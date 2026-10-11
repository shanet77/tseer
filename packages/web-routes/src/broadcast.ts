/**
 * The broadcast routes — port of nitter's `src/routes/broadcast.nim`
 * (`/i/broadcasts/@id` + `/i/broadcasts/@id/stream`).
 *
 * Same four-seam shape as the space/timeline/status/search/rss plugins
 * (`server` + `twitter` + `render` + `prefs` via static `.inject`,
 * `ctx.effect` cleanup). The broadcast object rides `twitter.cachedBroadcast`
 * (the `getCachedBroadcast` port — the m3u8 URL is re-resolved through
 * `broadcastStream` on every hit, never cached), and the page component comes
 * from `views/broadcast`; this file owns routes, conds, and the stream
 * plumbing.
 *
 * Divergences from the Nim original (documented at the call sites):
 * - Jester's `cond @"id".allCharsInSet({'a'..'z','A'..'Z','0'..'9'})` is an
 *   in-handler check: a failed cond skips the route upstream and falls through
 *   to the global 404 handler (`showError("Page not found")`), which is what
 *   both routes answer here. `:id` therefore stays dot-allowing at match time.
 * - nitter wraps `getCachedBroadcast` in `try/except: discard` — *every* fetch
 *   failure (rate limit included) collapses to the empty broadcast and the 404
 *   "Broadcast not found" page. That is ported verbatim: unlike the space
 *   routes there is no `guard` mapping here, and a rate-limited fetch is a
 *   404, not a 429 page.
 * - The stream route's missing-manifest 404 and empty-manifest 502 are *bare*
 *   (no error page), verbatim.
 * - The stream route answers `VideoType.m3u8` (`application/x-mpegURL`, the
 *   enum's wire value in `@tseer/types`) — nitter's `m3u8Mime` here is
 *   `application/vnd.apple.mpegurl`; same divergence as the space plugin.
 * - Manifest fetching reuses `@tseer/media`'s `safeFetchText` (the port of
 *   nitter's `safeFetch` over the streaming media fetcher) — never `ctx.http`,
 *   whose buffering + Cloudflare-retry semantics are wrong for manifests. The
 *   plugin owns a dedicated `UndiciMediaFetcher` (same shape as
 *   `mediaRoutePlugin`/`spacePlugin`) and closes it on unload.
 * - Segment rewriting signs through the views' process-global `getVidUrl`
 *   (installed by `renderPlugin`), exactly like nitter's process-global
 *   `getVidUrl` — no fifth (`media`) seam, matching the sibling plugins.
 */

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

/** broadcast.nim's `cond @"id".allCharsInSet({'a'..'z', 'A'..'Z', '0'..'9'})`. */
const ALNUM = /^[A-Za-z0-9]+$/;

export interface BroadcastRouteDeps {
  server: HttpServer;
  twitter: TwitterApi;
  render: Render;
  prefs: PrefsService;
  /** nitter's `safeFetch` over the m3u8 manifest; failures collapse to `""`. */
  fetchManifest: (url: string) => Promise<string>;
}

/** Options for {@link broadcastPlugin} — the fetcher it streams manifests with. */
export interface BroadcastPluginOptions {
  /** Transport override (tests, or a shared pool owned elsewhere). */
  fetcher?: MediaFetcher | undefined;
  /** `config.proxy` / `config.proxyAuth`, for the default fetcher. */
  proxy?: string | undefined;
  proxyAuth?: string | undefined;
  /** `config.httpMaxConns`, for the default fetcher's pool. */
  maxConns?: number | undefined;
  /** Headers-phase timeout in milliseconds. */
  headersTimeoutMs?: number | undefined;
}

export function registerBroadcastRoutes(deps: BroadcastRouteDeps): () => void {
  const { server, twitter, render, prefs, fetchManifest } = deps;
  const disposers: (() => void)[] = [];
  const route = (spec: RouteSpec): void => {
    disposers.push(server.route(spec));
  };

  const showError = createShowError(render);

  /**
   * broadcast.nim's `try: bc = await getCachedBroadcast(@"id") except: discard`
   * — every fetch failure (rate limit included) collapses to the empty
   * broadcast and the 404 page below. Ported verbatim: unlike the space
   * routes, no `guard` mapping wraps the handler.
   */
  async function cachedBroadcast(id: string): Promise<Broadcast | undefined> {
    try {
      return await twitter.cachedBroadcast(id);
    } catch {
      return undefined;
    }
  }

  /** `GET /i/broadcasts/@id` — the broadcast page (`renderBroadcast`). */
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

  /**
   * `GET /i/broadcasts/@id/stream` — the m3u8, segments rewritten through this
   * instance. The 404 (no manifest URL) and 502 (dead manifest) are bare,
   * verbatim.
   */
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

  // Both routes answer the alnum cond failure with the global 404 page; the
  // broadcast fetch itself swallows errors (nitter's `except: discard`), so
  // there is no `guard` here — the only thrown errors left are render bugs,
  // which belong to the server's 500 handler.
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

/**
 * The broadcast route plugin: `ctx.server` + `ctx.twitter` + `ctx.render` +
 * `ctx.prefs`. Unload it and only these routes disappear.
 */
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

  // A caller-supplied fetcher is the caller's to close; only one we build here
  // is ours to tear down (same shape as `mediaRoutePlugin`/`spacePlugin`).
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

  // cordis rc.10 does not run a plugin's returned disposer through
  // fiber.dispose(); the cleanup must be a real effect (same as the other
  // route plugins).
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
