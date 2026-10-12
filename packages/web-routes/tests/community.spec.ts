import { prefsPlugin } from "@tseer/prefs";
import { serverPlugin } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import {
  QueryKind,
  RankingMode,
  RateLimitError,
  type Result,
  type TimelineResult,
  type User,
} from "@tseer/types";
import { renderPlugin } from "@tseer/views";
import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";
import { default as communityPlugin, communityQuery } from "../src/community.ts";
import { emptyTimeline } from "../src/timeline.ts";
import { makeTimeline, makeTweet, makeUser, stubTwitter } from "./timeline.spec.ts";

function makeCommunity() {
  return {
    id: "9",
    name: "Spaceflight",
    description: "rockets and orbit",
    memberCount: 12345,
    banner: "https://pbs.twimg.com/community_banner/1.jpg",
    creator: makeUser(),
    category: "Science",
    joinPolicy: "Open",
    createdAt: "2023-06-01T12:00:00Z",
    rules: [{ name: "Be nice", description: "no flames" }],
    hashtags: ["#space"],
  };
}

function stubCommunityTwitter(extra: Partial<TwitterApi> = {}): TwitterApi {
  const user = makeUser();
  const timeline = makeTimeline(makeTweet()).tweets;
  const base = stubTwitter(user, { pinned: undefined, tweets: timeline });
  return {
    ...base,
    cachedCommunity: vi.fn(async () => makeCommunity()),
    community: vi.fn(async (): Promise<TimelineResult> => timeline),
    communityMedia: vi.fn(async (): Promise<TimelineResult> => timeline),
    communityMembers: vi.fn(
      async (): Promise<Result<User>> => ({
        content: [makeUser({ username: "friend", fullname: "Friend", id: "2" })],
        top: "",
        bottom: "MEMBERCURSOR",
        beginning: true,
        query: { ...emptyTimeline().query, kind: QueryKind.userList },
      }),
    ),
    cachedCommunityModerators: vi.fn(
      async (): Promise<User[]> => [makeUser({ username: "mod", fullname: "Mod", id: "3" })],
    ),
    communityHashtags: vi.fn(async (): Promise<TimelineResult> => timeline),
    ...extra,
  } as unknown as TwitterApi;
}

async function boot(twitter: TwitterApi): Promise<{ ctx: Context; unload: () => Promise<void> }> {
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
  const fiber = await ctx.plugin(communityPlugin);
  return { ctx, unload: () => fiber.dispose() };
}

describe("communityPlugin", () => {
  it("renders the Top tab with tabs, banner, member count, and timeline", async () => {
    const twitter = stubCommunityTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/communities/9" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<title>Spaceflight | nitter</title>");
    expect(res.body).toContain('href="/i/communities/9">Top</a>');
    expect(res.body).toContain('href="/i/communities/9/latest"');
    expect(res.body).toContain('href="/i/communities/9/media"');
    expect(res.body).toContain('href="/i/communities/9/about"');
    expect(res.body).toContain("timeline-banner");
    expect(res.body).toContain("/pic/https://pbs.twimg.com/community_banner/1.jpg");
    expect(res.body).toContain('href="/i/communities/9/members"');
    expect(res.body).toContain("12,345 Members");
    expect(res.body).toContain("hello world");

    expect(twitter.cachedCommunity).toHaveBeenCalledWith("9");
    expect(twitter.community).toHaveBeenCalledWith("9", "", RankingMode.Relevance);
  });

  it("serves Latest through the Recency ranking mode", async () => {
    const twitter = stubCommunityTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/communities/9/latest" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("<title>Spaceflight - Latest | nitter</title>");
    expect(twitter.community).toHaveBeenCalledWith("9", "", RankingMode.Recency);
  });

  it("serves the Media tab through communityMedia", async () => {
    const twitter = stubCommunityTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/communities/9/media" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("<title>Spaceflight - Media | nitter</title>");
    expect(twitter.communityMedia).toHaveBeenCalledWith("9", "");
    expect(twitter.community).not.toHaveBeenCalled();
  });

  it("serves the About tab through cachedCommunityModerators", async () => {
    const twitter = stubCommunityTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/communities/9/about" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("<title>Spaceflight - About | nitter</title>");
    expect(res.body).toContain("Anyone can join this Community.");
    expect(res.body).toContain("<strong>Be nice</strong>");
    expect(res.body).toContain('class="community-mod-username"');
    expect(res.body).toContain(">@mod</a>");
    expect(twitter.cachedCommunityModerators).toHaveBeenCalledWith("9");
  });

  it("serves the Members tab through communityMembers", async () => {
    const twitter = stubCommunityTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/communities/9/members" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("<title>Spaceflight - Members | nitter</title>");
    expect(res.body).toContain('data-username="friend"');
    expect(res.body).toContain("cursor=MEMBERCURSOR");
    expect(twitter.communityMembers).toHaveBeenCalledWith("9", "");
  });

  it("serves the Moderators tab with the zero-default beginning=false envelope", async () => {
    const twitter = stubCommunityTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/communities/9/moderators" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("<title>Spaceflight - Moderators | nitter</title>");
    expect(res.body).toContain('data-username="mod"');
    expect(res.body).toContain("Load newest");
    expect(twitter.cachedCommunityModerators).toHaveBeenCalledWith("9");
  });

  it("serves the hashtag tab through communityHashtags", async () => {
    const twitter = stubCommunityTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/communities/9/hashtag/space" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("<title>Spaceflight - #space | nitter</title>");
    expect(res.body).toContain("community-hashtag-title");
    expect(twitter.communityHashtags).toHaveBeenCalledWith("9", "space", "");
  });

  it("passes the cursor into the fetches", async () => {
    const twitter = stubCommunityTwitter();
    const { ctx } = await boot(twitter);

    await ctx.server.inject({ url: "/i/communities/9?cursor=ABC" });
    expect(twitter.community).toHaveBeenCalledWith("9", "ABC", RankingMode.Relevance);

    await ctx.server.inject({ url: "/i/communities/9/media?cursor=ABC" });
    expect(twitter.communityMedia).toHaveBeenCalledWith("9", "ABC");

    await ctx.server.inject({ url: "/i/communities/9/members?cursor=ABC" });
    expect(twitter.communityMembers).toHaveBeenCalledWith("9", "ABC");

    await ctx.server.inject({ url: "/i/communities/9/hashtag/space?cursor=ABC" });
    expect(twitter.communityHashtags).toHaveBeenCalledWith("9", "space", "ABC");
  });

  it("renders cursor-only pagination on the tweet tabs (posts-kind envelope query)", async () => {
    const twitter = stubCommunityTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/communities/9" });
    expect(res.body).toContain("cursor=CURSOR123");
    expect(res.body).not.toContain("f=tweets");
  });

  it("404s unknown communities with the id quoted", async () => {
    const twitter = stubCommunityTwitter({
      cachedCommunity: vi.fn(async () => undefined),
    });
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/communities/0" });
    expect(res.status).toBe(404);
    expect(res.body).toContain("Community &quot;0&quot; not found");
  });

  it("404s dotted ids in-handler (the cond falls to the global 404 page)", async () => {
    const twitter = stubCommunityTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/communities/a.b" });
    expect(res.status).toBe(404);
    expect(res.body).toContain("Page not found");
    expect(twitter.cachedCommunity).not.toHaveBeenCalled();
  });

  it("maps rate limits to a 429 page", async () => {
    const twitter = stubCommunityTwitter({
      community: vi.fn(async () => {
        throw new RateLimitError("limited");
      }),
    });
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/communities/9" });
    expect(res.status).toBe(429);
    expect(res.body).toContain("rate limited");
  });

  it("unloads cleanly: disposed routes answer 404", async () => {
    const { ctx, unload } = await boot(stubCommunityTwitter());
    expect((await ctx.server.inject({ url: "/i/communities/9" })).status).toBe(200);
    await unload();
    expect((await ctx.server.inject({ url: "/i/communities/9" })).status).toBe(404);
  });
});

describe("communityQuery", () => {
  it("builds the zero-default posts-kind query", () => {
    expect(communityQuery().kind).toBe(QueryKind.posts);
    expect(communityQuery().fromUser).toEqual([]);
    expect(communityQuery(QueryKind.userList).kind).toBe(QueryKind.userList);
  });
});
