import { describe, expect, it } from "vitest";
import { applyApiProxy, normalizeApiProxy, usesApiProxy } from "../src/api-proxy.ts";
import { cfTitle, isCloudflareHtml } from "../src/cloudflare.ts";
import { parseRateLimitHeaders } from "../src/rate-limit.ts";

describe("isCloudflareHtml", () => {
  it("matches doctype pages mentioning Cloudflare", () => {
    expect(isCloudflareHtml("<!DOCTYPE html><html><body>Cloudflare</body></html>")).toBe(true);
    expect(isCloudflareHtml("<!doctype html><title>Cloudflare</title></html>")).toBe(true);
  });

  it("rejects short, non-html, and non-cloudflare bodies", () => {
    expect(isCloudflareHtml("<!doctype HTM")).toBe(false);
    expect(isCloudflareHtml("<html><body>Cloudflare</body>")).toBe(false);
    expect(isCloudflareHtml('{"errors":[]}')).toBe(false);
    expect(isCloudflareHtml("<!DOCTYPE html><html><title>Error</title></html>")).toBe(false);
  });
});

describe("cfTitle", () => {
  it("extracts and collapses the title text", () => {
    const page =
      "<!DOCTYPE html><html><head><title>  Just a\n  moment...  </title></head>Cloudflare</html>";
    expect(cfTitle(page)).toBe("Just a moment...");
  });

  it("returns unknown without a complete title", () => {
    expect(cfTitle("<!DOCTYPE html><html><body>Cloudflare</body></html>")).toBe("unknown");
    expect(cfTitle("<title>unclosed")).toBe("unknown");
  });
});

describe("parseRateLimitHeaders", () => {
  const fixture = {
    "x-rate-limit-limit": "50",
    "x-rate-limit-remaining": "42",
    "x-rate-limit-reset": "1760000000",
  };

  it("parses x-rate-limit-* headers into a RateLimit", () => {
    expect(parseRateLimitHeaders(fixture)).toEqual({
      limit: 50,
      remaining: 42,
      reset: 1760000000,
    });
  });

  it("ignores edge-cached responses (x-np-cache HIT/STALE)", () => {
    expect(parseRateLimitHeaders({ ...fixture, "x-np-cache": "HIT" })).toBeUndefined();
    expect(parseRateLimitHeaders({ ...fixture, "x-np-cache": "STALE" })).toBeUndefined();
    expect(parseRateLimitHeaders({ ...fixture, "x-np-cache": "MISS" })).toEqual({
      limit: 50,
      remaining: 42,
      reset: 1760000000,
    });
  });

  it("returns undefined when headers are missing or malformed", () => {
    expect(parseRateLimitHeaders({})).toBeUndefined();
    expect(parseRateLimitHeaders({ "x-rate-limit-remaining": "42" })).toBeUndefined();
    expect(
      parseRateLimitHeaders({ ...fixture, "x-rate-limit-reset": "not-a-number" }),
    ).toBeUndefined();
  });
});

describe("apiProxy rewriting", () => {
  it("normalizes the configured prefix (port of setApiProxy)", () => {
    expect(normalizeApiProxy("")).toBe("");
    expect(normalizeApiProxy("1.2.3.4:8080")).toBe("http://1.2.3.4:8080/");
    expect(normalizeApiProxy("http://p.example:8118/")).toBe("http://p.example:8118/");
    expect(normalizeApiProxy("https://p.example///")).toBe("https://p.example/");
  });

  it("applies to graphql/rest paths and skips /1.1/ endpoints", () => {
    const proxy = normalizeApiProxy("http://p.example:8118");
    expect(usesApiProxy("https://x.com/i/api/graphql/abc?variables=%7B%7D", proxy)).toBe(true);
    expect(usesApiProxy("https://api.x.com/1.1/search/tweets.json", proxy)).toBe(false);
    expect(usesApiProxy("https://x.com/i/api/graphql/abc", "")).toBe(false);

    expect(applyApiProxy("https://x.com/i/api/graphql/abc", proxy)).toBe(
      "http://p.example:8118/x.com/i/api/graphql/abc",
    );
    expect(applyApiProxy("https://api.x.com/1.1/search/tweets.json", proxy)).toBe(
      "https://api.x.com/1.1/search/tweets.json",
    );
    expect(applyApiProxy("https://x.com/i/api/graphql/abc", "")).toBe(
      "https://x.com/i/api/graphql/abc",
    );
  });
});
