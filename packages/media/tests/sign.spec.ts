import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  decodeSegment,
  decodeUrl,
  decodeUrlSafeBase64,
  encodeUrl,
  encodeUrlSafeBase64,
  isTwitterUrl,
  MediaSignerImpl,
  mediaEtag,
  normalizeImgUrl,
} from "../src/index.ts";

describe("twitter URL allowlist", () => {
  it("accepts the allowlisted media hosts", () => {
    for (const host of [
      "https://pbs.twimg.com/media/abc.jpg",
      "https://abs.twimg.com/sticky/default_profile_images/default_profile.png",
      "https://video.twimg.com/x.m3u8",
      "https://twimg.com/x",
      "https://x.com/x",
      "http://pic.twitter.com/x",
    ]) {
      expect(isTwitterUrl(host), host).toBe(true);
    }
  });

  it("accepts the .video.pscp.tv suffix but not a lookalike host", () => {
    expect(isTwitterUrl("https://foo.video.pscp.tv/x.mp4")).toBe(true);
    expect(isTwitterUrl("https://evil-video.pscp.tv.attacker.com/x.mp4")).toBe(false);
  });

  it("rejects non-twitter hosts, non-http schemes, and junk (the #1411 guard)", () => {
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost:8080/",
      "http://127.0.0.1/",
      "http://10.0.0.1/",
      "http://attacker.com/",
      "https://pbs.twimg.com.attacker.com/x.jpg",
      "https://evilpbs.twimg.com.attacker.test/x",
      "file:///etc/passwd",
      "gopher://twimg.com/",
      "not a url",
      "",
    ]) {
      expect(isTwitterUrl(url), url).toBe(false);
    }
  });
});

describe("normalizeImgUrl", () => {
  it("expands bare twimg paths", () => {
    expect(normalizeImgUrl("media/abc.jpg")).toBe("https://pbs.twimg.com/media/abc.jpg");
    expect(normalizeImgUrl("/media/abc.jpg")).toBe("https://pbs.twimg.com//media/abc.jpg");
  });

  it("keeps a host that already mentions twimg.com", () => {
    expect(normalizeImgUrl("abs.twimg.com/x.png")).toBe("https://abs.twimg.com/x.png");
  });

  it("leaves anything already starting with http alone", () => {
    expect(normalizeImgUrl("https://pbs.twimg.com/a.jpg")).toBe("https://pbs.twimg.com/a.jpg");
    expect(normalizeImgUrl("http://pbs.twimg.com/a.jpg")).toBe("http://pbs.twimg.com/a.jpg");
  });
});

describe("segment encodings", () => {
  it("percent-encodes a media URL and round-trips it", () => {
    const url = "https://pbs.twimg.com/media/AbC123.jpg?format=jpg&name=small";
    const encoded = encodeUrl(url);
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("?");
    expect(decodeUrl(encoded)).toBe(url);
  });

  it("uses URL-safe base64 in the enc variant, padding included", () => {
    const bytes = Buffer.from([0xfb, 0xff]);
    expect(bytes.toString("base64")).toBe("+/8=");
    expect(bytes.toString("base64url")).toBe("-_8");
    expect(Buffer.from("-_8=", "base64").equals(bytes)).toBe(true);
    expect(Buffer.from("+/8=", "base64").equals(bytes)).toBe(true);
  });

  it("round-trips a UTF-8 URL through the enc variant", () => {
    const url = "https://video.twimg.com/ext_tw_video/1/pu/pl/seg01.m4s?name=1";
    expect(decodeUrlSafeBase64(encodeUrlSafeBase64(url))).toBe(url);
  });

  it("round-trips a URL containing a literal + (percent variant)", () => {
    const url = "https://pbs.twimg.com/media/a+b.jpg";
    const encoded = encodeUrl(url);
    expect(encoded).toContain("%2B");
    expect(decodeUrl(encoded)).toBe(url);
  });

  it("leaves % escapes alone for the percent variant (params arrive decoded)", () => {
    for (const url of [
      "https://pbs.twimg.com/media/a%2Fb.jpg",
      "https://pbs.twimg.com/media/a%20b.jpg",
      "https://pbs.twimg.com/media/%E4%B8%AD%E6%96%87.jpg",
    ]) {
      expect(decodeSegment(url, "percent")).toBe(url);
    }
  });

  it("still base64-decodes the enc variant", () => {
    const url = "https://pbs.twimg.com/media/a%2Fb.jpg";
    expect(decodeSegment(encodeUrlSafeBase64(url), "enc")).toBe(url);
  });
});

describe("mediaEtag", () => {
  it("is stable across calls and distinct per URL", () => {
    const a = "https://pbs.twimg.com/media/a.jpg";
    const b = "https://pbs.twimg.com/media/b.jpg";
    expect(mediaEtag(a)).toBe(mediaEtag(a));
    expect(mediaEtag(a)).not.toBe(mediaEtag(b));
  });
  describe("MediaSignerImpl", () => {
    it("signs with a 13-char hex prefix of HMAC-SHA256", () => {
      const signer = new MediaSignerImpl({ hmacKey: "hunter2" });
      const sig = signer.sign("https://video.twimg.com/x.m3u8");
      expect(sig).toMatch(/^[0-9a-f]{13}$/);
      expect(sig).toBe(
        new MediaSignerImpl({ hmacKey: "hunter2" }).sign("https://video.twimg.com/x.m3u8"),
      );
      expect(sig).not.toBe(
        new MediaSignerImpl({ hmacKey: "other" }).sign("https://video.twimg.com/x.m3u8"),
      );
    });

    it("verifies its own signatures and rejects tampered ones", () => {
      const signer = new MediaSignerImpl({ hmacKey: "hunter2" });
      const url = "https://video.twimg.com/seg.m4s";
      const sig = signer.sign(url);
      expect(signer.verify(url, sig)).toBe(true);
      expect(signer.verify(`${url}x`, sig)).toBe(false);
      expect(signer.verify(url, "fffffffffffff")).toBe(false);
      expect(signer.verify(url, "")).toBe(false);
      expect(signer.verify(url, `${sig}extra`)).toBe(false);
      expect(new MediaSignerImpl({ hmacKey: "nope" }).verify(url, sig)).toBe(false);
    });

    it("builds percent-encoded pic links by default", () => {
      const signer = new MediaSignerImpl({ hmacKey: "k" });
      const url = "https://pbs.twimg.com/media/a.jpg";
      expect(signer.picUrl(url)).toBe(`/pic/${encodeUrl(url)}`);
      expect(signer.origPicUrl(url)).toBe(`/pic/orig/${encodeUrl(url)}`);
      expect(signer.base64Media).toBe(false);
    });

    it("builds /enc/ links when base64Media is on", () => {
      const signer = new MediaSignerImpl({ hmacKey: "k", base64Media: true });
      const url = "https://pbs.twimg.com/media/a.jpg";
      const enc = encodeUrlSafeBase64(url);
      expect(signer.picUrl(url)).toBe(`/pic/enc/${enc}`);
      expect(signer.origPicUrl(url)).toBe(`/pic/orig/enc/${enc}`);
    });

    it("signs vidUrl links in both modes", () => {
      const url = "https://video.twimg.com/x.m3u8";
      const percent = new MediaSignerImpl({ hmacKey: "k" });
      const enc = new MediaSignerImpl({ hmacKey: "k", base64Media: true });
      expect(percent.vidUrl(url)).toBe(`/video/${percent.sign(url)}/${encodeUrl(url)}`);
      expect(enc.vidUrl(url)).toBe(`/video/enc/${enc.sign(url)}/${encodeUrlSafeBase64(url)}`);
    });

    it("returns an empty link for empty input (nitter leaves the href alone)", () => {
      const signer = new MediaSignerImpl({ hmacKey: "k" });
      expect(signer.picUrl("")).toBe("");
      expect(signer.origPicUrl("")).toBe("");
      expect(signer.vidUrl("")).toBe("");
    });
  });

  it("produces a fixed-width hex token safe to put in a header", () => {
    expect(mediaEtag("https://pbs.twimg.com/media/a.jpg")).toMatch(/^[0-9a-f]{8}$/);
  });
});
