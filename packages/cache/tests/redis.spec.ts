import { describe, expect, it } from "vitest";
import { RedisCacheStore } from "../src/redis.ts";
import { fakeRedis } from "./helpers.ts";

describe("RedisCacheStore", () => {
  it("stores values with an EX expiry", async () => {
    const redis = fakeRedis();
    const store = new RedisCacheStore(redis, { client: redis });
    await store.set("tseer:v1:p:alice", '"Alice"', 60);
    expect(redis.calls).toContain("set tseer:v1:p:alice EX 60");
    expect(redis.data.get("tseer:v1:p:alice")?.value).toBe('"Alice"');
  });

  it("floors a fractional TTL and skips non-positive ones", async () => {
    const redis = fakeRedis();
    const store = new RedisCacheStore(redis, { client: redis });
    await store.set("k", "v", 1.9);
    expect(redis.calls).toContain("set k EX 1");
    await store.set("k2", "v", 0);
    expect(redis.calls).not.toContain("set k2 EX 0");
  });

  it("maps a redis nil to undefined", async () => {
    const redis = fakeRedis();
    const store = new RedisCacheStore(redis, { client: redis });
    expect(await store.get("absent")).toBeUndefined();
  });

  it("respects the redis-side expiry", async () => {
    const redis = fakeRedis();
    const store = new RedisCacheStore(redis, { client: redis });
    await store.set("k", "v", 10);
    expect(await store.get("k")).toBe("v");
    redis.advance(11_000);
    expect(await store.get("k")).toBeUndefined();
  });

  it("deletes a key", async () => {
    const redis = fakeRedis();
    const store = new RedisCacheStore(redis, { client: redis });
    await store.set("k", "v", 60);
    await store.delete("k");
    expect(await store.get("k")).toBeUndefined();
  });

  it("drains a multi-page scan cursor when deleting a pattern", async () => {
    const redis = fakeRedis();
    const store = new RedisCacheStore(redis, { client: redis, scanCount: 2 });
    for (const name of ["a", "b", "c", "d", "e"]) await store.set(`tseer:v1:p:${name}`, "v", 60);
    await store.set("tseer:v1:t:42", "v", 60);

    await store.deletePattern("tseer:v1:p*");

    expect([...redis.data.keys()]).toEqual(["tseer:v1:t:42"]);
    expect(redis.calls.filter((c) => c.startsWith("scan"))).toHaveLength(3);
  });

  it("does not quit an injected client, but does own a created one", async () => {
    const injected = fakeRedis();
    await new RedisCacheStore(injected, { client: injected }).close();
    expect(injected.quitCalls).toBe(0);

    const created = fakeRedis();
    await new RedisCacheStore(created, {}).close();
    expect(created.quitCalls).toBe(1);
  });

  it("builds a store from an injected client factory", async () => {
    const redis = fakeRedis();
    const store = await RedisCacheStore.create({
      host: "example",
      port: 6380,
      createClient: (options) => {
        expect(options.host).toBe("example");
        return redis;
      },
    });
    await store.set("k", "v", 60);
    expect(await store.get("k")).toBe("v");
  });
});
