import { preferencesSchema } from "@tseer/prefs";
import { describe, expect, it } from "vitest";
import { default as preferencesPlugin } from "../src/preferences.ts";
import { type BootedRoute, bootRoute } from "./support.ts";

const boot = (instanceFollows: string[] = ["nasa", "spacex"]): Promise<BootedRoute> =>
  bootRoute(preferencesPlugin, {
    pluginOptions: { hostname: "nitter.example", useHttps: false },
    prefs: { preferences: { ...preferencesSchema.parse({}), follows: instanceFollows } },
  });

function post(url: string, cookie = "", referer = "/esa") {
  return {
    method: "POST" as const,
    url,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(cookie.length > 0 ? { cookie } : {}),
    },
    payload: `referer=${encodeURIComponent(referer)}`,
  };
}

function cookiesHeader(res: { headers: Record<string, string> }): string {
  return res.headers["set-cookie"] ?? "";
}

describe("follow/unfollow routes", () => {
  it("follow seeds from the instance default and snapshots the full list", async () => {
    const { ctx } = await boot();
    const res = await ctx.server.inject(post("/follow/esa"));
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/esa");
    expect(cookiesHeader(res)).toContain("follows=nasa.spacex.esa; ");
  });

  it("follow appends to an existing cookie list", async () => {
    const { ctx } = await boot();
    const res = await ctx.server.inject(post("/follow/esa", "follows=jaxa"));
    expect(cookiesHeader(res)).toContain("follows=jaxa.esa; ");
  });

  it("unfollow removes from the default list", async () => {
    const { ctx } = await boot();
    const res = await ctx.server.inject(post("/unfollow/NASA"));
    expect(cookiesHeader(res)).toContain("follows=spacex; ");
  });

  it("unfollowing everyone stores an empty (not expired) cookie", async () => {
    const { ctx } = await boot();
    const res = await ctx.server.inject(post("/unfollow/esa", "follows=esa"));
    const header = cookiesHeader(res);
    expect(header).toContain("follows=; ");
    const expires = Date.parse(header.match(/follows=; Expires=([^;]+);/)?.[1] ?? "");
    expect(expires).toBeGreaterThan(Date.now());
  });

  it("returning to the instance default expires the cookie", async () => {
    const { ctx } = await boot();
    const res = await ctx.server.inject(post("/unfollow/esa", "follows=nasa.spacex.esa"));
    const header = cookiesHeader(res);
    const expires = Date.parse(header.match(/follows=; Expires=([^;]+);/)?.[1] ?? "");
    expect(expires).toBeLessThan(Date.now());
  });

  it("rejects invalid usernames", async () => {
    const { ctx } = await boot();
    const res = await ctx.server.inject(post("/follow/bad%3Bname"));
    expect(res.status).toBe(400);
    expect(cookiesHeader(res)).toBe("");
  });

  it("ignores ?follows= query overrides when building the snapshot", async () => {
    const { ctx } = await boot();
    const res = await ctx.server.inject(post("/follow/esa?follows=evil"));
    expect(cookiesHeader(res)).toContain("follows=nasa.spacex.esa; ");
  });
});

describe("settings follows field", () => {
  it("renders the visitor's list in the Following textarea", async () => {
    const { ctx } = await boot();
    const res = await ctx.server.inject({
      url: "/settings",
      headers: { cookie: "follows=esa.jaxa" },
    });
    expect(res.body).toContain("<legend>Following</legend>");
    expect(res.body).toMatch(/<textarea[^>]*name="follows"[^>]*>esa\njaxa<\/textarea>/);
  });

  it("prefills the instance default when there is no cookie", async () => {
    const { ctx } = await boot();
    const res = await ctx.server.inject({ url: "/settings" });
    expect(res.body).toMatch(/<textarea[^>]*name="follows"[^>]*>nasa\nspacex<\/textarea>/);
  });

  it("saveprefs stores an edited list", async () => {
    const { ctx } = await boot();
    const res = await ctx.server.inject({
      method: "POST",
      url: "/saveprefs",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `referer=%2F&follows=${encodeURIComponent("esa\r\n@jaxa")}`,
    });
    expect(cookiesHeader(res)).toContain("follows=esa.jaxa; ");
  });
});
