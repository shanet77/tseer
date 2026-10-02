import { describe, expect, it, vi } from "vitest";
import { namespaces } from "../src/keys.ts";
import { MemoryCacheStore } from "../src/memory.ts";
import { CacheError, CacheService } from "../src/service.ts";
import { makeService } from "./helpers.ts";

describe("CacheService get/set", () => {
  it("round-trips JSON values through the store", async () => {
    const { service } = makeService();
    await service.set(namespaces.user, "alice", { id: "1", name: "Alice" }, 60);
    expect(await service.get(namespaces.user, "alice")).toEqual({ id: "1", name: "Alice" });
  });

  it("returns undefined for a miss", async () => {
    const { service } = makeService();
    expect(await service.get(namespaces.user, "nobody")).toBeUndefined();
  });

  it("namespaces keys so the same key in two namespaces does not collide", async () => {
    const { service } = makeService();
    await service.set(namespaces.user, "x", "profile", 60);
    await service.set(namespaces.tweet, "x", "tweet", 60);
    expect(await service.get(namespaces.user, "x")).toBe("profile");
    expect(await service.get(namespaces.tweet, "x")).toBe("tweet");
  });

  it("skips writes for a non-positive TTL", async () => {
    const { service, store } = makeService();
    await service.set(namespaces.list, "9", "value", 0);
    expect(await store.get("t:v1:l:9")).toBeUndefined();
  });

  it("fires onWrite after a successful write", async () => {
    const onWrite = vi.fn();
    const { service } = makeService(onWrite);
    await service.set(namespaces.user, "alice", 1, 60);
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  it("degrades to a miss when the store read throws", async () => {
    const errors: string[] = [];
    const service = new CacheService(
      {
        get: () => Promise.reject(new Error("redis down")),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        deletePattern: () => Promise.resolve(),
        close: () => Promise.resolve(),
      },
      { prefix: "t", version: "v1", onError: (message) => errors.push(message) },
    );
    expect(await service.get(namespaces.user, "alice")).toBeUndefined();
    expect(errors[0]).toContain("t:v1:p:alice");
  });

  it("discards an undecodable stored value instead of throwing", async () => {
    const store = new MemoryCacheStore({ sweepIntervalMs: 0 });
    const errors: string[] = [];
    const service = new CacheService(store, {
      prefix: "t",
      version: "v1",
      onError: (message) => errors.push(message),
    });
    await store.set("t:v1:p:alice", "not json", 60);
    expect(await service.get(namespaces.user, "alice")).toBeUndefined();
    expect(errors[0]).toContain("undecodable");
    expect(await store.get("t:v1:p:alice")).toBeUndefined();
  });

  it("rejects values that are not JSON-serializable", async () => {
    const { service } = makeService();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(service.set(namespaces.user, "alice", cyclic, 60)).rejects.toBeInstanceOf(
      CacheError,
    );
  });
});
