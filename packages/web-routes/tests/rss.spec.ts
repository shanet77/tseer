/** RSS route plugin tests — fastify `inject` against a context with a stubbed
 * `ctx.twitter`, proving the seams are real (plan §6). */

import { prefsPlugin } from "@tseer/prefs";
import { serverPlugin } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import { RateLimitError, type Rss } from "@tseer/types";
import { renderPlugin } from "@tseer/views";
import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";
import { redisKey, default as rssPlugin, rssTabEnabled, searchKeyHash } from "../src/rss.ts";
import { emptyTimeline } from "../src/timeline.ts";
import { stubSearchTwitter } from "./search.spec.ts";
import { makeTimeline, makeTweet, makeUser, stubTwitter } from "./timeline.spec.ts";

function makeList() {
  return {
    id: "7",
    name: "Space",
    userId: "1234",
    username: "nasa",
    description: "orbital updates",
    members: 3,
    banner: "",
  };
}

function stubRssTwitter(extra: Partial<TwitterApi> = {}): TwitterApi {
  const user = makeUser();
  const timeline = makeTimeline(makeTweet());
  const base = stubTwitter(user, timeline);
  return {
    ...base,
    cachedRss: vi.fn(async (_key: string, factory: () => Promise<Rss>) => factory()),
    cachedList: vi.fn(async () => makeList()),
    list: vi.fn(async () => timeline.tweets),
    ...extra,
  } as unknown as TwitterApi;
}

async function boot(
  twitter: TwitterApi,
  config: Record<string, unknown> = {},
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
  ctx.provide("config", { title: "nitter", hostname: "localhost", useHttps: false, ...config });
  const fiber = await ctx.plugin(rssPlugin);
  return { ctx, unload: () => fiber.dispose() };
}

describe("rssPlugin", () => {
  it("serves a user feed with items, rss content type, and the Min-Id cursor", async () => {
    const twitter = stubRssTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/nasa/rss" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/rss+xml");
    expect(res.headers["min-id"]).toBe("CURSOR123");
    expect(res.body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(res.body).toContain("<title>NASA / @nasa</title>");
    expect(res.body).toContain("<item>");
    expect(res.body).toContain("hello world");

    expect(twitter.cachedUser).toHaveBeenCalledWith("nasa");
    expect(twitter.tweets).toHaveBeenCalledWith("1234", "");
    expect(twitter.cachedRss).toHaveBeenCalledTimes(1);
    const [key] = (twitter.cachedRss as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(key).toBe("twitter:nasa");
  });

  it("passes the cursor into the fetch and the cache key", async () => {
    const twitter = stubRssTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/nasa/rss?cursor=ABC" });
    expect(res.status).toBe(200);
    expect(twitter.tweets).toHaveBeenCalledWith("1234", "ABC");
    const [key] = (twitter.cachedRss as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(key).toBe("twitter:nasa:ABC");
  });

  it("serves the tab feeds through the matching fetchers", async () => {
    const twitter = stubRssTwitter();
    const { ctx } = await boot(twitter);

    await ctx.server.inject({ url: "/nasa/with_replies/rss" });
    expect(twitter.tweetsAndReplies).toHaveBeenCalledWith("1234", "");
    expect((twitter.cachedRss as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(
      "with_replies:nasa",
    );

    await ctx.server.inject({ url: "/nasa/media/rss" });
    expect(twitter.media).toHaveBeenCalledWith("1234", "");

    await ctx.server.inject({ url: "/nasa/articles/rss" });
    expect(twitter.articles).toHaveBeenCalledWith("1234", "");

    const search = await ctx.server.inject({ url: "/nasa/search/rss?q=space" });
    expect(search.status).toBe(200);
    expect(twitter.search).toHaveBeenCalledTimes(1);
    const [query] = (twitter.search as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(query.fromUser).toEqual(["nasa"]);
    expect(query.text).toBe("space");
    const [searchKey] = (twitter.cachedRss as ReturnType<typeof vi.fn>).mock.calls[3]!;
    expect(searchKey).toMatch(/^search:nasa:\d+$/);
  });

  it("serves multi-user feeds through search", async () => {
    const twitter = stubRssTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/a,b/rss" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("<title>a | b</title>");
    const [query] = (twitter.search as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(query.fromUser).toEqual(["a", "b"]);
  });

  it("403s disabled feeds", async () => {
    const twitter = stubRssTwitter();
    const { ctx } = await boot(twitter, {
      enableRSSUserTweets: false,
      enableRSSUserMedia: false,
      enableRSSSearch: false,
      enableRSSList: false,
    });

    for (const url of ["/nasa/rss", "/nasa/media/rss", "/search/rss?q=x", "/i/lists/7/rss"]) {
      const res = await ctx.server.inject({ url });
      expect(res.status, url).toBe(403);
      expect(res.body, url).toContain("RSS feed is disabled");
    }
  });

  it("404s unknown and suspended users", async () => {
    const twitter = stubRssTwitter({
      cachedUser: vi.fn(async () => undefined),
    });
    const { ctx } = await boot(twitter);
    const missing = await ctx.server.inject({ url: "/ghost/rss" });
    expect(missing.status).toBe(404);
    expect(missing.body).toContain("User &quot;ghost&quot; not found");

    const suspended = stubRssTwitter({
      cachedUser: vi.fn(async () => makeUser({ suspended: true })),
    });
    const { ctx: ctx2 } = await boot(suspended);
    const gone = await ctx2.server.inject({ url: "/nasa/rss" });
    expect(gone.status).toBe(404);
    expect(gone.body).toContain("has been suspended");
  });

  it("404s dotted names, unknown tabs, and multi-user articles", async () => {
    const { ctx } = await boot(stubRssTwitter());
    for (const url of ["/na.sa/rss", "/nasa/nope/rss", "/a,b/articles/rss"]) {
      const res = await ctx.server.inject({ url });
      expect(res.status, url).toBe(404);
    }
  });

  it("serves search feeds and rejects bad search input", async () => {
    const twitter = stubSearchTwitter();
    const rssTwitter = {
      ...twitter,
      cachedRss: vi.fn(async (_key: string, factory: () => Promise<Rss>) => factory()),
    } as unknown as TwitterApi;
    const { ctx } = await boot(rssTwitter);

    const res = await ctx.server.inject({ url: "/search/rss?q=space" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/rss+xml");
    expect(res.headers["min-id"]).toBe("SEARCHCURSOR");
    expect(res.body).toContain('<title>Search results for "space"</title>');
    const [key] = (rssTwitter.cachedRss as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(key).toMatch(/^search:\d+$/);

    const long = await ctx.server.inject({ url: `/search/rss?q=${"x".repeat(201)}` });
    expect(long.status).toBe(400);
    expect(long.body).toContain("Search input too long.");

    const users = await ctx.server.inject({ url: "/search/rss?f=users&q=bob" });
    expect(users.status).toBe(400);
    expect(users.body).toContain("Only Tweet searches are allowed for RSS feeds.");
  });

  it("redirects list slugs to the id feed and serves it", async () => {
    const twitter = stubRssTwitter();
    const { ctx } = await boot(twitter);

    const redirect = await ctx.server.inject({ url: "/nasa/lists/space/rss" });
    expect(redirect.status).toBe(302);
    expect(redirect.headers["location"]).toBe("/i/lists/7/rss");

    const paged = await ctx.server.inject({ url: "/nasa/lists/space/rss?cursor=ABC" });
    expect(paged.headers["location"]).toBe("/i/lists/7/rss?cursor=ABC");

    const feed = await ctx.server.inject({ url: "/i/lists/7/rss" });
    expect(feed.status).toBe(200);
    expect(feed.headers["min-id"]).toBe("CURSOR123");
    expect(feed.body).toContain("<title>Space / @nasa</title>");
    expect(twitter.list).toHaveBeenCalledWith("7", "");
    const [key] = (twitter.cachedRss as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(key).toBe("lists:7");
  });

  it("404s unknown lists and the /i/ slug shortcut", async () => {
    const twitter = stubRssTwitter({
      cachedList: vi.fn(async () => undefined),
    });
    const { ctx } = await boot(twitter);

    const missing = await ctx.server.inject({ url: "/nasa/lists/nope/rss" });
    expect(missing.status).toBe(404);
    expect(missing.body).toContain("List &quot;nope&quot; not found");

    const idMissing = await ctx.server.inject({ url: "/i/lists/0/rss" });
    expect(idMissing.status).toBe(404);
    expect(idMissing.body).toContain("List &quot;0&quot; not found");

    const shortcut = await ctx.server.inject({ url: "/i/lists/space/rss" });
    expect(shortcut.status).toBe(404);
  });

  it("maps rate limits to a 429 page", async () => {
    const twitter = stubRssTwitter({
      tweets: vi.fn(async () => {
        throw new RateLimitError("limited");
      }),
    });
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/nasa/rss" });
    expect(res.status).toBe(429);
    expect(res.body).toContain("rate limited");
  });

  it("unloads cleanly: disposed routes answer 404", async () => {
    const { ctx, unload } = await boot(stubRssTwitter());
    expect((await ctx.server.inject({ url: "/nasa/rss" })).status).toBe(200);
    await unload();
    expect((await ctx.server.inject({ url: "/nasa/rss" })).status).toBe(404);
  });
});

describe("rss helpers", () => {
  it("builds cache keys", () => {
    expect(redisKey("twitter", "nasa", "")).toBe("twitter:nasa");
    expect(redisKey("twitter", "nasa", "ABC")).toBe("twitter:nasa:ABC");
    expect(redisKey("search", "123", "")).toBe("search:123");
  });

  it("gates tabs per flag", () => {
    expect(rssTabEnabled({}, "")).toBe(true);
    expect(rssTabEnabled({}, "search")).toBe(true);
    expect(rssTabEnabled({ enableRSSUserTweets: false }, "")).toBe(false);
    expect(rssTabEnabled({ enableRSSSearch: false }, "search")).toBe(false);
    expect(rssTabEnabled({}, "nope")).toBe(false);
  });

  it("hashes search keys deterministically", () => {
    const first = searchKeyHash(emptyTimeline().query);
    expect(first).toMatch(/^\d+$/);
    expect(searchKeyHash(emptyTimeline().query)).toBe(first);
  });
});
