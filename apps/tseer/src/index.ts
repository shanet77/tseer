import { httpClientPlugin } from "@tseer/http-client";
import {
  aboutRoutePlugin,
  createApp as createKernelApp,
  healthRoutePlugin,
  staticRoutePlugin,
} from "@tseer/kernel";
import { serverPlugin } from "@tseer/server";
import { twitterSessionsPlugin } from "@tseer/twitter-sessions";
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
  /** Path to the sessions JSONL store (default: `TSEER_SESSIONS_FILE`, `./sessions.jsonl`). */
  sessionsPath?: string | undefined;
  /** Skip the sessions plugin entirely (no pool, `/.health` stays empty). */
  withoutSessions?: boolean | undefined;
}

/** Mount the scaffold plugin list on a kernel-booted cordis context. */
export async function createApp(options: CreateAppOptions = {}): Promise<Context> {
  const ctx = await createKernelApp({
    configPath: options.configPath,
    configText: options.configText,
  });
  if (options.port !== undefined) ctx.config.port = options.port;

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
  if (options.withoutSessions !== true) {
    await ctx.plugin(twitterSessionsPlugin, { path: options.sessionsPath });
  }
  await ctx.plugin(healthRoutePlugin, {
    sessionHealth: options.withoutSessions === true ? undefined : () => ctx.accounts.health(),
    sessionDebug: options.withoutSessions === true ? undefined : () => ctx.accounts.debug(),
    enableDebug: ctx.config.enableDebug,
  });
  await ctx.plugin(staticRoutePlugin);
  return ctx;
}
