/** `@tseer/cache` — `ctx.cache` seam: get/set/cached over memory or redis. */

export {
  allPattern,
  CACHE_VERSION,
  CacheKeyError,
  type CacheNamespace,
  cacheKey,
  DEFAULT_KEY_PREFIX,
  entityKeys,
  fnv1a32,
  type KeyOptions,
  namespacePattern,
  namespaces,
  normalizeUsername,
  userIdBucketKey,
  userIdField,
  userKeys,
} from "./keys.ts";
export { globToRegExp, MemoryCacheStore } from "./memory.ts";
export { default as cachePlugin } from "./plugin.ts";
export { RedisCacheStore } from "./redis.ts";
export { CacheError, CacheService } from "./service.ts";
export { BASE_CACHE_SECONDS, type CacheConfig, type CacheTtls, resolveTtls } from "./ttls.ts";
export type {
  Cache,
  CachePluginOptions,
  CacheProvider,
  CacheServiceOptions,
  CacheStore,
  MemoryCacheOptions,
  RedisCacheOptions,
  RedisLike,
} from "./types.ts";
