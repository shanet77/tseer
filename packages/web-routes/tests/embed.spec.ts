/** Embed route plugin tests — fastify `inject` against a context with a
 * stubbed `ctx.twitter`, proving the seams are real (plan §6). */

import { prefsPlugin } from "@tseer/prefs";
import { serverPlugin } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import { type Media, MediaKind, type Tweet, VideoType } from "@tseer/types";
import { renderPlugin } from "@tseer/views";
import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";
import { default as embedPlugin, parseTweetPath, parseTweetUrl } from "../src/embed.ts";
import { makeTweet, makeUser, stubTwitter } from "./timeline.spec.ts";

function videoMedia(): Media {
  return {
    kind: MediaKind.videoMedia,
    video: {
      durationMs: 1500,
      url: "https://vid.example/v.mp4",
      thumb: "https://vid.example/t.jpg",
      available: true,
      reason: "",
      title: "",
      description: "",
      playbackType: VideoType.mp4,
      variants: [
        { contentType: VideoType.mp4, url: "https://vid.example/v.mp4", bitrate: 1, resolution: 0 },
      ],
    },
  };
}

const photoMedia: Media = {
  kind: MediaKind.photoMedia,
  photo: { url: "https://pic.example/p.jpg", altText: "" },
};

function videoTweet(): Tweet {
  return makeTweet({ media: [videoMedia()] });
}

function stubEmbedTwitter(tweet: Tweet | undefined): TwitterApi {
  return stubTwitter(
    makeUser(),
    {
      pinned: undefined,
      tweets: { content: [], top: "", bottom: "", beginning: true, query: undefined },
    } as never,
    {
      tweetByRestId: vi.fn(async (id: string) => (id === "1001" ? tweet : undefined)),
    },
  );
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
  const fiber = await ctx.plugin(embedPlugin);
  return { ctx, unload: () => fiber.dispose() };
}

describe("embedPlugin", () => {
  it("renders the video embed with og:video pointing at the tweet video route", async () => {
    const { ctx } = await boot(stubEmbedTwitter(videoTweet()));

    const res = await ctx.server.inject({ url: "/i/videos/tweet/1001" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("embed-video");
    expect(res.body).toContain("Watch on localhost");
    expect(res.body).toContain(
      'property="og:video:url" content="http://localhost/i/videos/tweet/1001"',
    );
  });

  it("answers the missing-tweet error embed for /i/videos/tweet/:id", async () => {
    const { ctx } = await boot(stubEmbedTwitter(undefined));

    const res = await ctx.server.inject({ url: "/i/videos/tweet/1001" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("Tweet not found");
    expect(res.body).toContain('href="/i/status/1001"');
  });

  it("answers the no-video error embed with the user's status link", async () => {
    const { ctx } = await boot(stubEmbedTwitter(makeTweet()));

    const res = await ctx.server.inject({ url: "/i/videos/tweet/1001" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("No video in tweet");
    expect(res.body).toContain('href="/nasa/status/1001"');
  });

  it("renders the tweet embed for /:name/status/:id/embed", async () => {
    const { ctx } = await boot(stubEmbedTwitter(makeTweet()));

    const res = await ctx.server.inject({ url: "/nasa/status/1001/embed" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("embed-wrapper");
    expect(res.body).toContain("hello world");
    expect(res.body).toContain("Read more on localhost");
  });

  it("answers the missing-tweet error embed on the named route", async () => {
    const { ctx } = await boot(stubEmbedTwitter(undefined));

    const res = await ctx.server.inject({ url: "/nasa/status/1001/embed" });
    expect(res.body).toContain("Tweet not found");
    expect(res.body).toContain('href="/nasa/status/1001"');
  });

  it("serves /i/status/:id/embed through the same handler (radix alias)", async () => {
    const { ctx } = await boot(stubEmbedTwitter(makeTweet()));

    const res = await ctx.server.inject({ url: "/i/status/1001/embed" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("embed-wrapper");
    expect(res.body).toContain("hello world");
  });

  it("redirects /embed/Tweet.html?id= to /i/status/:id/embed and 404s without it", async () => {
    const { ctx } = await boot(stubEmbedTwitter(makeTweet()));

    const res = await ctx.server.inject({ url: "/embed/Tweet.html?id=123" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/i/status/123/embed");

    const bare = await ctx.server.inject({ url: "/embed/Tweet.html" });
    expect(bare.status).toBe(404);
    expect(bare.body).toBe("");
  });

  it("serves the oEmbed JSON with CORS and the expected fields", async () => {
    const { ctx } = await boot(stubEmbedTwitter(makeTweet({ media: [photoMedia] })));

    const res = await ctx.server.inject({
      url: "/api/oembed?url=https%3A%2F%2Fx.com%2Fnasa%2Fstatus%2F1001",
    });
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    const body = res.json<Record<string, unknown>>();
    expect(body.version).toBe("1.0");
    expect(body.type).toBe("rich");
    expect(body.provider_name).toBe("nitter");
    expect(body.provider_url).toBe("http://localhost");
    expect(body.title).toBe("hello world");
    expect(body.author_name).toBe("NASA");
    expect(body.author_url).toBe("http://localhost/nasa");
    expect(body.url).toBe("http://localhost/nasa/status/1001/embed");
    expect(body.width).toBe(550);
    expect(body.height).toBeNull();
    expect(body.cache_age).toBe("3153600000");
    expect(body.html).toContain('src="http://localhost/nasa/status/1001/embed"');
    expect(body.thumbnail_url).toBe("http://localhost/pic/https://pic.example/p.jpg");
    expect(body.thumbnail_width).toBe(550);
    expect(body.thumbnail_height).toBe(550);
  });

  it("omits thumbnail fields when the tweet has no media", async () => {
    const { ctx } = await boot(stubEmbedTwitter(makeTweet()));

    const res = await ctx.server.inject({
      url: "/api/oembed?url=https%3A%2F%2Fx.com%2Fnasa%2Fstatus%2F1001",
    });
    const body = res.json<Record<string, unknown>>();
    expect(body).not.toHaveProperty("thumbnail_url");
  });

  it("clamps maxwidth to [220, 550] and defaults garbage to 550", async () => {
    const { ctx } = await boot(stubEmbedTwitter(makeTweet()));
    const width = async (maxwidth: string): Promise<unknown> =>
      (
        await ctx.server.inject({
          url: `/api/oembed?url=https%3A%2F%2Fx.com%2Fnasa%2Fstatus%2F1001&maxwidth=${maxwidth}`,
        })
      ).json<Record<string, unknown>>().width;

    expect(await width("100")).toBe(220);
    expect(await width("9999")).toBe(550);
    expect(await width("abc")).toBe(550);
    expect(await width("400")).toBe(400);
  });

  it("answers the oEmbed error triage verbatim", async () => {
    const { ctx } = await boot(stubEmbedTwitter(makeTweet()));

    const xml = await ctx.server.inject({
      url: "/api/oembed?url=https%3A%2F%2Fx.com%2Fnasa%2Fstatus%2F1001&format=xml",
    });
    expect(xml.status).toBe(501);
    expect(xml.body).toBe("Only JSON format is supported");

    const noUrl = await ctx.server.inject({ url: "/api/oembed" });
    expect(noUrl.status).toBe(400);
    expect(noUrl.body).toBe("Missing url parameter");

    const bad = await ctx.server.inject({ url: "/api/oembed?url=https%3A%2F%2Fexample.com%2Ffoo" });
    expect(bad.status).toBe(400);
    expect(bad.body).toBe("Invalid tweet URL");

    const missing = await ctx.server.inject({
      url: "/api/oembed?url=https%3A%2F%2Fx.com%2Fnasa%2Fstatus%2F9999",
    });
    expect(missing.status).toBe(404);
    expect(missing.body).toBe("");
  });

  it("renders markup in usernames and pre-escaped tweet text escaped (XSS)", async () => {
    const evil = makeUser({ fullname: "<script>alert(1)</script>" });
    const tweet = makeTweet({
      user: evil,
      text: "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;",
    });
    const { ctx } = await boot(stubEmbedTwitter(tweet));

    const res = await ctx.server.inject({ url: "/nasa/status/1001/embed" });
    expect(res.status).toBe(200);
    expect(res.body).not.toContain("<script>alert");
    expect(res.body).toContain("&lt;script&gt;");
  });

  it("unloads cleanly: every embed route answers 404", async () => {
    const { ctx, unload } = await boot(stubEmbedTwitter(videoTweet()));
    expect((await ctx.server.inject({ url: "/i/videos/tweet/1001" })).status).toBe(200);
    expect((await ctx.server.inject({ url: "/nasa/status/1001/embed" })).status).toBe(200);
    expect((await ctx.server.inject({ url: "/i/status/1001/embed" })).status).toBe(200);
    expect((await ctx.server.inject({ url: "/embed/Tweet.html?id=1" })).status).toBe(302);
    expect((await ctx.server.inject({ url: "/api/oembed?url=x" })).status).toBe(400);

    await unload();
    for (const url of [
      "/i/videos/tweet/1001",
      "/nasa/status/1001/embed",
      "/i/status/1001/embed",
      "/embed/Tweet.html?id=1",
      "/api/oembed?url=x",
    ]) {
      expect((await ctx.server.inject({ url })).status, url).toBe(404);
    }
  });
});

describe("embed url parsing", () => {
  it("parses the twitter prefixes", () => {
    for (const host of [
      "twitter.com",
      "x.com",
      "mobile.twitter.com",
      "www.twitter.com",
      "www.x.com",
    ]) {
      expect(
        parseTweetUrl(`https://${host}/nasa/status/1001`, { hostname: "nitter.example" }),
      ).toEqual({ username: "nasa", id: "1001" });
      expect(
        parseTweetUrl(`http://${host}/nasa/statuses/1001`, { hostname: "nitter.example" }),
      ).toEqual({ username: "nasa", id: "1001" });
    }
  });

  it("parses the configured hostname prefix", () => {
    expect(
      parseTweetUrl("https://nitter.example/nasa/status/1001", { hostname: "nitter.example" }),
    ).toEqual({ username: "nasa", id: "1001" });
  });

  it("falls back to host-stripping when the host differs from the config", () => {
    expect(
      parseTweetUrl("https://localhost:8080/nasa/status/1001", { hostname: "nitter.example" }),
    ).toEqual({ username: "nasa", id: "1001" });
    expect(
      parseTweetUrl("proxy.example/nasa/statuses/1001", { hostname: "nitter.example" }),
    ).toEqual({ username: "nasa", id: "1001" });
  });

  it("strips query and fragment from the id and rejects non-digits", () => {
    expect(parseTweetPath("nasa/status/1001?x=1")).toEqual({ username: "nasa", id: "1001" });
    expect(parseTweetPath("nasa/status/1001#m")).toEqual({ username: "nasa", id: "1001" });
    expect(parseTweetPath("nasa/status/abc")).toEqual({ username: "", id: "" });
    expect(parseTweetPath("nasa/other/1001")).toEqual({ username: "", id: "" });
    expect(parseTweetPath("nasa/status/")).toEqual({ username: "", id: "" });
    expect(
      parseTweetUrl("https://example.com/no/tweet/here", { hostname: "nitter.example" }),
    ).toEqual({ username: "", id: "" });
  });
});
