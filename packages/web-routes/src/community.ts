import type { TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import type { Community } from "@tseer/types";
import {
  type Query,
  QueryKind,
  RankingMode,
  type Result,
  type TimelineResult,
  type User,
} from "@tseer/types";
import {
  type Render,
  renderCommunity,
  renderCommunityAbout,
  renderCommunityTabs,
  renderHashtagHeader,
  renderMemberTabs,
  renderTimelineTweets,
  renderTimelineUsers,
} from "@tseer/views";
import type { Context } from "cordis";
import { mountRoutes, type RouteShell } from "./shell.ts";
import { emptyTimeline, getCursor, getPath } from "./timeline.ts";

export interface CommunityRouteDeps {
  twitter: TwitterApi;
  render: Render;
  shell: RouteShell;
}

export function communityQuery(kind: QueryKind = QueryKind.posts): Query {
  return {
    kind,
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

export function registerCommunityRoutes(deps: CommunityRouteDeps): () => void {
  const { twitter, render, shell } = deps;
  const { route, showError } = shell;

  function dotCond(req: AppRequest, reply: AppReply, requestPrefs: TseerPreferences): boolean {
    const id = req.params["id"] ?? "";
    if (id.includes(".")) {
      showError(reply, "Page not found", 404, requestPrefs);
      return true;
    }
    return false;
  }

  async function respondCommunity(
    req: AppRequest,
    reply: AppReply,
    id: string,
    requestPrefs: TseerPreferences,
    title: (cmty: Community) => string,
    nav: (cmty: Community) => VNodeLike,
    body: (cmty: Community) => Promise<VNodeLike>,
  ): Promise<void> {
    const cmty = await twitter.cachedCommunity(id);
    if (cmty === undefined || cmty.id.length === 0 || cmty.name.length === 0) {
      showError(reply, `Community "${id}" not found`, 404, requestPrefs);
      return;
    }
    const html = await render.page({
      body: renderCommunity(await body(cmty), nav(cmty), cmty),
      title: title(cmty),
      banner: cmty.banner,
      path: getPath(req),
      prefs: requestPrefs,
    });
    await reply.html(html);
  }

  route({
    method: "GET",
    path: "/i/communities/:id",
    handler: async (req, reply, requestPrefs) => {
      if (dotCond(req, reply, requestPrefs)) return;
      await respondCommunity(
        req,
        reply,
        req.params["id"] ?? "",
        requestPrefs,
        (cmty) => cmty.name,
        (cmty) => renderCommunityTabs(QueryKind.posts, cmty),
        async (cmty) => {
          const timeline: TimelineResult =
            (await twitter.community(cmty.id, getCursor(req), RankingMode.Relevance)) ??
            emptyTimeline();
          timeline.query = communityQuery();
          return renderTimelineTweets(timeline, requestPrefs, getPath(req));
        },
      );
    },
  });

  route({
    method: "GET",
    path: "/i/communities/:id/latest",
    handler: async (req, reply, requestPrefs) => {
      if (dotCond(req, reply, requestPrefs)) return;
      await respondCommunity(
        req,
        reply,
        req.params["id"] ?? "",
        requestPrefs,
        (cmty) => `${cmty.name} - Latest`,
        (cmty) => renderCommunityTabs(QueryKind.replies, cmty),
        async (cmty) => {
          const timeline: TimelineResult =
            (await twitter.community(cmty.id, getCursor(req), RankingMode.Recency)) ??
            emptyTimeline();
          timeline.query = communityQuery();
          return renderTimelineTweets(timeline, requestPrefs, getPath(req));
        },
      );
    },
  });

  route({
    method: "GET",
    path: "/i/communities/:id/media",
    handler: async (req, reply, requestPrefs) => {
      if (dotCond(req, reply, requestPrefs)) return;
      await respondCommunity(
        req,
        reply,
        req.params["id"] ?? "",
        requestPrefs,
        (cmty) => `${cmty.name} - Media`,
        (cmty) => renderCommunityTabs(QueryKind.media, cmty),
        async (cmty) => {
          const timeline: TimelineResult =
            (await twitter.communityMedia(cmty.id, getCursor(req))) ?? emptyTimeline();
          timeline.query = communityQuery();
          return renderTimelineTweets(timeline, requestPrefs, getPath(req));
        },
      );
    },
  });

  route({
    method: "GET",
    path: "/i/communities/:id/about",
    handler: async (req, reply, requestPrefs) => {
      if (dotCond(req, reply, requestPrefs)) return;
      await respondCommunity(
        req,
        reply,
        req.params["id"] ?? "",
        requestPrefs,
        (cmty) => `${cmty.name} - About`,
        (cmty) => renderCommunityTabs(QueryKind.userList, cmty),
        async (cmty) =>
          renderCommunityAbout(cmty, (await twitter.cachedCommunityModerators(cmty.id)) ?? []),
      );
    },
  });

  route({
    method: "GET",
    path: "/i/communities/:id/members",
    handler: async (req, reply, requestPrefs) => {
      if (dotCond(req, reply, requestPrefs)) return;
      await respondCommunity(
        req,
        reply,
        req.params["id"] ?? "",
        requestPrefs,
        (cmty) => `${cmty.name} - Members`,
        (cmty) => renderMemberTabs(cmty, false),
        async (cmty) => {
          const members: Result<User> = (await twitter.communityMembers(
            cmty.id,
            getCursor(req),
          )) ?? {
            content: [],
            top: "",
            bottom: "",
            beginning: true,
            query: communityQuery(QueryKind.userList),
          };
          return renderTimelineUsers(members, requestPrefs, getPath(req));
        },
      );
    },
  });

  route({
    method: "GET",
    path: "/i/communities/:id/moderators",
    handler: async (req, reply, requestPrefs) => {
      if (dotCond(req, reply, requestPrefs)) return;
      await respondCommunity(
        req,
        reply,
        req.params["id"] ?? "",
        requestPrefs,
        (cmty) => `${cmty.name} - Moderators`,
        (cmty) => renderMemberTabs(cmty, true),
        async (cmty) => {
          const members: Result<User> = {
            content: (await twitter.cachedCommunityModerators(cmty.id)) ?? [],
            top: "",
            bottom: "",
            beginning: false,
            query: communityQuery(),
          };
          return renderTimelineUsers(members, requestPrefs, getPath(req));
        },
      );
    },
  });

  route({
    method: "GET",
    path: "/i/communities/:id/hashtag/:tag",
    handler: async (req, reply, requestPrefs) => {
      if (dotCond(req, reply, requestPrefs)) return;
      const tag = req.params["tag"] ?? "";
      await respondCommunity(
        req,
        reply,
        req.params["id"] ?? "",
        requestPrefs,
        (cmty) => `${cmty.name} - #${tag}`,
        (cmty) => renderHashtagHeader(cmty, tag),
        async (cmty) => {
          const timeline: TimelineResult =
            (await twitter.communityHashtags(cmty.id, tag, getCursor(req))) ?? emptyTimeline();
          timeline.query = communityQuery();
          return renderTimelineTweets(timeline, requestPrefs, getPath(req));
        },
      );
    },
  });

  return shell.dispose;
}

export default function communityPlugin(ctx: Context): () => void {
  return mountRoutes(ctx, "community", ["twitter"], (resolve, shell) =>
    registerCommunityRoutes({
      twitter: resolve<TwitterApi>("twitter"),
      render: resolve<Render>("render"),
      shell,
    }),
  );
}

communityPlugin.inject = ["server", "twitter", "render", "prefs"];
