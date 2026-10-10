/** Cross-plugin routing: the shared dotless `:name` param (`src/params.ts`,
 * nitter's match-time `cond '.' notin name`) keeps every family on one radix
 * node, so static subpaths (`/about`, `/rss`, `/status`) win over `:tab` and
 * dotted asset URLs fall through to `staticDir`. Mounts timeline + status +
 * rss together because the shadowing only manifests across families. */

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
import { makeConversation } from "./status.spec.ts";
import { makeTimeline, makeTweet, makeUser, stubTwitter } from "./timeline.spec.ts";

function stubAllTwitter(): TwitterApi {
  const user = makeUser();
  const timeline = makeTimeline(makeTweet());
  const conv = makeConversation();
  return {
    ...stubTwitter(user, timeline),
    cachedRss: vi.fn(async (_key: string, factory: () => Promise<Rss>) => factory()),
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
    ]);

    const dir = await mkdtemp(join(tmpdir(), "tseer-routing-"));
    await mkdir(join(dir, "css"), { recursive: true });
    await writeFile(join(dir, "css/style.css"), "body{}");
    await writeFile(join(dir, "logo.png"), "png");
    const disposeStatic = ctx.server.static("/", dir);
    try {
      // Dotted asset URLs fall through to static, not to user routes.
      const css = await ctx.server.inject({ url: "/css/style.css" });
      expect(css.status).toBe(200);
      expect(css.body).toBe("body{}");
      const logo = await ctx.server.inject({ url: "/logo.png" });
      expect(logo.status).toBe(200);

      // Every family still answers on the shared `:name` node.
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

      // Invalid tabs still 404 as timeline pages, not as static misses.
      const badTab = await ctx.server.inject({ url: "/nasa/nope" });
      expect(badTab.status).toBe(404);
      expect(badTab.body).toContain("Page not found");
    } finally {
      disposeStatic();
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    }
  });
});
