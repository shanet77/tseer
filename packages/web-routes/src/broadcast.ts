import type { MediaFetcher, SafeFetchOptions } from "@tseer/media";
import { proxifyVideo, safeFetchText, UndiciMediaFetcher } from "@tseer/media";
import type { PrefsService } from "@tseer/prefs";
import type { AppReply, AppRequest, HttpServer, RouteSpec } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import type { Broadcast } from "@tseer/types";
import { VideoType } from "@tseer/types";
import { getVidUrl, type Render, renderBroadcast } from "@tseer/views";
import type { Context } from "cordis";
import { createShowError } from "./errors.ts";

const ALNUM = /^[A-Za-z0-9]+$/;

export interface BroadcastRouteDeps {
  server: HttpServer;
  twitter: TwitterApi;
  render: Render;
  prefs: PrefsService;
  fetchManifest: (url: string) => Promise<string>;
}

export interface BroadcastPluginOptions {
  fetcher?: MediaFetcher | undefined;
  proxy?: string | undefined;
  proxyAuth?: string | undefined;
  maxConns?: number | undefined;
  headersTimeoutMs?: number | undefined;
}

export function registerBroadcastRoutes(deps: BroadcastRouteDeps): () => void {
  const { server, twitter, render, prefs, fetchManifest } = deps;
  const disposers: (() => void)[] = [];
  const route = (spec: RouteSpec): void => {
    disposers.push(server.route(spec));
  };

  const showError = createShowError(render);

  async function cachedBroadcast(id: string): Promise<Broadcast | undefined> {
    try {
      return await twitter.cachedBroadcast(id);
    } catch {
      return undefined;
    }
  }

  async function showBroadcast(req: AppRequest, reply: AppReply): Promise<void> {
    const id = req.params["id"] ?? "";
    const requestPrefs = prefs.parse(req.cookies, req.query);
    if (!ALNUM.test(id)) {
      showError(reply, "Page not found", 404, requestPrefs);
      return;
    }
    const bc = await cachedBroadcast(id);
    if (bc === undefined || bc.id.length === 0) {
      showError(reply, "Broadcast not found", 404, requestPrefs);
      return;
    }
    await reply.html(
      await render.page({
        body: renderBroadcast(bc, requestPrefs, req.path),
        title: bc.title,
        ogTitle: bc.title,
        path: req.path,
        prefs: requestPrefs,
      }),
    );
  }

  async function showBroadcastStream(req: AppRequest, reply: AppReply): Promise<void> {
    const id = req.params["id"] ?? "";
    const requestPrefs = prefs.parse(req.cookies, req.query);
    if (!ALNUM.test(id)) {
      showError(reply, "Page not found", 404, requestPrefs);
      return;
    }
    const bc = await cachedBroadcast(id);
    if (bc === undefined || bc.m3u8Url.length === 0) {
      void reply.text("", { status: 404 });
      return;
    }
    const manifest = await fetchManifest(bc.m3u8Url);
    if (manifest.length === 0) {
      void reply.text("", { status: 502 });
      return;
    }
    const proxified = proxifyVideo(manifest, {
      proxy: requestPrefs.proxyVideos,
      manifestUrl: bc.m3u8Url,
      vidUrl: getVidUrl,
    });
    await reply.send(proxified, VideoType.m3u8);
  }

  route({
    method: "GET",
    path: "/i/broadcasts/:id",
    handler: (req, reply) => showBroadcast(req, reply),
  });

  route({
    method: "GET",
    path: "/i/broadcasts/:id/stream",
    handler: (req, reply) => showBroadcastStream(req, reply),
  });

  return () => {
    for (const dispose of disposers) dispose();
  };
}

export default function broadcastPlugin(
  ctx: Context,
  options: BroadcastPluginOptions = {},
): () => void {
  const server = ctx.get("server" as never) as HttpServer | undefined;
  const twitter = ctx.get("twitter" as never) as TwitterApi | undefined;
  const render = ctx.get("render" as never) as Render | undefined;
  const prefs = ctx.get("prefs" as never) as PrefsService | undefined;
  if (server === undefined)
    throw new Error("broadcast: ctx.server is not mounted (load serverPlugin first)");
  if (twitter === undefined)
    throw new Error("broadcast: ctx.twitter is not mounted (load twitterApiPlugin first)");
  if (render === undefined)
    throw new Error("broadcast: ctx.render is not mounted (load renderPlugin first)");
  if (prefs === undefined)
    throw new Error("broadcast: ctx.prefs is not mounted (load prefsPlugin first)");

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

  const disposeRoutes = registerBroadcastRoutes({
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

broadcastPlugin.inject = ["server", "twitter", "render", "prefs"];
