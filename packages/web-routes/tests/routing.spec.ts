import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prefsPlugin } from "@tseer/prefs";
import { serverPlugin } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import type { Rss } from "@tseer/types";
import { renderPlugin } from "@tseer/views";
import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";
import { default as rssPlugin } from "../src/rss.ts";
import { default as statusPlugin } from "../src/status.ts";
import { default as timelinePlugin } from "../src/timeline.ts";
import { default as unsupportedPlugin } from "../src/unsupported.ts";
import { makeConversation } from "./status.spec.ts";
import { makeTimeline, makeTweet, makeUser, stubTwitter } from "./timeline.spec.ts";

function stubAllTwitter(): TwitterApi {
  const user = makeUser();
  const timeline = makeTimeline(makeTweet());
  const conv = makeConversation();
  return {
    ...stubTwitter(user, timeline),
    cachedRss: vi.fn(async (_key: string, factory: () => Promise<Rss>) => factory()),
    cachedList: vi.fn(async () => ({
      id: "LIST1",
      name: "Space",
      userId: "1234",
      username: "nasa",
      description: "orbital updates",
      members: 3,
      banner: "",
    })),
    tweet: vi.fn(async () => conv),
    editHistory: vi.fn(async () => ({ latest: conv.tweet, history: [] })),
  } as unknown as TwitterApi;
}

describe("cross-plugin routing", () => {
  it("serves assets from static while every family keeps its routes", async () => {
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
    ctx.provide("twitter", stubAllTwitter());
    ctx.provide("config", { title: "nitter", hostname: "localhost", useHttps: false });
    const fibers = await Promise.all([
      ctx.plugin(timelinePlugin),
      ctx.plugin(statusPlugin),
      ctx.plugin(rssPlugin),
      ctx.plugin(unsupportedPlugin),
    ]);

    const dir = await mkdtemp(join(tmpdir(), "tseer-routing-"));
    await mkdir(join(dir, "css"), { recursive: true });
    await writeFile(join(dir, "css/style.css"), "body{}");
    await writeFile(join(dir, "logo.png"), "png");
    const disposeStatic = ctx.server.static("/", dir);
    try {
      const css = await ctx.server.inject({ url: "/css/style.css" });
      expect(css.status).toBe(200);
      expect(css.body).toBe("body{}");
      const logo = await ctx.server.inject({ url: "/logo.png" });
      expect(logo.status).toBe(200);

      expect((await ctx.server.inject({ url: "/nasa" })).status).toBe(200);
      const about = await ctx.server.inject({ url: "/nasa/about" });
      expect(about.status).toBe(200);
      expect(about.body).toContain("About @nasa");
      const rss = await ctx.server.inject({ url: "/nasa/rss" });
      expect(rss.status).toBe(200);
      expect(rss.headers["content-type"]).toContain("application/rss+xml");
      const status = await ctx.server.inject({ url: "/nasa/status/1001" });
      expect(status.status).toBe(200);
      expect(status.body).toContain("main tweet here");

      const badTab = await ctx.server.inject({ url: "/nasa/nope" });
      expect(badTab.status).toBe(404);
      expect(badTab.body).toContain("Page not found");

      const iStatus = await ctx.server.inject({ url: "/i/status/1001" });
      expect(iStatus.status).toBe(200);
      expect(iStatus.body).toContain("main tweet here");
      expect(iStatus.body).not.toContain("Unsupported feature");
      const iUser = await ctx.server.inject({ url: "/i/user/42" });
      expect(iUser.status).toBe(404);
      expect(iUser.body).toContain("User not found");
      expect(iUser.body).not.toContain("Unsupported feature");
      const listsRss = await ctx.server.inject({ url: "/nasa/lists/space/rss" });
      expect(listsRss.status).toBe(302);
      expect(listsRss.headers["location"]).toBe("/i/lists/LIST1/rss");
      const panel = await ctx.server.inject({ url: "/nasa/lists" });
      expect(panel.status).toBe(200);
      expect(panel.body).toContain("Unsupported feature");
    } finally {
      disposeStatic();
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    }
  });
});
