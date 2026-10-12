import { allPrefs, type PrefMeta } from "./prefs.ts";
import type { TseerPreferences } from "./schema.ts";

export interface PrefCookieWrite {
  name: string;
  value: string;
  expire: boolean;
}

export function updatePrefCookies(
  fields: Record<string, string>,
  defaults: TseerPreferences,
): PrefCookieWrite[] {
  const values = defaults as unknown as Record<string, boolean | string>;
  const writes: PrefCookieWrite[] = [];
  for (const pref of allPrefs) {
    const val = fields[pref.name] ?? "";
    const def = values[pref.name] ?? pref.default;
    const name = pref.name;
    if (isPrefDefault(pref, val, def)) {
      writes.push({ name, value: "", expire: true });
    } else {
      writes.push({ name, value: val, expire: false });
    }
  }
  return writes;
}

function isPrefDefault(pref: PrefMeta, val: string, def: boolean | string): boolean {
  if (pref.kind === "input" || pref.name === "theme") return val === String(def);
  if (pref.kind === "checkbox") return (val === "on") === def;
  return !(pref.options ?? []).includes(val) || val === def;
}

export function resetPrefCookies(): PrefCookieWrite[] {
  const writes: PrefCookieWrite[] = [];
  for (const pref of allPrefs) {
    writes.push({ name: pref.name, value: "", expire: true });
  }
  return writes;
}

export function applyPrefCookies(params: Record<string, string>): PrefCookieWrite[] {
  const writes: PrefCookieWrite[] = [];
  for (const pref of allPrefs) {
    if (params[pref.name] !== undefined) {
      writes.push({ name: pref.name, value: params[pref.name] ?? "", expire: false });
    } else {
      writes.push({ name: pref.name, value: "", expire: true });
    }
  }
  return writes;
}

export function parsePrefsParam(prefsParam: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of prefsParam.split(",")) {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      if (pair.length > 0) params[pair] = "";
    } else {
      params[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
  }
  return params;
}
