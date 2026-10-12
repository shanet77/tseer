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

async function cacheUser(cache: Cache, ttls: CacheTtls, user: User): Promise<void> {
  if (user.username.length === 0) return;
  const name = normalizeUsername(user.username);
  try {
    const segment = String(fnv1a32(name) % 1_000_000);
    const bucket =
      (await cache.get<Record<string, string>>(namespaces.userIdBucket, segment)) ?? {};
    bucket[userIdField(name)] = user.id;
    await cache.set(namespaces.userIdBucket, segment, bucket, ttls.base);
  } catch {}
  await cache.set(namespaces.user, name, user, ttls.base);
}

export interface CachedApiOptions {
  cache?: Cache | undefined;
  ttls?: CacheTtls | undefined;
}

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

    cachedPhotoRail(id) {
      if (id.length === 0) return Promise.resolve(undefined);
      return cache.cached<PhotoRail | undefined>(
        namespaces.photoRail,
        normalizeUsername(id),
        ttls.photoRail,
        () => api.photoRail(id),
      );
    },

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

    async cachedSpace(id) {
      if (id.length === 0) return undefined;
      const cached = await cache.get<AudioSpace>(namespaces.space, id);
      if (cached !== undefined) {
        cached.m3u8Url = (await api.broadcastStream(cached.mediaKey)) ?? "";
        return cached;
      }
      const space = await api.space(id);
      if (space !== undefined) {
        const ttl = space.state === "RUNNING" ? ttls.spaceRunning : ttls.space;
        await cache.set(namespaces.space, id, space, ttl);
        space.m3u8Url = (await api.broadcastStream(space.mediaKey)) ?? "";
      }
      return space;
    },

    cachedCommunity(id) {
      if (id.length === 0) return Promise.resolve(undefined);
      return cache.cached<Community | undefined>(namespaces.community, id, ttls.community, () =>
        api.communityInfo(id),
      );
    },

    cachedCommunityModerators(id) {
      if (id.length === 0) return Promise.resolve(undefined);
      return cache.cached<User[] | undefined>(
        namespaces.communityModerators,
        id,
        ttls.communityModerators,
        async () => (await api.communityModerators(id))?.content,
      );
    },

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

    cachedRss(key, factory) {
      return cache.cached<Rss>(namespaces.rss, key, ttls.rss, factory);
    },
  };
}
