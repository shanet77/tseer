/**
 * The search routes — port of nitter's `src/routes/search.nim` (`/search`,
 * `/hashtag/:hash`, `/opensearch`), plus the error pages nitter's
 * `nitter.nim` maps the fetch errors to.
 *
 * Consumes `ctx.server` + `ctx.twitter` + `ctx.render` + `ctx.prefs` like the
 * timeline plugin: handlers parse per-request prefs, build the `Query` with
 * `initQuery`, dispatch on its kind to `userSearch`/`search`/`listSearch`,
 * and render through the page shell. Unload it and only these routes
 * disappear.
 *
 * Divergences from the Nim original (documented at the call sites):
 * - The `f=user`/`f=list` x.com-compat remap happens after `initQuery`
 *   (nitter mutates the parsed query in the route; same here).
 * - `cond` failures have no counterpart — Jester's router DSL guards do not
 *   exist here; unknown `f=` kinds fall back to `tweets` inside `initQuery`
 *   except the kinds that legitimately reach the `else` 404 branch.
 */

import { encodeUrl } from "@tseer/media";
import type { PrefsService, TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest, HttpServer, RouteSpec } from "@tseer/server";
import { genQueryUrl, initQuery, type TwitterApi } from "@tseer/twitter-api";
import {
  BadClientError,
  InternalError,
  type ListSearchResult,
  NoSessionsError,
  type Query,
  QueryKind,
  RateLimitError,
  type Result,
  type TimelineResult,
  type User,
} from "@tseer/types";
import type { Render } from "@tseer/views";
import {
  getStatusUrlPrefix,
  renderListSearch,
  renderTweetSearch,
  renderUserSearch,
} from "@tseer/views";
import type { Context } from "cordis";
import { createShowError } from "./errors.ts";
import { getCursor, getPath } from "./timeline.ts";

/** Subset of `ctx.config` the search routes read (declared locally so the
 * package never imports `@tseer/kernel`). */
interface SearchConfig {
  title?: string | undefined;
  hostname?: string | undefined;
  useHttps?: boolean | undefined;
  enableRSSSearch?: boolean | undefined;
}

export interface SearchRouteDeps {
  server: HttpServer;
  twitter: TwitterApi;
  render: Render;
  prefs: PrefsService;
  config: SearchConfig | undefined;
}

/** search.nim `createSearchRouter`'s title: `Search` + ` (q)` when querying. */
export function searchTitle(q: string): string {
  return q.length > 0 ? `Search (${q})` : "Search";
}

/** search.nim's `f=user`/`f=list` x.com-compat remap (route-level, not query.nim). */
export function remapSearchKind(query: Query, f: string): Query {
  if (f === "user") return { ...query, kind: QueryKind.users };
  if (f === "list") return { ...query, kind: QueryKind.lists };
  return query;
}

/** search.nim's media view default (mirrors the `/user/media` tab rule). */
export function defaultMediaView(query: Query, mediaView: string): Query {
  if (query.kind === QueryKind.media && !["timeline", "grid", "gallery"].includes(query.view)) {
    return { ...query, view: mediaView.toLowerCase() };
  }
  return query;
}

/** opensearch.nimf `generateOpenSearchXML` — the template is a static string. */
export function generateOpenSearchXml(name: string, hostname: string, url: string): string {
  const escapeXml = (s: string): string =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/"\n                       xmlns:moz="http://www.mozilla.org/2006/browser/search/">\n  <ShortName>${escapeXml(name)}</ShortName>\n  <Description>Twitter search via ${escapeXml(hostname)}</Description>\n  <InputEncoding>UTF-8</InputEncoding>\n  <Url type="text/html" template="${escapeXml(url)}{searchTerms}" />\n</OpenSearchDescription>\n`;
}

export function emptyTimelineSearch(query: Query): TimelineResult {
  return { content: [], top: "", bottom: "", beginning: true, query };
}

export function emptyUserSearch(query: Query): Result<User> {
  return { content: [], top: "", bottom: "", beginning: true, query };
}

export function emptyListSearch(query: Query): Result<ListSearchResult> {
  return { content: [], top: "", bottom: "", beginning: true, query };
}

export function registerSearchRoutes(deps: SearchRouteDeps): () => void {
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

  async function showSearch(req: AppRequest, reply: AppReply): Promise<void> {
    const requestPrefs = prefs.parse(req.cookies, req.query);
    const q = req.query["q"] ?? "";
    if (q.length > 500) {
      showError(reply, "Search input too long.", 400, requestPrefs);
      return;
    }

    const title = searchTitle(q);
    let query = remapSearchKind(initQuery(req.query), req.query["f"] ?? "");
    query = defaultMediaView(query, requestPrefs.mediaView);

    const after = getCursor(req);
    const path = getPath(req);

    switch (query.kind) {
      case QueryKind.users: {
        if (q.includes(",")) {
          await reply.redirect(`/${q}`);
          return;
        }
        // nitter swallows InternalError here and renders the empty page
        // (a failed people-search is a miss, not a 500).
        let users: Result<User>;
        try {
          users = (await twitter.userSearch(query, after)) ?? emptyUserSearch(query);
        } catch (error) {
          if (error instanceof InternalError) {
            users = emptyUserSearch(query);
          } else {
            throw error;
          }
        }
        await reply.html(
          await render.page({
            body: renderUserSearch(users, requestPrefs),
            title,
            path,
            prefs: requestPrefs,
          }),
        );
        return;
      }
      case QueryKind.tweets:
      case QueryKind.top:
      case QueryKind.media: {
        const tweets = (await twitter.search(query, after)) ?? emptyTimelineSearch(query);
        const rss =
          (deps.config?.enableRSSSearch ?? true) ? `/search/rss?${genQueryUrl(query)}` : "";
        await reply.html(
          await render.page({
            body: renderTweetSearch(tweets, requestPrefs, path),
            title,
            rss,
            path,
            prefs: requestPrefs,
          }),
        );
        return;
      }
      case QueryKind.lists: {
        const lists = (await twitter.listSearch(query, after)) ?? emptyListSearch(query);
        await reply.html(
          await render.page({
            body: renderListSearch(lists, requestPrefs, path),
            title,
            path,
            prefs: requestPrefs,
          }),
        );
        return;
      }
      default: {
        showError(reply, "Invalid search", 404, requestPrefs);
        return;
      }
    }
  }

  route({
    method: "GET",
    path: "/search",
    handler: (req, reply) => guard(reply, undefined, () => showSearch(req, reply)),
  });

  route({
    method: "GET",
    path: "/hashtag/:hash",
    handler: (req, reply) =>
      guard(reply, undefined, async () => {
        const hash = req.params["hash"] ?? "";
        await reply.redirect(`/search?f=tweets&q=${encodeUrl(`#${hash}`)}`);
      }),
  });

  route({
    method: "GET",
    path: "/opensearch",
    handler: (_req, reply) =>
      guard(reply, undefined, async () => {
        const prefix = getStatusUrlPrefix({
          hostname: deps.config?.hostname,
          useHttps: deps.config?.useHttps,
        });
        const xml = generateOpenSearchXml(
          deps.config?.title ?? "nitter",
          deps.config?.hostname ?? "",
          `${prefix}/search?f=tweets&q=`,
        );
        await reply.send(xml, "application/opensearchdescription+xml");
      }),
  });

  return () => {
    for (const dispose of disposers) dispose();
  };
}

/** The search route plugin: `ctx.server` + `ctx.twitter` + `ctx.render` +
 * `ctx.prefs`. Unload it and only these routes disappear. */
export default function searchPlugin(ctx: Context): () => void {
  const server = ctx.get("server" as never) as HttpServer | undefined;
  const twitter = ctx.get("twitter" as never) as TwitterApi | undefined;
  const render = ctx.get("render" as never) as Render | undefined;
  const prefs = ctx.get("prefs" as never) as PrefsService | undefined;
  const config = ctx.get("config" as never) as SearchConfig | undefined;
  if (server === undefined)
    throw new Error("search: ctx.server is not mounted (load serverPlugin first)");
  if (twitter === undefined)
    throw new Error("search: ctx.twitter is not mounted (load twitterApiPlugin first)");
  if (render === undefined)
    throw new Error("search: ctx.render is not mounted (load renderPlugin first)");
  if (prefs === undefined)
    throw new Error("search: ctx.prefs is not mounted (load prefsPlugin first)");
  // cordis rc.10 does not run a plugin's returned disposer through
  // fiber.dispose(); the cleanup must be a real effect (same as
  // timelinePlugin/mediaRoutePlugin).
  const disposeRoutes = registerSearchRoutes({ server, twitter, render, prefs, config });
  const disposeEffect = ctx.effect(() => () => {
    disposeRoutes();
  });
  return () => {
    disposeRoutes();
    void disposeEffect();
  };
}

searchPlugin.inject = ["server", "twitter", "render", "prefs"];
