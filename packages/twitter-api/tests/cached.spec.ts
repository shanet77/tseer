import { CacheService, fnv1a32, MemoryCacheStore, resolveTtls } from "@tseer/cache";
import { Parsers } from "@tseer/twitter-parser";
import { describe, expect, it } from "vitest";
import { createDomainTwitterApi } from "../src/domain.ts";
import type { RawTwitterApi } from "../src/fetchers.ts";

function stubRaw(handlers: Partial<RawTwitterApi>): RawTwitterApi {
  const base = {
    user: async () => userPayload(),
    userById: async () => userPayload(),
    aboutAccount: async () => ({
      data: {
        user_result_by_screen_name: { result: { core: { screen_name: "jack", name: "Jack" } } },
      },
    }),
    photoRail: async () => "{}",
    broadcast: async () => ({
      data: { broadcast: { broadcast_id: "BC1", state: "ended", media_key: "mk" } },
    }),
    space: async () => ({
      data: { audioSpace: { metadata: { rest_id: "SP1", state: "running", media_key: "mk2" } } },
    }),
    broadcastStream: async () => "https://video.twimg.com/live.m3u8",
    communityInfo: async () => "{}",
    communityModerators: async () => "{}",
    listInfo: async () => ({ data: { list: { id_str: "55", name: "L" } } }),
    listBySlug: async () => ({ data: { list: { id_str: "56", name: "S" } } }),
  } as unknown as RawTwitterApi;
  return { ...base, ...handlers } as RawTwitterApi;
}

function userPayload(): string {
  return JSON.stringify({
    user_results: {
      result: {
        rest_id: "1",
        legacy: { id_str: "1", screen_name: "jack", name: "Jack" },
      },
    },
  });
}

function memoryCache() {
  return {
    cache: new CacheService(new MemoryCacheStore()),
    ttls: resolveTtls({ listCacheTime: 5 }),
  };
}

describe("createCachedMethods", () => {
  it("serves cachedUser from the p: namespace and writes the pid bucket", async () => {
    const { cache, ttls } = memoryCache();
    let fetches = 0;
    const raw = stubRaw({
      user: async () => {
        fetches += 1;
        return userPayload();
      },
    });

    const api = createDomainTwitterApi(raw, new Parsers(), { cache, ttls });
    expect((await api.cachedUser("Jack"))?.username).toBe("jack");
    expect((await api.cachedUser("jack"))?.username).toBe("jack");
    expect(fetches).toBe(1);

    expect(await api.cachedUser("missing", false)).toBeUndefined();

    const segment = String(fnv1a32("jack") % 1_000_000);
    expect(await cache.get<Record<string, string>>("pid", segment)).toEqual({ jack: "1" });
  });

  it("ports getCachedUsername: i: key, never caches misses, fills p: too", async () => {
    const { cache, ttls } = memoryCache();
    let fetches = 0;
    const raw = stubRaw({
      userById: async () => {
        fetches += 1;
        return userPayload();
      },
    });
    const api = createDomainTwitterApi(raw, new Parsers(), { cache, ttls });

    expect(await api.cachedUsername("1")).toBe("jack");
    expect(await api.cachedUsername("1")).toBe("jack");
    expect(fetches).toBe(1);
    expect(await cache.get<string>("i", "1")).toBe("jack");
    expect(await cache.get("p", "jack")).toMatchObject({ username: "jack" });
  });

  it("ports the accountInfo wrapper and the fetch=false path", async () => {
    const { cache, ttls } = memoryCache();
    let fetches = 0;
    const raw = stubRaw({
      aboutAccount: async () => {
        fetches += 1;
        return {
          data: {
            user_result_by_screen_name: { result: { core: { screen_name: "jack", name: "Jack" } } },
          },
        };
      },
    });
    const api = createDomainTwitterApi(raw, new Parsers(), { cache, ttls });

    expect((await api.cachedAccountInfo("JACK"))?.username).toBe("jack");
    expect((await api.cachedAccountInfo("jack"))?.username).toBe("jack");
    expect(fetches).toBe(1);
    expect(await api.cachedAccountInfo("jane", false)).toBeUndefined();
  });

  it("ports the broadcast/space wrappers: m3u8 always re-resolved", async () => {
    const { cache, ttls } = memoryCache();
    let streams = 0;
    const raw = stubRaw({
      broadcastStream: async () => {
        streams += 1;
        return `https://video.twimg.com/${streams}.m3u8`;
      },
    });
    const api = createDomainTwitterApi(raw, new Parsers(), { cache, ttls });

    const bc = await api.cachedBroadcast("BC1");
    expect(bc?.m3u8Url).toBe("https://video.twimg.com/1.m3u8");
    expect((await api.cachedBroadcast("BC1"))?.m3u8Url).toBe("https://video.twimg.com/2.m3u8");
    expect(await cache.get("bc", "BC1")).toMatchObject({ id: "BC1" });

    const sp = await api.cachedSpace("SP1");
    expect(sp?.state).toBe("RUNNING");
    expect(sp?.m3u8Url).toBe("https://video.twimg.com/3.m3u8");
    expect(await cache.get("sp", "SP1")).toMatchObject({ id: "SP1", state: "RUNNING" });
  });

  it("ports getCachedList: by id via cache, by slug cached under its id", async () => {
    const { cache, ttls } = memoryCache();
    let bySlug = 0;
    const raw = stubRaw({
      listBySlug: async () => {
        bySlug += 1;
        return { data: { list: { id_str: "56", name: "S" } } };
      },
    });
    const api = createDomainTwitterApi(raw, new Parsers(), { cache, ttls });

    expect((await api.cachedList(undefined, undefined, "55"))?.id).toBe("55");
    expect(await cache.get("l", "55")).toMatchObject({ id: "55" });

    expect((await api.cachedList("jack", "slug"))?.id).toBe("56");
    expect((await api.cachedList("jack", "slug"))?.id).toBe("56");
    expect(bySlug).toBe(2);
    expect(await cache.get("l", "56")).toMatchObject({ id: "56" });
  });

  it("degrades to direct fetches without a cache", async () => {
    const raw = stubRaw({});
    const api = createDomainTwitterApi(raw, new Parsers());
    expect(await api.cachedUser("jack")).toMatchObject({ username: "jack" });
    expect(await api.cachedUsername("1")).toBe("jack");
  });
});
