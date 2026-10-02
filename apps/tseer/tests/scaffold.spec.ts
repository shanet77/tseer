import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/index.ts";
import hello from "../src/plugins/hello.ts";

describe("scaffold boot", () => {
  it("mounts the scaffold plugin list on a kernel-booted context", async () => {
    const ctx = await createApp({ configText: "" });
    expect(ctx.registry.has(hello)).toBe(true);
    expect(ctx.get("hello")).toBe("tseer");
    expect(ctx.config.port).toBe(8080);
    expect(ctx.server).toBeDefined();
    expect(ctx.http).toBeDefined();
    expect(ctx.cache).toBeDefined();
    const about = await ctx.server.inject({ url: "/about" });
    expect(about.status).toBe(200);
    expect(about.body).toContain("<h1>About Nitter</h1>");
    const health = await ctx.server.inject({ url: "/.health" });
    expect(health.status).toBe(200);
    expect(health.json()).toMatchObject({
      sessions: { total: 0, limited: 0 },
      requests: { total: 0, apis: {} },
    });
  });

  it("passes options through to plugins", async () => {
    const ctx = await createApp({ name: "vitest", configText: "[Server]\nport = 4321\n" });
    expect(ctx.get("hello")).toBe("vitest");
    expect(ctx.config.port).toBe(4321);
  });

  it("serves the cache seam a read-through fill", async () => {
    const ctx = await createApp({ configText: "[Cache]\nlistMinutes = 10\n" });
    const factory = vi.fn(async () => ({ id: "1", username: "alice" }));
    expect(await ctx.cache.cached("p", "alice", 60, factory)).toEqual({
      id: "1",
      username: "alice",
    });
    expect(await ctx.cache.cached("p", "alice", 60, factory)).toEqual({
      id: "1",
      username: "alice",
    });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("omits the cache seam when the plugin is not mounted", async () => {
    const ctx = await createApp({ configText: "", withoutCache: true });
    expect(ctx.cache).toBeUndefined();
  });

  it("unwinds plugin effects when a plugin unloads", async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(hello, { name: "vitest" });
    expect(ctx.get("hello")).toBe("vitest");

    await fiber.dispose();
    expect(ctx.get("hello")).toBeUndefined();
  });
});
