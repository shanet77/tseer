import { allPrefs, type PrefMeta } from "./prefs.ts";
import { preferencesSchema, type TseerPreferences } from "./schema.ts";

export function parsePrefs(
  defaults: TseerPreferences,
  cookies: Record<string, string>,
  params: Record<string, string> = {},
): TseerPreferences {
  const prefs: Record<string, unknown> = { ...defaults };
  for (const source of [cookies, params]) {
    for (const pref of allPrefs) {
      const value = source[pref.name];
      if (value === undefined) continue;
      if (pref.kind === "input" || pref.name === "theme") prefs[pref.name] = value;
      else if (pref.kind === "checkbox")
        prefs[pref.name] = value === "on" || value === "true" || value === "1";
      else if (pref.options?.includes(value)) prefs[pref.name] = value;
    }
  }
  return preferencesSchema.parse(prefs);
}

export function encodePrefs(defaults: TseerPreferences, prefs: TseerPreferences): string {
  const values = prefs as unknown as Record<string, unknown>;
  const defaultValues = defaults as unknown as Record<string, unknown>;
  const pairs: string[] = [];
  for (const pref of allPrefs as PrefMeta[]) {
    if (values[pref.name] === defaultValues[pref.name]) continue;
    pairs.push(
      pref.kind === "checkbox"
        ? `${pref.name}=${values[pref.name] ? "on" : ""}`
        : `${pref.name}=${String(values[pref.name])}`,
    );
  }
  return pairs.join(",");
}
