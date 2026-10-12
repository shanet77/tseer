import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ApiErrorCode,
  BadClientError,
  CardKind,
  type Chain,
  type ChainResult,
  type Conversation,
  chainContains,
  containsErrorCode,
  type Errors,
  type Gif,
  getPhotos,
  getThumb,
  getVideos,
  hasGifs,
  hasPhotos,
  hasVideos,
  InternalError,
  type Media,
  MediaKind,
  NoSessionsError,
  type Photo,
  type Profile,
  QueryKind,
  RankingMode,
  RateLimitError,
  type Result,
  SessionKind,
  TimelineKind,
  type TimelineResult,
  type Tweet,
  type User,
  VerifiedType,
  type Video,
  VideoType,
} from "../src/index.ts";

function baseUser(overrides: Partial<User> = {}): User {
  return {
    id: "42",
    username: "nitter",
    fullname: "Nitter",
    location: "",
    website: "",
    bio: "",
    userPic: "https://pic.example/user.jpg",
    banner: "",
    pinnedTweet: "0",
    following: 1,
    followers: 2,
    tweets: 3,
    likes: 4,
    media: 5,
    verifiedType: VerifiedType.None,
    protected: false,
    suspended: false,
    joinDate: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function baseTweet(overrides: Partial<Tweet> = {}): Tweet {
  return {
    id: "1",
    threadId: "1",
    replyId: "0",
    user: baseUser(),
    text: "hello world",
    time: "2024-01-01T00:00:00.000Z",
    reply: [],
    pinned: false,
    hasThread: false,
    available: true,
    tombstone: "",
    location: "",
    source: "",
    stats: { replies: 0, retweets: 0, likes: 0, views: 0 },
    attributionLink: "",
    mediaTags: [],
    media: [],
    history: [],
    note: "",
    isAd: false,
    isAI: false,
    ...overrides,
  };
}

const photoMedia: Media = {
  kind: MediaKind.photoMedia,
  photo: { url: "https://pic.example/p.jpg", altText: "photo" },
};
const videoMedia: Media = {
  kind: MediaKind.videoMedia,
  video: {
    durationMs: 1000,
    url: "https://vid.example/v.mp4",
    thumb: "https://vid.example/t.jpg",
    available: true,
    reason: "",
    title: "",
    description: "",
    playbackType: VideoType.mp4,
    variants: [],
  },
};
const gifMedia: Media = {
  kind: MediaKind.gifMedia,
  gif: { url: "https://pic.example/g.gif", thumb: "https://pic.example/gt.jpg", altText: "gif" },
};

describe("enum value parity with nitter", () => {
  it("keeps X error codes numeric", () => {
    expect(ApiErrorCode.none).toBe(0);
    expect(ApiErrorCode.protectedUser).toBe(22);
    expect(ApiErrorCode.rateLimited).toBe(88);
    expect(ApiErrorCode.tweetNotFound).toBe(144);
    expect(ApiErrorCode.tweetCensored).toBe(422);
  });

  it("keeps card binding values verbatim", () => {
    expect(CardKind.summaryLarge).toBe("summary_large_image");
    expect(CardKind.storeLink).toBe("direct_store_link_app");
    expect(CardKind.audiospace).toBe("audiospace");
    expect(CardKind.newsletterPublication).toBe("newsletter_publication");
    expect(CardKind.hidden).toBe("hidden");
    expect(CardKind.unknown).toBe("unknown");
  });

  it("keeps the remaining string-valued enums verbatim", () => {
    expect(VerifiedType.None).toBe("None");
    expect(VerifiedType.Government).toBe("Government");
    expect(VideoType.m3u8).toBe("application/x-mpegURL");
    expect(SessionKind.oauth).toBe("oauth");
    expect(SessionKind.cookie).toBe("cookie");
    expect(RankingMode.Relevance).toBe("Relevance");
    expect(QueryKind.userList).toBe("userList");
    expect(TimelineKind.articles).toBe("articles");
    expect(MediaKind.gifMedia).toBe("gifMedia");
  });
});

describe("ported helper functions", () => {
  it("filters photos/videos and detects media kinds (types.nim procs)", () => {
    const tweet = baseTweet({ media: [photoMedia, videoMedia, gifMedia] });
    expect(getPhotos(tweet)).toEqual([{ url: "https://pic.example/p.jpg", altText: "photo" }]);
    expect(getVideos(tweet)).toHaveLength(1);
    expect(getVideos(tweet)?.[0]?.url).toBe("https://vid.example/v.mp4");
    expect(hasPhotos(tweet)).toBe(true);
    expect(hasVideos(tweet)).toBe(true);
    expect(hasGifs(tweet)).toBe(true);

    const bare = baseTweet();
    expect(getPhotos(bare)).toEqual([]);
    expect(getVideos(bare)).toEqual([]);
    expect(hasPhotos(bare)).toBe(false);
    expect(hasVideos(bare)).toBe(false);
    expect(hasGifs(bare)).toBe(false);
  });

  it("resolves thumbs per media kind (types.nim getThumb)", () => {
    expect(getThumb(photoMedia)).toBe("https://pic.example/p.jpg");
    expect(getThumb(videoMedia)).toBe("https://vid.example/t.jpg");
    expect(getThumb(gifMedia)).toBe("https://pic.example/gt.jpg");
  });

  it("detects thread membership (types.nim contains)", () => {
    const thread: Chain = {
      content: [baseTweet({ id: "1" }), baseTweet({ id: "2" })],
      hasMore: false,
      cursor: "",
      related: false,
    };
    expect(chainContains(thread, baseTweet({ id: "2" }))).toBe(true);
    expect(chainContains(thread, baseTweet({ id: "3" }))).toBe(false);
  });

  it("matches GraphQL error codes (common.nim contains)", () => {
    const errors: Errors = {
      errors: [{ code: ApiErrorCode.tweetNotFound, message: "Tweet not found" }],
    };
    expect(containsErrorCode([ApiErrorCode.tweetNotFound], errors)).toBe(true);
    expect(containsErrorCode([ApiErrorCode.tweetNotFound, ApiErrorCode.rateLimited], errors)).toBe(
      true,
    );
    expect(containsErrorCode([ApiErrorCode.rateLimited], errors)).toBe(false);
  });

  it("carries nitter's cross-seam error classes", () => {
    expect(new RateLimitError()).toBeInstanceOf(RateLimitError);
    expect(new RateLimitError().name).toBe("RateLimitError");
    expect(new NoSessionsError().message).toBe("no sessions available");
    expect(new InternalError("boom")).toBeInstanceOf(Error);
    expect(new BadClientError().name).toBe("BadClientError");
  });
});

describe("type-level contract", () => {
  it("stringifies ids and keeps Option fields undefined-tolerant", () => {
    expectTypeOf<Tweet["id"]>().toEqualTypeOf<string>();
    expectTypeOf<User["pinnedTweet"]>().toEqualTypeOf<string>();
    expectTypeOf<Tweet["quote"]>().toEqualTypeOf<Tweet | undefined>();
    expectTypeOf<Profile["pinned"]>().toEqualTypeOf<Tweet | undefined>();
  });

  it("keeps the pagination envelope and plan §4 aliases", () => {
    expectTypeOf<TimelineResult>().toEqualTypeOf<Result<Tweet>>();
    expectTypeOf<TimelineResult["content"]>().toEqualTypeOf<Tweet[]>();
    expectTypeOf<Conversation["replies"]>().toEqualTypeOf<ChainResult>();
    expectTypeOf<Result<Tweet>["top"]>().toEqualTypeOf<string>();
  });

  it("narrows the Media discriminated union", () => {
    expectTypeOf<Extract<Media, { kind: MediaKind.gifMedia }>>().toEqualTypeOf<{
      kind: MediaKind.gifMedia;
      gif: Gif;
    }>();
    function narrow(media: Media) {
      if (media.kind === MediaKind.photoMedia) {
        expectTypeOf(media.photo).toEqualTypeOf<Photo>();
      }
      if (media.kind === MediaKind.videoMedia) {
        expectTypeOf(media.video).toEqualTypeOf<Video>();
      }
    }
    narrow(photoMedia);
    narrow(videoMedia);
    narrow(gifMedia);
  });
});
