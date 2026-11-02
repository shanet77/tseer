import { decodeUrl } from "@tseer/media";
import type { TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import { type Query, QueryKind, type Result, type TimelineResult, type User } from "@tseer/types";
import type { Render } from "@tseer/views";
import { renderList, renderTimelineTweets, renderTimelineUsers } from "@tseer/views";
import type { Context } from "cordis";
import { NAME_PARAM } from "./params.ts";
import { mountRoutes, type RouteShell } from "./shell.ts";
import { getCursor, getPath } from "./timeline.ts";

interface ListConfig {
  enableRSSList?: boolean | undefined;
}

export interface ListRouteDeps {
  twitter: TwitterApi;
  render: Render;
  shell: RouteShell;
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
  const { twitter, render, shell } = deps;
  const { route, showError } = shell;

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
    handler: async (req, reply, requestPrefs) => {
      const name = req.params["name"] ?? "";
      const slugParam = req.params["slug"] ?? "";
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
    },
  });

  route({
    method: "GET",
    path: "/i/lists/:id",
    handler: async (req, reply, requestPrefs) => {
      const id = req.params["id"] ?? "";
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
    },
  });

  route({
    method: "GET",
    path: "/i/lists/:id/members",
    handler: async (req, reply, requestPrefs) => {
      const id = req.params["id"] ?? "";
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
    },
  });

  return shell.dispose;
}

export default function listPlugin(ctx: Context): () => void {
  return mountRoutes(ctx, "list", ["twitter"], (resolve, shell) =>
    registerListRoutes({
      twitter: resolve<TwitterApi>("twitter"),
      render: resolve<Render>("render"),
      config: resolve<ListConfig | undefined>("config"),
      shell,
    }),
  );
}

listPlugin.inject = ["server", "twitter", "render", "prefs"];
