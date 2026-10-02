/**
 * ioredis is an optional peer of this seam: only the redis provider needs it,
 * and the memory provider must stay installable without it. It is imported
 * dynamically here so the dependency is loaded on first redis use.
 */
import type { RedisCacheOptions, RedisLike } from "./types.ts";

export async function createIoredisClient(options: RedisCacheOptions = {}): Promise<RedisLike> {
  const mod = (await import("ioredis")) as unknown as {
    default?: new (opts: Record<string, unknown>) => unknown;
  };
  const Redis = mod.default;
  if (Redis === undefined) throw new Error("ioredis did not export a default constructor");
  const client = new Redis({
    host: options.host ?? "localhost",
    port: options.port ?? 6379,
    ...(options.password ? { password: options.password } : {}),
    ...(options.keyPrefix ? { keyPrefix: options.keyPrefix } : {}),
  });
  return client as RedisLike;
}
