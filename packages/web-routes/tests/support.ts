import { type PrefsPluginOptions, prefsPlugin } from "@tseer/prefs";
import { serverPlugin } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import { renderPlugin } from "@tseer/views";
import { Context, type Plugin } from "cordis";

export interface BootedRoute {
  ctx: Context;
  unload: () => Promise<void>;
}

export interface BootRouteOptions {
  twitter?: TwitterApi | undefined;
  config?: Record<string, unknown> | undefined;
  pluginOptions?: unknown;
  prefs?: PrefsPluginOptions | undefined;
  setup?: ((ctx: Context) => Promise<void> | void) | undefined;
}

const TEST_RENDER_OPTIONS = {
  title: "nitter",
  hostname: "localhost",
  useHttps: false,
  picUrl: (url: string) => `/pic/${url}`,
  origPicUrl: (url: string) => `/pic/orig/${url}`,
  vidUrl: (url: string) => `/video/sig/${url}`,
};

export async function createTestApp(
  twitter?: TwitterApi | undefined,
  config?: Record<string, unknown> | undefined,
  prefs: PrefsPluginOptions = {},
): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(serverPlugin, { port: 0 });
  await ctx.plugin(prefsPlugin, prefs);
  await ctx.plugin(renderPlugin, TEST_RENDER_OPTIONS);
  if (twitter !== undefined) ctx.provide("twitter", twitter);
  if (config !== undefined) {
    ctx.provide("config", {
      title: "nitter",
      hostname: "localhost",
      useHttps: false,
      ...config,
    });
  }
  return ctx;
}

export async function bootRoute(
  plugin: Plugin,
  options: BootRouteOptions = {},
): Promise<BootedRoute> {
  const ctx = await createTestApp(options.twitter, options.config, options.prefs);
  await options.setup?.(ctx);
  const fiber = await ctx.plugin(plugin, options.pluginOptions);
  return { ctx, unload: () => fiber.dispose() };
}
