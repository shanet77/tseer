/** Provide `ctx.prefs` — per-request preferences, bound to the config-derived
 * defaults (nitter's `defaultPrefs` is likewise updated from
 * `config.nim`'s `[Preferences]` section on boot). */
import type { Context } from "cordis";
import { encodePrefs, parsePrefs } from "./parse.ts";
import { preferencesSchema, type TseerPreferences } from "./schema.ts";

declare module "cordis" {
  interface Context {
    /** Per-request prefs from cookies/URL params (port of `prefs.nim`). */
    prefs: PrefsService;
  }
}

export interface PrefsService {
  /** Config-derived defaults (`[Preferences]` merged over schema defaults). */
  readonly defaults: TseerPreferences;
  parse(cookies: Record<string, string>, params?: Record<string, string>): TseerPreferences;
  encode(prefs: TseerPreferences): string;
}

export interface PrefsPluginOptions {
  /** Defaults from the config service; bare schema defaults when omitted. */
  preferences?: TseerPreferences | undefined;
}

export default function prefsPlugin(ctx: Context, options: PrefsPluginOptions = {}): () => void {
  const defaults = options.preferences ?? preferencesSchema.parse({});
  const service: PrefsService = {
    defaults,
    parse: (cookies, params) => parsePrefs(defaults, cookies, params),
    encode: (prefs) => encodePrefs(defaults, prefs),
  };
  const dispose = ctx.provide("prefs", service);
  return () => {
    void dispose();
  };
}
