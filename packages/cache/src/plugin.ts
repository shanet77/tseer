import type { Context } from "cordis";
import { MemoryCacheStore } from "./memory.ts";
import { RedisCacheStore } from "./redis.ts";
import { CacheService } from "./service.ts";
import { type CacheTtls, resolveTtls } from "./ttls.ts";
import type { Cache, CachePluginOptions, CacheStore } from "./types.ts";

declare module "cordis" {
  interface Context {
    cache: Cache;
  }

  interface Events {
    "cache/write": (ns: string, key: string, ttlSeconds: number) => void;
  }
}

interface CacheConfigSubset {
  listCacheTime?: number | undefined;
  rssCacheTime?: number | undefined;
  redisHost?: string | undefined;
  redisPort?: number | undefined;
  redisPassword?: string | undefined;
}

function readConfig(ctx: Context): CacheConfigSubset | undefined {
  return ctx.get("config" as never) as CacheConfigSubset | undefined;
}

async function createStore(ctx: Context, options: CachePluginOptions): Promise<CacheStore> {
  if (options.provider === "redis") {
    const config = readConfig(ctx);
    return await RedisCacheStore.create({
      host: options.redis?.host ?? config?.redisHost,
      port: options.redis?.port ?? config?.redisPort,
      password: options.redis?.password ?? config?.redisPassword,
      onClientError: (err) => {
        const e = err as Error;
        ctx.logger.warn(`cache: redis client error: ${e?.message || e?.name || String(err)}`);
      },
      ...options.redis,
    });
  }
  return new MemoryCacheStore(options.memory);
}

export default async function cachePlugin(
  ctx: Context,
  options: CachePluginOptions = {},
): Promise<() => Promise<void>> {
  const provider = options.provider ?? "memory";
  const store = await createStore(ctx, options);
  const ttls: CacheTtls = resolveTtls(readConfig(ctx) ?? {});
  const service = new CacheService(store, {
    prefix: options.prefix,
    version: options.version,
    onWrite: (ns, key, ttlSeconds) => ctx.emit("cache/write", ns, key, ttlSeconds),
    onError: (message, err) => ctx.logger.warn(`cache: ${message}: ${(err as Error)?.message}`),
  });

  const dispose = ctx.provide("cache", service);
  ctx.logger.info(
    `cache: ${provider} provider ready (prefix=${options.prefix ?? "tseer"}, ` +
      `version=${options.version ?? "v1"}, list=${ttls.list}s, rss=${ttls.rss}s)`,
  );
  return async () => {
    await dispose();
    await service.close();
  };
}
