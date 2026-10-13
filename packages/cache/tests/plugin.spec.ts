import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";
import cachePlugin from "../src/plugin.ts";
import { fakeRedis } from "./helpers.ts";

describe("cachePlugin", () => {
  it("provides ctx.cache backed by memory by default", async () => {
    const ctx = new Context();
    await ctx.plugin(cachePlugin, { memory: { sweepIntervalMs: 0 } });
    await ctx.cache.set("p", "alice", { id: "1" }, 60);
    expect(await ctx.cache.get("p", "alice")).toEqual({ id: "1" });
  });

  it("runs a read-through cached() fill", async () => {
    const ctx = new Context();
    await ctx.plugin(cachePlugin, { memory: { sweepIntervalMs: 0 } });
    const factory = vi.fn(async () => "value");
    expect(await ctx.cache.cached("p", "alice", 60, factory)).toBe("value");
    expect(await ctx.cache.cached("p", "alice", 60, factory)).toBe("value");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("emits cache/write on every write", async () => {
    const ctx = new Context();
    await ctx.plugin(cachePlugin, { memory: { sweepIntervalMs: 0 } });
    const writes: [string, string, number][] = [];
    ctx.on("cache/write", (ns, key, ttl) => writes.push([ns, key, ttl]));
    await ctx.cache.set("p", "alice", 1, 120);
    expect(writes).toEqual([["p", "alice", 120]]);
  });

  it("mounts the redis provider with an injected client", async () => {
    const ctx = new Context();
    const redis = fakeRedis();
    await ctx.plugin(cachePlugin, {
      provider: "redis",
      redis: { client: redis },
    });
    await ctx.cache.set("p", "alice", { id: "1" }, 60);
    expect(redis.data.has("tseer:v1:p:alice")).toBe(true);
    expect(await ctx.cache.get("p", "alice")).toEqual({ id: "1" });
  });

  it("reads redis connection settings from ctx.config", async () => {
    const ctx = new Context();
    ctx.provide("config" as never, { redisHost: "cache.internal", redisPort: 6380 } as never);
    const seen: Record<string, unknown> = {};
    await ctx.plugin(cachePlugin, {
      provider: "redis",
      redis: {
        createClient: (options) => {
          Object.assign(seen, options);
          return fakeRedis();
        },
      },
    });
    expect(seen.host).toBe("cache.internal");
    expect(seen.port).toBe(6380);
  });

  it("routes redis client errors to the logger", async () => {
    const ctx = new Context();
    const warn = vi.spyOn(ctx.logger, "warn").mockImplementation(() => {});
    let onClientError: ((err: unknown) => void) | undefined;
    await ctx.plugin(cachePlugin, {
      provider: "redis",
      redis: {
        createClient: (options) => {
          onClientError = options.onClientError;
          return fakeRedis();
        },
      },
    });
    onClientError?.(new Error("boom"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("redis client error: boom"));
    warn.mockRestore();
  });

  it("unloads cleanly and drops ctx.cache", async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(cachePlugin, { memory: { sweepIntervalMs: 0 } });
    expect(ctx.cache).toBeDefined();
    await fiber.dispose();
    expect(ctx.cache).toBeUndefined();
  });

  it("survives a store read failure without throwing", async () => {
    const ctx = new Context();
    const warn = vi.spyOn(ctx.logger, "warn").mockImplementation(() => {});
    await ctx.plugin(cachePlugin, {
      provider: "redis",
      redis: {
        client: {
          get: () => Promise.reject(new Error("ECONNREFUSED")),
          set: () => Promise.resolve(),
          del: () => Promise.resolve(0),
          scan: () => Promise.reject(new Error("ECONNREFUSED")),
          quit: () => Promise.resolve(),
        },
      },
    });
    expect(await ctx.cache.get("p", "alice")).toBeUndefined();
    await ctx.cache.clear();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
