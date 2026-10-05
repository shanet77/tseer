/** Ports of `prefs.nim`'s `getPrefs`/`genParsePrefs` and `genEncodePrefs`. */
import { allPrefs, type PrefMeta } from "./prefs.ts";
import { preferencesSchema, type TseerPreferences } from "./schema.ts";

/**
 * `defaultPrefs` overridden by cookies, then URL params (params win).
 * Presence semantics are ported verbatim from `genParsePrefs`:
 * - input and theme take the raw string (theme accepts anything, even
 *   non-option values — the Nim macro special-cases it).
 * - checkboxes are true only for "on"/"true"/"1"; any other present value
 *   (including "off") is false — presence is what matters, not the value.
 * - other selects apply only if the value is in their options.
 */
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

/**
 * Serialize non-default prefs to the compact `name=value` form (joined with
 * commas) that nitter uses for the shareable prefs string: checkboxes as
 * `name=on` / `name=`, everything else as `name=<value>`. Compared against the
 * config-derived defaults, like `genEncodePrefs` against `defaultPrefs`.
 */
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
