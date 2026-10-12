import { decodeUrl } from "@tseer/media";
import type { PrefsService, TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest, HttpServer, RouteSpec } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import {
  BadClientError,
  InternalError,
  NoSessionsError,
  type Query,
  QueryKind,
  RateLimitError,
  type Result,
  type TimelineResult,
  type User,
} from "@tseer/types";
import type { Render } from "@tseer/views";
import { renderList, renderTimelineTweets, renderTimelineUsers } from "@tseer/views";
import type { Context } from "cordis";
import { createShowError } from "./errors.ts";
import { NAME_PARAM } from "./params.ts";
import { getCursor, getPath } from "./timeline.ts";

interface ListConfig {
  enableRSSList?: boolean | undefined;
}

export interface ListRouteDeps {
  server: HttpServer;
  twitter: TwitterApi;
  render: Render;
  prefs: PrefsService;
  config: ListConfig | undefined;
}

export function listTitle(list: { username: string; name: string }): string {
  return `@${list.username}/${list.name}`;
}

export function listQuery(): Query {
  return {
    kind: QueryKind.posts,
    view: "",
    text: "",
    filters: [],
    includes: [],
    excludes: [],
    fromUser: [],
    since: "",
    until: "",
    minLikes: "",
    sep: "",
  };
}

type VNodeLike = Parameters<Render["page"]>[0]["body"];

export function registerListRoutes(deps: ListRouteDeps): () => void {
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

  function listNotFound(reply: AppReply, label: string, requestPrefs: TseerPreferences): void {
    showError(reply, `List "${label}" not found`, 404, requestPrefs);
  }

  async function respondList(
    req: AppRequest,
    reply: AppReply,
    listId: string,
    requestPrefs: TseerPreferences,
    body: (listQuery: Query) => Promise<VNodeLike>,
    notFoundLabel: string,
  ): Promise<void> {
    const list = await twitter.cachedList("", "", listId);
    if (list === undefined || list.id.length === 0 || list.name.length === 0) {
      listNotFound(reply, notFoundLabel, requestPrefs);
      return;
    }

    const query = listQuery();
    const html = await render.page({
      body: renderList(await body(query), query, list),
      title: listTitle(list),
      rss: (deps.config?.enableRSSList ?? true) ? `/i/lists/${list.id}/rss` : "",
      banner: list.banner,
      path: getPath(req),
      prefs: requestPrefs,
    });
    await reply.html(html);
  }

  route({
    method: "GET",
    path: `/${NAME_PARAM}/lists/:slug`,
    handler: (req, reply) =>
      guard(reply, undefined, async () => {
        const name = req.params["name"] ?? "";
        const slugParam = req.params["slug"] ?? "";
        const requestPrefs = prefs.parse(req.cookies, req.query);
        if (name === "i" || slugParam === "memberships") {
          showError(reply, "Page not found", 404, requestPrefs);
          return;
        }
        const slug = decodeUrl(slugParam);
        const list = await twitter.cachedList(name, slug);
        if (list === undefined || list.id.length === 0) {
          listNotFound(reply, slugParam, requestPrefs);
          return;
        }
        const cursor = getCursor(req);
        await reply.redirect(
          cursor.length > 0 ? `/i/lists/${list.id}?cursor=${cursor}` : `/i/lists/${list.id}`,
        );
      }),
  });

  route({
    method: "GET",
    path: "/i/lists/:id",
    handler: (req, reply) =>
      guard(reply, undefined, async () => {
        const id = req.params["id"] ?? "";
        const requestPrefs = prefs.parse(req.cookies, req.query);
        if (id.includes(".")) {
          showError(reply, "Page not found", 404, requestPrefs);
          return;
        }
        await respondList(
          req,
          reply,
          id,
          requestPrefs,
          async (query) => {
            const cursor = getCursor(req);
            const timeline: TimelineResult = (await twitter.list(id, cursor)) ?? {
              content: [],
              top: "",
              bottom: "",
              beginning: true,
              query,
            };
            timeline.query = query;
            return renderTimelineTweets(timeline, requestPrefs, getPath(req));
          },
          id,
        );
      }),
  });

  route({
    method: "GET",
    path: "/i/lists/:id/members",
    handler: (req, reply) =>
      guard(reply, undefined, async () => {
        const id = req.params["id"] ?? "";
        const requestPrefs = prefs.parse(req.cookies, req.query);
        if (id.includes(".")) {
          showError(reply, "Page not found", 404, requestPrefs);
          return;
        }
        await respondList(
          req,
          reply,
          id,
          requestPrefs,
          async (query) => {
            const cursor = getCursor(req);
            const members: Result<User> = (await twitter.listMembers(id, cursor)) ?? {
              content: [],
              top: "",
              bottom: "",
              beginning: true,
              query: { ...query, kind: QueryKind.userList },
            };
            members.query = { ...query, kind: QueryKind.userList };
            return renderTimelineUsers(members, requestPrefs, getPath(req));
          },
          id,
        );
      }),
  });

  return () => {
    for (const dispose of disposers) dispose();
  };
}

export default function listPlugin(ctx: Context): () => void {
  const server = ctx.get("server" as never) as HttpServer | undefined;
  const twitter = ctx.get("twitter" as never) as TwitterApi | undefined;
  const render = ctx.get("render" as never) as Render | undefined;
  const prefs = ctx.get("prefs" as never) as PrefsService | undefined;
  const config = ctx.get("config" as never) as ListConfig | undefined;
  if (server === undefined)
    throw new Error("list: ctx.server is not mounted (load serverPlugin first)");
  if (twitter === undefined)
    throw new Error("list: ctx.twitter is not mounted (load twitterApiPlugin first)");
  if (render === undefined)
    throw new Error("list: ctx.render is not mounted (load renderPlugin first)");
  if (prefs === undefined)
    throw new Error("list: ctx.prefs is not mounted (load prefsPlugin first)");
  const disposeRoutes = registerListRoutes({ server, twitter, render, prefs, config });
  const disposeEffect = ctx.effect(() => () => {
    disposeRoutes();
  });
  return () => {
    disposeRoutes();
    void disposeEffect();
  };
}

listPlugin.inject = ["server", "twitter", "render", "prefs"];
