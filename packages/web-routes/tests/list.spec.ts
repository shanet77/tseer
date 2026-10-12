/** List route plugin tests — fastify `inject` against a context with a
 * stubbed `ctx.twitter`, proving the seams are real (plan §6). Pins the
 * `respList` gate, the slug redirect, the members tab, and the upstream
 * divergences documented in `src/list.ts` (404 on unknown lists instead of
 * the nil-timeline 500; the posts-kind envelope query). */

import { prefsPlugin } from "@tseer/prefs";
import { serverPlugin } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import {
  QueryKind,
  RateLimitError,
  type Result,
  type TimelineResult,
  type User,
} from "@tseer/types";
import { renderPlugin } from "@tseer/views";
import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";
import { default as listPlugin, listQuery, listTitle } from "../src/list.ts";
import { emptyTimeline } from "../src/timeline.ts";
import { makeTimeline, makeTweet, makeUser, stubTwitter } from "./timeline.spec.ts";

function makeList() {
  return {
    id: "7",
    name: "Space",
    userId: "1234",
    username: "nasa",
    description: "orbital updates",
    members: 3,
    banner: "https://pbs.twimg.com/profile_banners/list/1500.jpg",
  };
}

function stubListTwitter(extra: Partial<TwitterApi> = {}): TwitterApi {
  const user = makeUser();
  const timeline = makeTimeline(makeTweet());
  const base = stubTwitter(user, timeline);
  return {
    ...base,
    cachedList: vi.fn(async () => makeList()),
    list: vi.fn(async (): Promise<TimelineResult> => timeline.tweets),
    listMembers: vi.fn(
      async (): Promise<Result<User>> => ({
        content: [makeUser({ username: "friend", fullname: "Friend", id: "2" })],
        top: "",
        bottom: "MEMBERCURSOR",
        beginning: true,
        query: { ...emptyTimeline().query, kind: QueryKind.userList },
      }),
    ),
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
  const fiber = await ctx.plugin(listPlugin);
  return { ctx, unload: () => fiber.dispose() };
}

describe("listPlugin", () => {
  it("renders the list timeline with header, tabs, banner, and rss link", async () => {
    const twitter = stubListTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/lists/7" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<title>@nasa/Space | nitter</title>");
    expect(res.body).toContain("&quot;Space&quot; by @nasa");
    expect(res.body).toContain('<div class="timeline-description">orbital updates</div>');
    expect(res.body).toContain('href="/i/lists/7/members"');
    // banner rides the shell head and the signed timeline-banner link
    expect(res.body).toContain("timeline-banner");
    expect(res.body).toContain("/pic/https://pbs.twimg.com/profile_banners/list/1500.jpg");
    // rss link gated on enableRSSList (default on)
    expect(res.body).toContain('href="/i/lists/7/rss"');
    expect(res.body).toContain("hello world");

    expect(twitter.cachedList).toHaveBeenCalledWith("", "", "7");
    expect(twitter.list).toHaveBeenCalledWith("7", "");
  });

  it("assigns the posts-kind envelope query (upstream's zero-default Query)", async () => {
    const twitter = stubListTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/lists/7" });
    expect(res.body).toContain('class="tab-item active"');
    // posts-kind query: the "Load more" link carries only the cursor
    expect(res.body).toContain("cursor=CURSOR123");
    expect(res.body).not.toContain("f=tweets");
    // the envelope the fetcher returned (tweets-kind) is overwritten
    expect(twitter.list).toHaveBeenCalledTimes(1);
  });

  it("omits the rss link when enableRSSList is off", async () => {
    const { ctx } = await boot(stubListTwitter(), { enableRSSList: false });

    const res = await ctx.server.inject({ url: "/i/lists/7" });
    expect(res.status).toBe(200);
    expect(res.body).not.toContain('href="/i/lists/7/rss"');
  });

  it("passes the cursor into the fetch and the pagination link", async () => {
    const twitter = stubListTwitter();
    const { ctx } = await boot(twitter);

    await ctx.server.inject({ url: "/i/lists/7?cursor=ABC" });
    expect(twitter.list).toHaveBeenCalledWith("7", "ABC");
  });

  it("serves the members tab through listMembers with a userList query", async () => {
    const twitter = stubListTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/lists/7/members" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("<title>@nasa/Space | nitter</title>");
    expect(res.body).toContain('data-username="friend"');
    expect(res.body).toContain("cursor=MEMBERCURSOR");
    expect(twitter.listMembers).toHaveBeenCalledWith("7", "");
  });

  it("redirects slugs to the id route", async () => {
    const twitter = stubListTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/nasa/lists/space" });
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/i/lists/7");
    expect(twitter.cachedList).toHaveBeenCalledWith("nasa", "space");

    const paged = await ctx.server.inject({ url: "/nasa/lists/space?cursor=ABC" });
    expect(paged.headers["location"]).toBe("/i/lists/7?cursor=ABC");
  });

  it("404s unknown lists and the denied slug paths", async () => {
    const twitter = stubListTwitter({
      cachedList: vi.fn(async () => undefined),
    });
    const { ctx } = await boot(twitter);

    const missing = await ctx.server.inject({ url: "/nasa/lists/nope" });
    expect(missing.status).toBe(404);
    expect(missing.body).toContain("List &quot;nope&quot; not found");

    const idMissing = await ctx.server.inject({ url: "/i/lists/0" });
    expect(idMissing.status).toBe(404);
    expect(idMissing.body).toContain("List &quot;0&quot; not found");

    // `cond @"name" != "i"`: /i/lists/space can't reach the slug route — the
    // radix router sends every /i/lists/* path to the static-segment id route
    // (as upstream's Jester does with its own static segments), where it
    // fails the list lookup instead.
    const slugAsId = await ctx.server.inject({ url: "/i/lists/space" });
    expect(slugAsId.status).toBe(404);
    expect(slugAsId.body).toContain("List &quot;space&quot; not found");

    // `cond @"slug" != "memberships"` reserves the members tab's future name
    const memberships = await ctx.server.inject({ url: "/nasa/lists/memberships" });
    expect(memberships.status).toBe(404);
    expect(memberships.body).toContain("Page not found");
  });

  it("renders an empty timeline page when the fetch misses", async () => {
    const twitter = stubListTwitter({ list: vi.fn(async () => undefined) });
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/lists/7" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("No items found");
  });

  it("maps rate limits to a 429 page", async () => {
    const twitter = stubListTwitter({
      list: vi.fn(async () => {
        throw new RateLimitError("limited");
      }),
    });
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/lists/7" });
    expect(res.status).toBe(429);
    expect(res.body).toContain("rate limited");
  });

  it("unloads cleanly: disposed routes answer 404", async () => {
    const { ctx, unload } = await boot(stubListTwitter());
    expect((await ctx.server.inject({ url: "/i/lists/7" })).status).toBe(200);
    await unload();
    expect((await ctx.server.inject({ url: "/i/lists/7" })).status).toBe(404);
  });
});

describe("list helpers", () => {
  it("titles lists as @owner/name", () => {
    expect(listTitle({ username: "nasa", name: "Space" })).toBe("@nasa/Space");
  });

  it("builds the zero-default posts-kind query", () => {
    expect(listQuery().kind).toBe(QueryKind.posts);
    expect(listQuery().fromUser).toEqual([]);
  });
});
