import type { MediaFetcher, SafeFetchOptions } from "@tseer/media";
import { proxifyVideo, safeFetchText, UndiciMediaFetcher } from "@tseer/media";
import type { TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import type { Broadcast } from "@tseer/types";
import { VideoType } from "@tseer/types";
import { getVidUrl, type Render, renderBroadcast } from "@tseer/views";
import type { Context } from "cordis";
import { mountRoutes, type RouteShell } from "./shell.ts";

const ALNUM = /^[A-Za-z0-9]+$/;

export interface BroadcastRouteDeps {
  twitter: TwitterApi;
  render: Render;
  shell: RouteShell;
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
  const { twitter, render, shell, fetchManifest } = deps;
  const { raw, showError } = shell;

  async function cachedBroadcast(id: string): Promise<Broadcast | undefined> {
    try {
      return await twitter.cachedBroadcast(id);
    } catch {
      return undefined;
    }
  }

  async function showBroadcast(
    req: AppRequest,
    reply: AppReply,
    requestPrefs: TseerPreferences,
  ): Promise<void> {
    const id = req.params["id"] ?? "";
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

  async function showBroadcastStream(
    req: AppRequest,
    reply: AppReply,
    requestPrefs: TseerPreferences,
  ): Promise<void> {
    const id = req.params["id"] ?? "";
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

  raw({
    method: "GET",
    path: "/i/broadcasts/:id",
    handler: showBroadcast,
  });

  raw({
    method: "GET",
    path: "/i/broadcasts/:id/stream",
    handler: showBroadcastStream,
  });

  return shell.dispose;
}

export default function broadcastPlugin(
  ctx: Context,
  options: BroadcastPluginOptions = {},
): () => void {
  return mountRoutes(ctx, "broadcast", ["twitter"], (resolve, shell) => {
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
      twitter: resolve<TwitterApi>("twitter"),
      render: resolve<Render>("render"),
      shell,
      fetchManifest: (url) => safeFetchText(url, fetchOptions),
    });
    return () => {
      disposeRoutes();
      disposeFetcher?.();
    };
  });
}

broadcastPlugin.inject = ["server", "twitter", "render", "prefs"];
