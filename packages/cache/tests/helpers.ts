/** Shared test doubles for the cache suite. */
import { MemoryCacheStore } from "../src/memory.ts";
import { CacheService } from "../src/service.ts";
import type { CacheStore, RedisLike } from "../src/types.ts";

export function makeService(onWrite?: () => void, store?: CacheStore) {
  const backing = store ?? new MemoryCacheStore({ sweepIntervalMs: 0 });
  return {
    store: backing,
    service: new CacheService(backing, {
      prefix: "t",
      version: "v1",
      onWrite: onWrite === undefined ? undefined : () => onWrite(),
      onError: () => {},
    }),
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface FakeRedisEntry {
  value: string;
  expiresAt: number;
}

export interface FakeRedis extends RedisLike {
  readonly data: Map<string, FakeRedisEntry>;
  readonly calls: string[];
  readonly quitCalls: number;
  advance(ms: number): void;
}

/** In-memory redis double: honors `EX`, and returns a two-page `SCAN` cursor. */
export function fakeRedis(start = 1_000_000): FakeRedis {
  const data = new Map<string, FakeRedisEntry>();
  const calls: string[] = [];
  const snapshots = new Map<string, string[]>();
  const quitCalls = { count: 0 };
  let now = start;

  const alive = (key: string): boolean => {
    const entry = data.get(key);
    if (entry === undefined) return false;
    if (entry.expiresAt <= now) {
      data.delete(key);
      return false;
    }
    return true;
  };

  return {
    data,
    calls,
    get quitCalls() {
      return quitCalls.count;
    },
    advance(ms: number) {
      now += ms;
    },
    get(key: string) {
      calls.push(`get ${key}`);
      return Promise.resolve(alive(key) ? (data.get(key)?.value ?? null) : null);
    },
    set(key: string, value: string, mode: "EX", ttlSeconds: number) {
      calls.push(`set ${key} ${mode} ${ttlSeconds}`);
      data.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
      return Promise.resolve("OK");
    },
    del(...keys: string[]) {
      calls.push(`del ${keys.length}`);
      let removed = 0;
      for (const key of keys) if (data.delete(key)) removed += 1;
      return Promise.resolve(removed);
    },
    scan(cursor: string, match: string, count: number) {
      calls.push(`scan ${cursor} ${match} ${count}`);
      // Real SCAN pages over a stable snapshot: every key present for the whole
      // iteration is returned exactly once, even though the caller deletes each
      // page before asking for the next. The double mirrors that with a
      // snapshot taken on the first page and a numeric offset as the cursor.
      let snapshot = snapshots.get(match);
      if (snapshot === undefined) {
        const pattern = new RegExp(
          `^${match.replace(/[.+^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, ".*")}$`,
          "u",
        );
        snapshot = [...data.keys()].filter((key) => pattern.test(key));
        snapshots.set(match, snapshot);
      }
      const offset = Number.parseInt(cursor, 10) || 0;
      const page = snapshot.slice(offset, offset + count);
      const next = offset + count < snapshot.length ? String(offset + count) : "0";
      return Promise.resolve([next, page] as [string, string[]]);
    },
    quit() {
      quitCalls.count += 1;
      return Promise.resolve("OK");
    },
  };
}
