import { Buffer } from "node:buffer";
import type { MediaFetcher, MediaFetchResponse } from "@tseer/media";
import { prefsPlugin } from "@tseer/prefs";
import { serverPlugin } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import type { Broadcast } from "@tseer/types";
import { RateLimitError, VerifiedType } from "@tseer/types";
import { renderPlugin } from "@tseer/views";
import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";
import type { BroadcastPluginOptions } from "../src/broadcast.ts";
import { default as broadcastPlugin } from "../src/broadcast.ts";

const M3U8 = "https://video.twimg.com/broadcast/main.m3u8";

function makeUser(username = "nasa") {
  return {
    id: "1234",
    username,
    fullname: "NASA",
    location: "",
    website: "",
    bio: "space posts",
    userPic: "https://pbs.twimg.com/profile_images/nasa_normal.jpg",
    banner: "",
    pinnedTweet: "",
    following: 10,
    followers: 1234,
    tweets: 5678,
    likes: 9,
    media: 0,
    verifiedType: VerifiedType.None,
    protected: false,
    suspended: false,
    joinDate: "",
  };
}

function makeBroadcast(overrides: Partial<Broadcast> = {}): Broadcast {
  return {
    id: "1yNGaLwepgeJB",
    title: "Starship launch",
    state: "ENDED",
    thumb: "https://pbs.twimg.com/broadcast/thumb.jpg",
    mediaKey: "media-key",
    m3u8Url: "",
    totalWatched: 12345,
    startTime: "",
    endTime: "",
    replayStart: 0,
    availableForReplay: false,
    user: makeUser(),
    ...overrides,
  };
}

function stubManifestFetcher(
  responses: Record<string, { status: number; body?: string }>,
): MediaFetcher {
  return {
    async fetch(url: string): Promise<MediaFetchResponse> {
      const spec = responses[url] ?? { status: 404 };
      const chunks = spec.body === undefined ? [] : [Buffer.from(spec.body, "utf8")];
      return {
        status: spec.status,
        headers: {},
        body: {
          async *[Symbol.asyncIterator]() {
            for (const chunk of chunks) yield chunk;
          },
        },
        abort() {},
      };
    },
    async close() {},
  };
}

function stubBroadcastTwitter(broadcast: Broadcast | undefined, extra = {}): TwitterApi {
  return {
    cachedBroadcast: vi.fn(async () => broadcast),
    ...extra,
  } as unknown as TwitterApi;
}

async function boot(
  twitter: TwitterApi,
  options: BroadcastPluginOptions = {},
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
  const fiber = await ctx.plugin(broadcastPlugin, options);
  return { ctx, unload: () => fiber.dispose() };
}

function bootStream(
  broadcast: Broadcast | undefined,
  manifest: { status: number; body?: string },
): Promise<{ ctx: Context; unload: () => Promise<void> }> {
  return boot(stubBroadcastTwitter(broadcast), {
    fetcher: stubManifestFetcher({ [M3U8]: manifest }),
  });
}

describe("broadcastPlugin", () => {
  it("renders the live broadcast page with title, ogTitle, and prefs", async () => {
    const twitter = stubBroadcastTwitter(makeBroadcast({ state: "RUNNING", m3u8Url: M3U8 }));
    const { ctx } = await boot(twitter, { fetcher: stubManifestFetcher({}) });

    const res = await ctx.server.inject({ url: "/i/broadcasts/1yNGaLwepgeJB?hlsPlayback=on" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<title>Starship launch | nitter</title>");
    expect(res.body).toContain('<meta property="og:title" content="Starship launch"');
    expect(res.body).toContain('<video poster="/pic/https://pbs.twimg.com/broadcast/thumb.jpg"');
    expect(res.body).toContain('data-start="0"');
    expect(res.body).toContain('onclick="playVideo(this)"');
    expect(res.body).toContain('<div class="broadcast-live">LIVE</div>');
    expect(res.body).toContain('href="/nasa"');
    expect(res.body).toContain("@nasa");
    expect(twitter.cachedBroadcast).toHaveBeenCalledWith("1yNGaLwepgeJB");
  });

  it("shows view counts and the replay duration minus replayStart", async () => {
    const ended = makeBroadcast({
      state: "ENDED",
      m3u8Url: M3U8,
      startTime: "2026-10-01T00:00:00.000Z",
      endTime: "2026-10-01T01:05:00.000Z",
      replayStart: 60,
    });
    const { ctx } = await boot(stubBroadcastTwitter(ended), {
      fetcher: stubManifestFetcher({}),
    });

    const res = await ctx.server.inject({ url: "/i/broadcasts/1yNGaLwepgeJB?hlsPlayback=on" });
    expect(res.body).toContain("12,345 views");
    expect(res.body).toContain("Ended Oct 1, 2026");
    expect(res.body).toContain('<div class="overlay-duration">1:04:00</div>');
  });

  it("404s non-alnum ids with the global not-found page", async () => {
    const { ctx } = await boot(stubBroadcastTwitter(makeBroadcast()));
    for (const url of ["/i/broadcasts/abc.def", "/i/broadcasts/abc%2Fdef/stream"]) {
      const res = await ctx.server.inject({ url });
      expect(res.status, url).toBe(404);
      expect(res.body, url).toContain("Page not found");
    }
  });

  it("404s unknown broadcasts", async () => {
    const { ctx } = await boot(stubBroadcastTwitter(undefined));
    const missing = await ctx.server.inject({ url: "/i/broadcasts/1yNGaLwepgeJB" });
    expect(missing.status).toBe(404);
    expect(missing.body).toContain("Broadcast not found");

    const empty = await boot(stubBroadcastTwitter(makeBroadcast({ id: "" })));
    const blank = await empty.ctx.server.inject({ url: "/i/broadcasts/1yNGaLwepgeJB" });
    expect(blank.status).toBe(404);
    expect(blank.body).toContain("Broadcast not found");
  });

  it("falls back to the enablehls button when hls is off", async () => {
    const { ctx } = await boot(
      stubBroadcastTwitter(makeBroadcast({ m3u8Url: M3U8, availableForReplay: true })),
    );
    const res = await ctx.server.inject({ url: "/i/broadcasts/1yNGaLwepgeJB" });
    expect(res.body).not.toContain("playVideo");
    expect(res.body).toContain('action="/enablehls"');
    expect(res.body).toContain("Enable hls playback");
  });

  it("renders the stream-unavailable and replay-not-available panels", async () => {
    const noReplay = await boot(stubBroadcastTwitter(makeBroadcast()));
    const res = await noReplay.ctx.server.inject({ url: "/i/broadcasts/1yNGaLwepgeJB" });
    expect(res.body).toContain("Replay is not available");

    const replayable = await boot(
      stubBroadcastTwitter(makeBroadcast({ availableForReplay: true })),
    );
    const res2 = await replayable.ctx.server.inject({ url: "/i/broadcasts/1yNGaLwepgeJB" });
    expect(res2.body).toContain("Stream unavailable");
  });

  it("renders the broadcast-not-found panel when there is no thumbnail", async () => {
    const { ctx } = await boot(
      stubBroadcastTwitter(makeBroadcast({ thumb: "", availableForReplay: true })),
    );
    const res = await ctx.server.inject({ url: "/i/broadcasts/1yNGaLwepgeJB" });
    expect(res.body).toContain("Broadcast not found");
  });

  it("serves the proxified manifest with the m3u8 content type", async () => {
    const manifest = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\nseg1.ts\n';
    const { ctx } = await bootStream(makeBroadcast({ m3u8Url: M3U8 }), {
      status: 200,
      body: manifest,
    });

    const res = await ctx.server.inject({ url: "/i/broadcasts/1yNGaLwepgeJB/stream" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-mpegURL");
    expect(res.body).toContain('/video/sig/https://video.twimg.com/broadcast/init.mp4"');
    expect(res.body).toContain("/video/sig/https://video.twimg.com/broadcast/seg1.ts");
  });

  it("answers a bare 404 when the broadcast has no manifest URL", async () => {
    const { ctx } = await bootStream(makeBroadcast({ m3u8Url: "" }), {
      status: 200,
      body: "x",
    });
    const res = await ctx.server.inject({ url: "/i/broadcasts/1yNGaLwepgeJB/stream" });
    expect(res.status).toBe(404);
    expect(res.body).toBe("");
  });

  it("answers a bare 502 when the manifest fetch fails", async () => {
    const { ctx } = await bootStream(makeBroadcast({ m3u8Url: M3U8 }), { status: 500 });
    const res = await ctx.server.inject({ url: "/i/broadcasts/1yNGaLwepgeJB/stream" });
    expect(res.status).toBe(502);
    expect(res.body).toBe("");
  });

  it("answers a bare 502 when the manifest is off-allowlist", async () => {
    const off = "https://evil.example/main.m3u8";
    const fetcher = stubManifestFetcher({ [off]: { status: 200, body: "#EXTM3U" } });
    const { ctx } = await boot(stubBroadcastTwitter(makeBroadcast({ m3u8Url: off })), { fetcher });
    const res = await ctx.server.inject({ url: "/i/broadcasts/1yNGaLwepgeJB/stream" });
    expect(res.status).toBe(502);
  });

  it("maps broadcast fetch failures to the 404 page (verbatim except-discard)", async () => {
    const twitter = stubBroadcastTwitter(undefined, {
      cachedBroadcast: vi.fn(async () => {
        throw new RateLimitError("limited");
      }),
    });
    const { ctx } = await boot(twitter);

    const page = await ctx.server.inject({ url: "/i/broadcasts/1yNGaLwepgeJB" });
    expect(page.status).toBe(404);
    expect(page.body).toContain("Broadcast not found");

    const stream = await ctx.server.inject({ url: "/i/broadcasts/1yNGaLwepgeJB/stream" });
    expect(stream.status).toBe(404);
    expect(stream.body).toBe("");
  });

  it("unloads cleanly: disposed routes answer 404", async () => {
    const { ctx, unload } = await boot(stubBroadcastTwitter(makeBroadcast()));
    expect((await ctx.server.inject({ url: "/i/broadcasts/1yNGaLwepgeJB" })).status).toBe(200);
    await unload();
    expect((await ctx.server.inject({ url: "/i/broadcasts/1yNGaLwepgeJB" })).status).toBe(404);
    expect((await ctx.server.inject({ url: "/i/broadcasts/1yNGaLwepgeJB/stream" })).status).toBe(
      404,
    );
  });
});
