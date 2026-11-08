import { describe, expect, it } from "vitest";
import {
  addFollow,
  applyPrefCookies,
  decodeFollows,
  encodeFollows,
  encodePrefs,
  followsCookieWrite,
  isFollowing,
  MAX_FOLLOWS,
  normalizeFollows,
  parseFollowsInput,
  parsePrefs,
  parsePrefsParam,
  preferencesSchema,
  removeFollow,
  resetPrefCookies,
  type TseerPreferences,
  updatePrefCookies,
} from "../src/index.ts";

const base = preferencesSchema.parse({});
const instance: TseerPreferences = { ...base, follows: ["nasa", "spacex"] };

describe("follow list helpers", () => {
  it("normalizes: trims, strips @, drops invalid names, dedupes case-insensitively, caps", () => {
    expect(normalizeFollows([" @NASA ", "nasa", "", "bad;name", "a.b", "spacex"])).toEqual([
      "NASA",
      "spacex",
    ]);
    expect(normalizeFollows(Array.from({ length: 200 }, (_, i) => `u${i}`))).toHaveLength(
      MAX_FOLLOWS,
    );
  });

  it("round-trips the dot-separated wire format", () => {
    expect(encodeFollows(["a", "b_c", "D"])).toBe("a.b_c.D");
    expect(decodeFollows("a.b_c.D")).toEqual(["a", "b_c", "D"]);
    expect(decodeFollows("")).toEqual([]);
  });

  it("parses free-form settings input", () => {
    expect(parseFollowsInput("nasa\r\n@spacex, esa  jaxa\n\n")).toEqual([
      "nasa",
      "spacex",
      "esa",
      "jaxa",
    ]);
  });

  it("adds and removes case-insensitively without duplicating", () => {
    expect(addFollow(["nasa"], "esa")).toEqual(["nasa", "esa"]);
    expect(addFollow(["nasa"], "NASA")).toEqual(["nasa"]);
    expect(removeFollow(["nasa", "esa"], "NASA")).toEqual(["esa"]);
    expect(isFollowing(["NASA"], "nasa")).toBe(true);
    expect(isFollowing(["NASA"], "esa")).toBe(false);
  });
});

describe("follows pref parsing", () => {
  it("falls back to the instance default without a cookie", () => {
    expect(parsePrefs(instance, {}).follows).toEqual(["nasa", "spacex"]);
  });

  it("uses the cookie snapshot when present, including an empty one", () => {
    expect(parsePrefs(instance, { follows: "esa.jaxa" }).follows).toEqual(["esa", "jaxa"]);
    expect(parsePrefs(instance, { follows: "" }).follows).toEqual([]);
  });

  it("includes follows in the ?prefs= export only when it differs from the default", () => {
    expect(encodePrefs(instance, instance)).toBe("");
    const code = encodePrefs(instance, { ...instance, follows: ["esa", "jaxa"] });
    expect(code).toBe("follows=esa.jaxa");
    const restored = parsePrefs(instance, {}, parsePrefsParam(code));
    expect(restored.follows).toEqual(["esa", "jaxa"]);
  });

  it("survives the export alongside other prefs", () => {
    const code = encodePrefs(instance, { ...instance, theme: "Mastodon", follows: ["esa"] });
    const writes = applyPrefCookies(parsePrefsParam(code));
    expect(writes.find((w) => w.name === "theme")?.value).toBe("Mastodon");
    expect(writes.find((w) => w.name === "follows")).toEqual({
      name: "follows",
      value: "esa",
      expire: false,
    });
  });
});

describe("follows cookie writes", () => {
  it("expires the cookie when the list matches the instance default (ignoring case)", () => {
    expect(followsCookieWrite(["NASA", "spacex"], instance)).toEqual({
      name: "follows",
      value: "",
      expire: true,
    });
  });

  it("stores the full list, including an empty one, when it differs", () => {
    expect(followsCookieWrite(["nasa"], instance)).toEqual({
      name: "follows",
      value: "nasa",
      expire: false,
    });
    expect(followsCookieWrite([], instance)).toEqual({
      name: "follows",
      value: "",
      expire: false,
    });
  });

  it("saveprefs only touches follows when the form carried the field", () => {
    expect(updatePrefCookies({}, instance).some((w) => w.name === "follows")).toBe(false);
    expect(updatePrefCookies({ follows: "esa\njaxa" }, instance)).toContainEqual({
      name: "follows",
      value: "esa.jaxa",
      expire: false,
    });
    expect(updatePrefCookies({ follows: "nasa\nspacex" }, instance)).toContainEqual({
      name: "follows",
      value: "",
      expire: true,
    });
  });

  it("reset clears the follows cookie back to the instance default", () => {
    expect(resetPrefCookies()).toContainEqual({ name: "follows", value: "", expire: true });
  });
});
