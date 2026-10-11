/** Space route plugin tests — fastify `inject` against a context with a
 * stubbed `ctx.twitter` and a scripted manifest fetcher, proving the seams are
 * real (plan §6). */

import { Buffer } from "node:buffer";
import type { MediaFetcher, MediaFetchResponse } from "@tseer/media";
import { prefsPlugin } from "@tseer/prefs";
import { serverPlugin } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import type { AudioSpace } from "@tseer/types";
import { RateLimitError, VerifiedType } from "@tseer/types";
import { renderPlugin } from "@tseer/views";
import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";
import type { SpacePluginOptions } from "../src/space.ts";
import { default as spacePlugin } from "../src/space.ts";

const M3U8 = "https://video.twimg.com/spaces/main.m3u8";

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

function makeSpace(overrides: Partial<AudioSpace> = {}): AudioSpace {
  return {
    id: "1yNGaLwepgeJB",
    title: "Starship update",
    state: "NotRunning",
    mediaKey: "media-key",
    m3u8Url: "",
    totalLiveListeners: 100,
    totalReplayWatched: 0,
    startTime: "",
    endTime: "",
    availableForReplay: false,
    creator: makeUser(),
    admins: [],
    speakers: [],
    ...overrides,
  };
}

/** A `MediaFetcher` scripted per URL — the manifest source the space plugin's
 * `safeFetchText` runs against (no test ever reaches the network). */
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

function stubSpaceTwitter(space: AudioSpace | undefined, extra = {}): TwitterApi {
  return {
    cachedSpace: vi.fn(async () => space),
    ...extra,
  } as unknown as TwitterApi;
}

async function boot(
  twitter: TwitterApi,
  options: SpacePluginOptions = {},
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
  const fiber = await ctx.plugin(spacePlugin, options);
  return { ctx, unload: () => fiber.dispose() };
}

function bootStream(
  space: AudioSpace | undefined,
  manifest: { status: number; body?: string },
): Promise<{ ctx: Context; unload: () => Promise<void> }> {
  return boot(stubSpaceTwitter(space), {
    fetcher: stubManifestFetcher({ [M3U8]: manifest }),
  });
}

describe("spacePlugin", () => {
  it("renders the space page with title, ogTitle, and prefs", async () => {
    const twitter = stubSpaceTwitter(makeSpace({ state: "RUNNING", m3u8Url: M3U8 }));
    const { ctx } = await boot(twitter, { fetcher: stubManifestFetcher({}) });

    const res = await ctx.server.inject({ url: "/i/spaces/1yNGaLwepgeJB?hlsPlayback=on" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<title>Starship update | nitter</title>");
    expect(res.body).toContain('<meta property="og:title" content="Starship update"');
    expect(res.body).toContain('onclick="playAudio(this)"');
    expect(res.body).toContain('<div class="space-live">LIVE</div>');
    expect(twitter.cachedSpace).toHaveBeenCalledWith("1yNGaLwepgeJB");
  });

  it("404s non-alnum ids with the global not-found page", async () => {
    const { ctx } = await boot(stubSpaceTwitter(makeSpace()));
    for (const url of ["/i/spaces/abc.def", "/i/spaces/abc%2Fdef/stream"]) {
      const res = await ctx.server.inject({ url });
      expect(res.status, url).toBe(404);
      expect(res.body, url).toContain("Page not found");
    }
  });

  it("404s unknown spaces", async () => {
    const { ctx } = await boot(stubSpaceTwitter(undefined));
    const missing = await ctx.server.inject({ url: "/i/spaces/1yNGaLwepgeJB" });
    expect(missing.status).toBe(404);
    expect(missing.body).toContain("Space not found");

    const empty = await boot(stubSpaceTwitter(makeSpace({ id: "" })));
    const blank = await empty.ctx.server.inject({ url: "/i/spaces/1yNGaLwepgeJB" });
    expect(blank.status).toBe(404);
    expect(blank.body).toContain("Space not found");
  });

  it("falls back to the enablehls button when hls is off", async () => {
    // hlsPlayback defaults to off; the m3u8 branch then renders the form.
    const { ctx } = await boot(stubSpaceTwitter(makeSpace({ m3u8Url: M3U8 })));
    const res = await ctx.server.inject({ url: "/i/spaces/1yNGaLwepgeJB" });
    expect(res.body).not.toContain("playAudio");
    expect(res.body).toContain('action="/enablehls"');
    expect(res.body).toContain("Enable hls playback");
  });

  it("renders the unavailable-audio and unavailable-replay panels", async () => {
    const noReplay = await boot(stubSpaceTwitter(makeSpace()));
    const res = await noReplay.ctx.server.inject({ url: "/i/spaces/1yNGaLwepgeJB" });
    expect(res.body).toContain("Replay is not available");

    const noAudio = await boot(stubSpaceTwitter(makeSpace({ availableForReplay: true })));
    const res2 = await noAudio.ctx.server.inject({ url: "/i/spaces/1yNGaLwepgeJB" });
    expect(res2.body).toContain("Audio stream unavailable");
  });

  it("serves the proxified manifest with the m3u8 content type", async () => {
    const manifest = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\nseg1.ts\n';
    const { ctx } = await bootStream(makeSpace({ m3u8Url: M3U8 }), {
      status: 200,
      body: manifest,
    });

    const res = await ctx.server.inject({ url: "/i/spaces/1yNGaLwepgeJB/stream" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-mpegURL");
    // segments resolve against the manifest URL and sign through getVidUrl
    expect(res.body).toContain('/video/sig/https://video.twimg.com/spaces/init.mp4"');
    expect(res.body).toContain("/video/sig/https://video.twimg.com/spaces/seg1.ts");
  });

  it("answers a bare 404 when the space has no manifest URL", async () => {
    const { ctx } = await bootStream(makeSpace({ m3u8Url: "" }), { status: 200, body: "x" });
    const res = await ctx.server.inject({ url: "/i/spaces/1yNGaLwepgeJB/stream" });
    expect(res.status).toBe(404);
    // bare 404: no error page, and no HTML in the reply
    expect(res.body).toBe("");
  });

  it("answers a bare 502 when the manifest fetch fails", async () => {
    // dead upstream: every attempt fails, safeFetchText swallows it into ""
    const { ctx } = await bootStream(makeSpace({ m3u8Url: M3U8 }), { status: 500 });
    const res = await ctx.server.inject({ url: "/i/spaces/1yNGaLwepgeJB/stream" });
    expect(res.status).toBe(502);
    expect(res.body).toBe("");
  });

  it("answers a bare 502 when the manifest is off-allowlist", async () => {
    // isTwitterUrl rejects the URL before any fetch — the same swallow, and
    // the fetcher is never called.
    const off = "https://evil.example/main.m3u8";
    const fetcher = stubManifestFetcher({ [off]: { status: 200, body: "#EXTM3U" } });
    const { ctx } = await boot(stubSpaceTwitter(makeSpace({ m3u8Url: off })), { fetcher });
    const res = await ctx.server.inject({ url: "/i/spaces/1yNGaLwepgeJB/stream" });
    expect(res.status).toBe(502);
  });

  it("maps rate limits to a 429 page", async () => {
    const twitter = stubSpaceTwitter(undefined, {
      cachedSpace: vi.fn(async () => {
        throw new RateLimitError("limited");
      }),
    });
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/i/spaces/1yNGaLwepgeJB" });
    expect(res.status).toBe(429);
    expect(res.body).toContain("rate limited");
  });

  it("unloads cleanly: disposed routes answer 404", async () => {
    const { ctx, unload } = await boot(stubSpaceTwitter(makeSpace()));
    expect((await ctx.server.inject({ url: "/i/spaces/1yNGaLwepgeJB" })).status).toBe(200);
    await unload();
    expect((await ctx.server.inject({ url: "/i/spaces/1yNGaLwepgeJB" })).status).toBe(404);
    expect((await ctx.server.inject({ url: "/i/spaces/1yNGaLwepgeJB/stream" })).status).toBe(404);
  });
});
