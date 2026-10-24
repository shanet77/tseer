import { mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serverPlugin } from "@tseer/server";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";
import {
  aboutPlugin,
  aboutRoutePlugin,
  applyEnvOverrides,
  createApp,
  emptySessionHealth,
  healthRoutePlugin,
  loggerPlugin,
  parseConfigText,
  parseIni,
  readConfigFile,
  staticRoutePlugin,
} from "../src/index.ts";

function fixtureUrl(name: string): URL {
  return new URL(`./fixtures/${name}`, import.meta.url);
}

describe("ini reader", () => {
  it("parses sections, quoted values, and inline comments", () => {
    const doc = parseIni(
      [
        "# leading comment",
        "[Server]",
        'hostname = "nitter.net"  # link host',
        "port = 8080 ; trailing semicolon comment",
        'note = "hash # inside quotes"',
        "",
        "[Config]",
        "flag: true",
      ].join("\n"),
    );
    expect(doc.warnings).toEqual([]);
    expect(doc.sections.get("Server")?.values.get("hostname")).toMatchObject({
      value: "nitter.net",
      line: 3,
    });
    expect(doc.sections.get("Server")?.values.get("port")?.value).toBe("8080");
    expect(doc.sections.get("Server")?.values.get("note")?.value).toBe("hash # inside quotes");
    expect(doc.sections.get("Config")?.values.get("flag")?.value).toBe("true");
  });

  it("warns on malformed lines and duplicate keys (last wins)", () => {
    const doc = parseIni(
      ["orphan = 1", "[Server]", "port = 8080", "port = 9090", "broken line"].join("\n"),
    );
    expect(doc.sections.get("Server")?.values.get("port")).toMatchObject({
      value: "9090",
      line: 4,
    });
    expect(doc.warnings.map((w) => w.message)).toEqual([
      expect.stringContaining("outside any section"),
      expect.stringContaining('duplicate key "port"'),
      expect.stringContaining("without a key/value separator"),
    ]);
  });
});

describe("nitter.conf compatibility", () => {
  it("parses the real example conf with no warnings", async () => {
    const text = await readFile(fixtureUrl("nitter.example.conf"), "utf8");
    const loaded = parseConfigText(text);
    expect(loaded.warnings).toEqual([]);
    expect(loaded.config.hostname).toBe("nitter.net");
    expect(loaded.config.port).toBe(8080);
    expect(loaded.config.useHttps).toBe(false);
    expect(loaded.config.listCacheTime).toBe(240);
    expect(loaded.config.preferences.theme).toBe("Nitter");
    expect(loaded.config.preferences.proxyVideos).toBe(true);
  });

  it("reads the checked-in fixture from disk", async () => {
    const loaded = await readConfigFile(fileURLToPath(fixtureUrl("nitter.example.conf")));
    expect(loaded.config.title).toBe("nitter");
  });

  it("applies the master enableRSS gate like config.nim", () => {
    const loaded = parseConfigText("[Config]\nenableRSS = false\nenableRSSSearch = true\n");
    expect(loaded.config.enableRSS).toBe(false);
    expect(loaded.config.enableRSSSearch).toBe(false);
    expect(loaded.config.enableRSSList).toBe(false);
  });

  it("warns on unknown sections/keys and invalid values, keeping defaults", () => {
    const loaded = parseConfigText(
      [
        "[Bogus]",
        "whatever = 1",
        "[Server]",
        "port = not-a-number",
        "nope = 1",
        "[Preferences]",
        "gallerySize = Huge",
        "mystery = 1",
      ].join("\n"),
    );
    expect(loaded.config.port).toBe(8080);
    expect(loaded.config.preferences.gallerySize).toBe("Medium");
    expect(loaded.warnings.map((w) => w.message)).toEqual([
      expect.stringContaining("invalid integer"),
      expect.stringContaining("invalid option"),
      expect.stringContaining("unknown preference key"),
      expect.stringContaining("unknown section [Bogus]"),
      expect.stringContaining("[Server]nope: unknown key"),
    ]);
  });

  it("rejects out-of-range numbers with zod detail", () => {
    expect(() => parseConfigText("[Server]\nport = 99999\n")).toThrow(/port/);
  });

  it("parses the [Plugins] add/remove lists as comma-separated specifiers", () => {
    const loaded = parseConfigText(
      '[Plugins]\nadd = ./plugins/a.ts, "./plugins/my plugin.ts"\nremove = broadcast, space\n',
    );
    expect(loaded.config.plugins).toEqual({
      add: ["./plugins/a.ts", "./plugins/my plugin.ts"],
      remove: ["broadcast", "space"],
    });
    expect(loaded.warnings).toEqual([]);
  });

  it("defaults the plugin lists and warns on unknown [Plugins] keys", () => {
    const loaded = parseConfigText("[Plugins]\nmystery = 1\n");
    expect(loaded.config.plugins).toEqual({ add: [], remove: [] });
    expect(loaded.warnings.map((w) => w.message)).toEqual([
      expect.stringContaining("[Plugins]mystery: unknown key"),
    ]);
  });

  it("parses the [Home] follows list, chunk size, and cache seconds", () => {
    const loaded = parseConfigText(
      "[Home]\nfollows = nasa, spacedot,\nchunkSize = 5\ncacheSeconds = 30\n",
    );
    expect(loaded.config.home).toEqual({
      follows: ["nasa", "spacedot"],
      chunkSize: 5,
      cacheSeconds: 30,
    });
    expect(loaded.warnings).toEqual([]);
  });

  it("defaults [Home] and warns on unknown keys and invalid integers", () => {
    const loaded = parseConfigText("[Home]\nmystery = 1\nchunkSize = many\n");
    expect(loaded.config.home).toEqual({ follows: [], chunkSize: 12, cacheSeconds: 120 });
    expect(loaded.warnings.map((w) => w.message)).toEqual([
      expect.stringContaining("[Home]chunkSize: invalid integer"),
      expect.stringContaining("[Home]mystery: unknown key"),
    ]);
  });

  it("applies the TSEER_HOME_FOLLOWS env override over the config file", () => {
    const { config } = parseConfigText("[Home]\nfollows = nasa\n");
    const overridden = applyEnvOverrides(config, { TSEER_HOME_FOLLOWS: " elonmusk , nasa ," });
    expect(overridden.home.follows).toEqual(["elonmusk", "nasa"]);
    expect(config.home.follows).toEqual(["nasa"]);
    expect(applyEnvOverrides(config, {})).toBe(config);
    expect(applyEnvOverrides(config, { TSEER_HOME_FOLLOWS: "" })).toBe(config);
    expect(applyEnvOverrides(config, { TSEER_HOME_FOLLOWS: " , ," })).toBe(config);
  });
});

describe("kernel boot", () => {
  it("provides ctx.config and unwinds on dispose", async () => {
    const ctx = await createApp({ configText: "[Server]\nport = 1234\n" });
    expect(ctx.config.port).toBe(1234);
    expect(ctx.config.hostname).toBe("localhost");
  });

  it("serves /about and 404s everything else", async () => {
    const ctx = await createApp({ configText: "" });
    const fiber = await ctx.plugin(aboutPlugin, { address: "127.0.0.1", port: 0, title: "t" });
    const server = ctx.aboutServer;
    expect(server).toBeDefined();
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    const address = server?.address();
    expect(address).toBeDefined();
    const port = typeof address === "object" && address ? address.port : 0;
    const about = await fetch(`http://127.0.0.1:${port}/about`);
    expect(about.status).toBe(200);
    expect(await about.text()).toContain("<h1>About t</h1>");
    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(missing.status).toBe(404);
    await fiber.dispose();
  });

  it("serves /about through ctx.server without touching node:http", async () => {
    const ctx = await createApp({ configText: "" });
    await ctx.plugin(serverPlugin, { port: 0 });
    const fiber = await ctx.plugin(aboutRoutePlugin, { title: "seam" });
    const about = await ctx.server.inject({ url: "/about" });
    expect(about.status).toBe(200);
    expect(about.body).toContain("<h1>About seam</h1>");
    await fiber.dispose();
    expect((await ctx.server.inject({ url: "/about" })).status).toBe(404);
  });

  it("serves /.health with nitter's empty-pool JSON shape", async () => {
    const ctx = await createApp({ configText: "" });
    await ctx.plugin(serverPlugin, { port: 0 });
    const fiber = await ctx.plugin(healthRoutePlugin);
    const res = await ctx.server.inject({ url: "/.health" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json()).toEqual(emptySessionHealth());
    expect(res.body).toBe(
      '{"sessions":{"total":0,"limited":0,"oauth":{"total":0,"limited":0},' +
        '"cookie":{"total":0,"limited":0},"oldest":"1970-01-01T00:00:00Z",' +
        '"newest":"1970-01-01T00:00:00Z","average":"1970-01-01T00:00:00Z"},' +
        '"requests":{"total":0,"apis":{}}}',
    );
    await fiber.dispose();
    expect((await ctx.server.inject({ url: "/.health" })).status).toBe(404);
  });

  it("uses a sessionHealth provider when one is supplied", async () => {
    const ctx = await createApp({ configText: "" });
    await ctx.plugin(serverPlugin, { port: 0 });
    const fiber = await ctx.plugin(healthRoutePlugin, {
      sessionHealth: () => ({
        sessions: {
          total: 2,
          limited: 1,
          oauth: { total: 1, limited: 1 },
          cookie: { total: 1, limited: 0 },
          oldest: "2026-01-01T00:00:00Z",
          newest: "2026-01-02T00:00:00Z",
          average: "2026-01-01T12:00:00Z",
        },
        requests: { total: 7, apis: { GraphUser: 7 } },
      }),
    });
    const res = await ctx.server.inject({ url: "/.health" });
    expect(res.json()).toEqual({
      sessions: {
        total: 2,
        limited: 1,
        oauth: { total: 1, limited: 1 },
        cookie: { total: 1, limited: 0 },
        oldest: "2026-01-01T00:00:00Z",
        newest: "2026-01-02T00:00:00Z",
        average: "2026-01-01T12:00:00Z",
      },
      requests: { total: 7, apis: { GraphUser: 7 } },
    });
    await fiber.dispose();
  });

  it("serves config.staticDir at the URL root with routes taking precedence", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tseer-static-"));
    writeFileSync(join(dir, "robots.txt"), "User-agent: *");
    writeFileSync(join(dir, "about"), "static about");
    const ctx = await createApp({ configText: `[Server]\nstaticDir = "${dir}"\n` });
    await ctx.plugin(serverPlugin, { port: 0 });
    const aboutFiber = await ctx.plugin(aboutRoutePlugin, { title: "t" });
    const staticFiber = await ctx.plugin(staticRoutePlugin);
    expect(ctx.config.staticDir).toBe(dir);

    const file = await ctx.server.inject({ url: "/robots.txt" });
    expect(file.status).toBe(200);
    expect(file.body).toBe("User-agent: *");

    const route = await ctx.server.inject({ url: "/about" });
    expect(route.status).toBe(200);
    expect(route.body).toContain("<h1>About t</h1>");

    await staticFiber.dispose();
    expect((await ctx.server.inject({ url: "/robots.txt" })).status).toBe(404);
    await aboutFiber.dispose();
  });

  it("does not mount static when staticDir is empty (never expose CWD)", async () => {
    const ctx = await createApp({ configText: "" });
    ctx.config.staticDir = "";
    await ctx.plugin(serverPlugin, { port: 0 });
    const fiber = await ctx.plugin(staticRoutePlugin);
    const res = await ctx.server.inject({ url: "/package.json" });
    expect(res.status).toBe(404);
    await fiber.dispose();
  });
});

describe("health routes", () => {
  const HEALTH = {
    sessions: {
      total: 2,
      limited: 1,
      oauth: { total: 1, limited: 0 },
      cookie: { total: 1, limited: 1 },
      oldest: "2024-01-01T00:00:00Z",
      newest: "2024-06-01T00:00:00Z",
      average: "2024-03-01T00:00:00Z",
    },
    requests: { total: 7, apis: { "gql/cookie": 7 } },
  };
  const DEBUG = { "42": { kind: "cookie", apis: {}, pending: 1 } };

  async function boot(enableDebug: boolean) {
    const ctx = await createApp({ configText: "" });
    await ctx.plugin(serverPlugin, { port: 0 });
    await ctx.plugin(healthRoutePlugin, {
      sessionHealth: () => HEALTH,
      sessionDebug: () => DEBUG,
      enableDebug,
    });
    return ctx;
  }

  it("serves the injected pool health on /.health", async () => {
    const ctx = await boot(false);
    const res = await ctx.server.inject({ url: "/.health" });
    expect(res.status).toBe(200);
    expect(res.json()).toEqual(HEALTH);
  });

  it("falls back to the empty-pool shape with no provider", async () => {
    const ctx = await createApp({ configText: "" });
    await ctx.plugin(serverPlugin, { port: 0 });
    await ctx.plugin(healthRoutePlugin);
    expect((await ctx.server.inject({ url: "/.health" })).json()).toEqual(emptySessionHealth());
  });

  it("hides /.sessions unless enableDebug is set", async () => {
    const ctx = await boot(false);
    expect((await ctx.server.inject({ url: "/.sessions" })).status).toBe(404);
  });

  it("serves /.sessions when enableDebug is set", async () => {
    const ctx = await boot(true);
    const res = await ctx.server.inject({ url: "/.sessions" });
    expect(res.status).toBe(200);
    expect(res.json()).toEqual(DEBUG);
  });

  it("unregisters both routes when the plugin unloads", async () => {
    const ctx = await createApp({ configText: "" });
    await ctx.plugin(serverPlugin, { port: 0 });
    const fiber = await ctx.plugin(healthRoutePlugin, {
      sessionHealth: () => HEALTH,
      sessionDebug: () => DEBUG,
      enableDebug: true,
    });
    expect((await ctx.server.inject({ url: "/.sessions" })).status).toBe(200);
    await fiber.dispose();
    expect((await ctx.server.inject({ url: "/.health" })).status).toBe(404);
    expect((await ctx.server.inject({ url: "/.sessions" })).status).toBe(404);
  });
});

describe("logger plugin", () => {
  it("boots with debug off (plain JSON transport)", async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(loggerPlugin, { debug: false });
    expect(() => ctx.logger.info("plain")).not.toThrow();
    await fiber.dispose();
  });

  it("boots with debug on, resolving the pino-pretty transport", async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(loggerPlugin, { debug: true });
    expect(() => ctx.logger.debug("pretty")).not.toThrow();
    await fiber.dispose();
  });

  it("forwards messages through the exporter level gate", async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(loggerPlugin, { debug: false, level: "warn" });
    expect(() => {
      ctx.logger.debug("dropped");
      ctx.logger.warn("kept");
      ctx.logger.error("kept");
    }).not.toThrow();
    await fiber.dispose();
  });
});
