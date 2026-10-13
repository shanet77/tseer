import type { RedisCacheOptions, RedisLike } from "./types.ts";

type IoredisClient = RedisLike & {
  on(event: "error", listener: (err: Error) => void): unknown;
};

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
  }) as IoredisClient;
  client.on("error", (err) => options.onClientError?.(err));
  return client;
}
