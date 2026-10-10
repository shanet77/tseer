/** RSS renderer tests — port fidelity for `views/rss` (the `rss.nimf` port). */

import { preferencesSchema, type TseerPreferences } from "@tseer/prefs";
import {
  CardKind,
  MediaKind,
  type Profile,
  QueryKind,
  type Tweet,
  type User,
  VerifiedType,
} from "@tseer/types";
import { beforeEach, describe, expect, it } from "vitest";
import {
  emptyAccountInfo,
  renderListRss,
  renderRssTweet,
  renderRssTweets,
  renderSearchRss,
  renderTimelineRss,
  rssTitle,
  setMediaSigners,
  withPinned,
} from "../src/index.ts";

const defaults: TseerPreferences = preferencesSchema.parse({});
const cfg = { hostname: "nitter.example", useHttps: true };
const PREFIX = "https://nitter.example";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "1234",
    username: "nasa",
    fullname: "NASA",
    location: "",
    website: "",
    bio: "space posts",
    userPic: "https://pbs.twimg.com/profile_images/nasa_normal.jpg",
    banner: "",
    pinnedTweet: "",
    following: 10,
    followers: 1234,
    tweets: 5678,
    likes: 9,
    media: 0,
    verifiedType: VerifiedType.None,
    protected: false,
    suspended: false,
    joinDate: "",
    ...overrides,
  };
}

function makeTweet(overrides: Partial<Tweet> = {}): Tweet {
  return {
    id: "1001",
    threadId: "",
    replyId: "",
    user: makeUser(),
    text: "hello world",
    time: "2023-06-01T12:00:00Z",
    reply: [],
    pinned: false,
    hasThread: false,
    available: true,
    tombstone: "",
    location: "",
    source: "",
    stats: { replies: 1, retweets: 2, likes: 3, views: 4 },
    media: [],
    mediaTags: [],
    attributionLink: "",
    history: [],
    note: "",
    isAd: false,
    isAI: false,
    ...overrides,
  };
}

function makeProfile(tweet: Tweet): Profile {
  return {
    user: makeUser(),
    photoRail: [],
    tweets: {
      content: [tweet],
      top: "",
      bottom: "CURSOR123",
      beginning: true,
      query: {
        kind: QueryKind.posts,
        view: "",
        text: "",
        filters: [],
        includes: [],
        excludes: [],
        fromUser: ["nasa"],
        since: "",
        until: "",
        minLikes: "",
        sep: "",
      },
    },
    accountInfo: emptyAccountInfo(),
  };
}

beforeEach(() => {
  setMediaSigners({
    picUrl: (url) => `/pic/${url}`,
    origPicUrl: (url) => `/pic/orig/${url}`,
    vidUrl: (url) => `/video/sig/${url}`,
  });
});

describe("rssTitle", () => {
  it("collapses whitespace and prefixes pins, retweets, and replies", () => {
    expect(rssTitle(makeTweet({ text: "a  b\nc" }), "")).toBe("a b c");
    expect(rssTitle(makeTweet({ pinned: true }), "")).toBe("Pinned: hello world");
    expect(rssTitle(makeTweet(), "bob")).toBe("RT by @bob: hello world");
    expect(rssTitle(makeTweet({ reply: ["alice", "bob"] }), "")).toBe("R to @alice: hello world");
  });

  it("escapes markup in titles", () => {
    expect(rssTitle(makeTweet({ text: "fish &amp; chips" }), "")).toBe("fish &amp; chips");
    expect(
      rssTitle(
        makeTweet({
          text: "",
          card: {
            kind: CardKind.summary,
            url: "https://x.com/y",
            title: "A <b>thing</b>",
            dest: "",
            text: "",
            image: "",
          },
        }),
        "",
      ),
    ).toBe("A &lt;b&gt;thing&lt;/b&gt;");
  });

  it("falls back to article, media, and card titles", () => {
    expect(
      rssTitle(
        makeTweet({
          text: "",
          articlePreview: { title: "Big read", previewText: "", coverImage: "", tweetId: "9" },
        }),
        "",
      ),
    ).toBe("Big read");
    expect(
      rssTitle(
        makeTweet({
          text: "",
          media: [{ kind: MediaKind.photoMedia, photo: { url: "u", altText: "" } }],
        }),
        "",
      ),
    ).toBe("Image");
    expect(
      rssTitle(
        makeTweet({
          text: "",
          media: [{ kind: MediaKind.gifMedia, gif: { url: "u", thumb: "t", altText: "" } }],
        }),
        "",
      ),
    ).toBe("Gif");
    expect(
      rssTitle(
        makeTweet({
          text: "",
          media: [
            { kind: MediaKind.photoMedia, photo: { url: "a", altText: "" } },
            {
              kind: MediaKind.videoMedia,
              video: {
                durationMs: 1,
                url: "u",
                thumb: "t",
                available: true,
                reason: "",
                title: "",
                description: "",
                playbackType: "video/mp4" as never,
                variants: [],
              },
            },
          ],
        }),
        "",
      ),
    ).toBe("Media");
    expect(
      rssTitle(
        makeTweet({
          text: "",
          card: {
            kind: CardKind.summary,
            url: "https://x.com/y",
            title: "Card title",
            dest: "",
            text: "",
            image: "",
          },
        }),
        "",
      ),
    ).toBe("Card title");
    expect(rssTitle(makeTweet({ text: "" }), "")).toBe("");
  });
});

describe("renderRssTweet", () => {
  it("renders text with line breaks, media, and community notes", () => {
    const out = renderRssTweet(
      makeTweet({
        text: "line1\nline2",
        media: [
          {
            kind: MediaKind.photoMedia,
            photo: { url: "https://pbs.twimg.com/x.jpg", altText: "" },
          },
        ],
        note: "needs context",
      }),
      defaults,
      PREFIX,
    );
    expect(out).toContain("<p>line1<br>\nline2</p>");
    expect(out).toContain(`<img src="${PREFIX}/pic/https://pbs.twimg.com/x.jpg"`);
    expect(out).toContain("<b>Community note:</b>");
  });

  it("hides community notes on request", () => {
    const out = renderRssTweet(
      makeTweet({ note: "needs context" }),
      { ...defaults, hideCommunityNotes: true },
      PREFIX,
    );
    expect(out).not.toContain("Community note");
  });

  it("renders cards, polls, and quotes", () => {
    const quote = makeTweet({ id: "2002", text: "quoted" });
    const out = renderRssTweet(
      makeTweet({
        text: "",
        card: {
          kind: CardKind.summary,
          url: "https://example.com/a",
          title: "T",
          dest: "example.com",
          text: "body",
          image: "",
        },
        poll: { options: ["yes", "no"], values: [3, 1], votes: 4, leader: 0, status: "Open" },
        quote,
      }),
      defaults,
      PREFIX,
    );
    expect(out).toContain("<b>Link</b>");
    expect(out).toContain("75% — yes<br>");
    expect(out).toContain("25% — no<br>");
    expect(out).toContain("4 votes");
    expect(out).toContain("<blockquote>");
    expect(out).toContain("quoted");
    expect(out).toContain(`${PREFIX}/nasa/status/2002#m`);
  });
});

describe("renderRssTweets", () => {
  it("dedups links and unwraps retweets", () => {
    const original = makeTweet({ id: "3003", text: "viral" });
    const retweet = makeTweet({ id: "3004", retweet: original });
    const out = renderRssTweets([retweet, original], defaults, PREFIX);
    expect(out.match(/<item>/g)).toHaveLength(1);
    expect(out).toContain("RT by @nasa: viral");
    expect(out).toContain("<dc:creator>@nasa</dc:creator>");
    expect(out).toContain("<pubDate>Thu, 01 Jun 2023 12:00:00 GMT</pubDate>");
  });

  it("switches GUID format at the snowflake cutoff", () => {
    const old = renderRssTweets([makeTweet({ id: "1001" })], defaults, PREFIX);
    expect(old).toContain(`<guid>${PREFIX}/nasa/status/1001#m</guid>`);
    const fresh = renderRssTweets([makeTweet({ id: "2000000000000000000" })], defaults, PREFIX);
    expect(fresh).toContain('<guid isPermaLink="false">2000000000000000000</guid>');
  });

  it("filters other users' tweets for profile feeds", () => {
    const mine = makeTweet({ id: "1" });
    const theirs = makeTweet({ id: "2", user: makeUser({ id: "9999", username: "other" }) });
    const out = renderRssTweets([mine, theirs], defaults, PREFIX, "1234");
    expect(out.match(/<item>/g)).toHaveLength(1);
    expect(out).toContain("/status/1#m");
  });
});

describe("withPinned", () => {
  it("splices the pin ahead of the first older tweet", () => {
    const tweets = [makeTweet({ id: "2000" }), makeTweet({ id: "1000" })];
    const pinned = makeTweet({ id: "1500", pinned: true });
    const ids = withPinned(tweets, pinned).map((t) => t.id);
    expect(ids).toEqual(["2000", "1500", "1000"]);
  });

  it("drops the pin when every tweet is newer", () => {
    const tweets = [makeTweet({ id: "2000" })];
    expect(withPinned(tweets, makeTweet({ id: "1000", pinned: true }))).toHaveLength(1);
  });
});

describe("feed documents", () => {
  it("renders the timeline feed with channel metadata", () => {
    const out = renderTimelineRss(makeProfile(makeTweet()), cfg, defaults);
    expect(out).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(out).toContain(`<atom:link href="${PREFIX}/nasa/rss"`);
    expect(out).toContain("<title>NASA / @nasa</title>");
    expect(out).toContain(`<link>${PREFIX}/nasa</link>`);
    expect(out).toContain(`Twitter feed for: @nasa. Generated by ${PREFIX}`);
    expect(out).toContain("<ttl>40</ttl>");
    expect(out).toContain("/pic/https://pbs.twimg.com/profile_images/nasa_400x400.jpg");
    expect(out).toContain("<item>");
  });

  it("renders the multi-user feed without the @ handle", () => {
    const profile = makeProfile(makeTweet());
    profile.user = { ...makeUser(), username: "a,b", fullname: "a | b" };
    const out = renderTimelineRss(profile, cfg, defaults, true);
    expect(out).toContain("<title>a | b</title>");
    expect(out).toContain("Twitter feed for: a,b.");
  });

  it("renders list and search feeds", () => {
    const list = renderListRss(
      [makeTweet()],
      {
        id: "7",
        name: "Space",
        userId: "1234",
        username: "nasa",
        description: "",
        members: 3,
        banner: "",
      },
      cfg,
      defaults,
    );
    expect(list).toContain("<title>Space / @nasa</title>");
    expect(list).toContain(`${PREFIX}/i/lists/7`);
    expect(list).toContain("Space by @nasa.");

    const search = renderSearchRss([makeTweet()], "space <x>", "f=tweets&q=space", cfg, defaults);
    expect(search).toContain('<title>Search results for "space &lt;x&gt;"</title>');
    expect(search).toContain(`${PREFIX}/search`);
  });
});
