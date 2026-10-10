import { prefsPlugin } from "@tseer/prefs";
import { serverPlugin } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import {
  type Chain,
  type Conversation,
  type EditHistory,
  QueryKind,
  RankingMode,
} from "@tseer/types";
import { renderPlugin } from "@tseer/views";
import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";
import { isValidTweetId, parseSortMode, default as statusPlugin } from "../src/status.ts";
import { makeTweet, makeUser } from "./timeline.spec.ts";

function emptyChain(overrides: Partial<Chain> = {}): Chain {
  return { content: [], hasMore: false, cursor: "", related: false, ...overrides };
}

export function makeConversation(): Conversation {
  const main = makeTweet({ id: "1001", text: "main tweet here" });
  const reply = makeTweet({ id: "1002", text: "a reply", user: makeUser() });
  return {
    tweet: main,
    before: emptyChain(),
    after: emptyChain(),
    replies: {
      content: [emptyChain({ content: [reply] })],
      top: "",
      bottom: "REPLYCURSOR",
      beginning: true,
      query: {
        kind: QueryKind.posts,
        view: "",
        text: "",
        filters: [],
        includes: [],
        excludes: [],
        fromUser: [],
        since: "",
        until: "",
        minLikes: "",
        sep: "",
      },
    },
  };
}

function stubStatusTwitter(
  conv: Conversation | undefined,
  extra: Partial<TwitterApi> = {},
): TwitterApi {
  const history: EditHistory = {
    latest: conv?.tweet ?? makeTweet(),
    history: [makeTweet({ id: "999", text: "older version" })],
  };
  return {
    tweet: vi.fn(async () => conv),
    editHistory: vi.fn(async () => history),
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
  const fiber = await ctx.plugin(statusPlugin);
  return { ctx, unload: () => fiber.dispose() };
}

describe("statusPlugin", () => {
  it("validates tweet ids and sort modes", () => {
    expect(isValidTweetId("1001")).toBe(true);
    expect(isValidTweetId("")).toBe(false);
    expect(isValidTweetId("abc")).toBe(false);
    expect(isValidTweetId("1".repeat(20))).toBe(false);
    expect(parseSortMode(undefined)).toBe(RankingMode.Relevance);
    expect(parseSortMode("recency")).toBe(RankingMode.Recency);
    expect(parseSortMode("Likes")).toBe(RankingMode.Likes);
    expect(parseSortMode("bogus")).toBe(RankingMode.Relevance);
  });

  it("renders a conversation end to end", async () => {
    const conv = makeConversation();
    const twitter = stubStatusTwitter(conv);
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/nasa/status/1001" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain('class="conversation"');
    expect(res.body).toContain('id="m"');
    expect(res.body).toContain("main tweet here");
    expect(res.body).toContain("a reply");
    expect(res.body).toContain("Sort replies:");
    expect(res.body).toContain("application/json+oembed");
    expect(res.body).toContain("/api/oembed?url=");
    expect(twitter.tweet).toHaveBeenCalledWith("1001", "", RankingMode.Relevance);
  });

  it("passes cursor and sort through to the provider", async () => {
    const twitter = stubStatusTwitter(makeConversation());
    const { ctx } = await boot(twitter);

    await ctx.server.inject({ url: "/nasa/status/1001?cursor=ABC&sort=likes" });
    expect(twitter.tweet).toHaveBeenCalledWith("1001", "ABC", RankingMode.Likes);
  });

  it("404s invalid ids and missing tweets; dotted names fall through to static", async () => {
    const { ctx } = await boot(stubStatusTwitter(makeConversation()));

    const invalid = await ctx.server.inject({ url: "/nasa/status/abc" });
    expect(invalid.status).toBe(404);
    expect(invalid.body).toContain("Invalid tweet ID");

    // Nitter's match-time `cond '.' notin name`: no route matches, so the
    // request falls through to static instead of rendering an error page.
    const dotted = await ctx.server.inject({ url: "/na.sa/status/1001" });
    expect(dotted.status).toBe(404);
    expect(dotted.body).not.toContain("Page not found");

    const { ctx: ctx2 } = await boot(stubStatusTwitter(undefined));
    const missing = await ctx2.server.inject({ url: "/nasa/status/1001" });
    expect(missing.status).toBe(404);
    expect(missing.body).toContain("Tweet not found");
  });

  it("shows the tombstone when the tweet is unavailable", async () => {
    const conv = makeConversation();
    conv.tweet = { ...makeTweet({ id: "", tombstone: "This tweet was deleted" }) };
    const { ctx } = await boot(stubStatusTwitter(conv));
    const res = await ctx.server.inject({ url: "/nasa/status/1001" });
    expect(res.status).toBe(404);
    expect(res.body).toContain("This tweet was deleted");
  });

  it("serves the infinite-scroll replies fragment", async () => {
    const twitter = stubStatusTwitter(makeConversation());
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/nasa/status/1001?scroll=1" });
    expect(res.status).toBe(200);
    expect(res.body).not.toContain("<html");
    expect(res.body).toContain("a reply");

    const { ctx: ctx2 } = await boot(
      stubStatusTwitter({
        ...makeConversation(),
        replies: {
          content: [],
          top: "",
          bottom: "",
          beginning: true,
          query: makeConversation().replies.query,
        },
      }),
    );
    const empty = await ctx2.server.inject({ url: "/nasa/status/1001?scroll=1" });
    expect(empty.status).toBe(204);
  });

  it("renders the edit history", async () => {
    const twitter = stubStatusTwitter(makeConversation());
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/nasa/status/1001/history" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("Latest post");
    expect(res.body).toContain("Version history");
    expect(res.body).toContain("older version");
    expect(twitter.editHistory).toHaveBeenCalledWith("1001");

    const bad = await ctx.server.inject({ url: "/nasa/status/xyz/history" });
    expect(bad.status).toBe(404);
  });

  it("redirects the legacy status urls", async () => {
    const { ctx } = await boot(stubStatusTwitter(makeConversation()));

    for (const [url, location] of [
      ["/nasa/statuses/1001", "/nasa/status/1001"],
      ["/nasa/thread/1001", "/nasa/status/1001"],
      ["/i/web/status/1001", "/i/status/1001"],
      ["/nasa/status/1001/photo", "/nasa/status/1001"],
      ["/nasa/statuses/1001/video", "/nasa/status/1001"],
    ] as const) {
      const res = await ctx.server.inject({ url });
      expect(res.status, url).toBe(302);
      expect(res.headers["location"], url).toBe(location);
    }

    const miss = await ctx.server.inject({ url: "/nasa/other/1001/bogus" });
    expect(miss.status).toBe(404);
  });

  it("escapes markup in replies (XSS regression)", async () => {
    const conv = makeConversation();
    const firstThread = conv.replies.content[0];
    const firstReply = firstThread?.content[0];
    if (firstReply !== undefined) {
      firstReply.text = "&lt;script&gt;alert(&apos;xss&apos;)&lt;/script&gt;";
    }
    const { ctx } = await boot(stubStatusTwitter(conv));
    const res = await ctx.server.inject({ url: "/nasa/status/1001" });
    expect(res.status).toBe(200);
    expect(res.body.toLowerCase()).not.toContain("<script");
    expect(res.body).toContain("&lt;script&gt;alert(&apos;xss&apos;)&lt;/script&gt;");
  });

  it("unloads cleanly: disposed routes answer 404", async () => {
    const { ctx, unload } = await boot(stubStatusTwitter(makeConversation()));
    expect((await ctx.server.inject({ url: "/nasa/status/1001" })).status).toBe(200);
    await unload();
    const res = await ctx.server.inject({ url: "/nasa/status/1001" });
    expect(res.status).toBe(404);
  });
});
