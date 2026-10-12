/**
 * The community routes — port of nitter's `src/routes/community.nim`
 * (`/i/communities/@id` + the `latest`/`media`/`about`/`members`/
 * `moderators`/`hashtag/@tag` subpaths), plus the error pages nitter's
 * `nitter.nim` maps the fetch errors to.
 *
 * Same four-seam shape as the list/space plugins (`server` + `twitter` +
 * `render` + `prefs` via static `.inject`, `ctx.effect` cleanup, `guard`
 * error mapping). The community object rides `twitter.cachedCommunity` (the
 * `getCachedCommunity` port, `cm:` key) and the moderators ride
 * `twitter.cachedCommunityModerators` (`cmm:`); the page components come
 * from `views/community`. The static `communities` segment beats the
 * unsupported plugin's `/i/:i/:j` param regardless of mount order; that
 * plugin's deny list stays upstream-verbatim — with this plugin unmounted,
 * `/i/communities/:id` rendering the "Unsupported feature" panel is correct
 * upstream-shaped behavior.
 *
 * Divergences from the Nim original (documented at the call sites):
 * - Jester's `cond '.' notin @"id"` is an in-handler check: a dotted id
 *   answers the 404 page (`Page not found`), which is where a failed cond
 *   falls through upstream.
 * - Upstream fetches the tab's timeline *before* `respCommunity`'s gate
 *   runs, but with an empty `cmty.id` that fetch no-ops (every `getGraph*`
 *   returns on `id.len == 0`); this port gates first and only fetches for a
 *   community that exists.
 * - The moderators tab wraps the cached list in
 *   `Result[User](content: mods)` — Nim's zero-default `beginning: false`
 *   makes `renderTimelineUsers` emit a "Load newest" link, ported verbatim.
 * - The members tab renders with the parser's envelope query (an empty
 *   userList-kind query), whose pagination links are cursor-only — the same
 *   wire shape as upstream's zero-default `Query()`. The tweet timelines get
 *   the same treatment the list plugin applies (upstream renders them with
 *   the zero-default `Query()`, kind `posts`; the parser envelope's default
 *   kind is `tweets`, which would add `f=tweets` to the "Load more" links),
 *   so the route overwrites `timeline.query` after the fetch.
 */

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

/** The zero-default `Query(kind)` — the moderators envelope's query and the
 * fallback envelopes (upstream's zero-default `Query()`). */
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

/** The list plugin's `VNodeLike`: the page body's component type. */
type VNodeLike = Parameters<Render["page"]>[0]["body"];

export function registerCommunityRoutes(deps: CommunityRouteDeps): () => void {
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

  /** The shared in-handler `cond '.' notin @"id"`: a dotted id answers the
   * global 404 page. */
  function dotCond(req: AppRequest, reply: AppReply): boolean {
    const id = req.params["id"] ?? "";
    if (id.includes(".")) {
      showError(reply, "Page not found", 404, prefs.parse(req.cookies, req.query));
      return true;
    }
    return false;
  }

  /** community.nim `respCommunity`'s not-found gate, then the shell around
   * `renderCommunity` (banner in the head, tabs as the nav). */
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

  // ---- /i/communities/@id (Top) --------------------------------------------

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

  // ---- /i/communities/@id/latest --------------------------------------------

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

  // ---- /i/communities/@id/media ----------------------------------------------

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

  // ---- /i/communities/@id/about -----------------------------------------------

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

  // ---- /i/communities/@id/members ----------------------------------------------

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

  // ---- /i/communities/@id/moderators ---------------------------------------------

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
            // `Result[User](content: mods)`: Nim's zero-default
            // `beginning: false` renders the "Load newest" link, verbatim.
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

  // ---- /i/communities/@id/hashtag/@tag --------------------------------------------

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

/** The community route plugin: `ctx.server` + `ctx.twitter` + `ctx.render` +
 * `ctx.prefs`. Unload it and only these routes disappear. */
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
  // cordis rc.10 does not run a plugin's returned disposer through
  // fiber.dispose(); the cleanup must be a real effect (same as the sibling
  // route plugins).
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
