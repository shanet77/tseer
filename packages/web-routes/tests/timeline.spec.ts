import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prefsPlugin } from "@tseer/prefs";
import { serverPlugin } from "@tseer/server";
import type { Json, ProfileTweets, TwitterApi } from "@tseer/twitter-api";
import { parseGraphTimeline } from "@tseer/twitter-parser";
import { QueryKind, type Result, type Tweet, type User, VerifiedType } from "@tseer/types";
import { emptyAccountInfo, renderPlugin } from "@tseer/views";
import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";
import { emptyTimeline, emptyUser, default as timelinePlugin } from "../src/timeline.ts";

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    ...emptyUser("nasa"),
    id: "1234",
    fullname: "NASA",
    bio: "space posts",
    userPic: "https://pbs.twimg.com/profile_images/nasa_normal.jpg",
    banner: "https://pbs.twimg.com/profile_banners/nasa/1500.jpg",
    following: 10,
    followers: 1234,
    tweets: 5678,
    likes: 9,
    media: 100,
    verifiedType: VerifiedType.Business,
    ...overrides,
  };
}

export function makeTweet(overrides: Partial<Tweet> = {}): Tweet {
  const user = makeUser();
  return {
    id: "1001",
    threadId: "",
    replyId: "",
    user,
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

export function makeTimeline(tweet: Tweet): ProfileTweets {
  return {
    pinned: undefined,
    tweets: {
      content: [tweet],
      top: "",
      bottom: "CURSOR123",
      beginning: true,
      query: { ...emptyTimeline().query, fromUser: ["nasa"] },
    },
  };
}

export function stubTwitter(
  user: User,
  timeline: ProfileTweets,
  extra: Partial<TwitterApi> = {},
): TwitterApi {
  return {
    cachedUser: vi.fn(async () => user),
    cachedPhotoRail: vi.fn(async () => []),
    cachedAccountInfo: vi.fn(async () => ({
      ...emptyAccountInfo(),
      username: user.username,
      fullname: user.fullname,
      userPic: user.userPic,
      verifiedType: user.verifiedType,
    })),
    cachedUsername: vi.fn(async () => ""),
    tweets: vi.fn(async () => timeline),
    tweetsAndReplies: vi.fn(async () => timeline),
    media: vi.fn(async () => timeline),
    articles: vi.fn(async () => timeline),
    search: vi.fn(async (query: unknown) => ({ ...timeline.tweets, query })),
    followers: vi.fn(
      async (): Promise<Result<User>> => ({
        content: [makeUser({ username: "friend", fullname: "Friend", id: "2" })],
        top: "",
        bottom: "FOLLOWCURSOR",
        beginning: true,
        query: { ...emptyTimeline().query, kind: QueryKind.followers, fromUser: [user.username] },
      }),
    ),
    following: vi.fn(
      async (): Promise<Result<User>> => ({
        content: [],
        top: "",
        bottom: "",
        beginning: true,
        query: { ...emptyTimeline().query, kind: QueryKind.following, fromUser: [user.username] },
      }),
    ),
    ...extra,
  } as unknown as TwitterApi;
}

export async function boot(
  twitter: TwitterApi,
): Promise<{ ctx: Context; unload: () => Promise<void> }> {
  const ctx = new Context();
  await ctx.plugin(serverPlugin, { port: 0 });
  await ctx.plugin(prefsPlugin, {});
  await ctx.plugin(renderPlugin, {
    title: "nitter",
    hostname: "localhost",
    useHttps: false,
    picUrl: (url) => `/pic/${url}`,
    origPicUrl: (url) => `/pic/orig/${url}`,
    vidUrl: (url) => `/video/sig/${url}`,
  });
  ctx.provide("twitter", twitter);
  const fiber = await ctx.plugin(timelinePlugin);
  return { ctx, unload: () => fiber.dispose() };
}

describe("timelinePlugin", () => {
  it("renders a profile timeline end to end", async () => {
    const user = makeUser();
    const timeline = makeTimeline(makeTweet());
    const twitter = stubTwitter(user, timeline);
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/nasa" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<title>NASA (@nasa) | nitter</title>");
    expect(res.body).toContain('data-username="nasa"');
    expect(res.body).toContain("hello world");
    expect(res.body).toContain("/pic/https://pbs.twimg.com/profile_images/nasa_400x400.jpg");
    expect(res.body).toContain("/nasa/rss");
    expect(res.body).toContain("/nasa/followers");
    expect(res.body).toContain("Load more");
    expect(res.body).toContain("cursor=CURSOR123");
    expect(res.body).toContain("/nasa/with_replies");

    expect(twitter.cachedUser).toHaveBeenCalledWith("nasa");
    expect(twitter.tweets).toHaveBeenCalledWith("1234", "");
  });

  it("renders the pinned tweet and hides it on request", async () => {
    const pinned = makeTweet({ id: "500", pinned: true, text: "pinned post" });
    const timeline = makeTimeline(makeTweet());
    timeline.pinned = pinned;
    const { ctx } = await boot(stubTwitter(makeUser(), timeline));

    const res = await ctx.server.inject({ url: "/nasa" });
    expect(res.body).toContain("pinned post");
    expect(res.body).toContain("Pinned Tweet");

    const hidden = await ctx.server.inject({ url: "/nasa", headers: { cookie: "hidePins=on" } });
    expect(hidden.body).not.toContain("pinned post");
  });

  it("escapes markup through the real parser (XSS regression)", async () => {
    const raw: Json = {
      data: {
        user: {
          result: {
            timeline: {
              timeline: {
                instructions: [
                  {
                    type: "TimelineAddEntries",
                    entries: [
                      {
                        entryId: "tweet-9001",
                        content: {
                          entryType: "TimelineTimelineItem",
                          __typename: "TimelineTimelineItem",
                          itemContent: {
                            tweet_results: {
                              result: {
                                rest_id: "9001",
                                core: {
                                  screen_name: "<script>alert(1)</script>",
                                  name: "<b>evil</b>",
                                  created_at: "2023-06-01T00:00:00.000Z",
                                },
                                legacy: {
                                  id_str: "9001",
                                  full_text: "<script>alert('xss')</script>",
                                  created_at: "2023-06-01T00:00:00.000Z",
                                  favorite_count: "1",
                                  conversation_id_str: "9001",
                                },
                              },
                            },
                          },
                        },
                      },
                      {
                        entryId: "cursor-bottom-0",
                        content: {
                          entryType: "TimelineTimelineCursor",
                          value: "C",
                          cursorType: "Bottom",
                        },
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    } as unknown as Json;
    const parsed = parseGraphTimeline(raw, "");
    expect(parsed.tweets.content).toHaveLength(1);

    const user = makeUser({ username: "<script>alert(1)</script>", fullname: "<b>evil</b>" });
    const { ctx } = await boot(stubTwitter(user, parsed));

    const res = await ctx.server.inject({ url: "/nasa" });
    expect(res.status).toBe(200);
    expect(res.body.toLowerCase()).not.toContain("<script");
    expect(res.body.toLowerCase()).not.toContain("<b>evil</b>");
    expect(res.body).toContain("&lt;script&gt;alert(&apos;xss&apos;)&lt;/script&gt;");
  });

  it("serves the tabs through the matching fetchers", async () => {
    const timeline = makeTimeline(makeTweet());
    const twitter = stubTwitter(makeUser(), timeline);
    const { ctx } = await boot(twitter);

    await ctx.server.inject({ url: "/nasa/with_replies" });
    expect(twitter.tweetsAndReplies).toHaveBeenCalledWith("1234", "");

    await ctx.server.inject({ url: "/nasa/media" });
    expect(twitter.media).toHaveBeenCalledWith("1234", "");

    await ctx.server.inject({ url: "/nasa/articles" });
    expect(twitter.articles).toHaveBeenCalledWith("1234", "");

    await ctx.server.inject({ url: "/nasa/search?q=space" });
    expect(twitter.search).toHaveBeenCalledTimes(1);
    const search = (twitter.search as ReturnType<typeof vi.fn>).mock.calls[0]![0]!;
    expect(search.kind).toBe(QueryKind.tweets);
    expect(search.text).toBe("space");
    expect(search.fromUser).toEqual(["nasa"]);
  });

  it("honors the media view pref (cookie) and the view param", async () => {
    const timeline = makeTimeline(makeTweet());
    const twitter = stubTwitter(makeUser(), timeline);
    const { ctx } = await boot(twitter);

    const cookie = await ctx.server.inject({
      url: "/nasa/media",
      headers: { cookie: "mediaView=Gallery" },
    });
    expect(cookie.body).toContain("media-only");
    expect(twitter.media).toHaveBeenCalledWith("1234", "");

    const param = await ctx.server.inject({ url: "/nasa/media?view=grid" });
    expect(param.body).not.toContain("media-only");
    expect(param.body).toContain("media-grid-view");

    const both = await ctx.server.inject({
      url: "/nasa/media?view=grid",
      headers: { cookie: "mediaView=Gallery" },
    });
    expect(both.body).toContain("media-grid-view");
  });

  it("404s unknown users and shows suspended accounts", async () => {
    const twitter = stubTwitter(emptyUser("ghost"), makeTimeline(makeTweet()), {
      cachedUser: vi.fn(async () => undefined),
    });
    const { ctx } = await boot(twitter);
    const res = await ctx.server.inject({ url: "/ghost" });
    expect(res.status).toBe(404);
    expect(res.body).toContain("User &quot;ghost&quot; not found");

    const suspended = stubTwitter(makeUser({ suspended: true }), makeTimeline(makeTweet()));
    const { ctx: ctx2 } = await boot(suspended);
    const res2 = await ctx2.server.inject({ url: "/nasa" });
    expect(res2.status).toBe(200);
    expect(res2.body).toContain("User &quot;nasa&quot; has been suspended");
  });

  it("renders a protected account without tweets", async () => {
    const { ctx } = await boot(
      stubTwitter(makeUser({ protected: true }), makeTimeline(makeTweet())),
    );
    const res = await ctx.server.inject({ url: "/nasa" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("timeline-protected");
    expect(res.body).not.toContain("hello world");
  });

  it("passes the cursor through and encodes it in the Load more link", async () => {
    const timeline = makeTimeline(makeTweet());
    timeline.tweets.beginning = false;
    const twitter = stubTwitter(makeUser(), timeline);
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/nasa?cursor=CURSOR123" });
    expect(res.status).toBe(200);
    expect(twitter.tweets).toHaveBeenCalledWith("1234", "CURSOR123");
    expect(res.body).toContain("Load newest");
    expect(res.body).toContain("Load more");
  });

  it("serves the infinite-scroll fragment", async () => {
    const timeline = makeTimeline(makeTweet());
    const twitter = stubTwitter(makeUser(), timeline);
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/nasa?scroll=1" });
    expect(res.status).toBe(200);
    expect(res.body).not.toContain("<html");
    expect(res.body).toContain("hello world");

    const empty = stubTwitter(makeUser(), { pinned: undefined, tweets: emptyTimeline() });
    const { ctx: ctx2 } = await boot(empty);
    const res2 = await ctx2.server.inject({ url: "/nasa?scroll=1" });
    expect(res2.status).toBe(404);
  });

  it("redirects /i/user/:id and /intent/user via the reverse lookup", async () => {
    const twitter = stubTwitter(makeUser(), makeTimeline(makeTweet()), {
      cachedUsername: vi.fn(async (id: string) => (id === "1234" ? "nasa" : "")),
    });
    const { ctx } = await boot(twitter);

    const hit = await ctx.server.inject({ url: "/i/user/1234" });
    expect(hit.status).toBe(302);
    expect(hit.headers["location"]).toBe("/nasa");

    const intent = await ctx.server.inject({ url: "/intent/user?user_id=1234" });
    expect(intent.status).toBe(302);
    expect(intent.headers["location"]).toBe("/nasa");

    const miss = await ctx.server.inject({ url: "/i/user/0" });
    expect(miss.status).toBe(404);
    expect(miss.body).toContain("User not found");

    const noId = await ctx.server.inject({ url: "/i/user/" });
    expect(noId.status).toBe(404);
  });

  it("redirects /intent/follow with a screen_name, 400 without", async () => {
    const { ctx } = await boot(stubTwitter(makeUser(), makeTimeline(makeTweet())));
    const hit = await ctx.server.inject({ url: "/intent/follow?screen_name=bob" });
    expect(hit.status).toBe(302);
    expect(hit.headers["location"]).toBe("/bob");

    const miss = await ctx.server.inject({ url: "/intent/follow" });
    expect(miss.status).toBe(400);
    expect(miss.body).toContain("Missing screen_name parameter");
  });

  it("renders the about panel", async () => {
    const { ctx } = await boot(stubTwitter(makeUser(), makeTimeline(makeTweet())));
    const res = await ctx.server.inject({ url: "/nasa/about" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("<title>About @nasa | nitter</title>");
    expect(res.body).toContain("about-account");
    expect(res.body).toContain("Date joined");
  });

  it("renders followers/following lists", async () => {
    const twitter = stubTwitter(makeUser(), makeTimeline(makeTweet()));
    const { ctx } = await boot(twitter);

    const followers = await ctx.server.inject({ url: "/nasa/followers" });
    expect(followers.status).toBe(200);
    expect(followers.body).toContain("<title>People following @nasa | nitter</title>");
    expect(followers.body).toContain('data-username="friend"');
    expect(followers.body).toContain("cursor=FOLLOWCURSOR");

    const following = await ctx.server.inject({ url: "/nasa/following" });
    expect(following.body).toContain("<title>People followed by @nasa | nitter</title>");
    expect(following.body).toContain("No items found");
  });

  it("honors prefs cookies over the rendered output", async () => {
    const { ctx } = await boot(stubTwitter(makeUser(), makeTimeline(makeTweet())));

    const stats = await ctx.server.inject({ url: "/nasa" });
    expect(stats.body).toContain("tweet-stats");

    const hidden = await ctx.server.inject({
      url: "/nasa",
      headers: { cookie: "hideTweetStats=on" },
    });
    expect(hidden.body).not.toContain("tweet-stats");

    const theme = await ctx.server.inject({ url: "/nasa", headers: { cookie: "theme=Twitter" } });
    expect(theme.body).toContain("/css/themes/twitter.css");
  });

  it("404s invalid names and tabs", async () => {
    const twitter = stubTwitter(makeUser(), makeTimeline(makeTweet()));
    const { ctx } = await boot(twitter);

    for (const url of ["/search", "/settings", "/nasa/nope", "/a,b/articles"]) {
      const res = await ctx.server.inject({ url });
      expect(res.status, url).toBe(404);
      expect(res.body, url).toContain("Page not found");
    }
  });

  it("lets dotted paths fall through to static files (theme assets)", async () => {
    const { ctx } = await boot(stubTwitter(makeUser(), makeTimeline(makeTweet())));
    const dir = await mkdtemp(join(tmpdir(), "tseer-timeline-"));
    await writeFile(join(dir, "style.css"), "body{}");
    const disposeStatic = ctx.server.static("/", dir);
    try {
      const css = await ctx.server.inject({ url: "/style.css" });
      expect(css.status).toBe(200);
      expect(css.body).toBe("body{}");
      const missing = await ctx.server.inject({ url: "/na.sa" });
      expect(missing.status).toBe(404);
      expect(missing.body).not.toContain("Page not found");
    } finally {
      disposeStatic();
    }
  });

  it("multi-user timelines go through search", async () => {
    const twitter = stubTwitter(makeUser(), makeTimeline(makeTweet()));
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/a,b" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("<title>Multi | nitter</title>");
    expect(res.body).toContain("a | b");
    const search = (twitter.search as ReturnType<typeof vi.fn>).mock.calls[0]![0]!;
    expect(search.fromUser).toEqual(["a", "b"]);
  });

  it("unloads cleanly: disposed routes answer 404", async () => {
    const { ctx, unload } = await boot(stubTwitter(makeUser(), makeTimeline(makeTweet())));
    expect((await ctx.server.inject({ url: "/nasa" })).status).toBe(200);
    await unload();
    const res = await ctx.server.inject({ url: "/nasa" });
    expect(res.status).toBe(404);
  });
});
