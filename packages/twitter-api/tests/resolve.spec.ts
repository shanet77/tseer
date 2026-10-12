import { describe, expect, it, vi } from "vitest";
import { createTwitterApi, resolveUrl } from "../src/fetchers.ts";

function recordingFetcher() {
  return {
    fetch: () => Promise.resolve({ ok: true }),
    fetchRaw: () => Promise.resolve("<raw>"),
  };
}

describe("resolveUrl", () => {
  it("returns the location header with a HEAD, no-follow request", async () => {
    const fetchFn = vi.fn(async () => ({
      headers: { get: (name: string) => (name === "location" ? "https://example.com/x" : null) },
    }));
    await expect(resolveUrl("https://t.co/abc", fetchFn)).resolves.toBe("https://example.com/x");
    expect(fetchFn).toHaveBeenCalledWith("https://t.co/abc", {
      method: "HEAD",
      redirect: "manual",
    });
  });

  it("returns empty when there is no location or the fetch throws", async () => {
    const missing = vi.fn(async () => ({ headers: { get: () => null } }));
    await expect(resolveUrl("https://t.co/abc", missing)).resolves.toBe("");
    const failing = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(resolveUrl("https://t.co/abc", failing)).resolves.toBe("");
  });
});

describe("raw resolve", () => {
  it("delegates to resolveUrl and guards empty input", async () => {
    const api = createTwitterApi(recordingFetcher());
    await expect(api.resolve("")).resolves.toBe("");
  });
});
