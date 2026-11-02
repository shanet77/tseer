import type { MediaFetcher, SafeFetchOptions } from "@tseer/media";
import { proxifyVideo, safeFetchText, UndiciMediaFetcher } from "@tseer/media";
import type { TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import { VideoType } from "@tseer/types";
import { getVidUrl, type Render, renderSpace } from "@tseer/views";
import type { Context } from "cordis";
import { mountRoutes, type RouteShell } from "./shell.ts";

const ALNUM = /^[A-Za-z0-9]+$/;

export interface SpaceRouteDeps {
  twitter: TwitterApi;
  render: Render;
  shell: RouteShell;
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
  const { twitter, render, shell, fetchManifest } = deps;
  const { route, showError } = shell;

  async function showSpace(
    req: AppRequest,
    reply: AppReply,
    requestPrefs: TseerPreferences,
  ): Promise<void> {
    const id = req.params["id"] ?? "";
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

  async function showSpaceStream(
    req: AppRequest,
    reply: AppReply,
    requestPrefs: TseerPreferences,
  ): Promise<void> {
    const id = req.params["id"] ?? "";
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
    handler: showSpace,
  });

  route({
    method: "GET",
    path: "/i/spaces/:id/stream",
    handler: showSpaceStream,
  });

  return shell.dispose;
}

export default function spacePlugin(ctx: Context, options: SpacePluginOptions = {}): () => void {
  return mountRoutes(ctx, "space", ["twitter"], (resolve, shell) => {
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

spacePlugin.inject = ["server", "twitter", "render", "prefs"];
