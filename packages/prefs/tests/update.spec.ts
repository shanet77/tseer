/**
 * Pure-function ports of nitter's `prefs_impl.nim` macros — the cookie-write
 * decisions behind `/saveprefs`, `/resetprefs`, and the `?prefs=` bookmark
 * URLs. These are the load-bearing prefs semantics, so each branch of the
 * per-kind `isDefault` comparison is pinned here.
 *
 * Verbatim from upstream:
 * - `genUpdatePrefs`: a default value *expires* the cookie, a non-default
 *   *sets* it.
 * - `genResetPrefs`: emits an unconditional `savePref(name, "", expire=true)`
 *   for every pref. The "only expire a cookie the request carried" guard is
 *   `savePref`'s own (`if not expire or pref in cookies(req)`), which lives in
 *   the preferences route plugin — not here. So these functions report the
 *   full write set, and the route filters it.
 * - `genApplyPrefs`: a pref present in the `?prefs=` params is *set* to its
 *   submitted value (no default comparison), and every other pref is expired.
 *   The bookmark URL therefore replaces the saved set rather than merging.
 */

import { describe, expect, it } from "vitest";
import { preferencesSchema } from "../src/index.ts";
import {
  applyPrefCookies,
  parsePrefsParam,
  resetPrefCookies,
  updatePrefCookies,
} from "../src/update.ts";

const schema = preferencesSchema;
const defaults = schema.parse({});
const allNames = Object.keys(schema.shape).sort();

describe("updatePrefCookies", () => {
  it("expires a pref whose submitted value matches the default", () => {
    const writes = updatePrefCookies({ theme: defaults.theme }, defaults);
    const theme = writes.find((w) => w.name === "theme");
    expect(theme).toEqual({ name: "theme", value: "", expire: true });
  });

  it("sets a pref whose submitted value differs from the default", () => {
    const writes = updatePrefCookies({ theme: "Mastodon" }, defaults);
    const theme = writes.find((w) => w.name === "theme");
    expect(theme).toEqual({ name: "theme", value: "Mastodon", expire: false });
  });

  it("emits one write per pref in the schema", () => {
    const writes = updatePrefCookies({}, defaults);
    expect(writes.map((w) => w.name).sort()).toEqual(allNames);
  });

  it("sets a default-off checkbox that the form turned on", () => {
    // squareAvatars defaults off; the form submits "on" for a checked box.
    const writes = updatePrefCookies({ squareAvatars: "on" }, defaults);
    const square = writes.find((w) => w.name === "squareAvatars");
    expect(square).toEqual({ name: "squareAvatars", value: "on", expire: false });
  });

  it("persists a default-on checkbox the form left off (absent → off)", () => {
    // mp4Playback defaults ON. An unchecked box is absent, so val is "" and
    // ("" == "on") != true → non-default → save "". That "" is what persists
    // "off" when the route writes it; a browser reads "" as unchecked.
    const writes = updatePrefCookies({ mp4Playback: "" }, defaults);
    const mp4 = writes.find((w) => w.name === "mp4Playback");
    expect(mp4).toEqual({ name: "mp4Playback", value: "", expire: false });
  });

  it("treats a default-valued input as a reset", () => {
    // replaceTwitter defaults to ""; submitting "" is a reset.
    const writes = updatePrefCookies({ replaceTwitter: "" }, defaults);
    const twitter = writes.find((w) => w.name === "replaceTwitter");
    expect(twitter).toEqual({ name: "replaceTwitter", value: "", expire: true });
  });

  it("keeps a non-default input verbatim", () => {
    const writes = updatePrefCookies({ replaceTwitter: "nitter.example" }, defaults);
    const twitter = writes.find((w) => w.name === "replaceTwitter");
    expect(twitter).toEqual({
      name: "replaceTwitter",
      value: "nitter.example",
      expire: false,
    });
  });

  it("compares against config-derived defaults, not schema defaults", () => {
    // The operator set theme=Mastodon as the default; submitting Mastodon is
    // then a reset, not a change.
    const cfgDefaults = schema.parse({ theme: "Mastodon" });
    const writes = updatePrefCookies({ theme: "Mastodon" }, cfgDefaults);
    const theme = writes.find((w) => w.name === "theme");
    expect(theme).toEqual({ name: "theme", value: "", expire: true });
  });
});

describe("resetPrefCookies", () => {
  it("emits an unconditional expiry for every pref in the schema", () => {
    // Upstream genResetPrefs emits savePref(name, "", expire=true) for every
    // pref; savePref's own guard (in the route) drops the ones the request
    // never carried. The pure function reports the full set.
    const writes = resetPrefCookies();
    expect(writes.map((w) => w.name).sort()).toEqual(allNames);
    expect(writes.every((w) => w.expire && w.value === "")).toBe(true);
  });
});

describe("applyPrefCookies", () => {
  it("sets each present pref and expires every other pref in the schema", () => {
    // The ?prefs= URL form: presence semantics, no default comparison.
    const writes = applyPrefCookies({ theme: "Mastodon", squareAvatars: "on" });
    const theme = writes.find((w) => w.name === "theme");
    const square = writes.find((w) => w.name === "squareAvatars");
    expect(theme).toEqual({ name: "theme", value: "Mastodon", expire: false });
    expect(square).toEqual({ name: "squareAvatars", value: "on", expire: false });
    const escaped = writes
      .filter((w) => w.expire)
      .map((w) => w.name)
      .sort();
    expect(escaped).toEqual(allNames.filter((n) => n !== "theme" && n !== "squareAvatars"));
  });

  it("treats an empty params object as a full reset", () => {
    // This is what an all-default prefs bookmark URL decodes to (encodePrefs
    // is a diff), so visiting it clears every saved pref.
    const writes = applyPrefCookies({});
    expect(writes).toHaveLength(allNames.length);
    expect(writes.every((w) => w.expire)).toBe(true);
  });

  it("keeps a present pref that equals the default (literal override)", () => {
    const writes = applyPrefCookies({ theme: defaults.theme });
    const theme = writes.find((w) => w.name === "theme");
    expect(theme?.expire).toBe(false);
  });
});

describe("parsePrefsParam", () => {
  it("splits the comma-separated name=value pairs", () => {
    expect(parsePrefsParam("theme=Mastodon,squareAvatars=on")).toEqual({
      theme: "Mastodon",
      squareAvatars: "on",
    });
  });

  it("treats an empty string as no prefs", () => {
    expect(parsePrefsParam("")).toEqual({});
  });

  it("splits on the first = only (values may contain =)", () => {
    expect(parsePrefsParam("replaceTwitter=a=b")).toEqual({ replaceTwitter: "a=b" });
  });

  it("keeps a bare name with no = as an empty value", () => {
    expect(parsePrefsParam("theme")).toEqual({ theme: "" });
  });
});
