/**
 * The per-entity `cached*` wrappers — the port of `redis_cache.nim`'s
 * `cache(data: …)`/`getCached*` procs, one-liners over `CacheService.cached()`
 * with the `resolveTtls` buckets. They cache **parsed domain objects** under
 * nitter's key layout (`p:`, `i:`, `pr2:`, `ai:`, `sp:`, `bc:`, `cm:`,
 * `cmm:`, `l:`, `pid:`), so an existing nitter redis stays readable.
 *
 * Not ported here: `getCachedTweet` (commented out upstream). The `pid:`
 * bucket is stored as one JSON object per bucket key (nitter uses a redis
 * hash); writes are read-modify-write and repopulate on the next cached user
 * fetch, which is acceptable for the reverse-lookup seam. The m3u8 URLs of
 * spaces/broadcasts are deliberately *not* cached — `getCachedBroadcast`/
 * `getCachedAudioSpace` re-resolve them on every call, like nitter.
 *
 * `cachedRss` is the port of `getCachedRss`/`cacheRss`: the `rss:` hash stores
 * the *rendered* feed plus the min cursor (`Rss`), keyed by the route plugin's
 * `redisKey` (`<page>:<name>[:<cursor>]`). Unlike nitter's two-field hash, the
 * whole `Rss` object is stored as one JSON value — including the
 * `"suspended"` sentinel cursor, whose feed holds the username.
 */

import type { Cache, CacheTtls } from "@tseer/cache";
import { fnv1a32, namespaces, normalizeUsername, userIdField } from "@tseer/cache";
import type {
  AccountInfo,
  AudioSpace,
  Broadcast,
  Community,
  List,
  PhotoRail,
  Rss,
  User,
} from "@tseer/types";

/**
 * nitter's `cache(data: User)`: the pid bucket write plus the `p:` profile.
 * Called directly (not via `cached()`) by the username wrapper, which must
 * not cache empty results.
 */
async function cacheUser(cache: Cache, ttls: CacheTtls, user: User): Promise<void> {
  if (user.username.length === 0) return;
  const name = normalizeUsername(user.username);
  try {
    // The pid bucket segment (`hash(name) div 1_000_000`, FNV-1a here). nitter's
    // hash has no expiry; the JSON bucket repopulates on the next cache write.
    const segment = String(fnv1a32(name) % 1_000_000);
    const bucket =
      (await cache.get<Record<string, string>>(namespaces.userIdBucket, segment)) ?? {};
    bucket[userIdField(name)] = user.id;
    await cache.set(namespaces.userIdBucket, segment, bucket, ttls.base);
  } catch {
    // bucket write is best-effort (nitter: `dawait`)
  }
  await cache.set(namespaces.user, name, user, ttls.base);
}

export interface CachedApiOptions {
  cache?: Cache | undefined;
  ttls?: CacheTtls | undefined;
}

/**
 * The `getCached*` group. When no cache is mounted the wrappers degrade to
 * direct fetches (a cache-less context pays the latency, nothing worse).
 */
/** The wrapper group, for typing the composition. */
export interface CachedMethods {
  cachedUser(username: string, fetch?: boolean): Promise<User | undefined>;
  cachedUsername(userId: string): Promise<string>;
  cachedAccountInfo(username: string, fetch?: boolean): Promise<AccountInfo | undefined>;
  cachedPhotoRail(id: string): Promise<PhotoRail | undefined>;
  cachedBroadcast(id: string): Promise<Broadcast | undefined>;
  cachedSpace(id: string): Promise<AudioSpace | undefined>;
  cachedCommunity(id: string): Promise<Community | undefined>;
  cachedCommunityModerators(id: string): Promise<User[] | undefined>;
  cachedList(username?: string, slug?: string, id?: string): Promise<List | undefined>;
  /** Port of `getCachedRss`/`cacheRss` (key layout is the route's `redisKey`). */
  cachedRss(key: string, factory: () => Promise<Rss>): Promise<Rss>;
}

export function createCachedMethods(
  api: {
    user(username: string): Promise<User | undefined>;
    userById(id: string): Promise<User | undefined>;
    aboutAccount(username: string): Promise<AccountInfo | undefined>;
    photoRail(userId: string): Promise<PhotoRail | undefined>;
    broadcast(id: string): Promise<Broadcast | undefined>;
    space(id: string): Promise<AudioSpace | undefined>;
    broadcastStream(mediaKey: string): Promise<string | undefined>;
    communityInfo(id: string): Promise<Community | undefined>;
    communityModerators(id: string): Promise<import("@tseer/types").Result<User> | undefined>;
    listInfo(id: string): Promise<List | undefined>;
    listBySlug(name: string, slug: string): Promise<List | undefined>;
  },
  options: CachedApiOptions,
): CachedMethods {
  const { cache, ttls } = options;
  if (cache === undefined || ttls === undefined) {
    return {
      cachedUser: (username) => api.user(username),
      cachedUsername: async (userId) => (await api.userById(userId))?.username ?? "",
      cachedAccountInfo: (username) => api.aboutAccount(username),
      cachedPhotoRail: (id) => api.photoRail(id),
      cachedBroadcast: (id) => api.broadcast(id),
      cachedSpace: (id) => api.space(id),
      cachedCommunity: (id) => api.communityInfo(id),
      cachedCommunityModerators: async (id) => (await api.communityModerators(id))?.content,
      cachedList: (username = "", slug = "", id = "") =>
        id.length > 0 ? api.listInfo(id) : api.listBySlug(username, slug),
      cachedRss: (_key, factory) => factory(),
    };
  }

  return {
    /** Port of `getCachedUser`. */
    async cachedUser(username, fetch = true) {
      if (username.length === 0) return undefined;
      const name = normalizeUsername(username);
      const cached = await cache.get<User>(namespaces.user, name);
      if (cached !== undefined) return cached;
      if (!fetch) return undefined;
      const user = await api.user(username);
      if (user !== undefined) await cacheUser(cache, ttls, user);
      return user;
    },

    /** Port of `getCachedUsername`: the `i:` reverse lookup (never caches misses). */
    async cachedUsername(userId) {
      const cached = await cache.get<string>(namespaces.username, userId);
      if (cached !== undefined) return cached;
      const user = await api.userById(userId);
      const username = user?.username ?? "";
      if (username.length > 0) {
        await cache.set(namespaces.username, userId, username, ttls.base);
        if (user !== undefined) await cacheUser(cache, ttls, user);
      }
      return username;
    },

    /** Port of `getCachedAccountInfo`. */
    async cachedAccountInfo(username, fetch = true) {
      if (username.length === 0) return undefined;
      const name = normalizeUsername(username);
      return cache.cached<AccountInfo | undefined>(
        namespaces.accountInfo,
        name,
        ttls.accountInfo,
        async () => {
          if (!fetch) return undefined;
          const info = await api.aboutAccount(username);
          return info;
        },
      );
    },

    /** Port of `getCachedPhotoRail`. */
    cachedPhotoRail(id) {
      if (id.length === 0) return Promise.resolve(undefined);
      return cache.cached<PhotoRail | undefined>(
        namespaces.photoRail,
        normalizeUsername(id),
        ttls.photoRail,
        () => api.photoRail(id),
      );
    },

    /** Port of `getCachedBroadcast` (the m3u8 URL is re-resolved, not cached). */
    async cachedBroadcast(id) {
      if (id.length === 0) return undefined;
      const broadcast = await cache.cached<Broadcast | undefined>(
        namespaces.broadcast,
        id,
        ttls.broadcast,
        () => api.broadcast(id),
      );
      if (broadcast === undefined) return undefined;
      broadcast.m3u8Url = (await api.broadcastStream(broadcast.mediaKey)) ?? "";
      return broadcast;
    },

    /** Port of `getCachedAudioSpace` (running spaces expire 6× faster). */
    async cachedSpace(id) {
      if (id.length === 0) return undefined;
      const cached = await cache.get<AudioSpace>(namespaces.space, id);
      if (cached !== undefined) {
        cached.m3u8Url = (await api.broadcastStream(cached.mediaKey)) ?? "";
        return cached;
      }
      const space = await api.space(id);
      if (space !== undefined) {
        // nitter picks the TTL at cache() time from the stored state
        const ttl = space.state === "RUNNING" ? ttls.spaceRunning : ttls.space;
        await cache.set(namespaces.space, id, space, ttl);
        space.m3u8Url = (await api.broadcastStream(space.mediaKey)) ?? "";
      }
      return space;
    },

    /** Port of `getCachedCommunity`. */
    cachedCommunity(id) {
      if (id.length === 0) return Promise.resolve(undefined);
      return cache.cached<Community | undefined>(namespaces.community, id, ttls.community, () =>
        api.communityInfo(id),
      );
    },

    /** Port of `getCachedCommunityModerators` (the `cmm:` key caches the list). */
    cachedCommunityModerators(id) {
      if (id.length === 0) return Promise.resolve(undefined);
      return cache.cached<User[] | undefined>(
        namespaces.communityModerators,
        id,
        ttls.communityModerators,
        async () => (await api.communityModerators(id))?.content,
      );
    },

    /** Port of `getCachedList` (id-keyed; by-slug results cache under their id). */
    async cachedList(username = "", slug = "", id = "") {
      if (id.length > 0) {
        return cache.cached<List | undefined>(namespaces.list, id, ttls.list, () =>
          api.listInfo(id),
        );
      }
      const list = await api.listBySlug(username, slug);
      if (list !== undefined && list.id.length > 0) {
        await cache.set(namespaces.list, list.id, list, ttls.list);
      }
      return list;
    },

    /** Port of `getCachedRss`/`cacheRss` (a `ttl <= 0` disables the write). */
    cachedRss(key, factory) {
      return cache.cached<Rss>(namespaces.rss, key, ttls.rss, factory);
    },
  };
}
