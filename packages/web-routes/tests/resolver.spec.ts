import type { TwitterApi } from "@tseer/twitter-api";
import { describe, expect, it, vi } from "vitest";
import { cardUrl, default as resolverPlugin, tcoUrl } from "../src/resolver.ts";
import { type BootedRoute, bootRoute } from "./support.ts";
import { makeTimeline, makeTweet, makeUser, stubTwitter } from "./timeline.spec.ts";

function stubResolverTwitter(resolve: (url: string) => Promise<string>): TwitterApi {
  return stubTwitter(makeUser(), makeTimeline(makeTweet()), {
    resolve: vi.fn(resolve),
  });
}

const boot = (twitter: TwitterApi): Promise<BootedRoute> =>
  bootRoute(resolverPlugin, { twitter, config: {} });

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
