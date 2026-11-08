import { encodeFollows, FOLLOWS_PREF, parseFollowsInput, sameFollows } from "./follows.ts";
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
  // Only touch follows when the form carried the field, so a form without it
  // can never wipe a visitor's list.
  const followsField = fields[FOLLOWS_PREF];
  if (followsField !== undefined) {
    writes.push(followsCookieWrite(parseFollowsInput(followsField), defaults));
  }
  return writes;
}

/**
 * The cookie write for a visitor's full follow list: expired when it matches
 * the instance default, otherwise the whole list (possibly empty) is stored.
 */
export function followsCookieWrite(
  follows: readonly string[],
  defaults: TseerPreferences,
): PrefCookieWrite {
  if (sameFollows(follows, defaults.follows)) {
    return { name: FOLLOWS_PREF, value: "", expire: true };
  }
  return { name: FOLLOWS_PREF, value: encodeFollows(follows), expire: false };
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
  writes.push({ name: FOLLOWS_PREF, value: "", expire: true });
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
  const follows = params[FOLLOWS_PREF];
  writes.push(
    follows !== undefined
      ? { name: FOLLOWS_PREF, value: encodeFollows(parseFollowsInput(follows)), expire: false }
      : { name: FOLLOWS_PREF, value: "", expire: true },
  );
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
