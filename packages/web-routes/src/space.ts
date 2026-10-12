import type { MediaFetcher, SafeFetchOptions } from "@tseer/media";
import { proxifyVideo, safeFetchText, UndiciMediaFetcher } from "@tseer/media";
import type { PrefsService, TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest, HttpServer, RouteSpec } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import {
  BadClientError,
  InternalError,
  NoSessionsError,
  RateLimitError,
  VideoType,
} from "@tseer/types";
import { getVidUrl, type Render, renderSpace } from "@tseer/views";
import type { Context } from "cordis";
import { createShowError } from "./errors.ts";

const ALNUM = /^[A-Za-z0-9]+$/;

export interface SpaceRouteDeps {
  server: HttpServer;
  twitter: TwitterApi;
  render: Render;
  prefs: PrefsService;
  fetchManifest: (url: string) => Promise<string>;
}

export interface SpacePluginOptions {
  fetcher?: MediaFetcher | undefined;
  proxy?: string | undefined;
  proxyAuth?: string | undefined;
  maxConns?: number | undefined;
  headersTimeoutMs?: number | undefined;
}

export function registerSpaceRoutes(deps: SpaceRouteDeps): () => void {
  const { server, twitter, render, prefs, fetchManifest } = deps;
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

  async function showSpace(req: AppRequest, reply: AppReply): Promise<void> {
    const id = req.params["id"] ?? "";
    const requestPrefs = prefs.parse(req.cookies, req.query);
    if (!ALNUM.test(id)) {
      showError(reply, "Page not found", 404, requestPrefs);
      return;
    }
    const sp = await twitter.cachedSpace(id);
    if (sp === undefined || sp.id.length === 0) {
      showError(reply, "Space not found", 404, requestPrefs);
      return;
    }
    await reply.html(
      await render.page({
        body: renderSpace(sp, requestPrefs, req.path),
        title: sp.title,
        ogTitle: sp.title,
        path: req.path,
        prefs: requestPrefs,
      }),
    );
  }

  async function showSpaceStream(req: AppRequest, reply: AppReply): Promise<void> {
    const id = req.params["id"] ?? "";
    const requestPrefs = prefs.parse(req.cookies, req.query);
    if (!ALNUM.test(id)) {
      showError(reply, "Page not found", 404, requestPrefs);
      return;
    }
    const sp = await twitter.cachedSpace(id);
    if (sp === undefined || sp.m3u8Url.length === 0) {
      void reply.text("", { status: 404 });
      return;
    }
    const manifest = await fetchManifest(sp.m3u8Url);
    if (manifest.length === 0) {
      void reply.text("", { status: 502 });
      return;
    }
    const proxified = proxifyVideo(manifest, {
      proxy: requestPrefs.proxyVideos,
      manifestUrl: sp.m3u8Url,
      vidUrl: getVidUrl,
    });
    await reply.send(proxified, VideoType.m3u8);
  }

  route({
    method: "GET",
    path: "/i/spaces/:id",
    handler: (req, reply) => guard(reply, undefined, () => showSpace(req, reply)),
  });

  route({
    method: "GET",
    path: "/i/spaces/:id/stream",
    handler: (req, reply) => guard(reply, undefined, () => showSpaceStream(req, reply)),
  });

  return () => {
    for (const dispose of disposers) dispose();
  };
}

export default function spacePlugin(ctx: Context, options: SpacePluginOptions = {}): () => void {
  const server = ctx.get("server" as never) as HttpServer | undefined;
  const twitter = ctx.get("twitter" as never) as TwitterApi | undefined;
  const render = ctx.get("render" as never) as Render | undefined;
  const prefs = ctx.get("prefs" as never) as PrefsService | undefined;
  if (server === undefined)
    throw new Error("space: ctx.server is not mounted (load serverPlugin first)");
  if (twitter === undefined)
    throw new Error("space: ctx.twitter is not mounted (load twitterApiPlugin first)");
  if (render === undefined)
    throw new Error("space: ctx.render is not mounted (load renderPlugin first)");
  if (prefs === undefined)
    throw new Error("space: ctx.prefs is not mounted (load prefsPlugin first)");

  const fetcher =
    options.fetcher ??
    new UndiciMediaFetcher({
      proxy: options.proxy,
      proxyAuth: options.proxyAuth,
      maxConns: options.maxConns,
      headersTimeoutMs: options.headersTimeoutMs,
    });
  const disposeFetcher = options.fetcher === undefined ? () => void fetcher.close() : undefined;

  const fetchOptions: SafeFetchOptions = {
    fetcher,
    onRetry: (message) => ctx.logger.debug(message),
  };

  const disposeRoutes = registerSpaceRoutes({
    server,
    twitter,
    render,
    prefs,
    fetchManifest: (url) => safeFetchText(url, fetchOptions),
  });
  const disposeEffect = ctx.effect(() => () => {
    disposeRoutes();
    disposeFetcher?.();
  });
  return () => {
    disposeRoutes();
    disposeFetcher?.();
    void disposeEffect();
  };
}

spacePlugin.inject = ["server", "twitter", "render", "prefs"];
