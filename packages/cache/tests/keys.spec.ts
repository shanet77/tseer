import { describe, expect, it } from "vitest";
import {
  allPattern,
  CACHE_VERSION,
  CacheKeyError,
  cacheKey,
  DEFAULT_KEY_PREFIX,
  entityKeys,
  fnv1a32,
  namespacePattern,
  namespaces,
  normalizeUsername,
  userIdBucketKey,
  userIdField,
  userKeys,
} from "../src/keys.ts";

describe("cacheKey", () => {
  it("qualifies keys as prefix:version:ns:key", () => {
    expect(cacheKey(namespaces.user, "alice")).toBe(
      `${DEFAULT_KEY_PREFIX}:${CACHE_VERSION}:p:alice`,
    );
  });

  it("honors custom prefix and version", () => {
    expect(cacheKey("p", "alice", { prefix: "nitter", version: "v2" })).toBe("nitter:v2:p:alice");
  });

  it("rejects empty namespaces and colons in namespaces", () => {
    expect(() => cacheKey("", "alice")).toThrow(CacheKeyError);
    expect(() => cacheKey("a:b", "alice")).toThrow(CacheKeyError);
  });

  it("allows colons in the key segment", () => {
    expect(cacheKey(namespaces.rss, "search:f:news")).toContain(":rss:search:f:news");
  });
});

describe("allPattern", () => {
  it("covers every namespace of one prefix+version pair", () => {
    expect(allPattern()).toBe(`${DEFAULT_KEY_PREFIX}:${CACHE_VERSION}:*`);
    expect(allPattern({ prefix: "nitter", version: "v2" })).toBe("nitter:v2:*");
  });
});

describe("namespacePattern", () => {
  it("matches the namespace prefix and nothing above it", () => {
    expect(namespacePattern(namespaces.user)).toBe(`${DEFAULT_KEY_PREFIX}:${CACHE_VERSION}:p*`);
    expect(namespacePattern("p", { prefix: "x", version: "v9" })).toBe("x:v9:p*");
  });
});

describe("username normalization", () => {
  it("lowercases and trims, like nitter's toLower", () => {
    expect(normalizeUsername("  Alice ")).toBe("alice");
    expect(userKeys.profile("ALICE")).toBe(`${DEFAULT_KEY_PREFIX}:${CACHE_VERSION}:p:alice`);
    expect(userKeys.photoRail("Alice")).toContain(":pr2:alice");
    expect(userKeys.accountInfo("Alice")).toContain(":ai:alice");
  });

  it("keys the reverse lookup by id, not username", () => {
    expect(userKeys.username("1234")).toBe(`${DEFAULT_KEY_PREFIX}:${CACHE_VERSION}:i:1234`);
  });
});

describe("entity keys", () => {
  it("matches the nitter key templates", () => {
    const p = DEFAULT_KEY_PREFIX;
    const v = CACHE_VERSION;
    expect(entityKeys.tweet("42")).toBe(`${p}:${v}:t:42`);
    expect(entityKeys.list("99")).toBe(`${p}:${v}:l:99`);
    expect(entityKeys.rss("search")).toBe(`${p}:${v}:rss:search`);
    expect(entityKeys.space("7")).toBe(`${p}:${v}:sp:7`);
    expect(entityKeys.broadcast("8")).toBe(`${p}:${v}:bc:8`);
    expect(entityKeys.community("9")).toBe(`${p}:${v}:cm:9`);
    expect(entityKeys.communityModerators("9")).toBe(`${p}:${v}:cmm:9`);
  });
});

describe("userIdBucket", () => {
  it("is deterministic and bounded by the bucket count", () => {
    const a = userIdBucketKey("alice");
    const b = userIdBucketKey("ALICE");
    expect(a).toBe(b);
    expect(a.startsWith(`${DEFAULT_KEY_PREFIX}:${CACHE_VERSION}:pid:`)).toBe(true);
    const bucket = Number(a.split(":").pop());
    expect(Number.isInteger(bucket)).toBe(true);
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(1_000_000);
  });

  it("spreads different usernames across buckets", () => {
    const buckets = new Set(
      ["a", "b", "c", "d", "e", "f"].map((name) => fnv1a32(name) % 1_000_000),
    );
    expect(buckets.size).toBeGreaterThan(1);
  });

  it("uses the lowercased name as the hash field", () => {
    expect(userIdField("Alice")).toBe("alice");
  });

  it("keeps FNV-1a stable across calls", () => {
    expect(fnv1a32("nitter")).toBe(fnv1a32("nitter"));
    expect(fnv1a32("")).toBe(0x811c9dc5);
  });
});
