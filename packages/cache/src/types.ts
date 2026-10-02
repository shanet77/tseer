/** `ctx.cache` contract: the seam's narrow surface, plus the backend store port. */

/**
 * The cache seam. Consumers (route plugins, `twitter-api`) only ever see this
 * interface, so the backend stays swappable: memory in-process, redis across a
 * fleet, or an out-of-tree provider.
 */
export interface Cache {
  get<T>(ns: string, key: string): Promise<T | undefined>;
  set<T>(ns: string, key: string, value: T, ttlSeconds: number): Promise<void>;
  /** Stampede-safe get-or-fill: concurrent misses on one key share one factory call. */
  cached<T>(ns: string, key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T>;
  delete(ns: string, key: string): Promise<void>;
  /** Drops every key in a namespace, or the whole cache when `ns` is omitted. */
  clear(ns?: string | undefined): Promise<void>;
}

/**
 * The backend port `Cache` is implemented over. Values are opaque JSON text and
 * TTLs are in seconds; a store never interprets either.
 */
export interface CacheStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Deletes keys matching a fully-qualified glob (`ns:key` never contains `*`). */
  deletePattern(pattern: string): Promise<void>;
  close(): Promise<void>;
}

export interface CacheServiceOptions {
  /** Prefix applied to every key, so one redis db can host several instances. */
  prefix?: string | undefined;
  /** Version segment: bump to invalidate every key of a changed value shape. */
  version?: string | undefined;
  /** Called after each successful `set`, for the `cache/write` event. */
  onWrite?: ((ns: string, key: string, ttlSeconds: number) => void) | undefined;
  /** Called when a read or write fails; the seam degrades to a miss on error. */
  onError?: ((message: string, err: unknown) => void) | undefined;
}

export interface MemoryCacheOptions {
  /** Hard entry cap; oldest-expiring entries are evicted past this. Default 10k. */
  maxEntries?: number | undefined;
  /** How often expired entries are swept. Default 30s; 0 disables the timer. */
  sweepIntervalMs?: number | undefined;
  now?: (() => number) | undefined;
}

/** Minimal ioredis-shaped port, so the redis provider is testable without a server. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  scan(cursor: string, match: string, count: number): Promise<[cursor: string, keys: string[]]>;
  quit(): Promise<unknown>;
}

export interface RedisCacheOptions {
  host?: string | undefined;
  port?: number | undefined;
  password?: string | undefined;
  keyPrefix?: string | undefined;
  /** Scan batch size for namespace clears. Default 500. */
  scanCount?: number | undefined;
  /** Injected client (tests, or a shared connection owned elsewhere). */
  client?: RedisLike | undefined;
  /** Injected client factory; when omitted the plugin builds an ioredis client. */
  createClient?: ((options: RedisCacheOptions) => RedisLike | Promise<RedisLike>) | undefined;
}

export type CacheProvider = "memory" | "redis";

export interface CachePluginOptions {
  /** Backend to mount. Default `memory`. */
  provider?: CacheProvider | undefined;
  /** Overrides for the memory store. */
  memory?: MemoryCacheOptions | undefined;
  /** Overrides for the redis store. */
  redis?: RedisCacheOptions | undefined;
  /** Key prefix/version, for sharing one redis db across instances. */
  prefix?: string | undefined;
  version?: string | undefined;
}
