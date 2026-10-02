/**
 * The `Cache` implementation: JSON codec, key qualification, and the
 * stampede-safe `cached()` from the plan's §4 contract.
 *
 * A stampede is the failure mode where N concurrent misses on the same key all
 * miss, all call the factory, and N upstream requests hit X for identical data.
 * In-flight calls are tracked per key so a miss joins an existing fill instead
 * of starting its own. A rejected factory is never cached and never poisons the
 * in-flight slot.
 */
import { allPattern, cacheKey, type KeyOptions, namespacePattern } from "./keys.ts";
import type { Cache, CacheServiceOptions, CacheStore } from "./types.ts";

export class CacheError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CacheError";
  }
}

export class CacheService implements Cache {
  private readonly store: CacheStore;
  private readonly keys: KeyOptions;
  private readonly onWrite: ((ns: string, key: string, ttlSeconds: number) => void) | undefined;
  private readonly onError: ((message: string, err: unknown) => void) | undefined;
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(store: CacheStore, options: CacheServiceOptions = {}) {
    this.store = store;
    this.keys = { prefix: options.prefix, version: options.version };
    this.onWrite = options.onWrite;
    this.onError = options.onError;
  }

  async get<T>(ns: string, key: string): Promise<T | undefined> {
    const full = this.qualify(ns, key);
    let raw: string | undefined;
    try {
      raw = await this.store.get(full);
    } catch (err) {
      this.onError?.(`failed to read ${full}`, err);
      return undefined;
    }
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      this.onError?.(`discarding undecodable value at ${full}`, err);
      await this.delete(ns, key);
      return undefined;
    }
  }

  async set<T>(ns: string, key: string, value: T, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    const full = this.qualify(ns, key);
    let raw: string;
    try {
      raw = JSON.stringify(value);
    } catch (err) {
      throw new CacheError(`value for ${full} is not JSON-serializable`, { cause: err });
    }
    if (raw === undefined) {
      await this.delete(ns, key);
      return;
    }
    try {
      await this.store.set(full, raw, ttlSeconds);
    } catch (err) {
      this.onError?.(`failed to write ${full}`, err);
      return;
    }
    this.onWrite?.(ns, key, ttlSeconds);
  }

  async cached<T>(
    ns: string,
    key: string,
    ttlSeconds: number,
    factory: () => Promise<T>,
  ): Promise<T> {
    const full = this.qualify(ns, key);
    const hit = await this.get<T>(ns, key);
    if (hit !== undefined) return hit;

    const pending = this.inflight.get(full) as Promise<T> | undefined;
    if (pending !== undefined) return pending;

    const fill = (async () => {
      try {
        const value = await factory();
        await this.set(ns, key, value, ttlSeconds);
        return value;
      } finally {
        this.inflight.delete(full);
      }
    })();
    this.inflight.set(full, fill);
    return fill;
  }

  async delete(ns: string, key: string): Promise<void> {
    const full = this.qualify(ns, key);
    this.inflight.delete(full);
    try {
      await this.store.delete(full);
    } catch (err) {
      this.onError?.(`failed to delete ${full}`, err);
    }
  }

  async clear(ns?: string | undefined): Promise<void> {
    try {
      if (ns === undefined) await this.store.deletePattern(this.allPattern());
      else await this.store.deletePattern(namespacePattern(ns, this.keys));
    } catch (err) {
      this.onError?.(`failed to clear ${ns ?? "cache"}`, err);
    }
  }

  async close(): Promise<void> {
    this.inflight.clear();
    await this.store.close();
  }

  /** Glob over every key this instance owns: `<prefix>:<version>:*`. */
  private allPattern(): string {
    return allPattern(this.keys);
  }

  private qualify(ns: string, key: string): string {
    return cacheKey(ns, key, this.keys);
  }
}
