/**
 * TTL buckets. Ported from `redis_cache.nim`: `baseCacheTime = 60 * 60`, with
 * per-entity multipliers, and `setCacheTimes` scaling the `[Cache]` config
 * minutes up to seconds.
 */

/** `baseCacheTime` in `redis_cache.nim`. */
export const BASE_CACHE_SECONDS = 60 * 60;

/** Subset of `ctx.config` this seam reads; `TseerConfig` satisfies it. */
export interface CacheConfig {
  listCacheTime?: number | undefined;
  rssCacheTime?: number | undefined;
}

export interface CacheTtls {
  /** Default for user/tweet/username entries. */
  base: number;
  list: number;
  rss: number;
  /** `baseCacheTime * 2` — photo rails change rarely. */
  photoRail: number;
  /** `baseCacheTime * 24` — about pages are near-static. */
  accountInfo: number;
  /** `baseCacheTime` for a finished space, `baseCacheTime div 6` while RUNNING. */
  space: number;
  spaceRunning: number;
  broadcast: number;
  community: number;
  communityModerators: number;
}

/**
 * `setCacheTimes(cfg)`: the ini/redis `listMinutes`/`rssMinutes` keys are in
 * minutes, so they scale to seconds. A zero or missing value means "do not
 * cache", which nitter expressed by skipping the write entirely.
 */
export function resolveTtls(config: CacheConfig = {}): CacheTtls {
  const list = Math.max(0, config.listCacheTime ?? 0) * 60;
  const rss = Math.max(0, config.rssCacheTime ?? 0) * 60;
  return {
    base: BASE_CACHE_SECONDS,
    list,
    rss,
    photoRail: BASE_CACHE_SECONDS * 2,
    accountInfo: BASE_CACHE_SECONDS * 24,
    space: BASE_CACHE_SECONDS,
    spaceRunning: Math.floor(BASE_CACHE_SECONDS / 6),
    broadcast: BASE_CACHE_SECONDS,
    community: list,
    communityModerators: list,
  };
}
