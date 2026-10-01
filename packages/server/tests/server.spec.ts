import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";
import {
  normalizeMethod,
  normalizePath,
  normalizePrefix,
  parseCookies,
  serverPlugin,
} from "../src/index.ts";

function makeDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "tseer-server-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

describe("route registry", () => {
  it("serves a registered route and 404s unknown paths", async () => {
    const ctx = new Context();
    await ctx.plugin(serverPlugin, { port: 0 });
    ctx.server.route({
      method: "GET",
      path: "/about",
      handler: (_req, reply) => reply.html("<h1>x</h1>"),
    });

    const hit = await ctx.server.inject({ url: "/about" });
    expect(hit.status).toBe(200);
    expect(hit.headers["content-type"]).toContain("text/html");
    expect(hit.body).toContain("<h1>x</h1>");

    const miss = await ctx.server.inject({ url: "/nope" });
    expect(miss.status).toBe(404);
    expect(miss.body).toBe("not found");
  });

  it("exposes params, query, cookies, and reply helpers", async () => {
    const ctx = new Context();
    await ctx.plugin(serverPlugin, { port: 0 });
    ctx.server.route({
      method: "get",
      path: "/user/:name",
      handler: (req, reply) => {
        if (req.query["format"] === "json") return reply.json({ name: req.params["name"] });
        if (req.query["go"] !== undefined) return reply.redirect("/about", 301);
        return reply.text(`${req.params["name"]}:${req.cookies["theme"] ?? ""}`, {
          headers: { "x-echo": req.query["echo"] ?? "" },
        });
      },
    });

    const text = await ctx.server.inject({
      url: "/user/alice?echo=hi",
      headers: { cookie: "theme=Nitter" },
    });
    expect(text.status).toBe(200);
    expect(text.body).toBe("alice:Nitter");
    expect(text.headers["x-echo"]).toBe("hi");

    const json = await ctx.server.inject({ url: "/user/bob?format=json" });
    expect(json.json()).toEqual({ name: "bob" });

    const redirect = await ctx.server.inject({ url: "/user/c?go=1" });
    expect(redirect.status).toBe(301);
    expect(redirect.headers["location"]).toBe("/about");
  });

  it("unregisters a route when its disposer runs", async () => {
    const ctx = new Context();
    await ctx.plugin(serverPlugin, { port: 0 });
    const dispose = ctx.server.route({
      method: "GET",
      path: "/temp",
      handler: (_req, reply) => reply.text("here"),
    });
    expect((await ctx.server.inject({ url: "/temp" })).status).toBe(200);
    dispose();
    expect((await ctx.server.inject({ url: "/temp" })).status).toBe(404);
  });

  it("maps handler errors to 500 without leaking fastify types", async () => {
    const ctx = new Context();
    await ctx.plugin(serverPlugin, { port: 0 });
    ctx.server.route({
      method: "GET",
      path: "/boom",
      handler: () => {
        throw new Error("kaput");
      },
    });
    const res = await ctx.server.inject({ url: "/boom" });
    expect(res.status).toBe(500);
    expect(res.body).toContain("kaput");
  });
});

describe("static files", () => {
  it("serves files with content types, blocks traversal, 404s missing", async () => {
    const ctx = new Context();
    await ctx.plugin(serverPlugin, { port: 0 });
    const dir = makeDir({ "app.css": "body{}", "nested.txt": "hi" });
    ctx.server.static("/static", dir);

    const css = await ctx.server.inject({ url: "/static/app.css" });
    expect(css.status).toBe(200);
    expect(css.headers["content-type"]).toContain("text/css");
    expect(css.body).toBe("body{}");

    const missing = await ctx.server.inject({ url: "/static/nope.css" });
    expect(missing.status).toBe(404);

    const traversal = await ctx.server.inject({ url: "/static/../server.ts" });
    expect(traversal.status).toBe(404);
  });

  it("serves at the URL root (`/` prefix), registered routes win", async () => {
    const ctx = new Context();
    await ctx.plugin(serverPlugin, { port: 0 });
    const dir = makeDir({ about: "static about", "robots.txt": "User-agent: *" });
    ctx.server.route({
      method: "GET",
      path: "/about",
      handler: (_req, reply) => reply.text("route about"),
    });
    ctx.server.static("/", dir);

    const file = await ctx.server.inject({ url: "/robots.txt" });
    expect(file.status).toBe(200);
    expect(file.body).toBe("User-agent: *");

    // Fastify radix precedence: specific route beats the root wildcard.
    const route = await ctx.server.inject({ url: "/about" });
    expect(route.body).toBe("route about");

    // Unknown paths keep the plain-text 404 contract.
    const missing = await ctx.server.inject({ url: "/nope.css" });
    expect(missing.status).toBe(404);
    expect(missing.body).toBe("not found");

    // The directory itself is never listed.
    const root = await ctx.server.inject({ url: "/" });
    expect(root.status).toBe(404);
  });
});

describe("validation", () => {
  it("rejects bad methods, paths, and prefixes", () => {
    expect(() => normalizeMethod("BREW")).toThrow(/unsupported method/);
    expect(() => normalizePath("about")).toThrow(/must start with/);
    expect(() => normalizePrefix("static")).toThrow(/must start with/);
    expect(normalizePrefix("/")).toBe("/");
    expect(normalizePrefix("/static/")).toBe("/static");
    expect(parseCookies("a=1; a=2; broken")).toEqual({ a: "1" });
    expect(parseCookies(undefined)).toEqual({});
  });

  it("start() is idempotent, close() resets, plugin dispose closes", async () => {
    const ctx = new Context();
    const seen: { address: string; port: number }[] = [];
    ctx.on("server/listening", (info) => seen.push(info));
    const fiber = await ctx.plugin(serverPlugin, { address: "127.0.0.1", port: 0 });
    const first = await ctx.server.start();
    const second = await ctx.server.start();
    expect(second).toEqual(first);
    expect(first.port).toBeGreaterThan(0);
    expect(seen).toEqual([first]);

    const res = await fetch(`http://127.0.0.1:${first.port}/nope`);
    expect(res.status).toBe(404);
    await res.text().catch(() => undefined);

    await ctx.server.close();
    expect(ctx.server.address()).toBeUndefined();
    await fiber.dispose();
  });
});
