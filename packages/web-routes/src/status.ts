import { encodeUrl } from "@tseer/media";
import type { TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import { MediaKind, RankingMode } from "@tseer/types";
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
import { NAME_PARAM } from "./params.ts";
import { mountRoutes, type RouteShell } from "./shell.ts";
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
  twitter: TwitterApi;
  render: Render;
  shell: RouteShell;
  config: StatusConfig | undefined;
}

export function registerStatusRoutes(deps: StatusRouteDeps): () => void {
  const { twitter, render, shell } = deps;
  const { route, showError } = shell;

  async function showStatus(
    req: AppRequest,
    reply: AppReply,
    requestPrefs: TseerPreferences,
  ): Promise<void> {
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

  async function showHistory(
    req: AppRequest,
    reply: AppReply,
    requestPrefs: TseerPreferences,
  ): Promise<void> {
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
    handler: showStatus,
  });
  route({
    method: "GET",
    path: `/${NAME_PARAM}/status/:id/history`,
    handler: showHistory,
  });

  route({
    method: "GET",
    path: `/${NAME_PARAM}/statuses/:id`,
    handler: (req, reply) =>
      reply.redirect(`/${req.params["name"] ?? ""}/status/${req.params["id"] ?? ""}`),
  });
  route({
    method: "GET",
    path: `/${NAME_PARAM}/thread/:id`,
    handler: (req, reply) =>
      reply.redirect(`/${req.params["name"] ?? ""}/status/${req.params["id"] ?? ""}`),
  });
  route({
    method: "GET",
    path: "/i/web/status/:id",
    handler: (req, reply) => reply.redirect(`/i/status/${req.params["id"] ?? ""}`),
  });
  route({
    method: "GET",
    path: "/i/status/:id",
    handler: showStatus,
  });
  route({
    method: "GET",
    path: `/${NAME_PARAM}/:s/:id/:m`,
    handler: (req, reply, requestPrefs) => {
      const s = req.params["s"] ?? "";
      const m = req.params["m"] ?? "";
      if ((s === "status" || s === "statuses") && (m === "video" || m === "photo")) {
        return reply.redirect(`/${req.params["name"] ?? ""}/status/${req.params["id"] ?? ""}`);
      }
      showError(reply, "Page not found", 404, requestPrefs);
    },
  });

  return shell.dispose;
}

export default function statusPlugin(ctx: Context): () => void {
  return mountRoutes(ctx, "status", ["twitter"], (resolve, shell) =>
    registerStatusRoutes({
      twitter: resolve<TwitterApi>("twitter"),
      render: resolve<Render>("render"),
      config: resolve<StatusConfig | undefined>("config"),
      shell,
    }),
  );
}

statusPlugin.inject = ["server", "twitter", "render", "prefs"];
