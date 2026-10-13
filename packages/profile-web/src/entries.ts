import { cachePlugin } from "@tseer/cache";
import { httpClientPlugin } from "@tseer/http-client";
import { aboutRoutePlugin, healthRoutePlugin, staticRoutePlugin } from "@tseer/kernel";
import { mediaPlugin, mediaRoutePlugin } from "@tseer/media";
import { prefsPlugin } from "@tseer/prefs";
import { serverPlugin } from "@tseer/server";
import { twitterApiPlugin } from "@tseer/twitter-api";
import { parsersPlugin } from "@tseer/twitter-parser";
import { twitterSessionsPlugin } from "@tseer/twitter-sessions";
import { renderPlugin } from "@tseer/views";
import {
  articlePlugin,
  broadcastPlugin,
  communityPlugin,
  embedPlugin,
  homePlugin,
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
import type { Context, Plugin } from "cordis";
import helloPlugin from "./hello.ts";

export interface ProfileOptions {
  name?: string;
  cacheProvider?: "memory" | "redis";
  withoutCache?: boolean;
  sessionsPath?: string;
  withoutSessions?: boolean;
  withoutTwitter?: boolean;
}

export interface ProfileState {
  options: ProfileOptions;
  mounted: ReadonlySet<string>;
}

export interface ProfileEntry {
  name: string;
  plugin: Plugin;
  options?: (ctx: Context, state: ProfileState) => unknown;
  requires?: string[];
  when?: (options: ProfileOptions) => boolean;
}

const whenTwitter = (options: ProfileOptions): boolean => options.withoutTwitter !== true;

export const profileEntries: ProfileEntry[] = [
  {
    name: "hello",
    plugin: helloPlugin,
    options: (_ctx, { options }) => ({ name: options.name ?? "tseer" }),
  },
  {
    name: "server",
    plugin: serverPlugin,
    options: (ctx) => ({ address: ctx.config.address, port: ctx.config.port }),
  },
  {
    name: "http-client",
    plugin: httpClientPlugin,
    options: (ctx) => ({
      maxConns: ctx.config.httpMaxConns,
      proxy: ctx.config.proxy,
      proxyAuth: ctx.config.proxyAuth,
      apiProxy: ctx.config.apiProxy,
      maxRetries: ctx.config.maxRetries,
      retryDelayMs: ctx.config.retryDelayMs,
    }),
  },
  {
    name: "about",
    plugin: aboutRoutePlugin,
    options: (ctx) => ({ title: ctx.config.title }),
  },
  {
    name: "prefs",
    plugin: prefsPlugin,
    options: (ctx) => ({ preferences: ctx.config.preferences }),
  },
  {
    name: "render",
    plugin: renderPlugin,
    options: (ctx, { mounted }) => ({
      title: ctx.config.title,
      hostname: ctx.config.hostname,
      useHttps: ctx.config.useHttps,
      ...(mounted.has("media")
        ? {
            picUrl: (url: string) => ctx.media.picUrl(url),
            origPicUrl: (url: string) => ctx.media.origPicUrl(url),
            vidUrl: (url: string) => ctx.media.vidUrl(url),
          }
        : {}),
    }),
  },
  {
    name: "cache",
    plugin: cachePlugin,
    when: (options) => options.withoutCache !== true,
    options: (ctx, { options }) => ({
      provider: options.cacheProvider ?? ctx.config.cacheProvider,
    }),
  },
  {
    name: "sessions",
    plugin: twitterSessionsPlugin,
    when: (options) => options.withoutSessions !== true,
    options: (_ctx, { options }) => ({ path: options.sessionsPath }),
  },
  {
    name: "media",
    plugin: mediaPlugin,
    when: whenTwitter,
    requires: ["sessions"],
    options: (ctx) => ({ hmacKey: ctx.config.hmacKey, base64Media: ctx.config.base64Media }),
  },
  {
    name: "media-routes",
    plugin: mediaRoutePlugin,
    when: whenTwitter,
    requires: ["media"],
    options: (ctx) => ({
      proxy: ctx.config.proxy,
      proxyAuth: ctx.config.proxyAuth,
      maxConns: ctx.config.httpMaxConns,
    }),
  },
  {
    name: "parsers",
    plugin: parsersPlugin,
    when: whenTwitter,
    requires: ["media"],
    options: (ctx) => ({ picUrl: (url: string) => ctx.media.picUrl(url) }),
  },
  {
    name: "twitter-api",
    plugin: twitterApiPlugin,
    when: whenTwitter,
    requires: ["parsers", "sessions"],
    options: (ctx) => ({
      disableTid: ctx.config.disableTid,
      maxRetries: ctx.config.maxRetries,
      retryDelayMs: ctx.config.retryDelayMs,
    }),
  },
  { name: "home", plugin: homePlugin, when: whenTwitter, requires: ["sessions"] },
  { name: "timeline", plugin: timelinePlugin, when: whenTwitter, requires: ["sessions"] },
  { name: "status", plugin: statusPlugin, when: whenTwitter, requires: ["sessions"] },
  { name: "article", plugin: articlePlugin, when: whenTwitter, requires: ["sessions"] },
  { name: "list", plugin: listPlugin, when: whenTwitter, requires: ["sessions"] },
  { name: "community", plugin: communityPlugin, when: whenTwitter, requires: ["sessions"] },
  { name: "search", plugin: searchPlugin, when: whenTwitter, requires: ["sessions"] },
  { name: "rss", plugin: rssPlugin, when: whenTwitter, requires: ["sessions"] },
  {
    name: "space",
    plugin: spacePlugin,
    when: whenTwitter,
    requires: ["sessions"],
    options: (ctx) => ({
      proxy: ctx.config.proxy,
      proxyAuth: ctx.config.proxyAuth,
      maxConns: ctx.config.httpMaxConns,
    }),
  },
  {
    name: "broadcast",
    plugin: broadcastPlugin,
    when: whenTwitter,
    requires: ["sessions"],
    options: (ctx) => ({
      proxy: ctx.config.proxy,
      proxyAuth: ctx.config.proxyAuth,
      maxConns: ctx.config.httpMaxConns,
    }),
  },
  { name: "resolver", plugin: resolverPlugin, when: whenTwitter, requires: ["sessions"] },
  { name: "embed", plugin: embedPlugin, when: whenTwitter, requires: ["sessions"] },
  {
    name: "preferences",
    plugin: preferencesPlugin,
    options: (ctx) => ({
      hostname: ctx.config.hostname,
      useHttps: ctx.config.useHttps,
      staticDir: ctx.config.staticDir,
    }),
  },
  { name: "unsupported", plugin: unsupportedPlugin },
  {
    name: "health",
    plugin: healthRoutePlugin,
    options: (ctx, { mounted }) => ({
      sessionHealth: mounted.has("sessions") ? () => ctx.accounts.health() : undefined,
      sessionDebug: mounted.has("sessions") ? () => ctx.accounts.debug() : undefined,
      enableDebug: ctx.config.enableDebug,
    }),
  },
  { name: "static", plugin: staticRoutePlugin },
];
