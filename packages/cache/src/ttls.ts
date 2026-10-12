export const BASE_CACHE_SECONDS = 60 * 60;

export interface CacheConfig {
  listCacheTime?: number | undefined;
  rssCacheTime?: number | undefined;
}

export interface CacheTtls {
  base: number;
  list: number;
  rss: number;
  photoRail: number;
  accountInfo: number;
  space: number;
  spaceRunning: number;
  broadcast: number;
  community: number;
  communityModerators: number;
}

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
