import { describe, expect, it, vi } from "vitest";
import { globToRegExp, MemoryCacheStore } from "../src/memory.ts";

function fakeClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("MemoryCacheStore", () => {
  it("round-trips values", async () => {
    const store = new MemoryCacheStore({ sweepIntervalMs: 0 });
    await store.set("a", "one", 60);
    expect(await store.get("a")).toBe("one");
    expect(await store.get("missing")).toBeUndefined();
  });

  it("expires entries on read once the TTL passes", async () => {
    const clock = fakeClock();
    const store = new MemoryCacheStore({ sweepIntervalMs: 0, now: clock.now });
    await store.set("a", "one", 10);
    clock.advance(9_999);
    expect(await store.get("a")).toBe("one");
    clock.advance(2);
    expect(await store.get("a")).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it("treats a non-positive TTL as a delete", async () => {
    const store = new MemoryCacheStore({ sweepIntervalMs: 0 });
    await store.set("a", "one", 60);
    await store.set("a", "two", 0);
    expect(await store.get("a")).toBeUndefined();
  });

  it("deletes by key and by glob pattern", async () => {
    const store = new MemoryCacheStore({ sweepIntervalMs: 0 });
    await store.set("tseer:v1:p:alice", "1", 60);
    await store.set("tseer:v1:p:bob", "2", 60);
    await store.set("tseer:v1:t:42", "3", 60);

    await store.deletePattern("tseer:v1:p*");
    expect(await store.get("tseer:v1:p:alice")).toBeUndefined();
    expect(await store.get("tseer:v1:t:42")).toBe("3");

    await store.delete("tseer:v1:t:42");
    expect(await store.get("tseer:v1:t:42")).toBeUndefined();
  });

  it("evicts the oldest entry past maxEntries", async () => {
    const clock = fakeClock();
    const store = new MemoryCacheStore({ maxEntries: 2, sweepIntervalMs: 0, now: clock.now });
    await store.set("a", "1", 60);
    clock.advance(1_000);
    await store.set("b", "2", 60);
    clock.advance(1_000);
    await store.set("c", "3", 60);
    expect(store.size).toBe(2);
    expect(await store.get("a")).toBeUndefined();
    expect(await store.get("b")).toBe("2");
    expect(await store.get("c")).toBe("3");
  });

  it("sweeps expired entries on a timer", async () => {
    vi.useFakeTimers();
    try {
      const clock = fakeClock();
      const store = new MemoryCacheStore({ sweepIntervalMs: 1_000, now: clock.now });
      await store.set("a", "1", 1);
      expect(store.size).toBe(1);
      clock.advance(2_000);
      vi.advanceTimersByTime(1_000);
      expect(store.size).toBe(0);
      await store.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears everything on close", async () => {
    const store = new MemoryCacheStore({ sweepIntervalMs: 0 });
    await store.set("a", "1", 60);
    await store.close();
    expect(store.size).toBe(0);
  });
});

describe("globToRegExp", () => {
  it("anchors both ends and supports * and ?", () => {
    expect(globToRegExp("tseer:v1:p*").test("tseer:v1:p:alice")).toBe(true);
    expect(globToRegExp("tseer:v1:p*").test("tseer:v1:t:42")).toBe(false);
    expect(globToRegExp("tseer:v1:p*").test("prefix-tseer:v1:p:alice")).toBe(false);
    expect(globToRegExp("a?c").test("abc")).toBe(true);
    expect(globToRegExp("a?c").test("abbc")).toBe(false);
  });

  it("escapes regex metacharacters outside wildcards", () => {
    expect(globToRegExp("a.b*").test("a.b:c")).toBe(true);
    expect(globToRegExp("a.b*").test("axb:c")).toBe(false);
  });
});
