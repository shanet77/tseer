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
  parseFormBody,
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
        if (req.query["go"] !== undefined) return reply.redirect("/about", { status: 301 });
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

  it("parses urlencoded form bodies into req.form and sends cookie redirects", async () => {
    const ctx = new Context();
    await ctx.plugin(serverPlugin, { port: 0 });
    ctx.server.route({
      method: "POST",
      path: "/saveprefs",
      handler: (_req, reply) =>
        reply.redirect("/settings", {
          headers: { "set-cookie": ["theme=Dracula; Path=/", "hlsPlayback=on; Path=/"] },
        }),
    });
    ctx.server.route({
      method: "POST",
      path: "/echo-form",
      handler: (req, reply) => reply.json(req.form),
    });

    const saved = await ctx.server.inject({
      method: "POST",
      url: "/saveprefs",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "theme=Dracula",
    });
    expect(saved.status).toBe(302);
    expect(saved.headers["location"]).toBe("/settings");
    expect(saved.headers["set-cookie"]).toBe("theme=Dracula; Path=/, hlsPlayback=on; Path=/");

    const echoed = await ctx.server.inject({
      method: "POST",
      url: "/echo-form",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "referer=%2Fnasa&note=hello+world&theme=first&theme=Dracula",
    });
    expect(echoed.json()).toEqual({ referer: "/nasa", note: "hello world", theme: "Dracula" });

    const empty = await ctx.server.inject({ method: "POST", url: "/echo-form" });
    expect(empty.json()).toEqual({});
  });

  it("runs request hooks before handlers and stops when a hook replies", async () => {
    const ctx = new Context();
    await ctx.plugin(serverPlugin, { port: 0 });
    const seen: string[] = [];
    const disposeHook = ctx.server.hook((req, reply) => {
      seen.push(req.path);
      if (req.query["prefs"] !== undefined) {
        void reply.redirect(req.path, { headers: { "set-cookie": ["theme=Dracula; Path=/"] } });
      }
    });
    ctx.server.route({
      method: "GET",
      path: "/page",
      handler: (_req, reply) => reply.text("page"),
    });

    const hooked = await ctx.server.inject({ url: "/page?prefs=theme%3DDracula" });
    expect(hooked.status).toBe(302);
    expect(hooked.headers["location"]).toBe("/page");
    expect(hooked.headers["set-cookie"]).toBe("theme=Dracula; Path=/");
    expect(hooked.body).toBe("");

    const passed = await ctx.server.inject({ url: "/page" });
    expect(passed.status).toBe(200);
    expect(passed.body).toBe("page");

    disposeHook();
    const after = await ctx.server.inject({ url: "/page?prefs=x" });
    expect(after.body).toBe("page");
    expect(seen).toEqual(["/page", "/page"]);
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

    const route = await ctx.server.inject({ url: "/about" });
    expect(route.body).toBe("route about");

    const missing = await ctx.server.inject({ url: "/nope.css" });
    expect(missing.status).toBe(404);
    expect(missing.body).toBe("not found");

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
    expect(parseFormBody("a=1&broken&c=%2B&d=x+y&=skipped&e=a%3Db")).toEqual({
      a: "1",
      broken: "",
      c: "+",
      d: "x y",
      e: "a=b",
    });
    expect(parseFormBody("")).toEqual({});
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

describe("AppReply.stream", () => {
  it("delivers the body from an async handler, over inject and a real socket", async () => {
    async function* body() {
      yield Buffer.from("HELLO");
      yield Buffer.from("WORLD");
    }
    const ctx = new Context();
    await ctx.plugin(serverPlugin, { port: 0 });
    ctx.server.route({
      method: "GET",
      path: "/stream",
      handler: (_req, reply) =>
        reply.stream?.(body(), "image/jpeg", { status: 200, headers: { etag: "abc" } }),
    });

    const injected = await ctx.server.inject({ url: "/stream" });
    expect(injected.status).toBe(200);
    expect(injected.headers["content-type"]).toBe("image/jpeg");
    expect(injected.headers["etag"]).toBe("abc");
    expect(injected.body).toBe("HELLOWORLD");

    const bound = await ctx.server.start();
    const response = await fetch(`http://127.0.0.1:${bound.port}/stream`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(await response.text()).toBe("HELLOWORLD");
    await ctx.server.close();
  });

  it("streams large bodies incrementally rather than buffering", async () => {
    const CHUNKS = 64;
    const CHUNK_BYTES = 64 * 1024;
    let produced = 0;
    async function* body(): AsyncGenerator<Uint8Array> {
      for (let i = 0; i < CHUNKS; i++) {
        produced++;
        await new Promise((resolve) => setTimeout(resolve, 0));
        yield new Uint8Array(CHUNK_BYTES).fill(i % 256);
      }
    }
    const ctx = new Context();
    await ctx.plugin(serverPlugin, { port: 0 });
    ctx.server.route({
      method: "GET",
      path: "/big",
      handler: (_req, reply) => reply.stream?.(body(), "application/octet-stream"),
    });

    const bound = await ctx.server.start();
    const response = await fetch(`http://127.0.0.1:${bound.port}/big`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("expected a response body");
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(produced).toBeLessThan(CHUNKS);

    let total = first.value?.length ?? 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value?.length ?? 0;
    }
    expect(total).toBe(CHUNKS * CHUNK_BYTES);
    expect(produced).toBe(CHUNKS);
    await ctx.server.close();
  });

  it("honours an explicit content-length and forwards a status", async () => {
    async function* body() {
      yield Buffer.from("12345");
    }
    const ctx = new Context();
    await ctx.plugin(serverPlugin, { port: 0 });
    ctx.server.route({
      method: "GET",
      path: "/len",
      handler: (_req, reply) =>
        reply.stream?.(body(), "application/octet-stream", {
          status: 206,
          headers: { "content-length": "5" },
        }),
    });
    const res = await ctx.server.inject({ url: "/len" });
    expect(res.status).toBe(206);
    expect(res.headers["content-length"]).toBe("5");
    expect(res.body).toBe("12345");
  });
});
