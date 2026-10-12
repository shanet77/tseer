import { prefsPlugin } from "@tseer/prefs";
import { serverPlugin } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import { type Article, QueryKind, RateLimitError, type Tweet, type User } from "@tseer/types";
import { renderPlugin } from "@tseer/views";
import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";
import { default as articlePlugin } from "../src/article.ts";
import { makeTweet, makeUser, stubTwitter } from "./timeline.spec.ts";

function makeArticle(user: User, overrides: Partial<Article> = {}): Article {
  return {
    title: "Deep space",
    coverImage: "https://pbs.twimg.com/media/cover.jpg",
    user,
    time: "2023-06-01T12:00:00Z",
    stats: { replies: 1, retweets: 2, likes: 3, views: 4 },
    paragraphs: [
      { text: "First paragraph", kind: "unstructured", inlineStyles: [], entityRanges: [] },
      {
        text: "",
        kind: "atomic",
        inlineStyles: [],
        entityRanges: [{ offset: 0, length: 1, key: 0 }],
      },
    ],
    entities: {
      0: {
        kind: "TWEET",
        url: "",
        mediaIds: [],
        tweetId: "1001",
        markdown: "",
        caption: "",
      },
    },
    media: {},
    ...overrides,
  };
}

function stubArticleTwitter(extra: Partial<TwitterApi> = {}): TwitterApi {
  const user = makeUser();
  return {
    ...stubTwitter(user, {
      pinned: undefined,
      tweets: {
        content: [],
        top: "",
        bottom: "",
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
    }),
    article: vi.fn(async () => makeArticle(user)),
    tweetResults: vi.fn(async (): Promise<Tweet[]> => [makeTweet()]),
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
  const fiber = await ctx.plugin(articlePlugin);
  return { ctx, unload: () => fiber.dispose() };
}

describe("articlePlugin", () => {
  it("renders the article page with the shell, cover, and embedded tweet", async () => {
    const twitter = stubArticleTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/article/1001" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<title>Deep space | nitter</title>");
    expect(res.body).toContain('class="article-page"');
    expect(res.body).toContain('class="article-cover"');
    expect(res.body).toContain("/pic/orig/https://pbs.twimg.com/media/cover.jpg");
    expect(res.body).toContain("First paragraph");
    expect(res.body).toContain("hello world");

    expect(twitter.article).toHaveBeenCalledWith("1001");
    expect(twitter.tweetResults).toHaveBeenCalledWith(["1001"]);
  });

  it("links Open in X to the canonical x.com article URL", async () => {
    const { ctx } = await boot(stubArticleTwitter());

    const res = await ctx.server.inject({ url: "/i/article/1001" });
    expect(res.body).toContain(
      'class="icon-bird" title="Open in X" aria-label="Open in X" href="https://x.com/nasa/article/1001"',
    );
  });

  it("only batches TWEET-kind entities", async () => {
    const twitter = stubArticleTwitter({
      article: vi.fn(async () =>
        makeArticle(makeUser(), {
          entities: {
            0: {
              kind: "LINK",
              url: "https://example.com",
              mediaIds: [],
              tweetId: "",
              markdown: "",
              caption: "",
            },
            1: { kind: "TWEET", url: "", mediaIds: [], tweetId: "7", markdown: "", caption: "" },
            2: { kind: "TWEET", url: "", mediaIds: [], tweetId: "8", markdown: "", caption: "" },
          },
        }),
      ),
    });
    const { ctx } = await boot(twitter);

    await ctx.server.inject({ url: "/i/article/1001" });
    expect(twitter.tweetResults).toHaveBeenCalledWith(["7", "8"]);
  });

  it("swallows a failed tweet batch and still renders the body", async () => {
    const twitter = stubArticleTwitter({
      tweetResults: vi.fn(async () => {
        throw new RateLimitError("limited");
      }),
    });
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/article/1001" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("First paragraph");
  });

  it("404s a missing article", async () => {
    const twitter = stubArticleTwitter({ article: vi.fn(async () => undefined) });
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/article/0" });
    expect(res.status).toBe(404);
    expect(res.body).toContain("Article not found");
  });

  it("404s non-digit ids in-handler (the cond falls to the global 404 page)", async () => {
    const twitter = stubArticleTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/article/abc" });
    expect(res.status).toBe(404);
    expect(res.body).toContain("Page not found");
    expect(twitter.article).not.toHaveBeenCalled();
  });

  it("redirects the legacy paths to /i/article/:id", async () => {
    const twitter = stubArticleTwitter();
    const { ctx } = await boot(twitter);

    const byName = await ctx.server.inject({ url: "/nasa/article/1001" });
    expect(byName.status).toBe(302);
    expect(byName.headers.location).toBe("/i/article/1001");

    const byStatus = await ctx.server.inject({ url: "/nasa/status/1001/article" });
    expect(byStatus.status).toBe(302);
    expect(byStatus.headers.location).toBe("/i/article/1001");

    expect(twitter.article).not.toHaveBeenCalled();
  });

  it("404s non-digit ids on the redirect paths", async () => {
    const { ctx } = await boot(stubArticleTwitter());

    for (const url of ["/nasa/article/xyz", "/nasa/status/xyz/article"]) {
      const res = await ctx.server.inject({ url });
      expect(res.status).toBe(404);
      expect(res.body).toContain("Page not found");
    }
  });

  it("maps rate limits to a 429 page", async () => {
    const twitter = stubArticleTwitter({
      article: vi.fn(async () => {
        throw new RateLimitError("limited");
      }),
    });
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/article/1001" });
    expect(res.status).toBe(429);
    expect(res.body).toContain("rate limited");
  });

  it("unloads cleanly: disposed routes answer 404", async () => {
    const { ctx, unload } = await boot(stubArticleTwitter());
    expect((await ctx.server.inject({ url: "/i/article/1001" })).status).toBe(200);
    await unload();
    expect((await ctx.server.inject({ url: "/i/article/1001" })).status).toBe(404);
  });
});
