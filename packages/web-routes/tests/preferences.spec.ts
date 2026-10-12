import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prefsPlugin } from "@tseer/prefs";
import { serverPlugin } from "@tseer/server";
import { renderPlugin } from "@tseer/views";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";
import { default as preferencesPlugin } from "../src/preferences.ts";

async function makeStaticDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tseer-prefs-"));
  await mkdir(join(dir, "css", "themes"), { recursive: true });
  for (const theme of ["auto.css", "dracula.css", "twitter_dark.css"]) {
    await writeFile(join(dir, "css", "themes", theme), "");
  }
  return dir;
}

async function boot(
  config: { hostname?: string; useHttps?: boolean; staticDir?: string } = {},
): Promise<{ ctx: Context; unload: () => Promise<void> }> {
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
  const fiber = await ctx.plugin(preferencesPlugin, {
    hostname: "nitter.example",
    useHttps: false,
    ...config,
  });
  return { ctx, unload: () => fiber.dispose() };
}

function cookiesHeader(res: { headers: Record<string, string> }): string {
  return res.headers["set-cookie"] ?? "";
}

function cookieExpires(header: string, name: string): number {
  const match = header.match(new RegExp(`${name}=[^;]*; Expires=([^;]+);`));
  return match?.[1] === undefined ? Number.NaN : Date.parse(match[1]);
}

describe("preferencesPlugin", () => {
  it("renders the settings form with themes, widgets, and the bookmark url", async () => {
    const staticDir = await makeStaticDir();
    const { ctx } = await boot({ staticDir });

    const res = await ctx.server.inject({ url: "/settings" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<title>Preferences | nitter</title>");

    expect(res.body).toContain('<form method="post" action="/saveprefs" autocomplete="off">');
    expect(res.body).toContain('<input name="referer" style="display: none" value="/"/>');
    expect(res.body).toContain("<legend>Display</legend>");
    expect(res.body).toContain("<legend>Media</legend>");
    expect(res.body).toContain("<legend>Link replacements (blank to disable)</legend>");
    expect(res.body).toContain('title="squareAvatars"');
    expect(res.body).toContain('placeholder="Nitter hostname"');

    expect(res.body).toContain('name="mp4Playback" type="checkbox" checked');
    expect(res.body).toContain('name="squareAvatars" type="checkbox"/>');
    expect(res.body).toContain('<option value="Auto">Auto</option>');
    expect(res.body).toContain('<option value="Dracula">Dracula</option>');
    expect(res.body).toContain('<option value="Twitter Dark">Twitter Dark</option>');
    expect(res.body).not.toContain('<option value="Mastodon">');

    expect(res.body).toContain('<pre class="prefs-code">http://nitter.example/?prefs=</pre>');
    expect(res.body).toContain('action="/resetprefs"');
  });

  it("reflects cookie prefs in the form state and the bookmark code", async () => {
    const { ctx } = await boot();
    const res = await ctx.server.inject({
      url: "/settings",
      headers: { cookie: "theme=Dracula; squareAvatars=on; replaceTwitter=nitter.example" },
    });
    expect(res.status).toBe(200);
    expect(res.body).toContain('<option value="Dracula" selected>');
    expect(res.body).toContain('name="squareAvatars" type="checkbox" checked');
    expect(res.body).toContain('value="nitter.example"');
    expect(res.body).toContain(
      '<pre class="prefs-code">http://nitter.example/?prefs=theme=Dracula,squareAvatars=on,replaceTwitter=nitter.example</pre>',
    );
  });

  it("uses the query referer as the form's return path", async () => {
    const { ctx } = await boot();
    const res = await ctx.server.inject({ url: "/settings?referer=%2Fnasa" });
    expect(res.body).toContain('<input name="referer" style="display: none" value="/nasa"/>');
  });

  it("redirects bare /settings/:i back to /settings", async () => {
    const { ctx } = await boot();
    const res = await ctx.server.inject({ url: "/settings/whatever" });
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/settings");
  });

  it("saves non-default prefs as cookies and redirects to the form referer", async () => {
    const { ctx } = await boot();
    const res = await ctx.server.inject({
      method: "POST",
      url: "/saveprefs",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "referer=%2Fnasa&theme=Dracula&squareAvatars=on&replaceTwitter=nitter.example",
    });
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/nasa");

    const header = cookiesHeader(res);
    for (const [name, value] of [
      ["theme", "Dracula"],
      ["squareAvatars", "on"],
      ["replaceTwitter", "nitter.example"],
    ] as const) {
      expect(header, name).toContain(`${name}=${value}; `);
      const days = (cookieExpires(header, name) - Date.now()) / 86_400_000;
      expect(days, name).toBeGreaterThan(350);
      expect(header, name).toContain(`${name}=${value}; Expires=`);
      expect(header, name).toContain("Path=/; HttpOnly; SameSite=Lax");
    }
    expect(header).not.toContain("Secure");

    expect(header).toContain("mp4Playback=; ");
  });

  it("expires default-valued prefs only when the request carried the cookie", async () => {
    const { ctx } = await boot();

    const bare = await ctx.server.inject({
      method: "POST",
      url: "/saveprefs",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "theme=Nitter",
    });
    const bareHeader = cookiesHeader(bare);
    expect(bareHeader).not.toContain("hlsPlayback=");
    expect(bareHeader).not.toContain("infiniteScroll=");

    const carried = await ctx.server.inject({
      method: "POST",
      url: "/saveprefs",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: "theme=Nitter",
      },
      payload: "theme=Nitter",
    });
    const carriedHeader = cookiesHeader(carried);
    expect(carriedHeader).toContain("theme=; ");
    expect(cookieExpires(carriedHeader, "theme")).toBeLessThan(Date.now());
  });

  it("resets prefs: expires every carried cookie, bounces to /settings", async () => {
    const { ctx } = await boot();
    const res = await ctx.server.inject({
      method: "POST",
      url: "/resetprefs",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: "theme=Dracula; squareAvatars=on; unrelated=1",
      },
      payload: "referer=%2Fnasa",
    });
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/settings?referer=%2Fnasa");

    const header = cookiesHeader(res);
    expect(header).toContain("theme=; ");
    expect(header).toContain("squareAvatars=; ");
    expect(header).not.toContain("hlsPlayback=");
  });

  it("enables hls/mp4 playback and returns to the referer", async () => {
    const { ctx } = await boot();
    for (const [path, name] of [
      ["/enablehls", "hlsPlayback"],
      ["/enablemp4", "mp4Playback"],
    ] as const) {
      const res = await ctx.server.inject({
        method: "POST",
        url: path,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "referer=%2Fnasa",
      });
      expect(res.status, path).toBe(302);
      expect(res.headers["location"], path).toBe("/nasa");
      expect(cookiesHeader(res), path).toContain(`${name}=on; `);
    }
  });

  it("applies ?prefs= bookmark urls and strips the param", async () => {
    const { ctx } = await boot();

    const res = await ctx.server.inject({
      url: "/nasa?prefs=theme%3DDracula%2CsquareAvatars%3Don&sort=likes",
    });
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/nasa?sort=likes");
    const header = cookiesHeader(res);
    expect(header).toContain("theme=Dracula; ");
    expect(header).toContain("squareAvatars=on; ");
    const alone = await ctx.server.inject({ url: "/nasa?prefs=theme%3DDracula" });
    expect(alone.headers["location"]).toBe("/nasa");

    const sticky = await ctx.server.inject({
      url: "/nasa?prefs=theme%3DDracula",
      headers: { cookie: "stickyNav=on" },
    });
    expect(cookiesHeader(sticky)).toContain("stickyNav=; ");

    const asset = await ctx.server.inject({ url: "/style.css?prefs=theme%3DDracula" });
    expect(asset.status).toBe(404);
    expect(asset.headers["set-cookie"]).toBeUndefined();
  });

  it("runs the ?prefs= hook on /embed/Tweet.html despite the dotted path", async () => {
    const { ctx } = await boot();

    const res = await ctx.server.inject({ url: "/embed/Tweet.html?prefs=theme%3DMastodon&id=123" });
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/embed/Tweet.html?id=123");
    expect(cookiesHeader(res)).toContain("theme=Mastodon; ");
  });

  it("secure https instances get Secure; SameSite=None cookies", async () => {
    const { ctx } = await boot({ useHttps: true });
    const res = await ctx.server.inject({
      method: "POST",
      url: "/enablehls",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "referer=%2Fnasa",
    });
    expect(cookiesHeader(res)).toContain("Path=/; HttpOnly; Secure; SameSite=None");
    const page = await ctx.server.inject({ url: "/settings" });
    expect(page.body).toContain("https://nitter.example/?prefs=");
  });

  it("unloads cleanly: routes and the prefs hook disappear", async () => {
    const { ctx, unload } = await boot();
    expect((await ctx.server.inject({ url: "/settings" })).status).toBe(200);
    expect((await ctx.server.inject({ url: "/nasa?prefs=theme%3DDracula" })).status).toBe(302);

    await unload();
    expect((await ctx.server.inject({ url: "/settings" })).status).toBe(404);
    expect((await ctx.server.inject({ url: "/saveprefs" })).status).toBe(404);
    const hooked = await ctx.server.inject({ url: "/nasa?prefs=theme%3DDracula" });
    expect(hooked.status).toBe(404);
    expect(hooked.headers["set-cookie"]).toBeUndefined();
  });
});
