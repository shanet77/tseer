/**
 * The timeline/user routes — port of nitter's `src/routes/timeline.nim`
 * (`/i/user/:id`, `/intent/*`, `/:name/about`, `/:name/followers|following`,
 * and the profile timeline `/:name/:tab?`), plus the error pages nitter's
 * `nitter.nim` maps the fetch errors to.
 *
 * First real consumer of `ctx.prefs` + `ctx.render` + `ctx.twitter` together:
 * handlers parse per-request prefs, fetch domain objects through the provider
 * seam, and render through the page shell. Inject-based like
 * `mediaRoutePlugin`, so mounting defers until all four seams exist — and
 * unloading the plugin removes exactly these routes.
 *
 * Divergences from the Nim original (documented at the call sites):
 * - Jester's optional `@tab` group becomes two registrations (`/:name`,
 *   `/:name/:tab`); fastify's radix router gives the static subpaths
 *   (`/about`, `/followers`, `/following`) precedence over `:tab`, mirroring
 *   nitter's dedicated routes. Every `:name`/`:tab` here uses the shared
 *   dotless params (`./params.ts`, the port of nitter's match-time
 *   `cond '.' notin name`), so asset URLs fall through to `staticDir`
 *   instead of 404ing as usernames.
 * - `cond` failures fall through to nitter's global 404 error page — the
 *   handlers answer 404 with `Page not found` directly (dotted names never
 *   reach a handler: they fall through to static first).
 * - `getUserId`'s pid-bucket lookup + "suspended" sentinel collapses into
 *   `cachedUser` (one cached user fetch instead of two; the suspended flag
 *   carries the sentinel).
 * - A user with an empty id renders 404 `User "x" not found` (nitter leaks an
 *   empty 200 body through `respTimeline` before the same message fires).
 */

import { decodeUrl } from "@tseer/media";
import type { PrefsService, TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest, HttpServer, RouteSpec } from "@tseer/server";
import {
  genQueryUrl,
  getArticlesQuery,
  getMediaQuery,
  getReplyQuery,
  initQuery,
  type ProfileTweets,
  type TwitterApi,
} from "@tseer/twitter-api";
import {
  BadClientError,
  InternalError,
  NoSessionsError,
  type Profile,
  type Query,
  QueryKind,
  type QueryKind as QueryKindT,
  RateLimitError,
  type Result,
  type TimelineResult,
  type Tweet,
  type User,
  VerifiedType,
} from "@tseer/types";
import type { Render } from "@tseer/views";
import {
  emptyAccountInfo,
  getSuspended,
  getUserPic,
  pageDesc,
  pageTitle,
  renderAboutAccount,
  renderProfile,
  renderProtected,
  renderTimelineTweets,
  renderTweetSearch,
  renderUserList,
  toHtml,
} from "@tseer/views";
import type { Context } from "cordis";
import { createShowError } from "./errors.ts";
import { NAME_PARAM, TAB_PARAM } from "./params.ts";

/** Subset of `ctx.config` the timeline routes read (declared locally so the
 * package never imports `@tseer/kernel`). */
interface TimelineConfig {
  enableRSSUserTweets?: boolean | undefined;
  enableRSSUserReplies?: boolean | undefined;
  enableRSSUserMedia?: boolean | undefined;
  enableRSSUserArticles?: boolean | undefined;
  enableRSSSearch?: boolean | undefined;
}

/** router_utils.nim `nitterParams`: path/route params that never reappear in
 * the query strings timeline links build (`getPath`). */
const NITTER_PARAMS = ["name", "tab", "id", "list", "referer", "scroll", "prefs"];

const RESERVED_NAMES = new Set([
  "pic",
  "gif",
  "video",
  "search",
  "settings",
  "login",
  "intent",
  "i",
]);
const NAME_CHARS = /^[A-Za-z0-9_,]+$/;
const SINGLE_NAME_CHARS = /^[A-Za-z0-9_]+$/;
const TABS = new Set(["with_replies", "media", "search", "articles"]);

/** router_utils.nim `getPath`: path + non-empty query params (minus nitter's
 * route params), the URL tabs/"load more" links point back at. */
export function getPath(req: AppRequest): string {
  const query = Object.entries(req.query)
    .filter(([key, value]) => value.length > 0 && !NITTER_PARAMS.includes(key))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return query.length > 0 ? `${req.path}?${query}` : req.path;
}

/** router_utils.nim `getCursor`: `?cursor=` (legacy `max_position`), decoded. */
export function getCursor(req: AppRequest): string {
  const cursor = req.query["cursor"] ?? req.query["max_position"] ?? "";
  return decodeUrl(cursor);
}

/** router_utils.nim `getNames`: `/name1,name2` → both (no empty parts). */
export function getNames(name: string): string[] {
  return name
    .replace(/^\/+|\/+$/g, "")
    .split(",")
    .filter((part) => part.length > 0);
}

/** timeline.nim's bare `Query(fromUser: @[name])` (posts kind). */
export function postsQuery(name: string): Query {
  return {
    kind: QueryKind.posts,
    view: "",
    text: "",
    filters: [],
    includes: [],
    excludes: [],
    fromUser: [name],
    since: "",
    until: "",
    minLikes: "",
    sep: "",
  };
}

/** timeline.nim `getQuery`: the tab's query (view override for media). */
export function timelineQuery(
  tab: string,
  name: string,
  prefs: TseerPreferences,
  params: Record<string, string>,
): Query {
  switch (tab) {
    case "with_replies":
      return getReplyQuery(name);
    case "articles":
      return getArticlesQuery(name);
    case "media": {
      const query = getMediaQuery(name);
      query.view = ["timeline", "grid", "gallery"].includes(params["view"] ?? "")
        ? (params["view"] ?? "")
        : prefs.mediaView.toLowerCase();
      return query;
    }
    case "search":
      return initQuery(params, name);
    default:
      return postsQuery(name);
  }
}

/** timeline.nim `tabRssEnabled` + the route's rss URL construction. */
export function tabRssUrl(config: TimelineConfig, tab: string, name: string, query: Query): string {
  const enabled =
    tab === ""
      ? (config.enableRSSUserTweets ?? true)
      : tab === "with_replies"
        ? (config.enableRSSUserReplies ?? true)
        : tab === "media"
          ? (config.enableRSSUserMedia ?? true)
          : tab === "articles"
            ? (config.enableRSSUserArticles ?? true)
            : tab === "search"
              ? (config.enableRSSSearch ?? true)
              : false;
  if (!enabled) return "";
  if (tab === "") return `/${name}/rss`;
  if (tab === "search") return `/${name}/search/rss?${genQueryUrl(query)}`;
  return `/${name}/${tab}/rss`;
}

/** Nim's zero-default `User(username: name)` (fetchProfile's empty profile). */
export function emptyUser(name: string): User {
  return {
    id: "",
    username: name,
    fullname: "",
    location: "",
    website: "",
    bio: "",
    userPic: "",
    banner: "",
    pinnedTweet: "",
    following: 0,
    followers: 0,
    tweets: 0,
    likes: 0,
    media: 0,
    verifiedType: VerifiedType.None,
    protected: false,
    suspended: false,
    joinDate: "",
  };
}

export function emptyTimeline(query: Query = postsQuery("")): TimelineResult {
  return { content: [], top: "", bottom: "", beginning: true, query };
}

function emptyUsers(kind: QueryKindT, name: string): Result<User> {
  return {
    content: [],
    top: "",
    bottom: "",
    beginning: true,
    query: { ...postsQuery(name), kind },
  };
}

export interface TimelineRouteDeps {
  server: HttpServer;
  twitter: import("@tseer/twitter-api").TwitterApi;
  render: Render;
  prefs: PrefsService;
  config: TimelineConfig | undefined;
}

export function registerTimelineRoutes(deps: TimelineRouteDeps): () => void {
  const { server, twitter, render, prefs } = deps;
  const disposers: (() => void)[] = [];
  const route = (spec: RouteSpec): void => {
    disposers.push(server.route(spec));
  };

  const showError = createShowError(render);

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

  /** `fetchProfile` (routes/timeline.nim): resolve the user, then the
   * timeline for the query kind (search when not a profile tab). */
  async function fetchProfile(
    query: Query,
    after: string,
    options: { skipRail?: boolean | undefined } = {},
  ): Promise<Profile> {
    const name = query.fromUser[0] ?? "";
    const user = (await twitter.cachedUser(name)) ?? emptyUser(name);

    // temporary fix to prevent errors from people browsing timelines
    // during/immediately after deployment
    let cursor = after;
    if (
      (query.kind === QueryKind.posts || query.kind === QueryKind.replies) &&
      cursor.startsWith("scroll")
    ) {
      cursor = "";
    }

    const rail =
      options.skipRail === true || query.kind === QueryKind.media
        ? []
        : ((await twitter.cachedPhotoRail(user.id)) ?? []);

    let pinned: Tweet | undefined;
    let tweets: TimelineResult;
    if (user.id === "") {
      tweets = emptyTimeline(query);
    } else {
      const byKind = await (async (): Promise<ProfileTweets | undefined> => {
        switch (query.kind) {
          case QueryKind.posts:
            return twitter.tweets(user.id, cursor);
          case QueryKind.replies:
            return twitter.tweetsAndReplies(user.id, cursor);
          case QueryKind.media:
            return twitter.media(user.id, cursor);
          case QueryKind.articles:
            return twitter.articles(user.id, cursor);
          default: {
            const searched = await twitter.search(query, cursor);
            return searched === undefined ? undefined : { pinned: undefined, tweets: searched };
          }
        }
      })();
      pinned = byKind?.pinned;
      tweets = byKind?.tweets ?? emptyTimeline(query);
    }

    const profile: Profile = {
      user,
      photoRail: rail,
      ...(pinned !== undefined ? { pinned } : {}),
      tweets,
      accountInfo: (await twitter.cachedAccountInfo(name, false)) ?? emptyAccountInfo(),
    };
    profile.tweets.query = query;
    return profile;
  }

  /** `showTimeline` (routes/timeline.nim): the profile page (or 404/suspended
   * error page). Returns false when the reply was already sent. */
  async function showTimeline(
    reply: AppReply,
    query: Query,
    requestPrefs: TseerPreferences,
    path: string,
    rss: string,
    after: string,
    name: string,
  ): Promise<boolean> {
    if (query.fromUser.length !== 1) {
      const timeline = (await twitter.search(query, after)) ?? emptyTimeline(query);
      await reply.html(
        await render.page({
          body: renderTweetSearch(timeline, requestPrefs, path),
          title: "Multi",
          rss,
          path,
          prefs: requestPrefs,
        }),
      );
      return true;
    }

    const profile = await fetchProfile(query, after);
    const user = profile.user;
    if (user.suspended) {
      showError(reply, getSuspended(user.username), 200, requestPrefs);
      return true;
    }
    if (user.id.length === 0) {
      showError(reply, `User "${name}" not found`, 404, requestPrefs);
      return true;
    }

    await reply.html(
      await render.page({
        body: renderProfile(profile, requestPrefs, path),
        title: pageTitle(user),
        desc: pageDesc(user),
        rss,
        images: [getUserPic(user.userPic, "_400x400")],
        banner: user.banner,
        path,
        prefs: requestPrefs,
      }),
    );
    return true;
  }

  // ---- /i/user/:user_id + /intent/user (respUserId) -----------------------

  async function respUserId(req: AppRequest, reply: AppReply): Promise<void> {
    const requestPrefs = prefs.parse(req.cookies, req.query);
    const userId = req.params["user_id"] ?? req.query["user_id"] ?? "";
    if (userId.length === 0) {
      showError(reply, "Page not found", 404, requestPrefs);
      return;
    }
    const username = await twitter.cachedUsername(userId);
    if (username.length > 0) {
      await reply.redirect(`/${username}`);
    } else {
      showError(reply, "User not found", 404, requestPrefs);
    }
  }

  route({
    method: "GET",
    path: "/i/user/:user_id",
    handler: (req, reply) => guard(reply, undefined, () => respUserId(req, reply)),
  });
  route({
    method: "GET",
    path: "/intent/user",
    handler: (req, reply) => guard(reply, undefined, () => respUserId(req, reply)),
  });

  // ---- /intent/follow ------------------------------------------------------

  route({
    method: "GET",
    path: "/intent/follow",
    handler: (req, reply) =>
      guard(reply, undefined, async () => {
        const requestPrefs = prefs.parse(req.cookies, req.query);
        const username = req.query["screen_name"] ?? "";
        if (username.length === 0) {
          showError(reply, "Missing screen_name parameter", 400, requestPrefs);
          return;
        }
        await reply.redirect(`/${username}`);
      }),
  });

  // ---- /:name/about --------------------------------------------------------

  route({
    method: "GET",
    path: `/${NAME_PARAM}/about`,
    handler: (req, reply) =>
      guard(reply, undefined, async () => {
        const name = req.params["name"] ?? "";
        const requestPrefs = prefs.parse(req.cookies, req.query);
        if (!SINGLE_NAME_CHARS.test(name)) {
          showError(reply, "Page not found", 404, requestPrefs);
          return;
        }
        const info = (await twitter.cachedAccountInfo(name)) ?? emptyAccountInfo();
        if (info.suspended) {
          showError(reply, getSuspended(name), 200, requestPrefs);
          return;
        }
        if (info.username.length === 0) {
          showError(reply, `User "${name}" not found`, 404, requestPrefs);
          return;
        }
        await reply.html(
          await render.page({
            body: renderAboutAccount(info),
            title: `About @${info.username}`,
            path: getPath(req),
            prefs: requestPrefs,
          }),
        );
      }),
  });

  // ---- /:name/followers | /:name/following ---------------------------------

  async function showConnections(
    req: AppRequest,
    reply: AppReply,
    kind: "followers" | "following",
  ): Promise<void> {
    const name = req.params["name"] ?? "";
    const requestPrefs = prefs.parse(req.cookies, req.query);
    if (!SINGLE_NAME_CHARS.test(name)) {
      showError(reply, "Page not found", 404, requestPrefs);
      return;
    }
    const user = (await twitter.cachedUser(name)) ?? emptyUser(name);
    if (user.id.length === 0) {
      showError(reply, `User "${name}" not found`, 404, requestPrefs);
      return;
    }
    if (user.suspended) {
      showError(reply, getSuspended(name), 200, requestPrefs);
      return;
    }
    const cursor = getCursor(req);
    const results =
      kind === "followers"
        ? ((await twitter.followers(user.id, cursor)) ?? emptyUsers(QueryKind.followers, name))
        : ((await twitter.following(user.id, cursor)) ?? emptyUsers(QueryKind.following, name));

    if (user.protected) {
      await reply.html(
        await render.page({
          body: renderProtected(user.username),
          title: `Protected account @${name}`,
          path: getPath(req),
          prefs: requestPrefs,
        }),
      );
      return;
    }

    const tab = kind === "followers" ? "Followers" : "Following";
    const title = (kind === "followers" ? "People following @" : "People followed by @") + name;
    await reply.html(
      await render.page({
        body: renderUserList(user, results, requestPrefs, getPath(req), tab),
        title,
        images: [getUserPic(user.userPic, "_400x400")],
        path: getPath(req),
        prefs: requestPrefs,
      }),
    );
  }

  route({
    method: "GET",
    path: `/${NAME_PARAM}/followers`,
    handler: (req, reply) =>
      guard(reply, undefined, () => showConnections(req, reply, "followers")),
  });
  route({
    method: "GET",
    path: `/${NAME_PARAM}/following`,
    handler: (req, reply) =>
      guard(reply, undefined, () => showConnections(req, reply, "following")),
  });

  // ---- /:name/:tab? (the timeline) -----------------------------------------

  async function showIndex(req: AppRequest, reply: AppReply, tab: string): Promise<void> {
    const name = req.params["name"] ?? "";
    const requestPrefs = prefs.parse(req.cookies, req.query);
    const validName = !name.includes(".") && NAME_CHARS.test(name) && !RESERVED_NAMES.has(name);
    if (
      !validName ||
      (tab.length > 0 && !TABS.has(tab)) ||
      (tab === "articles" && name.includes(","))
    ) {
      showError(reply, "Page not found", 404, requestPrefs);
      return;
    }

    const after = getCursor(req);
    const names = getNames(name);
    const query = timelineQuery(tab, name, requestPrefs, req.query);
    if (names.length !== 1) query.fromUser = names;

    const path = getPath(req);

    // used for the infinite scroll feature
    if (req.query["scroll"] !== undefined) {
      if (names.length !== 1) {
        const timeline = (await twitter.search(query, after)) ?? emptyTimeline(query);
        if (timeline.content.length === 0) {
          void reply.text("", { status: 204 });
          return;
        }
        timeline.beginning = true;
        void reply.html(toHtml(renderTweetSearch(timeline, requestPrefs, path)));
        return;
      }
      const profile = await fetchProfile(query, after, { skipRail: true });
      if (profile.tweets.content.length === 0) {
        void reply.text("", { status: 404 });
        return;
      }
      profile.tweets.beginning = true;
      void reply.html(toHtml(renderTimelineTweets(profile.tweets, requestPrefs, path)));
      return;
    }

    const rss = tabRssUrl(deps.config ?? {}, tab, name, query);
    await showTimeline(reply, query, requestPrefs, path, rss, after, name);
  }

  route({
    method: "GET",
    path: `/${NAME_PARAM}`,
    handler: (req, reply) => guard(reply, undefined, () => showIndex(req, reply, "")),
  });
  route({
    method: "GET",
    path: `/${NAME_PARAM}/${TAB_PARAM}`,
    handler: (req, reply) =>
      guard(reply, undefined, () => showIndex(req, reply, req.params["tab"] ?? "")),
  });

  return () => {
    for (const dispose of disposers) dispose();
  };
}

/** The timeline route plugin: `ctx.server` + `ctx.twitter` + `ctx.render` +
 * `ctx.prefs`. Unload it and only these routes disappear. */
export default function timelinePlugin(ctx: Context): () => void {
  const server = ctx.get("server" as never) as HttpServer | undefined;
  const twitter = ctx.get("twitter" as never) as TwitterApi | undefined;
  const render = ctx.get("render" as never) as Render | undefined;
  const prefs = ctx.get("prefs" as never) as PrefsService | undefined;
  const config = ctx.get("config" as never) as TimelineConfig | undefined;
  if (server === undefined)
    throw new Error("timeline: ctx.server is not mounted (load serverPlugin first)");
  if (twitter === undefined)
    throw new Error("timeline: ctx.twitter is not mounted (load twitterApiPlugin first)");
  if (render === undefined)
    throw new Error("timeline: ctx.render is not mounted (load renderPlugin first)");
  if (prefs === undefined)
    throw new Error("timeline: ctx.prefs is not mounted (load prefsPlugin first)");
  // cordis rc.10 does not run a plugin's returned disposer through
  // fiber.dispose(); the cleanup must be a real effect (same as
  // mediaRoutePlugin).
  const disposeRoutes = registerTimelineRoutes({ server, twitter, render, prefs, config });
  const disposeEffect = ctx.effect(() => () => {
    disposeRoutes();
  });
  return () => {
    disposeRoutes();
    void disposeEffect();
  };
}

timelinePlugin.inject = ["server", "twitter", "render", "prefs"];
