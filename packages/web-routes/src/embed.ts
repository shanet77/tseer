import type { PrefsService, TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import { getThumb, hasVideos } from "@tseer/types";
import {
  getPicUrl,
  getStatusUrlPrefix,
  renderErrorEmbed,
  renderOembedIframe,
  renderTweetEmbed,
  renderVideoEmbed,
  stripHtml,
} from "@tseer/views";
import type { Context } from "cordis";
import { NAME_PARAM } from "./params.ts";
import { mountRoutes, type RouteShell } from "./shell.ts";
import { getPath } from "./timeline.ts";

interface EmbedConfig {
  title?: string | undefined;
  hostname?: string | undefined;
  useHttps?: boolean | undefined;
}

export interface EmbedRouteDeps {
  twitter: TwitterApi;
  shell: RouteShell;
  prefs: PrefsService;
  config: EmbedConfig | undefined;
}

export function parseTweetPath(path: string): { username: string; id: string } {
  const parts = path.split("/");
  if (parts.length >= 3 && (parts[1] === "status" || parts[1] === "statuses")) {
    const tweetId = parts[2]?.split("?")[0]?.split("#")[0] ?? "";
    if (tweetId.length > 0 && /^[0-9]+$/.test(tweetId)) {
      return { username: parts[0] ?? "", id: tweetId };
    }
  }
  return { username: "", id: "" };
}

const TWITTER_PREFIXES = [
  "twitter.com/",
  "x.com/",
  "mobile.twitter.com/",
  "www.twitter.com/",
  "www.x.com/",
];

export function parseTweetUrl(
  url: string,
  cfg: { hostname?: string | undefined },
): { username: string; id: string } {
  let path = url;
  if (path.startsWith("https://")) {
    path = path.slice(8);
  } else if (path.startsWith("http://")) {
    path = path.slice(7);
  }

  for (const prefix of TWITTER_PREFIXES) {
    if (path.startsWith(prefix)) {
      return parseTweetPath(path.slice(prefix.length));
    }
  }

  const nitterPrefix = `${cfg.hostname ?? ""}/`;
  if (path.startsWith(nitterPrefix)) {
    return parseTweetPath(path.slice(nitterPrefix.length));
  }

  const slashPos = path.indexOf("/");
  if (slashPos > 0) {
    const parsed = parseTweetPath(path.slice(slashPos + 1));
    if (parsed.username.length > 0) {
      return parsed;
    }
  }

  return { username: "", id: "" };
}

export function registerEmbedRoutes(deps: EmbedRouteDeps): () => void {
  const { twitter, shell, prefs } = deps;
  const { route } = shell;

  function embedConfig(): { title: string; hostname: string; useHttps: boolean } {
    return {
      title: deps.config?.title ?? "Tseer",
      hostname: deps.config?.hostname ?? "localhost",
      useHttps: deps.config?.useHttps ?? true,
    };
  }

  async function showVideoEmbed(
    req: AppRequest,
    reply: AppReply,
    requestPrefs: TseerPreferences,
  ): Promise<void> {
    const id = req.params.id ?? "";
    const tweet = await twitter.tweetByRestId(id);

    if (tweet === undefined) {
      await reply.html(
        renderErrorEmbed("Tweet not found", requestPrefs, embedConfig(), { tweetId: id }),
      );
      return;
    }
    if (!hasVideos(tweet)) {
      await reply.html(
        renderErrorEmbed("No video in tweet", requestPrefs, embedConfig(), {
          tweetId: id,
          username: tweet.user.username,
        }),
      );
      return;
    }

    const videoPrefs = {
      ...prefs.defaults,
      hlsPlayback: true,
      mp4Playback: true,
    };
    await reply.html(renderVideoEmbed(tweet, embedConfig(), videoPrefs));
  }

  async function showTweetEmbed(
    req: AppRequest,
    reply: AppReply,
    requestPrefs: TseerPreferences,
  ): Promise<void> {
    const id = req.params.id ?? "";
    const user = req.params.name ?? "";
    const tweet = await twitter.tweetByRestId(id);

    if (tweet === undefined) {
      await reply.html(
        renderErrorEmbed("Tweet not found", requestPrefs, embedConfig(), {
          tweetId: id,
          username: user,
        }),
      );
      return;
    }
    await reply.html(renderTweetEmbed(tweet, getPath(req), requestPrefs, embedConfig()));
  }

  route({
    method: "GET",
    path: "/i/videos/tweet/:id",
    handler: showVideoEmbed,
  });

  route({
    method: "GET",
    path: `/${NAME_PARAM}/status/:id/embed`,
    handler: showTweetEmbed,
  });
  route({
    method: "GET",
    path: "/i/status/:id/embed",
    handler: showTweetEmbed,
  });

  route({
    method: "GET",
    path: "/embed/Tweet.html",
    handler: (req, reply) => {
      const id = req.query.id ?? "";
      if (id.length > 0) {
        return reply.redirect(`/i/status/${id}/embed`);
      }
      void reply.text("", { status: 404 });
    },
  });

  route({
    method: "GET",
    path: "/api/oembed",
    handler: showOembed,
  });

  async function showOembed(req: AppRequest, reply: AppReply): Promise<void> {
    const headers = { "Access-Control-Allow-Origin": "*" };
    const url = req.query.url ?? "";
    const format = req.query.format ?? "";

    if (format.length > 0 && format !== "json") {
      void reply.text("Only JSON format is supported", { status: 501, headers });
      return;
    }
    if (url.length === 0) {
      void reply.text("Missing url parameter", { status: 400, headers });
      return;
    }

    const cfg = embedConfig();
    const { username, id: tweetId } = parseTweetUrl(url, cfg);
    if (username.length === 0 || tweetId.length === 0) {
      void reply.text("Invalid tweet URL", { status: 400, headers });
      return;
    }

    const tweet = await twitter.tweetByRestId(tweetId);
    if (tweet === undefined) {
      void reply.text("", { status: 404, headers });
      return;
    }

    const maxwidthParam = req.query.maxwidth ?? "";
    let maxwidth = 550;
    if (maxwidthParam.length > 0) {
      const parsed = Number.parseInt(maxwidthParam, 10);
      if (!Number.isNaN(parsed)) {
        maxwidth = Math.min(Math.max(parsed, 220), 550);
      }
    }

    const prefix = getStatusUrlPrefix(cfg);
    const embedUrl = `${prefix}/${tweet.user.username}/status/${tweetId}/embed`;
    const authorUrl = `${prefix}/${tweet.user.username}`;
    const title = stripHtml(tweet.text);

    const response: Record<string, unknown> = {
      version: "1.0",
      type: "rich",
      provider_name: cfg.title,
      provider_url: prefix,
      title,
      author_name: tweet.user.fullname,
      author_url: authorUrl,
      url: embedUrl,
      width: maxwidth,
      height: null,
      cache_age: "3153600000",
      html: renderOembedIframe(embedUrl, maxwidth),
    };

    if (tweet.media.length > 0) {
      const first = tweet.media[0];
      if (first !== undefined) {
        const thumbUrl = `${prefix}${getPicUrl(getThumb(first))}`;
        response.thumbnail_url = thumbUrl;
        response.thumbnail_width = maxwidth;
        response.thumbnail_height = maxwidth;
      }
    }

    void reply.send(JSON.stringify(response), "application/json", { headers });
  }

  return shell.dispose;
}

export default function embedPlugin(ctx: Context): () => void {
  return mountRoutes(ctx, "embed", ["twitter"], (resolve, shell) =>
    registerEmbedRoutes({
      twitter: resolve<TwitterApi>("twitter"),
      prefs: resolve<PrefsService>("prefs"),
      config: resolve<EmbedConfig | undefined>("config"),
      shell,
    }),
  );
}

embedPlugin.inject = ["server", "twitter", "render", "prefs"];
