/** Unsupported-feature route plugin tests — static panel, no `twitter` seam.
 * Also pins the radix interplay: the denied `/i` values (`status`, `lists`,
 * `user`) keep resolving to their sibling plugins' real handlers. */

import { prefsPlugin } from "@tseer/prefs";
import { serverPlugin } from "@tseer/server";
import { renderPlugin } from "@tseer/views";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";
import { default as unsupportedPlugin } from "../src/unsupported.ts";

async function boot(): Promise<{ ctx: Context; unload: () => Promise<void> }> {
  const ctx = new Context();
  await ctx.plugin(serverPlugin, { port: 0 });
  await ctx.plugin(prefsPlugin, {});
  await ctx.plugin(renderPlugin, {
    title: "nitter",
    hostname: "localhost",
    useHttps: false,
    picUrl: (url) => `/pic/${url}`,
    origPicUrl: (url) => `/pic/orig/${url}`,
    vidUrl: (url) => `/video/sig/${url}`,
  });
  const fiber = await ctx.plugin(unsupportedPlugin);
  return { ctx, unload: () => fiber.dispose() };
}

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
      expect(res.body, url).toContain("https://github.com/zedeus/nitter/issues");
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
    // Upstream's unsupported router claims only the bare `/@name/lists`;
    // `/@name/lists/@slug` is list.nim's. Without the list plugin mounted it
    // answers 404, not the misleading "unsupported" panel.
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
