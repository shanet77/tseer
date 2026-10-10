/** Resolver route plugin tests — fastify `inject` against a context with a
 * stubbed `ctx.twitter`, proving the seams are real (plan §6). */

import { prefsPlugin } from "@tseer/prefs";
import { serverPlugin } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import { renderPlugin } from "@tseer/views";
import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";
import { cardUrl, default as resolverPlugin, tcoUrl } from "../src/resolver.ts";
import { makeTimeline, makeTweet, makeUser, stubTwitter } from "./timeline.spec.ts";

function stubResolverTwitter(resolve: (url: string) => Promise<string>): TwitterApi {
  return stubTwitter(makeUser(), makeTimeline(makeTweet()), {
    resolve: vi.fn(resolve),
  });
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
  ctx.provide("config", { title: "nitter", hostname: "localhost", useHttps: false });
  const fiber = await ctx.plugin(resolverPlugin);
  return { ctx, unload: () => fiber.dispose() };
}

describe("resolverPlugin", () => {
  it("resolves card links to the location header", async () => {
    const twitter = stubResolverTwitter(async () => "https://example.com/card-target");
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/cards/poll/123" });
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("https://example.com/card-target");
    expect(twitter.resolve).toHaveBeenCalledWith("https://cards.twitter.com/cards/poll/123");
  });

  it("resolves t.co links to the location header", async () => {
    const twitter = stubResolverTwitter(async () => "https://example.com/expanded");
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/t.co/abc123" });
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("https://example.com/expanded");
    expect(twitter.resolve).toHaveBeenCalledWith("https://t.co/abc123");
  });

  it("answers the invalid-link page when resolution is empty", async () => {
    const twitter = stubResolverTwitter(async () => "");
    const { ctx } = await boot(twitter);

    const card = await ctx.server.inject({ url: "/cards/poll/123" });
    expect(card.status).toBe(200);
    expect(card.body).toContain("Invalid card link");

    const tco = await ctx.server.inject({ url: "/t.co/abc123" });
    expect(tco.status).toBe(200);
    expect(tco.body).toContain("Invalid t.co link");
  });

  it("rewrites the resolved location with the link-replacement prefs", async () => {
    const twitter = stubResolverTwitter(async () => "https://twitter.com/someone/status/1");
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({
      url: "/t.co/abc123?replaceTwitter=nitter.example",
    });
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("https://nitter.example/someone/status/1");
  });

  it("unloads cleanly: disposed routes answer 404", async () => {
    const twitter = stubResolverTwitter(async () => "https://example.com/x");
    const { ctx, unload } = await boot(twitter);
    expect((await ctx.server.inject({ url: "/t.co/abc123" })).status).toBe(302);
    await unload();
    expect((await ctx.server.inject({ url: "/t.co/abc123" })).status).toBe(404);
  });
});

describe("resolver helpers", () => {
  it("builds upstream urls", () => {
    expect(cardUrl("poll", "123")).toBe("https://cards.twitter.com/cards/poll/123");
    expect(tcoUrl("abc123")).toBe("https://t.co/abc123");
  });
});
