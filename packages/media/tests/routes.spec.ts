import { serverPlugin } from "@tseer/server";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";
import {
  encodeUrl,
  encodeUrlSafeBase64,
  MediaSignerImpl,
  mediaEtag,
  mediaPlugin,
  mediaRoutePlugin,
} from "../src/index.ts";
import { StubFetcher } from "./stub-fetcher.ts";

const HMAC_KEY = "test-key";
const IMAGE = "https://pbs.twimg.com/media/a.jpg";
const SEGMENT = "https://video.twimg.com/ext_tw_video/1/pu/pl/seg01.m4s";
const MANIFEST = "https://video.twimg.com/ext_tw_video/1/pu/pl/index.m3u8";

const signer = new MediaSignerImpl({ hmacKey: HMAC_KEY });
/** The same signer with `config.base64Media = true`, for the `/enc/` routes. */
const encSigner = new MediaSignerImpl({ hmacKey: HMAC_KEY, base64Media: true });

/** A context with the server + signing plugins mounted and routes registered. */
async function mount(options: { fetcher?: StubFetcher; base64Media?: boolean } = {}) {
  const fetcher = options.fetcher ?? new StubFetcher();
  const ctx = new Context();
  await ctx.plugin(serverPlugin, { port: 0 });
  await ctx.plugin(mediaPlugin, {
    hmacKey: HMAC_KEY,
    base64Media: options.base64Media ?? false,
  });
  await ctx.plugin(mediaRoutePlugin, { fetcher });
  return { ctx, fetcher };
}

describe("pic routes", () => {
  it("proxies an image and forwards the upstream content type", async () => {
    const fetcher = new StubFetcher({
      responses: { [IMAGE]: { headers: { "content-type": "image/jpeg" }, body: "JPEG" } },
    });
    const { ctx } = await mount({ fetcher });
    const res = await ctx.server.inject({ url: signer.picUrl(IMAGE) });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
    expect(res.body).toBe("JPEG");
    expect(res.headers["cache-control"]).toBe("max-age=604800");
    expect(res.headers["etag"]).toBe(mediaEtag(IMAGE));
  });

  it("404s the bare /pic prefix", async () => {
    const { ctx } = await mount();
    expect((await ctx.server.inject({ url: "/pic" })).status).toBe(404);
  });

  it("appends ?name=orig only for the /pic/orig route", async () => {
    const fetcher = new StubFetcher({
      responses: {
        [`${IMAGE}?name=orig`]: { headers: { "content-type": "image/jpeg" }, body: "ORIG" },
        [IMAGE]: { headers: { "content-type": "image/jpeg" }, body: "SMALL" },
      },
    });
    const { ctx } = await mount({ fetcher });
    expect((await ctx.server.inject({ url: signer.origPicUrl(IMAGE) })).body).toBe("ORIG");
    expect((await ctx.server.inject({ url: signer.picUrl(IMAGE) })).body).toBe("SMALL");
  });

  it("serves /enc/ links when base64Media is on", async () => {
    const fetcher = new StubFetcher({
      responses: { [IMAGE]: { headers: { "content-type": "image/jpeg" }, body: "JPEG" } },
    });
    const { ctx } = await mount({ fetcher, base64Media: true });
    const url = encSigner.picUrl(IMAGE);
    expect(url).toBe(`/pic/enc/${encodeUrlSafeBase64(IMAGE)}`);
    expect((await ctx.server.inject({ url })).body).toBe("JPEG");
  });

  it("answers 304 when If-None-Match matches, without a body", async () => {
    const fetcher = new StubFetcher({
      responses: { [IMAGE]: { headers: { "content-type": "image/jpeg" }, body: "JPEG" } },
    });
    const { ctx } = await mount({ fetcher });
    const res = await ctx.server.inject({
      url: signer.picUrl(IMAGE),
      headers: { "if-none-match": mediaEtag(IMAGE) },
    });
    expect(res.status).toBe(304);
    expect(res.body).toBe("");
    // A stale validator must not produce a 304.
    const stale = await ctx.server.inject({
      url: signer.picUrl(IMAGE),
      headers: { "if-none-match": "deadbeef" },
    });
    expect(stale.status).toBe(200);
  });

  it("404s a non-twitter URL (the #1411 guard)", async () => {
    const fetcher = new StubFetcher();
    const { ctx } = await mount({ fetcher });
    for (const evil of [
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost:8080/",
      "http://attacker.com/x.jpg",
    ]) {
      const res = await ctx.server.inject({ url: signer.picUrl(evil) });
      expect(res.status, evil).toBe(404);
    }
    // Nothing off-allowlist was ever fetched.
    expect(fetcher.calls).toEqual([]);
  });

  it("404s an amplify_video path (nitter rejects these)", async () => {
    const fetcher = new StubFetcher();
    const { ctx } = await mount({ fetcher });
    const amp = "https://video.twimg.com/amplify_video/123/seg.mp4";
    expect((await ctx.server.inject({ url: signer.picUrl(amp) })).status).toBe(404);
    expect(fetcher.calls).toEqual([]);
  });

  it("normalizes a bare twimg path before fetching", async () => {
    const fetcher = new StubFetcher({
      responses: { [IMAGE]: { headers: { "content-type": "image/jpeg" }, body: "JPEG" } },
    });
    const { ctx } = await mount({ fetcher });
    const res = await ctx.server.inject({ url: signer.picUrl("media/a.jpg") });
    expect(res.status).toBe(200);
    expect(fetcher.calls).toEqual([IMAGE]);
  });
});

describe("video routes", () => {
  it("proxies a signed segment", async () => {
    const fetcher = new StubFetcher({
      responses: { [SEGMENT]: { headers: { "content-type": "video/mp4" }, body: "BYTES" } },
    });
    const { ctx } = await mount({ fetcher });
    const res = await ctx.server.inject({ url: signer.vidUrl(SEGMENT) });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("video/mp4");
    expect(res.body).toBe("BYTES");
  });

  it("403s a bad signature", async () => {
    const fetcher = new StubFetcher({
      responses: { [SEGMENT]: { body: "BYTES" } },
    });
    const { ctx } = await mount({ fetcher });
    const tampered = signer
      .vidUrl(SEGMENT)
      .replace(/^\/video\/[0-9a-f]{13}\//, "/video/0000000000000/");
    const res = await ctx.server.inject({ url: tampered });
    expect(res.status).toBe(403);
    // Crucially, nothing is fetched for an unverifiable request.
    expect(fetcher.calls).toEqual([]);
  });

  it("403s a valid signature applied to a different URL", async () => {
    const other = "https://video.twimg.com/ext_tw_video/1/pu/pl/seg02.m4s";
    const fetcher = new StubFetcher({
      responses: { [SEGMENT]: { body: "BYTES" }, [other]: { body: "OTHER" } },
    });
    const { ctx } = await mount({ fetcher });
    // Right signature, wrong payload: the HMAC binds the URL.
    const forged = `/video/${signer.sign(SEGMENT)}/${encodeUrl(other)}`;
    expect((await ctx.server.inject({ url: forged })).status).toBe(403);
    expect(fetcher.calls).toEqual([]);
  });

  it("403s a non-twitter URL even with a valid signature", async () => {
    const fetcher = new StubFetcher();
    const { ctx } = await mount({ fetcher });
    const evil = "http://169.254.169.254/latest/meta-data/";
    expect((await ctx.server.inject({ url: signer.vidUrl(evil) })).status).toBe(403);
    expect(fetcher.calls).toEqual([]);
  });

  it("rewrites an m3u8 into signed segment links", async () => {
    const playlist = [
      "#EXTM3U",
      "#EXT-X-TARGETDURATION:4",
      "#EXTINF:4.000,",
      "/ext_tw_video/1/pu/pl/seg01.m4s",
      "#EXT-X-ENDLIST",
    ].join("\n");
    const fetcher = new StubFetcher({
      responses: {
        [MANIFEST]: { headers: { "content-type": "text/plain" }, body: playlist },
        [SEGMENT]: { headers: { "content-type": "video/mp4" }, body: "BYTES" },
      },
    });
    const { ctx } = await mount({ fetcher });
    const res = await ctx.server.inject({ url: signer.vidUrl(MANIFEST) });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/vnd.apple.mpegurl");
    expect(res.body).toContain("#EXTM3U");
    expect(res.body).toContain(signer.vidUrl(SEGMENT));
    // The rewritten link must itself verify through the route.
    expect((await ctx.server.inject({ url: signer.vidUrl(SEGMENT) })).status).toBe(200);
  });

  it("follows a vmap to its m3u8 and rewrites that", async () => {
    const vmapUrl = "https://video.twimg.com/ext_tw_video/1/vmap.vmap";
    const fetcher = new StubFetcher({
      responses: {
        [vmapUrl]: { body: `<video url="${MANIFEST}">` },
        [MANIFEST]: { body: ["#EXTM3U", "/ext_tw_video/1/pu/pl/seg01.m4s"].join("\n") },
        [SEGMENT]: { body: "BYTES" },
      },
    });
    const { ctx } = await mount({ fetcher });
    const res = await ctx.server.inject({ url: signer.vidUrl(vmapUrl) });
    expect(res.status).toBe(200);
    expect(res.body).toContain(signer.vidUrl(SEGMENT));
    expect(fetcher.calls).toEqual([vmapUrl, MANIFEST]);
  });

  it("leaves segments absolute when proxyVideos is off", async () => {
    const fetcher = new StubFetcher({
      responses: {
        [MANIFEST]: { body: ["#EXTM3U", "/ext_tw_video/1/pu/pl/seg01.m4s"].join("\n") },
      },
    });
    const ctx = new Context();
    await ctx.plugin(serverPlugin, { port: 0 });
    await ctx.plugin(mediaPlugin, { hmacKey: HMAC_KEY });
    await ctx.plugin(mediaRoutePlugin, { fetcher, proxyVideos: false });
    const res = await ctx.server.inject({ url: signer.vidUrl(MANIFEST) });
    expect(res.body).toContain(SEGMENT);
    expect(res.body).not.toContain("/video/");
  });

  it("404s a dead manifest instead of erroring", async () => {
    const fetcher = new StubFetcher({ responses: { [MANIFEST]: { status: 404 } } });
    const { ctx } = await mount({ fetcher });
    expect((await ctx.server.inject({ url: signer.vidUrl(MANIFEST) })).status).toBe(404);
  });

  it("404s a vmap with no m3u8 reference", async () => {
    const vmapUrl = "https://video.twimg.com/ext_tw_video/1/vmap.vmap";
    const fetcher = new StubFetcher({ responses: { [vmapUrl]: { body: "<html></html>" } } });
    const { ctx } = await mount({ fetcher });
    expect((await ctx.server.inject({ url: signer.vidUrl(vmapUrl) })).status).toBe(404);
  });

  it("serves /video/enc/ links when base64Media is on", async () => {
    const fetcher = new StubFetcher({
      responses: { [SEGMENT]: { headers: { "content-type": "video/mp4" }, body: "BYTES" } },
    });
    const { ctx } = await mount({ fetcher, base64Media: true });
    const url = encSigner.vidUrl(SEGMENT);
    expect(url).toBe(`/video/enc/${encSigner.sign(SEGMENT)}/${encodeUrlSafeBase64(SEGMENT)}`);
    expect((await ctx.server.inject({ url })).body).toBe("BYTES");
  });
});
describe("plugin lifecycle", () => {
  it("provides ctx.media and unwinds it on dispose", async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(mediaPlugin, { hmacKey: "k" });
    expect(ctx.get("media")).toBeDefined();
    await fiber.dispose();
    expect(ctx.get("media")).toBeUndefined();
  });

  it("removes the media routes when the route plugin is disposed", async () => {
    const fetcher = new StubFetcher({
      responses: { [IMAGE]: { headers: { "content-type": "image/jpeg" }, body: "JPEG" } },
    });
    const ctx = new Context();
    await ctx.plugin(serverPlugin, { port: 0 });
    await ctx.plugin(mediaPlugin, { hmacKey: HMAC_KEY });
    const fiber = await ctx.plugin(mediaRoutePlugin, { fetcher });
    const url = signer.picUrl(IMAGE);
    expect((await ctx.server.inject({ url })).status).toBe(200);
    await fiber.dispose();
    // Disposed routes fall through to the server's 404.
    expect((await ctx.server.inject({ url })).status).toBe(404);
  });

  it("does not close a fetcher it was handed", async () => {
    const fetcher = new StubFetcher();
    const ctx = new Context();
    await ctx.plugin(serverPlugin, { port: 0 });
    await ctx.plugin(mediaPlugin, { hmacKey: HMAC_KEY });
    const fiber = await ctx.plugin(mediaRoutePlugin, { fetcher });
    await fiber.dispose();
    // Ownership stayed with the caller.
    expect(fetcher.isClosed).toBe(false);
  });

  it("throws a helpful error when its dependencies are missing", async () => {
    // Call the plugin body directly rather than through `ctx.plugin`: cordis
    // wraps a sync throw into a rejection value that vitest cannot format, and
    // these guards are plain `throw`s, so a direct call is the honest check.
    const bare = new Context();
    expect(() => mediaRoutePlugin(bare, { fetcher: new StubFetcher() })).toThrow(
      /ctx\.server is not mounted/,
    );

    const noMedia = new Context();
    await noMedia.plugin(serverPlugin, { port: 0 });
    expect(() => mediaRoutePlugin(noMedia, { fetcher: new StubFetcher() })).toThrow(
      /ctx\.media is not mounted/,
    );
  });
});
