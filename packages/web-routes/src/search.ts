import { encodeUrl } from "@tseer/media";
import type { TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest } from "@tseer/server";
import { genQueryUrl, initQuery, type TwitterApi } from "@tseer/twitter-api";
import {
  InternalError,
  type ListSearchResult,
  type Query,
  QueryKind,
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
import { mountRoutes, type RouteShell } from "./shell.ts";
import { getCursor, getPath } from "./timeline.ts";

interface SearchConfig {
  title?: string | undefined;
  hostname?: string | undefined;
  useHttps?: boolean | undefined;
  enableRSSSearch?: boolean | undefined;
}

export interface SearchRouteDeps {
  twitter: TwitterApi;
  render: Render;
  shell: RouteShell;
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
  const { twitter, render, shell } = deps;
  const { route, showError } = shell;

  async function showSearch(
    req: AppRequest,
    reply: AppReply,
    requestPrefs: TseerPreferences,
  ): Promise<void> {
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
    handler: showSearch,
  });

  route({
    method: "GET",
    path: "/hashtag/:hash",
    handler: (req, reply) => {
      const hash = req.params["hash"] ?? "";
      return reply.redirect(`/search?f=tweets&q=${encodeUrl(`#${hash}`)}`);
    },
  });

  route({
    method: "GET",
    path: "/opensearch",
    handler: (_req, reply) => {
      const prefix = getStatusUrlPrefix({
        hostname: deps.config?.hostname,
        useHttps: deps.config?.useHttps,
      });
      const xml = generateOpenSearchXml(
        deps.config?.title ?? "Tseer",
        deps.config?.hostname ?? "",
        `${prefix}/search?f=tweets&q=`,
      );
      return reply.send(xml, "application/opensearchdescription+xml");
    },
  });

  return shell.dispose;
}

export default function searchPlugin(ctx: Context): () => void {
  return mountRoutes(ctx, "search", ["twitter"], (resolve, shell) =>
    registerSearchRoutes({
      twitter: resolve<TwitterApi>("twitter"),
      render: resolve<Render>("render"),
      config: resolve<SearchConfig | undefined>("config"),
      shell,
    }),
  );
}

searchPlugin.inject = ["server", "twitter", "render", "prefs"];
