/**
 * The audio-space routes — port of nitter's `src/routes/space.nim`
 * (`/i/spaces/@id` + `/i/spaces/@id/stream`), plus the error pages nitter's
 * `nitter.nim` maps the fetch errors to.
 *
 * Same four-seam shape as the timeline/status/search/rss plugins (`server` +
 * `twitter` + `render` + `prefs` via static `.inject`, `ctx.effect` cleanup,
 * `guard` error mapping). The space object rides `twitter.cachedSpace` (the
 * `getCachedAudioSpace` port), and the page component comes from
 * `views/space`; this file owns routes, conds, and the stream plumbing.
 *
 * Divergences from the Nim original (documented at the call sites):
 * - Jester's `cond @"id".allCharsInSet({'a'..'z','A'..'Z','0'..'9'})` is an
 *   in-handler check: a failed cond skips the route upstream and falls through
 *   to the global 404 handler (`showError("Page not found")`), which is what
 *   both routes answer here. `:id` therefore stays dot-allowing at match time
 *   (nitter has no match-time cond on it).
 * - The stream route's missing-manifest 404 and empty-manifest 502 are *bare*
 *   (no error page), verbatim; only thrown fetch errors get the `guard` pages.
 * - The stream route answers `VideoType.m3u8` (`application/x-mpegURL`) —
 *   nitter's `m3u8Mime` here is `application/vnd.apple.mpegurl` (the media
 *   route's constant); `VideoType.m3u8` is the enum's own wire value and the
 *   value this port's `@tseer/types` carries.
 * - Manifest fetching reuses `@tseer/media`'s `safeFetchText` (the port of
 *   nitter's `safeFetch` over the streaming media fetcher) — never `ctx.http`,
 *   whose buffering + Cloudflare-retry semantics are wrong for manifests. The
 *   plugin owns a dedicated `UndiciMediaFetcher` (same shape as
 *   `mediaRoutePlugin`) and closes it on unload.
 * - Segment rewriting signs through the views' process-global `getVidUrl`
 *   (installed by `renderPlugin`), exactly like nitter's process-global
 *   `getVidUrl` — no fifth (`media`) seam, matching the sibling plugins.
 */

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

/** space.nim's `cond @"id".allCharsInSet({'a'..'z', 'A'..'Z', '0'..'9'})`. */
const ALNUM = /^[A-Za-z0-9]+$/;

export interface SpaceRouteDeps {
  server: HttpServer;
  twitter: TwitterApi;
  render: Render;
  prefs: PrefsService;
  /** nitter's `safeFetch` over the m3u8 manifest; failures collapse to `""`. */
  fetchManifest: (url: string) => Promise<string>;
}

/** Options for {@link spacePlugin} — the fetcher it streams manifests with. */
export interface SpacePluginOptions {
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

export function registerSpaceRoutes(deps: SpaceRouteDeps): () => void {
  const { server, twitter, render, prefs, fetchManifest } = deps;
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

  /** `GET /i/spaces/@id` — the space page (`renderSpace` under the shell). */
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

  /**
   * `GET /i/spaces/@id/stream` — the m3u8, segments rewritten through this
   * instance. The 404 (no manifest URL) and 502 (dead manifest) are bare,
   * verbatim.
   */
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

  // Both routes answer the alnum cond failure with the global 404 page, so
  // each handler runs under the same `guard` as its siblings (a rate-limited
  // space fetch is a 429 page, not a crash).
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

/**
 * The space route plugin: `ctx.server` + `ctx.twitter` + `ctx.render` +
 * `ctx.prefs`. Unload it and only these routes disappear. */
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

  // A caller-supplied fetcher is the caller's to close; only one we build here
  // is ours to tear down (same shape as `mediaRoutePlugin`).
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
