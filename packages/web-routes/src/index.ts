/** `@tseer/web-routes` — route plugins, one per nitter route family. */

export { default as searchPlugin, registerSearchRoutes } from "./search.ts";
export { default as statusPlugin, registerStatusRoutes } from "./status.ts";
export { default as timelinePlugin, registerTimelineRoutes } from "./timeline.ts";
