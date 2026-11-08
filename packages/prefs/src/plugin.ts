import type { Context } from "cordis";
import { normalizeFollows } from "./follows.ts";
import { encodePrefs, parsePrefs } from "./parse.ts";
import { preferencesSchema, type TseerPreferences } from "./schema.ts";

declare module "cordis" {
  interface Context {
    prefs: PrefsService;
  }
}

export interface PrefsService {
  readonly defaults: TseerPreferences;
  parse(cookies: Record<string, string>, params?: Record<string, string>): TseerPreferences;
  encode(prefs: TseerPreferences): string;
}

export interface PrefsPluginOptions {
  preferences?: TseerPreferences | undefined;
}

export default function prefsPlugin(ctx: Context, options: PrefsPluginOptions = {}): () => void {
  const base = options.preferences ?? preferencesSchema.parse({});
  const defaults: TseerPreferences = { ...base, follows: normalizeFollows(base.follows) };
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
