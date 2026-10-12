import { encodeUrl } from "@tseer/media";
import type { PrefsService, TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest, HttpServer, RouteSpec } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import {
  BadClientError,
  InternalError,
  MediaKind,
  NoSessionsError,
  RankingMode,
  RateLimitError,
} from "@tseer/types";
import type { Render } from "@tseer/views";
import {
  getPicUrl,
  getStatusUrlPrefix,
  getVideoEmbed,
  pageTitle,
  pageTitleOfTweet,
  renderConversation,
  renderEditHistory,
  renderReplies,
  toHtml,
} from "@tseer/views";
import type { Context } from "cordis";
import { createShowError } from "./errors.ts";
import { NAME_PARAM } from "./params.ts";
import { getCursor, getPath } from "./timeline.ts";

interface StatusConfig {
  hostname?: string | undefined;
  useHttps?: boolean | undefined;
}

export function isValidTweetId(id: string): boolean {
  return id.length > 0 && id.length <= 19 && /^[0-9]+$/.test(id);
}

export function parseSortMode(raw: string | undefined): RankingMode {
  const normalized = (raw ?? "").toLowerCase();
  if (normalized === "recency" || normalized === "recent") return RankingMode.Recency;
  if (normalized === "likes" || normalized === "liked") return RankingMode.Likes;
  return RankingMode.Relevance;
}

export interface StatusRouteDeps {
  server: HttpServer;
  twitter: TwitterApi;
  render: Render;
  prefs: PrefsService;
  config: StatusConfig | undefined;
}

export function registerStatusRoutes(deps: StatusRouteDeps): () => void {
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

  async function showStatus(req: AppRequest, reply: AppReply): Promise<void> {
    const requestPrefs = prefs.parse(req.cookies, req.query);
    const name = req.params["name"] ?? "";
    const id = req.params["id"] ?? "";

    if (name.includes(".")) {
      showError(reply, "Page not found", 404, requestPrefs);
      return;
    }
    if (!isValidTweetId(id)) {
      showError(reply, "Invalid tweet ID", 404, requestPrefs);
      return;
    }

    const sort = parseSortMode(req.query["sort"]);
    const cursor = getCursor(req);
    const path = getPath(req);

    if (req.query["scroll"] !== undefined) {
      const conv = await twitter.tweet(id, cursor, sort);
      const replies = conv?.replies;
      if (replies === undefined || replies.content.length === 0) {
        void reply.text("", { status: 204 });
        return;
      }
      void reply.html(toHtml(renderReplies(replies, requestPrefs, path, conv?.tweet, sort)));
      return;
    }

    const conv = await twitter.tweet(id, cursor, sort);
    if (conv === undefined || conv.tweet.id === "") {
      let error = "Tweet not found";
      if (conv !== undefined && conv.tweet.tombstone.length > 0) error = conv.tweet.tombstone;
      showError(reply, error, 404, requestPrefs);
      return;
    }

    const title = pageTitleOfTweet(conv.tweet);
    const ogTitle = pageTitle(conv.tweet.user);
    const desc = conv.tweet.text;

    const prefix = getStatusUrlPrefix({
      hostname: deps.config?.hostname,
      useHttps: deps.config?.useHttps,
    });
    let images = conv.tweet.media
      .filter((item) => item.kind === MediaKind.photoMedia)
      .flatMap((item) => (item.kind === MediaKind.photoMedia ? [item.photo.url] : []));
    let video = "";
    const first = conv.tweet.media[0];
    if (first !== undefined) {
      if (first.kind === MediaKind.videoMedia) {
        images = [first.video.thumb];
        video = getVideoEmbed(prefix, conv.tweet.id);
      } else if (first.kind === MediaKind.gifMedia) {
        images = [first.gif.thumb];
        video = getPicUrl(first.gif.url);
      }
    } else if (conv.tweet.card !== undefined) {
      const card = conv.tweet.card;
      if (card.image.length > 0) {
        images = [card.image];
      } else if (card.video !== undefined) {
        images = [card.video.thumb];
      }
    }

    const tweetUrl = `${prefix}/${conv.tweet.user.username}/status/${conv.tweet.id}`;
    const oembedUrl = `${prefix}/api/oembed?url=${encodeUrl(tweetUrl)}`;

    await reply.html(
      await render.page({
        body: renderConversation(conv, requestPrefs, `${path}#m`, sort),
        title,
        ogTitle,
        desc,
        images,
        video,
        oembed: oembedUrl,
        path,
        prefs: requestPrefs,
      }),
    );
  }

  async function showHistory(req: AppRequest, reply: AppReply): Promise<void> {
    const requestPrefs = prefs.parse(req.cookies, req.query);
    const name = req.params["name"] ?? "";
    const id = req.params["id"] ?? "";

    if (name.includes(".")) {
      showError(reply, "Page not found", 404, requestPrefs);
      return;
    }
    if (!isValidTweetId(id)) {
      showError(reply, "Invalid tweet ID", 404, requestPrefs);
      return;
    }

    const edits = await twitter.editHistory(id);
    if (edits === undefined || edits.latest.id === "") {
      showError(reply, "Tweet history not found", 404, requestPrefs);
      return;
    }

    const title = `History for ${pageTitleOfTweet(edits.latest)}`;
    const ogTitle = `Edit History for ${pageTitle(edits.latest.user)}`;
    await reply.html(
      await render.page({
        body: renderEditHistory(edits, requestPrefs, getPath(req)),
        title,
        ogTitle,
        desc: edits.latest.text,
        path: getPath(req),
        prefs: requestPrefs,
      }),
    );
  }

  route({
    method: "GET",
    path: `/${NAME_PARAM}/status/:id`,
    handler: (req, reply) => guard(reply, undefined, () => showStatus(req, reply)),
  });
  route({
    method: "GET",
    path: `/${NAME_PARAM}/status/:id/history`,
    handler: (req, reply) => guard(reply, undefined, () => showHistory(req, reply)),
  });

  route({
    method: "GET",
    path: `/${NAME_PARAM}/statuses/:id`,
    handler: (req, reply) =>
      guard(reply, undefined, async () => {
        await reply.redirect(`/${req.params["name"] ?? ""}/status/${req.params["id"] ?? ""}`);
      }),
  });
  route({
    method: "GET",
    path: `/${NAME_PARAM}/thread/:id`,
    handler: (req, reply) =>
      guard(reply, undefined, async () => {
        await reply.redirect(`/${req.params["name"] ?? ""}/status/${req.params["id"] ?? ""}`);
      }),
  });
  route({
    method: "GET",
    path: "/i/web/status/:id",
    handler: (req, reply) =>
      guard(reply, undefined, async () => {
        await reply.redirect(`/i/status/${req.params["id"] ?? ""}`);
      }),
  });
  route({
    method: "GET",
    path: "/i/status/:id",
    handler: (req, reply) => guard(reply, undefined, () => showStatus(req, reply)),
  });
  route({
    method: "GET",
    path: `/${NAME_PARAM}/:s/:id/:m`,
    handler: (req, reply) =>
      guard(reply, undefined, async () => {
        const requestPrefs = prefs.parse(req.cookies, req.query);
        const s = req.params["s"] ?? "";
        const m = req.params["m"] ?? "";
        if ((s === "status" || s === "statuses") && (m === "video" || m === "photo")) {
          await reply.redirect(`/${req.params["name"] ?? ""}/status/${req.params["id"] ?? ""}`);
          return;
        }
        showError(reply, "Page not found", 404, requestPrefs);
      }),
  });

  return () => {
    for (const dispose of disposers) dispose();
  };
}

export default function statusPlugin(ctx: Context): () => void {
  const server = ctx.get("server" as never) as HttpServer | undefined;
  const twitter = ctx.get("twitter" as never) as TwitterApi | undefined;
  const render = ctx.get("render" as never) as Render | undefined;
  const prefs = ctx.get("prefs" as never) as PrefsService | undefined;
  const config = ctx.get("config" as never) as StatusConfig | undefined;
  if (server === undefined)
    throw new Error("status: ctx.server is not mounted (load serverPlugin first)");
  if (twitter === undefined)
    throw new Error("status: ctx.twitter is not mounted (load twitterApiPlugin first)");
  if (render === undefined)
    throw new Error("status: ctx.render is not mounted (load renderPlugin first)");
  if (prefs === undefined)
    throw new Error("status: ctx.prefs is not mounted (load prefsPlugin first)");
  const disposeRoutes = registerStatusRoutes({ server, twitter, render, prefs, config });
  const disposeEffect = ctx.effect(() => () => {
    disposeRoutes();
  });
  return () => {
    disposeRoutes();
    void disposeEffect();
  };
}

statusPlugin.inject = ["server", "twitter", "render", "prefs"];
