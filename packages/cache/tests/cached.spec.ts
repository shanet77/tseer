import { describe, expect, it, vi } from "vitest";
import { namespaces } from "../src/keys.ts";
import { MemoryCacheStore } from "../src/memory.ts";
import { CacheService } from "../src/service.ts";
import type { CacheStore } from "../src/types.ts";
import { deferred, makeService } from "./helpers.ts";

describe("CacheService.cached", () => {
  it("calls the factory on a miss and caches the result", async () => {
    const { service } = makeService();
    const factory = vi.fn(async () => ({ id: "1" }));
    const first = await service.cached(namespaces.user, "alice", 60, factory);
    const second = await service.cached(namespaces.user, "alice", 60, factory);
    expect(first).toEqual({ id: "1" });
    expect(second).toEqual({ id: "1" });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("collapses concurrent misses on one key into a single factory call", async () => {
    const { service } = makeService();
    const gate = deferred<string>();
    const factory = vi.fn(() => gate.promise);

    const all = Promise.all([
      service.cached(namespaces.user, "alice", 60, factory),
      service.cached(namespaces.user, "alice", 60, factory),
      service.cached(namespaces.user, "alice", 60, factory),
    ]);
    gate.resolve("value");
    expect(await all).toEqual(["value", "value", "value"]);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("does not collapse misses across different keys", async () => {
    const { service } = makeService();
    const gate = deferred<string>();
    const factory = vi.fn(() => gate.promise);
    const all = Promise.all([
      service.cached(namespaces.user, "alice", 60, factory),
      service.cached(namespaces.user, "bob", 60, factory),
    ]);
    gate.resolve("value");
    await all;
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("does not poison the in-flight slot when the factory rejects", async () => {
    const { service } = makeService();
    const failing = vi.fn(async () => {
      throw new Error("upstream 500");
    });
    await expect(service.cached(namespaces.user, "alice", 60, failing)).rejects.toThrow(
      "upstream 500",
    );
    const recovered = await service.cached(namespaces.user, "alice", 60, async () => "fresh");
    expect(recovered).toBe("fresh");
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("starts a new fill after the previous one settles", async () => {
    const { service } = makeService();
    const factory = vi.fn(async () => "value");
    await service.cached(namespaces.user, "alice", 0, factory);
    await service.cached(namespaces.user, "alice", 0, factory);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("caches falsy values like 0", async () => {
    const { service } = makeService();
    const factory = vi.fn(async () => 0);
    expect(await service.cached(namespaces.tweet, "42", 60, factory)).toBe(0);
    expect(await service.cached(namespaces.tweet, "42", 60, factory)).toBe(0);
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

describe("CacheService clear and close", () => {
  it("clears a single namespace and leaves the rest intact", async () => {
    const { service } = makeService();
    await service.set(namespaces.user, "alice", 1, 60);
    await service.set(namespaces.tweet, "42", 2, 60);
    await service.clear(namespaces.user);
    expect(await service.get(namespaces.user, "alice")).toBeUndefined();
    expect(await service.get(namespaces.tweet, "42")).toBe(2);
  });

  it("clears every key of this instance when no namespace is given", async () => {
    const { service } = makeService();
    await service.set(namespaces.user, "alice", 1, 60);
    await service.set(namespaces.tweet, "42", 2, 60);
    await service.clear();
    expect(await service.get(namespaces.user, "alice")).toBeUndefined();
    expect(await service.get(namespaces.tweet, "42")).toBeUndefined();
  });

  it("does not let a clear() wipe a foreign prefix", async () => {
    const { service, store } = makeService();
    await store.set("other:v1:p:bob", "foreign", 60);
    await service.set(namespaces.user, "alice", 1, 60);
    await service.clear();
    expect(await store.get("other:v1:p:bob")).toBe("foreign");
  });

  it("closes the underlying store", async () => {
    const close = vi.fn(async () => {});
    const store: CacheStore = {
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      deletePattern: () => Promise.resolve(),
      close,
    };
    const service = new CacheService(store);
    await service.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("drops a cached entry so the next cached() refills", async () => {
    const { service } = makeService();
    const factory = vi.fn(async () => "value");
    await service.cached(namespaces.user, "alice", 60, factory);
    await service.delete(namespaces.user, "alice");
    await service.cached(namespaces.user, "alice", 60, factory);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe("MemoryCacheStore as a CacheService backend", () => {
  it("expires a cached() entry once the TTL elapses", async () => {
    let now = 1_000_000;
    const store = new MemoryCacheStore({ sweepIntervalMs: 0, now: () => now });
    const service = new CacheService(store, { prefix: "t", version: "v1" });
    const factory = vi.fn(async () => "value");
    await service.cached(namespaces.user, "alice", 10, factory);
    now += 11_000;
    await service.cached(namespaces.user, "alice", 10, factory);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
