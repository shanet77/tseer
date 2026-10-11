/** `@tseer/prefs` — `ctx.prefs` seam: per-request preferences from cookies and
 * URL params, ported from nitter's `prefs.nim` + `prefs_impl.nim`. */

export { encodePrefs, parsePrefs } from "./parse.ts";
export type { PrefsPluginOptions, PrefsService } from "./plugin.ts";
export { default as prefsPlugin } from "./plugin.ts";
export type { PrefCategory, PrefKind, PrefMeta } from "./prefs.ts";
export { allPrefs, prefList } from "./prefs.ts";
export type { TseerPreferences } from "./schema.ts";
export {
  gallerySizeOptions,
  mediaViewOptions,
  preferencesSchema,
  themeOptions,
} from "./schema.ts";
export type { PrefCookieWrite } from "./update.ts";
export {
  applyPrefCookies,
  parsePrefsParam,
  resetPrefCookies,
  updatePrefCookies,
} from "./update.ts";
