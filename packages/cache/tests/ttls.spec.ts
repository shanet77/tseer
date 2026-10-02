import { describe, expect, it } from "vitest";
import { BASE_CACHE_SECONDS, resolveTtls } from "../src/ttls.ts";

describe("resolveTtls", () => {
  it("ports the baseCacheTime arithmetic from redis_cache.nim", () => {
    const ttls = resolveTtls({ listCacheTime: 10, rssCacheTime: 5 });
    expect(ttls.base).toBe(BASE_CACHE_SECONDS);
    expect(ttls.photoRail).toBe(BASE_CACHE_SECONDS * 2);
    expect(ttls.accountInfo).toBe(BASE_CACHE_SECONDS * 24);
    expect(ttls.space).toBe(BASE_CACHE_SECONDS);
    expect(ttls.spaceRunning).toBe(Math.floor(BASE_CACHE_SECONDS / 6));
    expect(ttls.broadcast).toBe(BASE_CACHE_SECONDS);
  });

  it("scales the ini minute values up to seconds", () => {
    const ttls = resolveTtls({ listCacheTime: 10, rssCacheTime: 5 });
    expect(ttls.list).toBe(600);
    expect(ttls.rss).toBe(300);
    expect(ttls.community).toBe(600);
    expect(ttls.communityModerators).toBe(600);
  });

  it("yields zero (do not cache) when the minute keys are absent or zero", () => {
    const ttls = resolveTtls();
    expect(ttls.list).toBe(0);
    expect(ttls.rss).toBe(0);
    expect(resolveTtls({ listCacheTime: 0, rssCacheTime: 0 }).list).toBe(0);
  });

  it("clamps a negative value to zero rather than a negative TTL", () => {
    expect(resolveTtls({ listCacheTime: -5, rssCacheTime: -1 }).list).toBe(0);
  });
});
