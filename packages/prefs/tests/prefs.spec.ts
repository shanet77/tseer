import { Context } from "cordis";
import { describe, expect, it } from "vitest";
import {
  allPrefs,
  encodePrefs,
  parsePrefs,
  preferencesSchema,
  prefList,
  prefsPlugin,
  type TseerPreferences,
} from "../src/index.ts";

const defaults: TseerPreferences = preferencesSchema.parse({});

describe("prefList metadata", () => {
  it("matches the zod schema key-for-key", () => {
    expect(new Set(allPrefs.map((p) => p.name))).toEqual(
      new Set(Object.keys(preferencesSchema.shape)),
    );
  });

  it("metadata defaults match the schema defaults", () => {
    for (const pref of allPrefs) {
      expect(pref.default, pref.name).toEqual(
        (preferencesSchema.shape as Record<string, { parse: (v: undefined) => unknown }>)[
          pref.name
        ]?.parse(undefined),
      );
    }
  });

  it("keeps the nitter categories", () => {
    expect(prefList.map((c) => c.category)).toEqual([
      "Display",
      "Media",
      "Link replacements (blank to disable)",
    ]);
  });
});

describe("prefsPlugin", () => {
  it("provides ctx.prefs bound to the given defaults", async () => {
    const ctx = new Context();
    await ctx.plugin(prefsPlugin, { preferences: { ...defaults, theme: "Twitter" } });
    expect(ctx.prefs.defaults.theme).toBe("Twitter");
    expect(ctx.prefs.parse({ theme: "Mastodon" }).theme).toBe("Mastodon");
    expect(ctx.prefs.encode(ctx.prefs.defaults)).toBe("");
  });

  it("falls back to bare schema defaults", async () => {
    const ctx = new Context();
    await ctx.plugin(prefsPlugin);
    expect(ctx.prefs.defaults).toEqual(defaults);
  });
});

describe("parsePrefs", () => {
  it("returns defaults for empty maps", () => {
    expect(parsePrefs(defaults, {})).toEqual(defaults);
  });

  it("applies checkbox truthiness like genParsePrefs", () => {
    const on = parsePrefs(defaults, { squareAvatars: "on" });
    expect(on.squareAvatars).toBe(true);
    expect(parsePrefs(defaults, { squareAvatars: "true" }).squareAvatars).toBe(true);
    expect(parsePrefs(defaults, { squareAvatars: "1" }).squareAvatars).toBe(true);
    expect(parsePrefs(defaults, { squareAvatars: "false" }).squareAvatars).toBe(false);
    // Presence with a non-truthy value is false, even for a default-true pref
    // (`result.ident = val == "on" or val == "true" or val == "1"`).
    expect(parsePrefs(defaults, { stickyNav: "off" }).stickyNav).toBe(false);
  });

  it("takes theme as free text, like the Nim special case", () => {
    expect(parsePrefs(defaults, { theme: "Twitter" }).theme).toBe("Twitter");
    expect(parsePrefs(defaults, { theme: "SomeCustom" }).theme).toBe("SomeCustom");
  });

  it("applies selects only for known options", () => {
    expect(parsePrefs(defaults, { gallerySize: "Large" }).gallerySize).toBe("Large");
    expect(parsePrefs(defaults, { gallerySize: "Huge" }).gallerySize).toBe("Medium");
  });

  it("applies input prefs verbatim", () => {
    expect(parsePrefs(defaults, { replaceTwitter: "nitter.example" }).replaceTwitter).toBe(
      "nitter.example",
    );
  });

  it("lets URL params override cookies", () => {
    const prefs = parsePrefs(defaults, { theme: "Nitter" }, { theme: "Mastodon" });
    expect(prefs.theme).toBe("Mastodon");
  });
});

describe("encodePrefs", () => {
  it("emits only non-defaults", () => {
    expect(encodePrefs(defaults, defaults)).toBe("");
    expect(encodePrefs(defaults, { ...defaults, theme: "Twitter" })).toBe("theme=Twitter");
  });

  it("serializes checkboxes as on/empty like genEncodePrefs", () => {
    const prefs = { ...defaults, stickyNav: false, squareAvatars: true };
    expect(encodePrefs(defaults, prefs)).toBe("stickyNav=,squareAvatars=on");
  });

  it("round-trips through parse", () => {
    const prefs: TseerPreferences = {
      ...defaults,
      theme: "Mastodon",
      hideBanner: true,
      stickyProfile: false,
      gallerySize: "Large",
      replaceTwitter: "nitter.example",
    };
    const encoded = encodePrefs(defaults, prefs);
    const cookies = Object.fromEntries(
      encoded
        .split(",")
        .map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]),
    );
    expect(parsePrefs(defaults, cookies)).toEqual(prefs);
  });
});
