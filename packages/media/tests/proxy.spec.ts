import { describe, expect, it } from "vitest";
import { mediaEtag, proxyMedia, safeFetchText } from "../src/index.ts";
import { drain, StubFetcher } from "./stub-fetcher.ts";

describe("proxyMedia", () => {
  const IMAGE = "https://pbs.twimg.com/media/a.jpg";

  it("returns a 200 with the upstream body and the proxy headers", async () => {
    const fetcher = new StubFetcher({
      responses: {
        [IMAGE]: { headers: { "content-type": "image/jpeg" }, body: "JPEGDATA" },
      },
    });
    const result = await proxyMedia(IMAGE, { fetcher });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toBe("image/jpeg");
    expect(result.headers["cache-control"]).toBe("max-age=604800");
    expect(result.etag).toBe(mediaEtag(IMAGE));
    expect((await drain(result.body)).toString()).toBe("JPEGDATA");
  });

  it("lets an overridden cache-control win over the default", async () => {
    const fetcher = new StubFetcher({ responses: { [IMAGE]: { body: "x" } } });
    const result = await proxyMedia(IMAGE, { fetcher, cacheControl: "max-age=60" });
    expect(result.ok && result.headers["cache-control"]).toBe("max-age=60");
  });

  it("treats 404 as final — one attempt, no retry", async () => {
    const fetcher = new StubFetcher({ responses: { [IMAGE]: { status: 404 } } });
    const result = await proxyMedia(IMAGE, { fetcher });
    expect(result).toMatchObject({ ok: false, reason: "notFound", status: 404 });
    expect(fetcher.calls).toHaveLength(1);
  });

  it("retries a 500 up to maxAttempts, then 404s", async () => {
    const fetcher = new StubFetcher({ responses: { [IMAGE]: { status: 500 } } });
    const result = await proxyMedia(IMAGE, { fetcher });
    expect(result).toMatchObject({ ok: false, reason: "exhausted", status: 404 });
    expect(fetcher.calls).toHaveLength(3);
  });

  it("recovers when a retry succeeds", async () => {
    const fetcher = new StubFetcher({
      responses: {
        [IMAGE]: [{ status: 503 }, { status: 200, body: "late" }],
      },
    });
    const result = await proxyMedia(IMAGE, { fetcher });
    expect(result.ok).toBe(true);
    expect(fetcher.calls).toHaveLength(2);
    if (result.ok) expect((await drain(result.body)).toString()).toBe("late");
  });

  it("aborts every non-200 body so sockets are not leaked", async () => {
    const fetcher = new StubFetcher({ responses: { [IMAGE]: { status: 500 } } });
    await proxyMedia(IMAGE, { fetcher });
    expect(fetcher.aborted).toEqual([IMAGE, IMAGE, IMAGE]);
  });

  it("follows a redirect that stays on an allowlisted host", async () => {
    const target = "https://pbs.twimg.com/media/final.jpg";
    const fetcher = new StubFetcher({
      responses: {
        [IMAGE]: { status: 302, headers: { location: target } },
        [target]: { headers: { "content-type": "image/jpeg" }, body: "FINAL" },
      },
    });
    const result = await proxyMedia(IMAGE, { fetcher });
    expect(result.ok).toBe(true);
    expect(fetcher.calls).toEqual([IMAGE, target]);
    if (result.ok) expect(result.etag).toBe(mediaEtag(IMAGE));
  });

  it("refuses a redirect off the allowlist with 403 (#1411)", async () => {
    const evil = "http://169.254.169.254/latest/meta-data/";
    const fetcher = new StubFetcher({
      responses: { [IMAGE]: { status: 302, headers: { location: evil } } },
    });
    const result = await proxyMedia(IMAGE, { fetcher });
    expect(result).toMatchObject({ ok: false, reason: "forbiddenRedirect", status: 403 });
    expect(fetcher.calls).toEqual([IMAGE]);
  });

  it("stops a redirect chain rather than looping forever", async () => {
    const hop = "https://pbs.twimg.com/media/hop.jpg";
    const fetcher = new StubFetcher({
      responses: {
        [IMAGE]: { status: 302, headers: { location: hop } },
        [hop]: { status: 302, headers: { location: IMAGE } },
      },
    });
    const result = await proxyMedia(IMAGE, { fetcher });
    expect(result.ok).toBe(false);
    expect(fetcher.calls.length).toBeLessThanOrEqual(3);
  });

  it("maps a headers timeout to 504 and retries first", async () => {
    const timeout = Object.assign(new Error("Headers Timeout Error"), {
      code: "UND_ERR_HEADERS_TIMEOUT",
    });
    const fetcher = new StubFetcher();
    fetcher.fetch = async () => {
      fetcher.calls.push(IMAGE);
      throw timeout;
    };
    const result = await proxyMedia(IMAGE, { fetcher });
    expect(result).toMatchObject({ ok: false, reason: "timeout", status: 504 });
    expect(fetcher.calls).toHaveLength(3);
  });

  it("maps other transport errors to 404 rather than throwing", async () => {
    const fetcher = new StubFetcher();
    fetcher.fetch = async () => {
      fetcher.calls.push(IMAGE);
      throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    };
    const result = await proxyMedia(IMAGE, { fetcher });
    expect(result).toMatchObject({ ok: false, reason: "exhausted", status: 404 });
  });

  it("honours a single-attempt budget", async () => {
    const fetcher = new StubFetcher({ responses: { [IMAGE]: { status: 500 } } });
    await proxyMedia(IMAGE, { fetcher, maxAttempts: 1 });
    expect(fetcher.calls).toHaveLength(1);
  });

  it("reports retries to onRetry", async () => {
    const seen: string[] = [];
    const fetcher = new StubFetcher({ responses: { [IMAGE]: { status: 500 } } });
    await proxyMedia(IMAGE, { fetcher, onRetry: (message) => seen.push(message) });
    expect(seen).toHaveLength(3);
    expect(seen[0]).toContain("attempt 1/3");
    expect(seen[0]).toContain("status 500");
  });

  it("forwards caller headers (Range) to the fetcher", async () => {
    const fetcher = new StubFetcher({
      responses: {
        [IMAGE]: {
          status: 206,
          headers: { "content-type": "video/mp4", "content-range": "bytes 0-1/100" },
          body: "AB",
        },
      },
    });
    const result = await proxyMedia(IMAGE, { fetcher, headers: { range: "bytes=0-1" } });
    expect(result.ok).toBe(true);
    expect(fetcher.callHeaders).toEqual([{ range: "bytes=0-1" }]);
  });

  it("treats a 206 as success and keeps the range headers", async () => {
    const fetcher = new StubFetcher({
      responses: {
        [IMAGE]: {
          status: 206,
          headers: {
            "content-type": "video/mp4",
            "content-range": "bytes 0-1/100",
            "accept-ranges": "bytes",
            "content-length": "2",
          },
          body: "AB",
        },
      },
    });
    const result = await proxyMedia(IMAGE, { fetcher, headers: { range: "bytes=0-1" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(206);
    expect(result.headers["content-range"]).toBe("bytes 0-1/100");
    expect(result.headers["accept-ranges"]).toBe("bytes");
    expect(result.headers["content-length"]).toBe("2");
  });
});

describe("safeFetchText", () => {
  const MANIFEST = "https://video.twimg.com/spaces/main.m3u8";

  it("collects a 200 body as utf8 text", async () => {
    const fetcher = new StubFetcher({
      responses: { [MANIFEST]: { body: "#EXTM3U\nseg1.ts" } },
    });
    const text = await safeFetchText(MANIFEST, { fetcher });
    expect(text).toBe("#EXTM3U\nseg1.ts");
  });

  it("swallows upstream failures into an empty string", async () => {
    const fetcher = new StubFetcher({ responses: { [MANIFEST]: { status: 500 } } });
    expect(await safeFetchText(MANIFEST, { fetcher })).toBe("");
    expect(fetcher.calls).toHaveLength(3);
    expect(fetcher.aborted).toHaveLength(3);
  });

  it("refuses off-allowlist URLs without fetching", async () => {
    const fetcher = new StubFetcher();
    expect(await safeFetchText("https://evil.example/main.m3u8", { fetcher })).toBe("");
    expect(fetcher.calls).toHaveLength(0);
  });

  it("follows a redirect that stays on the allowlist", async () => {
    const target = "https://video.twimg.com/spaces/real.m3u8";
    const fetcher = new StubFetcher({
      responses: {
        [MANIFEST]: { status: 302, headers: { location: target } },
        [target]: { body: "#EXTM3U" },
      },
    });
    expect(await safeFetchText(MANIFEST, { fetcher })).toBe("#EXTM3U");
    expect(fetcher.calls).toEqual([MANIFEST, target]);
  });
});
