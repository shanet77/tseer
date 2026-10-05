import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VerifiedType } from "@tseer/types";
import { describe, expect, it } from "vitest";
import type { Json } from "../src/json.ts";
import {
  parseAboutAccount,
  parseGraphUser,
  parseUserResult,
  parseVerifiedType,
} from "../src/user.ts";

function fixture(name: string): Json {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), "utf8"),
  );
}

describe("user parsers", () => {
  it("ports parseGraphUser over a legacy user_results payload", () => {
    const user = parseGraphUser(fixture("user_legacy"));
    expect(user).toMatchObject({
      id: "1234567890",
      username: "jack",
      fullname: "Jack",
      location: "San Francisco",
      website: "https://jack.xyz",
      userPic: "profile_images/1/xyz.jpg",
      banner: "profile_banners/123/1500x500",
      following: 100,
      followers: 1000000,
      tweets: 50000,
      likes: 5,
      media: 500,
      protected: false,
      suspended: false,
      verifiedType: VerifiedType.Blue,
      joinDate: "2006-03-21T20:19:24.000Z",
    });
  });

  it("rewrites the bio: expanded urls, mentions, hashtags", () => {
    const user = parseGraphUser(fixture("user_legacy"));
    expect(user.bio).toBe(
      'founder! visit <a href="https://jack.xyz">jack.xyz</a> and say hi <a href="/bob_1">@bob_1</a> about <a href="/search?f=tweets&q=%23foo">#foo</a>',
    );
  });

  it("ports parser.nim's minimal typed-shape fallback (no banner/bio/counts)", () => {
    const user = parseGraphUser(fixture("user_typed"));
    expect(user).toMatchObject({
      id: "42",
      username: "modern",
      fullname: "Modern User",
      userPic: "profile_images/2/abc.jpg",
      verifiedType: VerifiedType.Government,
      banner: "",
      bio: "",
      followers: 0,
    });
  });

  it("returns suspended for unavailable users", () => {
    const user = parseGraphUser(fixture("user_suspended"));
    expect(user.suspended).toBe(true);
  });

  it("parses an empty payload into a default user", () => {
    const user = parseGraphUser(undefined);
    expect(user.username).toBe("");
    expect(user.verifiedType).toBe(VerifiedType.None);
  });

  it("ports parseUserResult for the list-member shape (legacy + typed)", () => {
    const legacy = parseUserResult(
      (fixture("user_legacy") as { user_results: { result: Json } }).user_results.result,
    );
    expect(legacy.username).toBe("jack");
    expect(legacy.pinnedTweet).toBe("9876");

    const typed = parseUserResult(fixture("user_typed"));
    expect(typed).toMatchObject({
      username: "modern",
      followers: 10,
      following: 20,
      tweets: 30,
      media: 3,
      likes: 40,
      bio: "typed bio",
      banner: "https://pbs.twimg.com/profile_banners/2/1500x500",
      location: "Berlin",
      protected: true,
      verifiedType: VerifiedType.Government,
      joinDate: "2020-01-01T01:02:03.000Z",
    });
  });

  it("ports parseAboutAccount", () => {
    const info = parseAboutAccount(fixture("about_account"));
    expect(info).toMatchObject({
      username: "jack",
      fullname: "Jack",
      userPic: "profile_images/1/xyz.jpg",
      joinDate: "2006-03-21T20:19:24.000Z",
      verifiedType: VerifiedType.Business,
      suspended: false,
      basedIn: "United States",
      source: "experts",
      affiliateUsername: "square",
      affiliateLabel: "Gold checkmark",
      usernameChanges: 3,
      lastUsernameChange: "2023-11-14T22:13:20.000Z",
      isIdentityVerified: true,
      overrideVerifiedYear: 2020,
      verifiedSince: "2020-09-13T12:26:40.000Z",
    });
  });

  it("flags suspended about-account results", () => {
    expect(
      parseAboutAccount({
        data: { user_result_by_screen_name: { result: { unavailable_reason: "Suspended" } } },
      }).suspended,
    ).toBe(true);
  });

  it("keeps unknown verified_type strings", () => {
    expect(parseVerifiedType("Business", VerifiedType.None)).toBe(VerifiedType.Business);
    expect(parseVerifiedType("nonsense", VerifiedType.Blue)).toBe(VerifiedType.Blue);
  });
});
