import { Context } from "cordis";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/index.ts";
import hello from "../src/plugins/hello.ts";

describe("scaffold boot", () => {
  it("mounts the scaffold plugin list on a cordis context", async () => {
    const ctx = await createApp();
    expect(ctx.registry.has(hello)).toBe(true);
    expect(ctx.get("hello")).toBe("nitter");
  });

  it("passes options through to plugins", async () => {
    const ctx = await createApp({ name: "vitest" });
    expect(ctx.get("hello")).toBe("vitest");
  });

  it("unwinds plugin effects when a plugin unloads", async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(hello, { name: "vitest" });
    expect(ctx.get("hello")).toBe("vitest");

    await fiber.dispose();
    expect(ctx.get("hello")).toBeUndefined();
  });
});
