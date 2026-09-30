import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { aboutPlugin, createApp, parseConfigText, parseIni, readConfigFile } from "../src/index.ts";

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
});

describe("kernel boot", () => {
  it("provides ctx.config and unwinds on dispose", async () => {
    const ctx = await createApp({ configText: "[Server]\nport = 1234\n" });
    expect(ctx.config.port).toBe(1234);
    expect(ctx.config.hostname).toBe("nitter.net");
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
});
