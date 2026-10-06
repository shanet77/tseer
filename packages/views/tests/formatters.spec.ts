import { preferencesSchema, type TseerPreferences } from "@tseer/prefs";
import type { User } from "@tseer/types";
import { VerifiedType } from "@tseer/types";
import { describe, expect, it } from "vitest";
import {
  getDuration,
  getJoinDate,
  getJoinDateFull,
  getLink,
  getLocation,
  getRfc822Time,
  getShortTime,
  getSuspended,
  getTime,
  getUrlPrefix,
  getUserPic,
  pageDesc,
  pageTitle,
  pageTitleOfTweet,
  replaceUrls,
  sanitizeXml,
  shorten,
  shortLink,
  stripHtml,
  titleize,
} from "../src/index.ts";

const defaults: TseerPreferences = preferencesSchema.parse({});

describe("shorten/shortLink", () => {
  it("truncates with an ellipsis at the codepoint level", () => {
    expect(shorten("https://example.com/abcdefghi")).toBe("https://example.com/abcdefgh…");
    expect(shorten("short")).toBe("short");
    expect(shorten("🔥".repeat(30))).toBe(`${"🔥".repeat(28)}…`);
  });

  it("strips the scheme/www before shortening", () => {
    expect(shortLink("https://www.example.com/abcdefghijklmnopqrstuvwxyz")).toBe(
      "example.com/abcdefghijklmnop…",
    );
  });
});

describe("stripHtml", () => {
  it("replaces http links with their href", () => {
    expect(stripHtml('before <a href="https://x.com/a">text</a> after')).toBe(
      "before https://x.com/a after",
    );
  });

  it("shortens links when asked", () => {
    const html = '<a href="https://www.example.com/abcdefghijklmnopqrstuvwxyz">text</a>';
    expect(stripHtml(html, true)).toBe("example.com/abcdefghijklmnop…");
  });

  it("strips other tags and decodes entities", () => {
    expect(stripHtml("<b>bold &amp; brave</b> &lt;tag&gt;")).toBe("bold & brave <tag>");
  });
});

describe("sanitizeXml", () => {
  it("drops characters outside the legal XML ranges", () => {
    expect(sanitizeXml("ok\u0000bad\u0008")).toBe("okbad");
    expect(sanitizeXml("tab\tnewline\n")).toBe("tab\tnewline\n");
    expect(sanitizeXml("emoji \u{1F600} stays")).toBe("emoji \u{1F600} stays");
  });
});

describe("replaceUrls", () => {
  const prefs = (overrides: Partial<TseerPreferences>): TseerPreferences => ({
    ...defaults,
    ...overrides,
  });

  it("rewrites youtube hosts", () => {
    const out = replaceUrls(
      '<a href="https://www.youtube.com/watch?v=1">youtube.com/watch?v=1</a>',
      prefs({ replaceYouTube: "piped.example/" }),
    );
    expect(out).toBe('<a href="https://piped.example/watch?v=1">piped.example/watch?v=1</a>');
  });

  it("rewrites twitter and t.co links", () => {
    const out = replaceUrls(
      '<a href="https://twitter.com/a/status/1">twitter.com/a/status/1</a> https://t.co/xyz https://cards.twitter.com/cards/x',
      prefs({ replaceTwitter: "nitter.example" }),
    );
    expect(out).toBe(
      '<a href="https://nitter.example/a/status/1">nitter.example/a/status/1</a> https://nitter.example/t.co/xyz https://nitter.example/cards/x',
    );
  });

  it("rewrites x.com links including <a> forms", () => {
    const out = replaceUrls(
      '<a href="https://x.com/a/status/1">x.com/a/status/1</a> https://x.com/b',
      prefs({ replaceTwitter: "nitter.example" }),
    );
    expect(out).toBe(
      '<a href="https://nitter.example/a/status/1">nitter.example/a/status/1</a> https://nitter.example/b',
    );
  });

  it("rewrites reddit links and galleries", () => {
    const out = replaceUrls(
      '<a href="https://old.reddit.com/r/x/gallery/abc">old.reddit.com/r/x/gallery/abc</a> https://redd.it/xyz',
      prefs({ replaceReddit: "teddit.example" }),
    );
    expect(out).toBe(
      '<a href="https://teddit.example/r/x/comments/abc">teddit.example/r/x/comments/abc</a> https://teddit.example/comments/xyz',
    );
  });

  it("makes links absolute when asked", () => {
    const out = replaceUrls('<a href="/pic/x.jpg">x</a>', defaults, "https://nitter.example");
    expect(out).toBe('<a href="https://nitter.example/pic/x.jpg">x</a>');
  });

  it("leaves body untouched without prefs", () => {
    const body = '<a href="https://x.com/a">x.com/a</a>';
    expect(replaceUrls(body, defaults)).toBe(body);
  });
});

describe("getUserPic", () => {
  it("strips variant suffixes and applies styles", () => {
    expect(getUserPic("abc_normal.jpg")).toBe("abc.jpg");
    expect(getUserPic("abc_bigger.png", "_200x200")).toBe("abc_200x200.png");
    expect(getUserPic("abc.jpg")).toBe("abc.jpg");
    expect(getUserPic("")).toBe("");
  });
});

describe("titles and descriptions", () => {
  const user: User = {
    id: "",
    username: "jane",
    fullname: "Jane Doe",
    location: "",
    website: "",
    bio: "bio with <b>html</b>",
    userPic: "",
    banner: "",
    pinnedTweet: "",
    following: 0,
    followers: 0,
    tweets: 0,
    likes: 0,
    media: 0,
    verifiedType: VerifiedType.None,
    protected: false,
    suspended: false,
    joinDate: "",
  };

  it("formats user titles", () => {
    expect(pageTitle(user)).toBe("Jane Doe (@jane)");
  });

  it("formats tweet titles with stripped text", () => {
    expect(pageTitleOfTweet({ user, text: "hello <i>world</i>" })).toBe(
      'Jane Doe (@jane): "hello world"',
    );
  });

  it("falls back to a generic description without a bio", () => {
    expect(pageDesc({ ...user, bio: "" })).toBe("The latest tweets from Jane Doe");
    expect(pageDesc(user)).toBe("bio with html");
  });
});

describe("dates (ISO strings, empty string = not set)", () => {
  it("formats join dates like Nim's templates", () => {
    expect(getJoinDate("2019-03-05T13:30:00Z")).toBe("Joined March 2019");
    expect(getJoinDateFull("2019-03-05T13:30:00Z")).toBe("1:30 PM - 5 Mar 2019");
  });

  it("formats tweet times", () => {
    expect(getTime("2019-03-05T13:30:00Z")).toBe("Mar 5, 2019 · 1:30 PM UTC");
    expect(getRfc822Time("2019-03-05T13:30:00Z")).toBe("Tue, 05 Mar 2019 13:30:00 GMT");
  });

  it("returns empty for unset dates", () => {
    expect(getJoinDate("")).toBe("");
    expect(getTime("")).toBe("");
    expect(getRfc822Time("")).toBe("");
    expect(getShortTime("")).toBe("");
  });

  it("renders relative short times", () => {
    const now = Date.parse("2024-06-01T12:00:00Z");
    expect(getShortTime("2024-06-01T11:59:59Z", now)).toBe("now");
    expect(getShortTime("2024-06-01T11:59:40Z", now)).toBe("20s");
    expect(getShortTime("2024-06-01T11:30:00Z", now)).toBe("30m");
    expect(getShortTime("2024-06-01T06:00:00Z", now)).toBe("6h");
    expect(getShortTime("2024-05-30T06:00:00Z", now)).toBe("May 30");
    expect(getShortTime("2023-06-01T06:00:00Z", now)).toBe("1 Jun 2023");
  });
});

describe("getDuration", () => {
  it("formats durations", () => {
    expect(getDuration(59_000)).toBe("0:59");
    expect(getDuration(61_000)).toBe("1:01");
    expect(getDuration(3_723_000)).toBe("1:02:03");
  });
});

describe("links", () => {
  it("builds status links with the #m focus anchor", () => {
    expect(getLink("123", "jane")).toBe("/jane/status/123#m");
    expect(getLink("123", "jane", false)).toBe("/jane/status/123");
    expect(getLink("123", "")).toBe("/i/status/123#m");
  });

  it("splits geo-tagged locations", () => {
    expect(getLocation("New York:01F9Z1")).toEqual(["New York", "/search?f=tweets&q=place:01F9Z1"]);
    expect(getLocation("Somewhere")).toEqual(["Somewhere", ""]);
    expect(getLocation("https://maps.example")).toEqual(["https://maps.example", ""]);
  });

  it("formats suspensions", () => {
    expect(getSuspended("jane")).toBe('User "jane" has been suspended');
  });
});

describe("titleize", () => {
  it("capitalizes after delimiters", () => {
    expect(titleize("hello world")).toBe("Hello World");
    expect(titleize("(optional) text")).toBe("(Optional) Text");
    expect(titleize("iPhone")).toBe("IPhone");
  });
});

describe("getUrlPrefix", () => {
  it("prefixes by scheme", () => {
    expect(getUrlPrefix({ useHttps: true, hostname: "nitter.example" })).toBe(
      "https://nitter.example",
    );
    expect(getUrlPrefix({ useHttps: false, hostname: "localhost" })).toBe("http://localhost");
  });
});
