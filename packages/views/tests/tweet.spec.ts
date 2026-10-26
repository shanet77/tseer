import { preferencesSchema, type TseerPreferences } from "@tseer/prefs";
import { type Gif, MediaKind, type Tweet, type User, VerifiedType } from "@tseer/types";
import { renderToString } from "preact-render-to-string";
import { beforeEach, describe, expect, it } from "vitest";
import { renderTweet, setMediaSigners } from "../src/index.ts";

const defaults: TseerPreferences = preferencesSchema.parse({});

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

const gif: Gif = {
  url: "https://video.twimg.com/gif.mp4",
  thumb: "https://pbs.twimg.com/t.jpg",
  altText: "",
};

function render(overrides: Partial<Tweet> = {}, prefs: TseerPreferences = defaults): string {
  return renderToString(renderTweet(makeTweet(overrides), prefs, "/path"));
}

beforeEach(() => {
  setMediaSigners({
    picUrl: (url) => `/pic/${url}`,
    origPicUrl: (url) => `/pic/orig/${url}`,
    vidUrl: (url) => `/video/sig/${url}`,
  });
});

describe("renderTweet gif attachments", () => {
  it("autoplaying gifs play inline (playsinline), not fullscreen", () => {
    const html = render({ media: [{ kind: MediaKind.gifMedia, gif }] });
    expect(html).toContain('class="gif"');
    expect(html).toContain("autoplay");
    expect(html).toContain("playsinline");
    expect(html).toContain("muted");
    expect(html).toContain("loop");
  });

  it("non-autoplay gifs fall back to controls", () => {
    const prefs = { ...defaults, autoplayGifs: false };
    const html = render({ media: [{ kind: MediaKind.gifMedia, gif }] }, prefs);
    expect(html).not.toContain("autoplay");
    expect(html).toContain("controls");
    expect(html).toContain("playsinline");
  });
});
