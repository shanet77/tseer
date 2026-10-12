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

export function searchTitle(q: string): string {
  return q.length > 0 ? `Search (${q})` : "Search";
}

export function remapSearchKind(query: Query, f: string): Query {
  if (f === "user") return { ...query, kind: QueryKind.users };
  if (f === "list") return { ...query, kind: QueryKind.lists };
  return query;
}

export function defaultMediaView(query: Query, mediaView: string): Query {
  if (query.kind === QueryKind.media && !["timeline", "grid", "gallery"].includes(query.view)) {
    return { ...query, view: mediaView.toLowerCase() };
  }
  return query;
}

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
