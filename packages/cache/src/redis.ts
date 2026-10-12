import type { CacheStore, RedisCacheOptions, RedisLike } from "./types.ts";

const DEFAULT_SCAN_COUNT = 500;

export class RedisCacheStore implements CacheStore {
  private readonly client: RedisLike;
  private readonly scanCount: number;
  private readonly ownsClient: boolean;

  constructor(client: RedisLike, options: RedisCacheOptions = {}) {
    this.client = client;
    this.scanCount = options.scanCount ?? DEFAULT_SCAN_COUNT;
    this.ownsClient = options.client === undefined;
  }

  static async create(options: RedisCacheOptions = {}): Promise<RedisCacheStore> {
    if (options.client !== undefined) return new RedisCacheStore(options.client, options);
    if (options.createClient === undefined) {
      const { createIoredisClient } = await import("./ioredis.ts");
      return new RedisCacheStore(await createIoredisClient(options), options);
    }
    return new RedisCacheStore(await options.createClient(options), options);
  }

  async get(key: string): Promise<string | undefined> {
    const value = await this.client.get(key);
    return value ?? undefined;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    await this.client.set(key, value, "EX", Math.floor(ttlSeconds));
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async deletePattern(pattern: string): Promise<void> {
    let cursor = "0";
    do {
      const [next, keys] = await this.client.scan(cursor, pattern, this.scanCount);
      cursor = next;
      if (keys.length > 0) await this.client.del(...keys);
    } while (cursor !== "0");
  }

  async close(): Promise<void> {
    if (this.ownsClient) await this.client.quit();
  }
}
