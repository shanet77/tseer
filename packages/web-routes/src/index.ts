/** `@tseer/web-routes` — route plugins, one per nitter route family. */

export { NAME_PARAM, TAB_PARAM } from "./params.ts";
export { default as preferencesPlugin, registerPreferencesRoutes } from "./preferences.ts";
export { default as resolverPlugin, registerResolverRoutes } from "./resolver.ts";
export { default as rssPlugin, registerRssRoutes } from "./rss.ts";
export { default as searchPlugin, registerSearchRoutes } from "./search.ts";
export { default as statusPlugin, registerStatusRoutes } from "./status.ts";
export { default as timelinePlugin, registerTimelineRoutes } from "./timeline.ts";
export { default as unsupportedPlugin, registerUnsupportedRoutes } from "./unsupported.ts";
