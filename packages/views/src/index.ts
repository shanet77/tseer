/** `@tseer/views` — `ctx.render` seam (page shell) + formatters. */

export {
  getDuration,
  getJoinDate,
  getJoinDateFull,
  getLink,
  getLocation,
  getRfc822Time,
  getShortTime,
  getSuspended,
  getTime,
  getTweetLink,
  getUrlPrefix,
  getUserPic,
  pageDesc,
  pageTitle,
  pageTitleOfTweet,
  replaceUrls,
  sanitizeXml,
  shorten,
  shortLink,
  stripHtml,
  titleize,
} from "./formatters.ts";
export type {
  PageConfig,
  TseerPreferencesLike,
} from "./page.tsx";
export { doctype, renderError, renderHead, renderMain, renderNavbar } from "./page.tsx";
export type { RenderPluginOptions } from "./plugin.ts";
export { default as renderPlugin } from "./plugin.ts";
export type {
  PageContext,
  PageOpts,
  Render,
  RenderEvents,
  RenderOptions,
} from "./render.ts";
export { RenderImpl } from "./render.ts";
