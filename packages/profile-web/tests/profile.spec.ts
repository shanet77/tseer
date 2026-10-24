import { fileURLToPath } from "node:url";
import { aboutRoutePlugin } from "@tseer/kernel";
import { serverPlugin } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";
import {
  createApp,
  helloPlugin,
  loadPluginEntry,
  type ProfileState,
  profileEntries,
  resolveProfile,
} from "../src/index.ts";

const examplePath = fileURLToPath(new URL("../examples/json-api.ts", import.meta.url));

describe("default profile", () => {
  it("mounts the ordered plugin list = full nitter parity", async () => {
    const ctx = await createApp({ configText: "" });
    expect(ctx.registry.has(helloPlugin)).toBe(true);
    expect(ctx.get("hello")).toBe("tseer");
    expect(ctx.server).toBeDefined();
    expect(ctx.http).toBeDefined();
    expect(ctx.cache).toBeDefined();
    expect(ctx.accounts).toBeDefined();
    expect(ctx.media).toBeDefined();
    expect(ctx.parsers).toBeDefined();
    expect(ctx.render).toBeDefined();
    expect(ctx.prefs).toBeDefined();
    expect(ctx.twitter).toBeDefined();

    const about = await ctx.server.inject({ url: "/about" });
    expect(about.status).toBe(200);
    expect(about.body).toContain("<h1>About Tseer</h1>");

    const health = await ctx.server.inject({ url: "/.health" });
    expect(health.status).toBe(200);
    expect(health.json()).toMatchObject({
      sessions: { total: 0, limited: 0 },
      requests: { total: 0, apis: {} },
    });

    expect(ctx.media.picUrl("https://pbs.twimg.com/media/x.jpg").startsWith("/pic/")).toBe(true);
    const bad = await ctx.server.inject({
      url: "/video/deadbeefdead0/https%3A%2F%2Fvideo.twimg.com%2Ftest.mp4",
    });
    expect(bad.status).toBe(403);

    expect((await ctx.server.inject({ url: "/i/nope" })).status).toBe(200);
  });
});

describe("[Plugins] remove", () => {
  it("drops a named built-in without touching the rest", async () => {
    const ctx = await createApp({ configText: "[Plugins]\nremove = cache\n" });
    expect(ctx.cache).toBeUndefined();
    expect(ctx.twitter).toBeDefined();
    expect((await ctx.server.inject({ url: "/about" })).status).toBe(200);
  });

  it("derives the cache provider from [Cache] provider when options do not set one", () => {
    const cacheEntry = profileEntries.find((entry) => entry.name === "cache");
    expect(cacheEntry).toBeDefined();
    const ctx = { config: { cacheProvider: "redis" } } as unknown as Context;
    const state = { options: {}, mounted: new Set() } as unknown as ProfileState;
    expect(cacheEntry?.options?.(ctx, state)).toEqual({ provider: "redis" });
    const overridden = {
      options: { cacheProvider: "memory" },
      mounted: new Set(),
    } as unknown as ProfileState;
    expect(cacheEntry?.options?.(ctx, overridden)).toEqual({ provider: "memory" });
  });

  it("cascades through requires: removing sessions unmounts the X stack", async () => {
    const ctx = await createApp({ configText: "[Plugins]\nremove = sessions\n" });
    expect(ctx.accounts).toBeUndefined();
    expect(ctx.twitter).toBeUndefined();
    expect(ctx.media).toBeUndefined();
    expect(ctx.parsers).toBeUndefined();
    expect(ctx.render).toBeDefined();
    expect((await ctx.server.inject({ url: "/about" })).status).toBe(200);
  });

  it("unmounts a route family so its paths 404", async () => {
    const withPanel = await createApp({ configText: "" });
    expect((await withPanel.server.inject({ url: "/i/nope" })).status).toBe(200);
    await withPanel.server.close();

    const ctx = await createApp({ configText: "[Plugins]\nremove = unsupported\n" });
    expect((await ctx.server.inject({ url: "/i/nope" })).status).toBe(404);
  });
});

describe("[Plugins] add", () => {
  it("loads an out-of-tree plugin from a config path", async () => {
    const ctx = await createApp({ configText: `[Plugins]\nadd = "${examplePath}"\n` });

    const res = await ctx.server.inject({ url: "/status/1001.json" });
    expect(res.status).toBe(502);
    expect(res.json()).toMatchObject({ errors: [{ message: "no sessions available" }] });
  });

  it("loads and unloads the added plugin at runtime without restart regressions", async () => {
    const ctx = new Context();
    await ctx.plugin(serverPlugin, { port: 0 });
    await ctx.plugin(aboutRoutePlugin, { title: "t" });
    ctx.provide("twitter", {
      tweet: async () => ({ tweet: { id: "1001", text: "hello from the seam" } }),
    } as unknown as TwitterApi);

    const entry = await loadPluginEntry(examplePath, process.cwd());
    expect(entry.name).toBe("json-api");
    const fiber = await ctx.plugin(entry.plugin);

    const res = await ctx.server.inject({ url: "/status/1001.json" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json()).toMatchObject({ id: "1001", text: "hello from the seam" });
    expect((await ctx.server.inject({ url: "/about" })).status).toBe(200);

    await fiber.dispose();
    expect((await ctx.server.inject({ url: "/status/1001.json" })).status).toBe(404);
    expect((await ctx.server.inject({ url: "/about" })).status).toBe(200);
  });

  it("answers 400 for a non-digit id and keeps the profile on a bad add path", async () => {
    const ctx = await createApp({
      configText: `[Plugins]\nadd = ./does-not-exist.ts, "${examplePath}"\n`,
    });
    expect(ctx.twitter).toBeDefined();

    const res = await ctx.server.inject({ url: "/status/abc.json" });
    expect(res.status).toBe(400);
    expect(res.json()).toMatchObject({ errors: [{ message: "Invalid tweet ID" }] });
  });
});

describe("resolveProfile", () => {
  it("filters when/remove and cascades requires to a fixed point", () => {
    const resolved = resolveProfile(profileEntries, { withoutCache: true }, ["broadcast", "space"]);
    const names = resolved.map((entry) => entry.name);
    expect(names).not.toContain("cache");
    expect(names).not.toContain("broadcast");
    expect(names).not.toContain("space");
    expect(names).toContain("twitter-api");
    expect(names).toContain("preferences");

    const bare = resolveProfile(profileEntries, {}, ["sessions", "parsers"]);
    const bareNames = bare.map((entry) => entry.name);
    expect(bareNames).not.toContain("sessions");
    expect(bareNames).not.toContain("parsers");
    expect(bareNames).not.toContain("twitter-api");
    expect(bareNames).not.toContain("media");
    expect(bareNames).not.toContain("media-routes");
    expect(bareNames).not.toContain("timeline");
  });
});
