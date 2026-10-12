import type { PrefsService, TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest, HttpServer, RouteSpec } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import type { Community } from "@tseer/types";
import {
  BadClientError,
  InternalError,
  NoSessionsError,
  type Query,
  QueryKind,
  RankingMode,
  RateLimitError,
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
import { createShowError } from "./errors.ts";
import { emptyTimeline, getCursor, getPath } from "./timeline.ts";

export interface CommunityRouteDeps {
  server: HttpServer;
  twitter: TwitterApi;
  render: Render;
  prefs: PrefsService;
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

  function dotCond(req: AppRequest, reply: AppReply): boolean {
    const id = req.params["id"] ?? "";
    if (id.includes(".")) {
      showError(reply, "Page not found", 404, prefs.parse(req.cookies, req.query));
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
    handler: (req, reply) =>
      guard(reply, undefined, async () => {
        if (dotCond(req, reply)) return;
        const requestPrefs = prefs.parse(req.cookies, req.query);
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
      }),
  });

  route({
    method: "GET",
    path: "/i/communities/:id/latest",
    handler: (req, reply) =>
      guard(reply, undefined, async () => {
        if (dotCond(req, reply)) return;
        const requestPrefs = prefs.parse(req.cookies, req.query);
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
      }),
  });

  route({
    method: "GET",
    path: "/i/communities/:id/media",
    handler: (req, reply) =>
      guard(reply, undefined, async () => {
        if (dotCond(req, reply)) return;
        const requestPrefs = prefs.parse(req.cookies, req.query);
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
      }),
  });

  route({
    method: "GET",
    path: "/i/communities/:id/about",
    handler: (req, reply) =>
      guard(reply, undefined, async () => {
        if (dotCond(req, reply)) return;
        const requestPrefs = prefs.parse(req.cookies, req.query);
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
      }),
  });

  route({
    method: "GET",
    path: "/i/communities/:id/members",
    handler: (req, reply) =>
      guard(reply, undefined, async () => {
        if (dotCond(req, reply)) return;
        const requestPrefs = prefs.parse(req.cookies, req.query);
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
      }),
  });

  route({
    method: "GET",
    path: "/i/communities/:id/moderators",
    handler: (req, reply) =>
      guard(reply, undefined, async () => {
        if (dotCond(req, reply)) return;
        const requestPrefs = prefs.parse(req.cookies, req.query);
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
      }),
  });

  route({
    method: "GET",
    path: "/i/communities/:id/hashtag/:tag",
    handler: (req, reply) =>
      guard(reply, undefined, async () => {
        if (dotCond(req, reply)) return;
        const tag = req.params["tag"] ?? "";
        const requestPrefs = prefs.parse(req.cookies, req.query);
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
      }),
  });

  return () => {
    for (const dispose of disposers) dispose();
  };
}

export default function communityPlugin(ctx: Context): () => void {
  const server = ctx.get("server" as never) as HttpServer | undefined;
  const twitter = ctx.get("twitter" as never) as TwitterApi | undefined;
  const render = ctx.get("render" as never) as Render | undefined;
  const prefs = ctx.get("prefs" as never) as PrefsService | undefined;
  if (server === undefined)
    throw new Error("community: ctx.server is not mounted (load serverPlugin first)");
  if (twitter === undefined)
    throw new Error("community: ctx.twitter is not mounted (load twitterApiPlugin first)");
  if (render === undefined)
    throw new Error("community: ctx.render is not mounted (load renderPlugin first)");
  if (prefs === undefined)
    throw new Error("community: ctx.prefs is not mounted (load prefsPlugin first)");
  const disposeRoutes = registerCommunityRoutes({ server, twitter, render, prefs });
  const disposeEffect = ctx.effect(() => () => {
    disposeRoutes();
  });
  return () => {
    disposeRoutes();
    void disposeEffect();
  };
}

communityPlugin.inject = ["server", "twitter", "render", "prefs"];
