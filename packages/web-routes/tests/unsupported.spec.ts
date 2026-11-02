import { describe, expect, it } from "vitest";
import { default as unsupportedPlugin } from "../src/unsupported.ts";
import { type BootedRoute, bootRoute } from "./support.ts";

const boot = (): Promise<BootedRoute> => bootRoute(unsupportedPlugin);

describe("unsupportedPlugin", () => {
  it("renders the feature panel for every unsupported path", async () => {
    const { ctx } = await boot();
    for (const url of [
      "/about/feature",
      "/login",
      "/login/reset",
      "/nasa/lists",
      "/intent",
      "/intent/share",
      "/i",
      "/i/notifications",
      "/i/notifications/all",
    ]) {
      const res = await ctx.server.inject({ url });
      expect(res.status, url).toBe(200);
      expect(res.body, url).toContain("Unsupported feature");
      expect(res.body, url).toContain("it might in the future");
    }
  });

  it("denies the paths sibling plugins own", async () => {
    const { ctx } = await boot();
    for (const url of [
      "/intent/user",
      "/intent/follow",
      "/i/status",
      "/i/lists",
      "/i/user",
      "/i/status/1001",
      "/i/lists/123",
    ]) {
      const res = await ctx.server.inject({ url });
      expect(res.status, url).toBe(404);
      expect(res.body, url).toContain("Page not found");
      expect(res.body, url).not.toContain("Unsupported feature");
    }
  });

  it("keeps the list timeline path for the list plugin", async () => {
    const { ctx } = await boot();
    const res = await ctx.server.inject({ url: "/nasa/lists/space" });
    expect(res.status).toBe(404);
    expect(res.body).not.toContain("Unsupported feature");
  });

  it("unloads cleanly: disposed routes answer 404", async () => {
    const { ctx, unload } = await boot();
    expect((await ctx.server.inject({ url: "/login" })).status).toBe(200);
    await unload();
    expect((await ctx.server.inject({ url: "/login" })).status).toBe(404);
  });
});
