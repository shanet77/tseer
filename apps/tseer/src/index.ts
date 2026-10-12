import { cachePlugin } from "@tseer/cache";
import { httpClientPlugin } from "@tseer/http-client";
import {
  aboutRoutePlugin,
  createApp as createKernelApp,
  healthRoutePlugin,
  staticRoutePlugin,
} from "@tseer/kernel";
import { mediaPlugin, mediaRoutePlugin } from "@tseer/media";
import { prefsPlugin } from "@tseer/prefs";
import { serverPlugin } from "@tseer/server";
import { twitterApiPlugin } from "@tseer/twitter-api";
import { parsersPlugin } from "@tseer/twitter-parser";
import { twitterSessionsPlugin } from "@tseer/twitter-sessions";
import { renderPlugin, viewsPublicDir } from "@tseer/views";
import {
  broadcastPlugin,
  embedPlugin,
  listPlugin,
  preferencesPlugin,
  resolverPlugin,
  rssPlugin,
  searchPlugin,
  spacePlugin,
  statusPlugin,
  timelinePlugin,
  unsupportedPlugin,
} from "@tseer/web-routes";
import type { Context } from "cordis";
import hello from "./plugins/hello.ts";

export interface CreateAppOptions {
  /** Name surfaced by the scaffold `hello` plugin. */
  name?: string;
  /** Path to a `nitter.conf`-compatible INI file. */
  configPath?: string | undefined;
  /** Raw INI text (preferred in tests; skips file I/O). */
  configText?: string | undefined;
  /** Override for `config.port` (applied before the web plugin binds). */
  port?: number | undefined;
  /** Cache backend to mount. Default `memory`. */
  cacheProvider?: "memory" | "redis" | undefined;
  /** Skip the cache plugin entirely. */
  withoutCache?: boolean | undefined;
  /** Path to the sessions JSONL store (default: `TSEER_SESSIONS_FILE`, `./sessions.jsonl`). */
  sessionsPath?: string | undefined;
  /** Skip the sessions plugin entirely (no pool, `/.health` stays empty). */
  withoutSessions?: boolean | undefined;
  /** Skip the `ctx.twitter` provider (needs `ctx.accounts`; default when sessions are off). */
  withoutTwitter?: boolean | undefined;
  /** Directory served at the URL root (nitter `staticDir`). Defaults to the
   * views package's `public/` (compiled theme CSS + vendored assets); an
   * explicit `staticDir` in config always wins. */
  staticDir?: string | undefined;
}

/** Mount the scaffold plugin list on a kernel-booted cordis context. */
export async function createApp(options: CreateAppOptions = {}): Promise<Context> {
  const ctx = await createKernelApp({
    configPath: options.configPath,
    configText: options.configText,
  });
  if (options.port !== undefined) ctx.config.port = options.port;
  // Fresh boots serve the ported theme/assets: kernel's `./public` default
  // names a directory that only exists when the operator creates it (nitter
  // parity — the example conf ships the same default). Kernel does not track
  // whether the value was explicit, so `./public` always means "not
  // configured" here; any other path (custom `staticDir`) is left alone. An
  // explicit `staticDir` option wins over both.
  if (options.staticDir !== undefined) ctx.config.staticDir = options.staticDir;
  else if (ctx.config.staticDir === "./public") ctx.config.staticDir = viewsPublicDir();

  await ctx.plugin(hello, { name: options.name ?? "tseer" });
  await ctx.plugin(serverPlugin, {
    address: ctx.config.address,
    port: ctx.config.port,
  });
  await ctx.plugin(httpClientPlugin, {
    maxConns: ctx.config.httpMaxConns,
    proxy: ctx.config.proxy,
    proxyAuth: ctx.config.proxyAuth,
    apiProxy: ctx.config.apiProxy,
    maxRetries: ctx.config.maxRetries,
    retryDelayMs: ctx.config.retryDelayMs,
  });
  await ctx.plugin(aboutRoutePlugin, { title: ctx.config.title });
  await ctx.plugin(prefsPlugin, { preferences: ctx.config.preferences });
  await ctx.plugin(renderPlugin, {
    title: ctx.config.title,
    hostname: ctx.config.hostname,
    useHttps: ctx.config.useHttps,
    ...(options.withoutSessions === true
      ? {}
      : {
          picUrl: (url: string) => ctx.media.picUrl(url),
          origPicUrl: (url: string) => ctx.media.origPicUrl(url),
          vidUrl: (url: string) => ctx.media.vidUrl(url),
        }),
  });
  if (options.withoutCache !== true) {
    await ctx.plugin(cachePlugin, { provider: options.cacheProvider ?? "memory" });
  }
  if (options.withoutSessions !== true) {
    await ctx.plugin(twitterSessionsPlugin, { path: options.sessionsPath });
  }
  if (options.withoutTwitter !== true && options.withoutSessions !== true) {
    await ctx.plugin(mediaPlugin, {
      hmacKey: ctx.config.hmacKey,
      base64Media: ctx.config.base64Media,
    });
    await ctx.plugin(mediaRoutePlugin, {
      proxy: ctx.config.proxy,
      proxyAuth: ctx.config.proxyAuth,
      maxConns: ctx.config.httpMaxConns,
    });
    await ctx.plugin(parsersPlugin, { picUrl: (url) => ctx.media.picUrl(url) });
    await ctx.plugin(twitterApiPlugin, {
      disableTid: ctx.config.disableTid,
      maxRetries: ctx.config.maxRetries,
      retryDelayMs: ctx.config.retryDelayMs,
    });
    await ctx.plugin(timelinePlugin);
    await ctx.plugin(statusPlugin);
    await ctx.plugin(listPlugin);
    await ctx.plugin(searchPlugin);
    await ctx.plugin(rssPlugin);
    await ctx.plugin(spacePlugin, {
      proxy: ctx.config.proxy,
      proxyAuth: ctx.config.proxyAuth,
      maxConns: ctx.config.httpMaxConns,
    });
    await ctx.plugin(broadcastPlugin, {
      proxy: ctx.config.proxy,
      proxyAuth: ctx.config.proxyAuth,
      maxConns: ctx.config.httpMaxConns,
    });
    await ctx.plugin(resolverPlugin);
    await ctx.plugin(embedPlugin);
  }
  // The settings page and the static "unsupported feature" panel need no X
  // session — they render from `prefs` + `render` alone, so they mount
  // regardless of `withoutTwitter`/`withoutSessions`.
  await ctx.plugin(preferencesPlugin, {
    hostname: ctx.config.hostname,
    useHttps: ctx.config.useHttps,
    staticDir: ctx.config.staticDir,
  });
  await ctx.plugin(unsupportedPlugin);
  await ctx.plugin(healthRoutePlugin, {
    sessionHealth: options.withoutSessions === true ? undefined : () => ctx.accounts.health(),
    sessionDebug: options.withoutSessions === true ? undefined : () => ctx.accounts.debug(),
    enableDebug: ctx.config.enableDebug,
  });
  await ctx.plugin(staticRoutePlugin);
  return ctx;
}
