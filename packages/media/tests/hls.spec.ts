import { describe, expect, it } from "vitest";
import { getM3u8Url, MediaSignerImpl, proxifyVideo } from "../src/index.ts";

describe("getM3u8Url", () => {
  it("extracts the playlist URL from a vmap document", () => {
    const vmap = '<video id="vmap" url="https://video.twimg.com/ext_tw_video/1/pu/pl/x.m3u8">';
    expect(getM3u8Url(vmap)).toBe("https://video.twimg.com/ext_tw_video/1/pu/pl/x.m3u8");
  });

  it("returns an empty string when there is no .m3u8 reference", () => {
    expect(getM3u8Url("")).toBe("");
    expect(getM3u8Url("<html><body>nothing here</body></html>")).toBe("");
    expect(getM3u8Url('url="https://video.twimg.com/ext_tw_video/1/x.mp4"')).toBe("");
    expect(getM3u8Url('url="https://video.twimg.com/x.m3u8')).toBe("");
  });
});

describe("proxifyVideo", () => {
  const vidUrl = (url: string) => `/video/abc123/${url}`;

  it("rewrites root-relative segments against the manifest origin", () => {
    const manifest = [
      "#EXTM3U",
      "#EXT-X-TARGETDURATION:4",
      "#EXTINF:4.000,",
      "/ext_tw_video/1/pu/pl/seg1.m4s",
      "#EXTINF:4.000,",
      "/ext_tw_video/1/pu/pl/seg2.m4s",
      "#EXT-X-ENDLIST",
    ].join("\n");
    const out = proxifyVideo(manifest, {
      proxy: true,
      manifestUrl: "https://video.twimg.com/ext_tw_video/1/pu/pl/index.m3u8",
      vidUrl,
    });
    expect(out).toContain("/video/abc123/https://video.twimg.com/ext_tw_video/1/pu/pl/seg1.m4s");
    expect(out).toContain("/video/abc123/https://video.twimg.com/ext_tw_video/1/pu/pl/seg2.m4s");
    expect(out).toContain("#EXTM3U");
    expect(out).toContain("#EXT-X-ENDLIST");
  });

  it("rewrites relative segments against the manifest's directory", () => {
    const manifest = ["#EXTM3U", "#EXTINF:4.000,", "seg01.m4s"].join("\n");
    const out = proxifyVideo(manifest, {
      proxy: true,
      manifestUrl: "https://video.twimg.com/a/b/index.m3u8",
      vidUrl,
    });
    expect(out).toContain("/video/abc123/https://video.twimg.com/a/b/seg01.m4s");
  });

  it("rewrites init segments and alternate renditions", () => {
    const manifest = [
      "#EXTM3U",
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio/en.m4s"',
      '#EXT-X-MAP:URI="init.mp4"',
    ].join("\n");
    const out = proxifyVideo(manifest, {
      proxy: true,
      manifestUrl: "https://video.twimg.com/a/b/index.m3u8",
      vidUrl,
    });
    expect(out).toContain("/video/abc123/https://video.twimg.com/a/b/audio/en.m4s");
    expect(out).toContain("/video/abc123/https://video.twimg.com/a/b/init.mp4");
  });

  it("resolves absolute segments to absolute URLs when proxying is off", () => {
    const manifest = ["#EXTM3U", "/ext_tw_video/1/pu/pl/seg1.m4s"].join("\n");
    const out = proxifyVideo(manifest, {
      proxy: false,
      manifestUrl: "https://video.twimg.com/ext_tw_video/1/pu/pl/index.m3u8",
      vidUrl,
    });
    expect(out).toContain("https://video.twimg.com/ext_tw_video/1/pu/pl/seg1.m4s");
    expect(out).not.toContain("/video/");
  });

  it("falls back to the video.twimg.com origin with no manifest URL", () => {
    const manifest = ["#EXTM3U", "/ext_tw_video/1/seg1.m4s"].join("\n");
    const out = proxifyVideo(manifest, { proxy: true, vidUrl });
    expect(out).toContain("/video/abc123/https://video.twimg.com/ext_tw_video/1/seg1.m4s");
  });

  it("leaves relative segments alone when there is no directory to resolve against", () => {
    const manifest = ["#EXTM3U", "seg01.m4s"].join("\n");
    const out = proxifyVideo(manifest, { proxy: true, vidUrl });
    expect(out).toContain("seg01.m4s");
    expect(out).not.toContain("/video/");
  });

  it("does not treat comments or bare sequence numbers as URLs", () => {
    const manifest = [
      "#EXTM3U",
      "#EXT-X-MEDIA-SEQUENCE:0",
      "#EXTINF:4.000,",
      "0",
      "1",
      "#EXTINF:4.000,",
      "seg01.m4s",
    ].join("\n");
    const out = proxifyVideo(manifest, {
      proxy: true,
      manifestUrl: "https://video.twimg.com/a/b/index.m3u8",
      vidUrl,
    });
    expect(out.split("\n").filter((line) => line === "0" || line === "1")).toHaveLength(2);
    expect(out).toContain("#EXT-X-MEDIA-SEQUENCE:0");
    expect(out).toContain("/video/abc123/https://video.twimg.com/a/b/seg01.m4s");
  });

  it("emits links the signed video route can verify", () => {
    const signer = new MediaSignerImpl({ hmacKey: "test-key" });
    const manifest = ["#EXTM3U", "/ext_tw_video/1/pu/pl/seg1.m4s"].join("\n");
    const out = proxifyVideo(manifest, {
      proxy: true,
      manifestUrl: "https://video.twimg.com/ext_tw_video/1/pu/pl/index.m3u8",
      vidUrl: (url) => signer.vidUrl(url),
    });
    const segment = "https://video.twimg.com/ext_tw_video/1/pu/pl/seg1.m4s";
    expect(out.split("\n")).toContain(signer.vidUrl(segment));
    expect(out).toContain(`/video/${signer.sign(segment)}/`);
  });
});
