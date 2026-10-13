export interface Cache {
  get<T>(ns: string, key: string): Promise<T | undefined>;
  set<T>(ns: string, key: string, value: T, ttlSeconds: number): Promise<void>;
  cached<T>(ns: string, key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T>;
  delete(ns: string, key: string): Promise<void>;
  clear(ns?: string | undefined): Promise<void>;
}

export interface CacheStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  deletePattern(pattern: string): Promise<void>;
  close(): Promise<void>;
}

export interface CacheServiceOptions {
  prefix?: string | undefined;
  version?: string | undefined;
  onWrite?: ((ns: string, key: string, ttlSeconds: number) => void) | undefined;
  onError?: ((message: string, err: unknown) => void) | undefined;
}

export interface MemoryCacheOptions {
  maxEntries?: number | undefined;
  sweepIntervalMs?: number | undefined;
  now?: (() => number) | undefined;
}

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
  scanCount?: number | undefined;
  client?: RedisLike | undefined;
  createClient?: ((options: RedisCacheOptions) => RedisLike | Promise<RedisLike>) | undefined;
  onClientError?: ((err: unknown) => void) | undefined;
}

export type CacheProvider = "memory" | "redis";

export interface CachePluginOptions {
  provider?: CacheProvider | undefined;
  memory?: MemoryCacheOptions | undefined;
  redis?: RedisCacheOptions | undefined;
  prefix?: string | undefined;
  version?: string | undefined;
}
