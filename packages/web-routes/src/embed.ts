import type { PrefsService, TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest, HttpServer, RouteSpec } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import {
  BadClientError,
  getThumb,
  hasVideos,
  InternalError,
  NoSessionsError,
  RateLimitError,
} from "@tseer/types";
import type { Render } from "@tseer/views";
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
import { createShowError } from "./errors.ts";
import { NAME_PARAM } from "./params.ts";
import { getPath } from "./timeline.ts";

interface EmbedConfig {
  title?: string | undefined;
  hostname?: string | undefined;
  useHttps?: boolean | undefined;
}

export interface EmbedRouteDeps {
  server: HttpServer;
  twitter: TwitterApi;
  render: Render;
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

  function embedConfig(): { title: string; hostname: string; useHttps: boolean } {
    return {
      title: deps.config?.title ?? "Tseer",
      hostname: deps.config?.hostname ?? "localhost",
      useHttps: deps.config?.useHttps ?? true,
    };
  }

  async function showVideoEmbed(req: AppRequest, reply: AppReply): Promise<void> {
    const id = req.params.id ?? "";
    const requestPrefs = prefs.parse(req.cookies, req.query);
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

  async function showTweetEmbed(req: AppRequest, reply: AppReply): Promise<void> {
    const id = req.params.id ?? "";
    const user = req.params.name ?? "";
    const requestPrefs = prefs.parse(req.cookies, req.query);
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
    handler: (req, reply) => guard(reply, undefined, () => showVideoEmbed(req, reply)),
  });

  route({
    method: "GET",
    path: `/${NAME_PARAM}/status/:id/embed`,
    handler: (req, reply) => guard(reply, undefined, () => showTweetEmbed(req, reply)),
  });
  route({
    method: "GET",
    path: "/i/status/:id/embed",
    handler: (req, reply) => guard(reply, undefined, () => showTweetEmbed(req, reply)),
  });

  route({
    method: "GET",
    path: "/embed/Tweet.html",
    handler: (req, reply) =>
      guard(reply, undefined, async () => {
        const id = req.query.id ?? "";
        if (id.length > 0) {
          await reply.redirect(`/i/status/${id}/embed`);
        } else {
          void reply.text("", { status: 404 });
        }
      }),
  });

  route({
    method: "GET",
    path: "/api/oembed",
    handler: (req, reply) => guard(reply, undefined, () => showOembed(req, reply)),
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

  return () => {
    for (const dispose of disposers) dispose();
  };
}

export default function embedPlugin(ctx: Context): () => void {
  const server = ctx.get("server" as never) as HttpServer | undefined;
  const twitter = ctx.get("twitter" as never) as TwitterApi | undefined;
  const render = ctx.get("render" as never) as Render | undefined;
  const prefs = ctx.get("prefs" as never) as PrefsService | undefined;
  const config = ctx.get("config" as never) as EmbedConfig | undefined;
  if (server === undefined)
    throw new Error("embed: ctx.server is not mounted (load serverPlugin first)");
  if (twitter === undefined)
    throw new Error("embed: ctx.twitter is not mounted (load twitterApiPlugin first)");
  if (render === undefined)
    throw new Error("embed: ctx.render is not mounted (load renderPlugin first)");
  if (prefs === undefined)
    throw new Error("embed: ctx.prefs is not mounted (load prefsPlugin first)");
  const disposeRoutes = registerEmbedRoutes({ server, twitter, render, prefs, config });
  const disposeEffect = ctx.effect(() => () => {
    disposeRoutes();
  });
  return () => {
    disposeRoutes();
    void disposeEffect();
  };
}

embedPlugin.inject = ["server", "twitter", "render", "prefs"];
