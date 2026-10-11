/** Ports of `prefs_impl.nim`'s `genUpdatePrefs`/`genResetPrefs`/
 * `genApplyPrefs` plus the pair-splitting from `router_utils.nim`'s
 * `applyUrlPrefs` — the cookie-write decisions behind `/saveprefs`,
 * `/resetprefs`, and the `?prefs=` bookmark URLs.
 *
 * These are pure functions over the pref model: which names get written with
 * which values, and which expire. The HTTP half — serializing a write into a
 * `Set-Cookie` header, and the `savePref` guard that skips expiring a cookie
 * the request never carried — lives in the preferences route plugin, because
 * it needs the request/response (AGENTS.md: "route-plugin territory"). */
import { allPrefs, type PrefMeta } from "./prefs.ts";
import type { TseerPreferences } from "./schema.ts";

/** One cookie write the route plugin turns into a `Set-Cookie` header. */
export interface PrefCookieWrite {
  name: string;
  /** Empty for expiries (nitter writes `""` to clear). */
  value: string;
  /** Expire (delete) instead of set — nitter's `savePref(expire=true)`. */
  expire: boolean;
}

/**
 * `genUpdatePrefs` (POST /saveprefs): for every pref, compare the submitted
 * value against the config-derived default. Defaults expire the cookie;
 * non-defaults are saved verbatim.
 *
 * Checkbox presence semantics ported verbatim: an unchecked box is *absent*
 * from the form body, so `val` is `""` and `(val == "on") == default` decides
 * — an unchecked default-true box therefore saves `""` (persisting "off"),
 * while an unchecked default-false box just clears any stale cookie.
 * Selects treat out-of-options values as default (nitter: `val notin
 * options or val == default`); `theme` compares as free text (the macro's
 * `input or name == "theme"` special case).
 *
 * Like the other two ports, this reports the full write set — upstream emits
 * `savePref(name, "", expire=true)` for a default unconditionally, and
 * `savePref`'s presence guard filters it. The guard lives in the route plugin.
 *
 * @param fields Submitted values; unchecked checkboxes are absent ("").
 * @param defaults Config-derived defaults (`ctx.prefs.defaults`).
 */
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
  // select: out-of-options values count as default
  return !(pref.options ?? []).includes(val) || val === def;
}

/** `genResetPrefs` (POST /resetprefs): expire every pref, unconditionally.
 *
 * The `savePref` presence guard ("only expire a cookie the request carried")
 * is not applied here — upstream `genResetPrefs` emits `savePref(name, "",
 * expire=true)` for every pref and lets `savePref` decide, so the guard stays
 * in the route plugin where the request is available. This reports the full
 * write set; the route filters it. */
export function resetPrefCookies(): PrefCookieWrite[] {
  const writes: PrefCookieWrite[] = [];
  for (const pref of allPrefs) {
    writes.push({ name: pref.name, value: "", expire: true });
  }
  return writes;
}

/**
 * `genApplyPrefs` (via `applyUrlPrefs`, the `?prefs=` bookmark URLs): prefs
 * present in the URL params are set to their submitted value — no default
 * comparison — and every other pref is expired. A prefs URL therefore
 * *replaces* the saved set rather than merging into it.
 *
 * The expiry here is unconditional, matching upstream `genApplyPrefs`; the
 * `savePref` presence guard is applied by the route plugin, which holds the
 * request. */
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

/**
 * `applyUrlPrefs`' pair splitting: `"a=1,b"` → `{ a: "1", b: "" }`. Pairs
 * split on `,`, then the first `=`; a bare name means empty value, an empty
 * pair (from `,,`) is skipped.
 */
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
