import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cachePlugin } from "@tseer/cache";
import { prefsPlugin } from "@tseer/prefs";
import { serverPlugin } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import { QueryKind, RateLimitError, type TimelineResult, type Tweet } from "@tseer/types";
import { renderPlugin } from "@tseer/views";
import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";
import {
  chunkList,
  HOME_MAX_FOLLOWS,
  default as homePlugin,
  mergeHomeTweets,
  nextHomeCursor,
  normalizeFollows,
} from "../src/home.ts";
import { emptyTimeline } from "../src/timeline.ts";
import { makeTweet } from "./timeline.spec.ts";

function tweet(id: string): Tweet {
  return makeTweet({ id, text: `tw-${id}` });
}

function stubHomeTwitter(
  byUser: Record<string, Tweet[]>,
  extra: Partial<TwitterApi> = {},
): TwitterApi {
  return {
    search: vi.fn(
      async (query: { fromUser: string[] }): Promise<TimelineResult> => ({
        content: query.fromUser.flatMap((name) => byUser[name] ?? []),
        top: "",
        bottom: "CHUNKBOTTOM",
        beginning: false,
        query: { ...emptyTimeline().query, fromUser: query.fromUser },
      }),
    ),
    ...extra,
  } as unknown as TwitterApi;
}

async function boot(
  twitter: TwitterApi,
  home: Record<string, unknown> = {},
  useCache = false,
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
  if (useCache) await ctx.plugin(cachePlugin, { provider: "memory" });
  ctx.provide("twitter", twitter);
  ctx.provide("config", { title: "nitter", hostname: "localhost", useHttps: false, home });
  const fiber = await ctx.plugin(homePlugin);
  return { ctx, unload: () => fiber.dispose() };
}

describe("home helpers", () => {
  it("chunks lists", () => {
    const items = Array.from({ length: 25 }, (_, i) => `u${i}`);
    expect(chunkList(items, 12).map((chunk) => chunk.length)).toEqual([12, 12, 1]);
    expect(chunkList(items, 0)).toEqual(items.map((item) => [item]));
    expect(chunkList([], 12)).toEqual([]);
  });

  it("merges chunk pages chronologically with dedupe", () => {
    const merged = mergeHomeTweets([
      { ...emptyTimeline(), content: [tweet("300"), tweet("100"), tweet("300")] },
      { ...emptyTimeline(), content: [tweet("400"), tweet(""), tweet("200")] },
    ]);
    expect(merged.map((t) => t.id)).toEqual(["400", "300", "200", "100"]);
  });

  it("derives the next cursor one below the oldest id", () => {
    expect(nextHomeCursor([tweet("100"), tweet("50"), tweet("7")])).toBe("maxid:6");
    expect(nextHomeCursor([tweet("5")])).toBe("maxid:4");
    expect(nextHomeCursor([tweet("1")])).toBe("");
    expect(nextHomeCursor([])).toBe("");
  });

  it("normalizes and caps the follows list", () => {
    expect(normalizeFollows([" a ", "A", "", "b"])).toEqual(["a", "b"]);
    expect(normalizeFollows(Array.from({ length: 200 }, (_, i) => `u${i}`))).toHaveLength(
      HOME_MAX_FOLLOWS,
    );
  });
});

describe("homePlugin", () => {
  it("chunks follows into tweet-kind searches and merges chronologically", async () => {
    const twitter = stubHomeTwitter({
      a: [tweet("300")],
      b: [tweet("100")],
      c: [tweet("400")],
      d: [tweet("200")],
    });
    const { ctx } = await boot(twitter, { follows: ["a", "b", "c", "d"], chunkSize: 2 });

    const res = await ctx.server.inject({ url: "/" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("<title>Home | nitter</title>");
    expect(res.body).toContain("timeline-header");

    const calls = (twitter.search as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![0].fromUser).toEqual(["a", "b"]);
    expect(calls[1]![0].fromUser).toEqual(["c", "d"]);
    for (const [query, cursor] of calls) {
      expect(query.kind).toBe(QueryKind.tweets);
      expect(cursor).toBe("");
    }

    expect(res.body.indexOf("tw-400")).toBeLessThan(res.body.indexOf("tw-300"));
    expect(res.body.indexOf("tw-300")).toBeLessThan(res.body.indexOf("tw-200"));
    expect(res.body.indexOf("tw-200")).toBeLessThan(res.body.indexOf("tw-100"));
  });

  it("links and threads the maxid cursor through every chunk", async () => {
    const twitter = stubHomeTwitter({
      a: [tweet("300")],
      b: [tweet("100")],
    });
    const { ctx } = await boot(twitter, { follows: ["a", "b"], chunkSize: 1 });

    const first = await ctx.server.inject({ url: "/" });
    expect(first.body).toContain("Load more");
    expect(first.body).toContain("cursor=maxid%3A99");

    const second = await ctx.server.inject({ url: "/?cursor=maxid%3A99" });
    expect(second.status).toBe(200);
    const calls = (twitter.search as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(4);
    expect(calls[2]![1]).toBe("maxid:99");
    expect(calls[3]![1]).toBe("maxid:99");
  });

  it("renders the empty-state panel when no follows are configured", async () => {
    const twitter = stubHomeTwitter({});
    const { ctx } = await boot(twitter, {});

    const res = await ctx.server.inject({ url: "/" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("No followed accounts configured");
    expect(res.body).toContain("TSEER_HOME_FOLLOWS");
    expect(twitter.search).not.toHaveBeenCalled();
  });

  it("renders No items found for an empty feed", async () => {
    const twitter = stubHomeTwitter({});
    const { ctx } = await boot(twitter, { follows: ["a"], chunkSize: 2 });

    const res = await ctx.server.inject({ url: "/" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("No items found");
    expect(res.body).not.toContain("Load more");
  });

  it("serves scroll fragments without the shell and 204s when empty", async () => {
    const twitter = stubHomeTwitter({ a: [tweet("9")] });
    const empty = stubHomeTwitter({});
    const { ctx } = await boot(twitter, { follows: ["a"] });
    const { ctx: emptyCtx } = await boot(empty, { follows: ["a"] });

    const fragment = await ctx.server.inject({ url: "/?scroll=1" });
    expect(fragment.status).toBe(200);
    expect(fragment.body).toContain("timeline-container");
    expect(fragment.body).toContain("tw-9");
    expect(fragment.body).not.toContain("<title>");

    expect((await emptyCtx.server.inject({ url: "/?scroll=1" })).status).toBe(204);
  });

  it("maps rate limits to a 429 page", async () => {
    const twitter = stubHomeTwitter(
      {},
      {
        search: vi.fn(async () => {
          throw new RateLimitError("limited");
        }),
      },
    );
    const { ctx } = await boot(twitter, { follows: ["a"] });

    const res = await ctx.server.inject({ url: "/" });
    expect(res.status).toBe(429);
    expect(res.body).toContain("rate limited");
  });

  it("caches the merged feed per cursor when a cache is mounted", async () => {
    const twitter = stubHomeTwitter({ a: [tweet("9")], b: [tweet("8")] });
    const { ctx } = await boot(
      twitter,
      { follows: ["a", "b"], chunkSize: 1, cacheSeconds: 60 },
      true,
    );

    const first = await ctx.server.inject({ url: "/" });
    const second = await ctx.server.inject({ url: "/" });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toBe(first.body);
    expect(twitter.search).toHaveBeenCalledTimes(2);
  });

  it("keeps the root route ahead of the static wildcard", async () => {
    const twitter = stubHomeTwitter({ a: [tweet("9")] });
    const { ctx } = await boot(twitter, { follows: ["a"] });

    const dir = await mkdtemp(join(tmpdir(), "tseer-home-"));
    await mkdir(join(dir, "css"), { recursive: true });
    await writeFile(join(dir, "css/style.css"), "body{}");
    const disposeStatic = ctx.server.static("/", dir);
    try {
      const home = await ctx.server.inject({ url: "/" });
      expect(home.status).toBe(200);
      expect(home.body).toContain("tw-9");
      const css = await ctx.server.inject({ url: "/css/style.css" });
      expect(css.status).toBe(200);
      expect(css.body).toBe("body{}");
    } finally {
      disposeStatic();
    }
  });

  it("unloads cleanly: disposed routes answer 404", async () => {
    const twitter = stubHomeTwitter({ a: [tweet("9")] });
    const { ctx, unload } = await boot(twitter, { follows: ["a"] });
    expect((await ctx.server.inject({ url: "/" })).status).toBe(200);
    await unload();
    expect((await ctx.server.inject({ url: "/" })).status).toBe(404);
  });
});
