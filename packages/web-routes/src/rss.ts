/**
 * The RSS routes — port of nitter's `src/routes/rss.nim` (`/search/rss`,
 * `/:name/rss`, `/:name/:tab/rss`, `/:name/lists/:slug/rss`,
 * `/i/lists/:id/rss`), plus the error pages nitter's `nitter.nim` maps the
 * fetch errors to.
 *
 * Same four-seam shape as the timeline/status/search plugins (`server` +
 * `twitter` + `render` + `prefs` via static `.inject`, `ctx.effect` cleanup,
 * `guard` error mapping). The rendered feed + min cursor ride
 * `twitter.cachedRss` (the `getCachedRss`/`cacheRss` port), so a cache-less
 * context pays latency and nothing worse. Feed HTML comes from `views/rss`
 * (the `rss.nimf` port); this file owns routes, gates, and cache keys.
 *
 * Divergences from the Nim original (documented at the call sites):
 * - `/:name/rss` and `/:name/:tab/rss` are separate registrations (Jester's
 *   `/@name/?@tab?/rss` group); fastify's radix router gives the static `rss`
 *   segment precedence over the timeline plugin's `/:name/:tab` param, so
 *   mount order does not matter.
 * - The search-key `$hash(...)` is FNV-1a, not Nim's `hash` (unstable across
 *   builds; same substitution as the `pid:` buckets in `@tseer/cache`).
 * - `timelineRss` resolves the user through `cachedUser` (one cached fetch)
 *   instead of nitter's `getUserId` pid-bucket lookup + `getCachedUser` pair;
 *   the suspended flag carries the `"suspended"` sentinel.
 */

import { fnv1a32 } from "@tseer/cache";
import { decodeUrl, encodeUrl } from "@tseer/media";
import type { PrefsService, TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest, HttpServer, RouteSpec } from "@tseer/server";
import { genQueryUrl, initQuery, type TwitterApi } from "@tseer/twitter-api";
import {
  BadClientError,
  InternalError,
  NoSessionsError,
  type Profile,
  type Query,
  QueryKind,
  RateLimitError,
  type Rss,
  type TimelineResult,
  type User,
} from "@tseer/types";
import type { Render } from "@tseer/views";
import {
  defaultProfilePic,
  emptyAccountInfo,
  getSuspended,
  renderListRss,
  renderSearchRss,
  renderTimelineRss,
} from "@tseer/views";
import type { Context } from "cordis";
import { emptyTimelineSearch } from "./search.ts";
import {
  emptyTimeline,
  emptyUser,
  getCursor,
  getNames,
  postsQuery,
  timelineQuery,
} from "./timeline.ts";

/** Subset of `ctx.config` the RSS routes read (declared locally so the
 * package never imports `@tseer/kernel`). */
interface RssConfig {
  hostname?: string | undefined;
  useHttps?: boolean | undefined;
  enableRSSUserTweets?: boolean | undefined;
  enableRSSUserReplies?: boolean | undefined;
  enableRSSUserMedia?: boolean | undefined;
  enableRSSUserArticles?: boolean | undefined;
  enableRSSSearch?: boolean | undefined;
  enableRSSList?: boolean | undefined;
}

/** rss.nim's `@tab` cond for the `/:name/:tab/rss` route. */
const RSS_TABS = new Set(["with_replies", "media", "search", "articles"]);

export interface RssRouteDeps {
  server: HttpServer;
  twitter: TwitterApi;
  render: Render;
  prefs: PrefsService;
  config: RssConfig | undefined;
}

/** rss.nim `redisKey`: `<page>:<name>` + `:<cursor>` when paged. */
export function redisKey(page: string, name: string, cursor: string): string {
  let key = `${page}:${name}`;
  if (cursor.length > 0) key += `:${cursor}`;
  return key;
}

/**
 * rss.nim's `$hash(genQueryUrl(query))` for the search cache keys. Nim's
 * `hash` is not stable across builds, so this is FNV-1a (the same
 * substitution `@tseer/cache` uses for the `pid:` buckets).
 */
export function searchKeyHash(query: Query): string {
  return String(fnv1a32(genQueryUrl(query)));
}

/** timeline.nim `tabRssEnabled` (the `""` tab is the plain `/:name/rss`). */
export function rssTabEnabled(config: RssConfig, tab: string): boolean {
  switch (tab) {
    case "":
      return config.enableRSSUserTweets ?? true;
    case "with_replies":
      return config.enableRSSUserReplies ?? true;
    case "media":
      return config.enableRSSUserMedia ?? true;
    case "articles":
      return config.enableRSSUserArticles ?? true;
    case "search":
      return config.enableRSSSearch ?? true;
    default:
      return false;
  }
}

/** Feed-render inputs `timelineRss` needs beyond the query. */
export interface RssFeedEnv {
  hostname: string;
  useHttps: boolean;
  prefs: TseerPreferences;
}

/**
 * rss.nim `timelineRss`: the single-name profile fetch (photo rail skipped,
 * like nitter's `skipRail=true`) or the multi-user search fallback with its
 * default-pic stub user. An unknown user yields the empty cursor (the route
 * answers 404); a suspended one yields the `"suspended"` sentinel.
 */
export async function timelineRss(
  twitter: TwitterApi,
  name: string,
  query: Query,
  after: string,
  env: RssFeedEnv,
): Promise<Rss> {
  const names = getNames(name);
  if (names.length !== 1) {
    const multi: Query = { ...query, fromUser: names };
    const searched = await twitter.search(multi, after);
    const tweets = searched ?? emptyTimeline(multi);
    const user: User = {
      ...emptyUser(name),
      fullname: names.join(" | "),
      userPic: defaultProfilePic(),
    };
    return {
      feed: renderTimelineRss(
        { user, photoRail: [], tweets, accountInfo: emptyAccountInfo() },
        { hostname: env.hostname, useHttps: env.useHttps },
        env.prefs,
        true,
      ),
      cursor: tweets.bottom,
    };
  }

  const single = names[0] ?? "";
  // timeline.nim's post-deployment `scroll` guard, kept for the posts/replies kinds.
  let cursor = after;
  if (
    (query.kind === QueryKind.posts || query.kind === QueryKind.replies) &&
    cursor.startsWith("scroll")
  ) {
    cursor = "";
  }

  const user = (await twitter.cachedUser(single)) ?? emptyUser(single);
  if (user.suspended) return { feed: user.username, cursor: "suspended" };

  let tweets: TimelineResult;
  if (user.id === "") {
    tweets = emptyTimeline(query);
  } else {
    switch (query.kind) {
      case QueryKind.posts:
        tweets = (await twitter.tweets(user.id, cursor))?.tweets ?? emptyTimeline(query);
        break;
      case QueryKind.replies:
        tweets = (await twitter.tweetsAndReplies(user.id, cursor))?.tweets ?? emptyTimeline(query);
        break;
      case QueryKind.media:
        tweets = (await twitter.media(user.id, cursor))?.tweets ?? emptyTimeline(query);
        break;
      case QueryKind.articles:
        tweets = (await twitter.articles(user.id, cursor))?.tweets ?? emptyTimeline(query);
        break;
      default:
        tweets = (await twitter.search(query, cursor)) ?? emptyTimeline(query);
        break;
    }
  }

  if (user.fullname.length === 0) return { feed: "", cursor: "" };
  const profile: Profile = { user, photoRail: [], tweets, accountInfo: emptyAccountInfo() };
  return {
    feed: renderTimelineRss(
      profile,
      { hostname: env.hostname, useHttps: env.useHttps },
      env.prefs,
      false,
    ),
    cursor: tweets.bottom,
  };
}

export function registerRssRoutes(deps: RssRouteDeps): () => void {
  const { server, twitter, render, prefs } = deps;
  const disposers: (() => void)[] = [];
  const route = (spec: RouteSpec): void => {
    disposers.push(server.route(spec));
  };

  function showError(
    reply: AppReply,
    message: string,
    status = 200,
    requestPrefs?: TseerPreferences,
  ): void {
    void reply.html(render.errorPage(message, undefined, requestPrefs), { status });
  }

  /** nitter.nim's error pages: the fetch loop's failures get real pages. */
  async function guard(
    reply: AppReply,
    requestPrefs: TseerPreferences | undefined,
    body: () => Promise<void>,
  ): Promise<void> {
    try {
      await body();
    } catch (error) {
      if (error instanceof RateLimitError) {
        showError(
          reply,
          "Instance has been rate limited. Use another instance or try again later.",
          429,
          requestPrefs,
        );
        return;
      }
      if (error instanceof NoSessionsError) {
        showError(
          reply,
          "Instance has no auth tokens, or is fully rate limited. Use another instance or try again later.",
          429,
          requestPrefs,
        );
        return;
      }
      if (error instanceof InternalError) {
        showError(
          reply,
          "An error occurred, please open a GitHub issue with the URL you tried to visit.",
          500,
          requestPrefs,
        );
        return;
      }
      if (error instanceof BadClientError) {
        showError(reply, "Network error occurred, please try again.", 500, requestPrefs);
        return;
      }
      throw error;
    }
  }

  function feedEnv(requestPrefs: TseerPreferences): RssFeedEnv {
    return {
      hostname: deps.config?.hostname ?? "",
      useHttps: deps.config?.useHttps ?? false,
      prefs: requestPrefs,
    };
  }

  /** rss.nim `respRss`: empty cursor 404s, `"suspended"` names the account. */
  function respondRss(
    reply: AppReply,
    rss: Rss,
    page: "User" | "List" | "Search",
    label: string,
    requestPrefs: TseerPreferences,
  ): void {
    if (rss.cursor.length === 0) {
      const info = page === "Search" ? " " : ` "${label}" `;
      showError(reply, `${page}${info}not found`, 404, requestPrefs);
      return;
    }
    if (rss.cursor === "suspended") {
      showError(reply, getSuspended(label), 404, requestPrefs);
      return;
    }
    void reply.send(rss.feed, "application/rss+xml; charset=utf-8", {
      headers: { "Min-Id": rss.cursor },
    });
  }

  async function showSearchRss(req: AppRequest, reply: AppReply): Promise<void> {
    const requestPrefs = prefs.parse(req.cookies, req.query);
    if (!(deps.config?.enableRSSSearch ?? true)) {
      showError(reply, "RSS feed is disabled", 403, requestPrefs);
      return;
    }
    if ((req.query["q"] ?? "").length > 200) {
      showError(reply, "Search input too long.", 400, requestPrefs);
      return;
    }
    const query = initQuery(req.query);
    if (
      query.kind !== QueryKind.tweets &&
      query.kind !== QueryKind.top &&
      query.kind !== QueryKind.media
    ) {
      showError(reply, "Only Tweet searches are allowed for RSS feeds.", 400, requestPrefs);
      return;
    }

    const cursor = getCursor(req);
    const key = redisKey("search", searchKeyHash(query), cursor);
    const rss = await twitter.cachedRss(key, async () => {
      const tweets = (await twitter.search(query, cursor)) ?? emptyTimelineSearch(query);
      return {
        feed: renderSearchRss(
          tweets.content,
          query.text,
          genQueryUrl(query),
          { hostname: deps.config?.hostname ?? "", useHttps: deps.config?.useHttps ?? false },
          requestPrefs,
        ),
        cursor: tweets.bottom,
      };
    });
    respondRss(reply, rss, "Search", "", requestPrefs);
  }

  async function showUserRss(req: AppRequest, reply: AppReply, tab: string): Promise<void> {
    const name = req.params["name"] ?? "";
    const requestPrefs = prefs.parse(req.cookies, req.query);
    if (name.includes(".") || (tab.length > 0 && !RSS_TABS.has(tab))) {
      showError(reply, "Page not found", 404, requestPrefs);
      return;
    }
    // articles can't be approximated by search, so multi-user is unsupported
    if (tab === "articles" && name.includes(",")) {
      showError(reply, "Page not found", 404, requestPrefs);
      return;
    }
    if (!rssTabEnabled(deps.config ?? {}, tab)) {
      showError(reply, "RSS feed is disabled", 403, requestPrefs);
      return;
    }

    const cursor = getCursor(req);
    const query = tab === "" ? postsQuery(name) : timelineQuery(tab, name, requestPrefs, req.query);
    const searchKey = tab === "search" ? `:${searchKeyHash(query)}` : "";
    const key = redisKey(tab === "" ? "twitter" : tab, `${name}${searchKey}`, cursor);
    const rss = await twitter.cachedRss(key, () =>
      timelineRss(twitter, name, query, cursor, feedEnv(requestPrefs)),
    );
    respondRss(reply, rss, "User", name, requestPrefs);
  }

  route({
    method: "GET",
    path: "/search/rss",
    handler: (req, reply) => guard(reply, undefined, () => showSearchRss(req, reply)),
  });

  route({
    method: "GET",
    path: "/:name/rss",
    handler: (req, reply) => guard(reply, undefined, () => showUserRss(req, reply, "")),
  });

  route({
    method: "GET",
    path: "/:name/:tab/rss",
    handler: (req, reply) =>
      guard(reply, undefined, () => showUserRss(req, reply, req.params["tab"] ?? "")),
  });

  route({
    method: "GET",
    path: "/:name/lists/:slug/rss",
    handler: (req, reply) =>
      guard(reply, undefined, async () => {
        const name = req.params["name"] ?? "";
        const slug = req.params["slug"] ?? "";
        const requestPrefs = prefs.parse(req.cookies, req.query);
        if (name === "i") {
          showError(reply, "Page not found", 404, requestPrefs);
          return;
        }
        if (!(deps.config?.enableRSSList ?? true)) {
          showError(reply, "RSS feed is disabled", 403, requestPrefs);
          return;
        }
        const list = await twitter.cachedList(name, decodeUrl(slug));
        if (list === undefined || list.id === "") {
          showError(reply, `List "${slug}" not found`, 404, requestPrefs);
          return;
        }
        const cursor = getCursor(req);
        const target = `/i/lists/${list.id}/rss`;
        await reply.redirect(cursor.length > 0 ? `${target}?cursor=${encodeUrl(cursor)}` : target);
      }),
  });

  route({
    method: "GET",
    path: "/i/lists/:id/rss",
    handler: (req, reply) =>
      guard(reply, undefined, async () => {
        const id = req.params["id"] ?? "";
        const requestPrefs = prefs.parse(req.cookies, req.query);
        if (!(deps.config?.enableRSSList ?? true)) {
          showError(reply, "RSS feed is disabled", 403, requestPrefs);
          return;
        }
        const cursor = getCursor(req);
        const key = redisKey("lists", id, cursor);
        const rss = await twitter.cachedRss(key, async () => {
          const list = await twitter.cachedList("", "", id);
          if (list === undefined || list.id === "") return { feed: "", cursor: "" };
          const timeline = await twitter.list(list.id, cursor);
          if (timeline === undefined) return { feed: "", cursor: "" };
          return {
            feed: renderListRss(
              timeline.content,
              list,
              { hostname: deps.config?.hostname ?? "", useHttps: deps.config?.useHttps ?? false },
              requestPrefs,
            ),
            cursor: timeline.bottom,
          };
        });
        respondRss(reply, rss, "List", id, requestPrefs);
      }),
  });

  return () => {
    for (const dispose of disposers) dispose();
  };
}

/** The RSS route plugin: `ctx.server` + `ctx.twitter` + `ctx.render` +
 * `ctx.prefs`. Unload it and only these routes disappear. */
export default function rssPlugin(ctx: Context): () => void {
  const server = ctx.get("server" as never) as HttpServer | undefined;
  const twitter = ctx.get("twitter" as never) as TwitterApi | undefined;
  const render = ctx.get("render" as never) as Render | undefined;
  const prefs = ctx.get("prefs" as never) as PrefsService | undefined;
  const config = ctx.get("config" as never) as RssConfig | undefined;
  if (server === undefined)
    throw new Error("rss: ctx.server is not mounted (load serverPlugin first)");
  if (twitter === undefined)
    throw new Error("rss: ctx.twitter is not mounted (load twitterApiPlugin first)");
  if (render === undefined)
    throw new Error("rss: ctx.render is not mounted (load renderPlugin first)");
  if (prefs === undefined)
    throw new Error("rss: ctx.prefs is not mounted (load prefsPlugin first)");
  // cordis rc.10 does not run a plugin's returned disposer through
  // fiber.dispose(); the cleanup must be a real effect (same as
  // timelinePlugin/mediaRoutePlugin).
  const disposeRoutes = registerRssRoutes({ server, twitter, render, prefs, config });
  const disposeEffect = ctx.effect(() => () => {
    disposeRoutes();
  });
  return () => {
    disposeRoutes();
    void disposeEffect();
  };
}

rssPlugin.inject = ["server", "twitter", "render", "prefs"];
