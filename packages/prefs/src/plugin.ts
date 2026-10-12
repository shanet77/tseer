import type { Context } from "cordis";
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
