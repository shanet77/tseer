import { preferencesSchema } from "@tseer/prefs";
import { Context } from "cordis";
import { h } from "preact";
import { describe, expect, it } from "vitest";
import { doctype, type PageContext, renderPlugin } from "../src/index.ts";

async function mount(options?: Partial<Parameters<typeof renderPlugin>[1]>) {
  const ctx = new Context();
  const hook = {
    pre: undefined as PageContext | undefined,
    post: undefined as string | undefined,
  };
  ctx.on("render/pre", (page) => {
    hook.pre = page;
  });
  ctx.on("render/post", (html, next) => {
    hook.post = html;
    return next().replace("</html>", "<!-- post --></html>");
  });
  await ctx.plugin(renderPlugin, {
    title: "Nitter",
    hostname: "nitter.example",
    useHttps: true,
    picUrl: (url) => `/pic/${url}`,
    ...options,
  });
  return { ctx, hook };
}

const body = h("p", null, "hello");

describe("renderPlugin (ctx.render)", () => {
  it("renders a full document with title, theme and meta", async () => {
    const { ctx } = await mount();
    const html = await ctx.render.page({
      body,
      title: "Jane Doe (@jane)",
      desc: "some <b>desc</b>",
      path: "/jane",
    });
    expect(html.startsWith(doctype)).toBe(true);
    expect(html).toContain("<title>Jane Doe (@jane) | Nitter</title>");
    expect(html).toContain('<link rel="stylesheet" type="text/css" href="/css/themes/nitter.css"');
    expect(html).toContain('<meta property="og:description" content="some desc"');
    expect(html).toContain('href="/settings?referer=%2Fjane"');
    expect(html).toContain('<a class="site-name" href="/">Nitter</a>');
    expect(html).toContain(
      '<a class="icon-bird" title="Open in X" aria-label="Open in X" href="https://x.com/jane"',
    );
    expect(html).toContain("<p>hello</p>");
  });

  it("applies request prefs: theme stylesheet, sticky nav, hls scripts", async () => {
    const { ctx } = await mount();
    const prefs = {
      ...preferencesSchema.parse({}),
      theme: "Mastodon",
      stickyNav: false,
      hlsPlayback: true,
    };
    const html = await ctx.render.page({ body, prefs });
    expect(html).toContain("/css/themes/mastodon.css");
    expect(html).not.toContain('class="fixed-nav"');
    expect(html).toContain("/js/hls.min.js");
  });

  it("omits the theme stylesheet for an empty theme", async () => {
    const { ctx } = await mount();
    const prefs = { ...preferencesSchema.parse({}), theme: "" };
    const html = await ctx.render.page({ body, prefs });
    expect(html).not.toContain("/css/themes/");
  });

  it("adds rss links and og:image preloads", async () => {
    const { ctx } = await mount();
    const html = await ctx.render.page({
      body,
      rss: "/jane/rss",
      images: ["abc_400x400.jpg"],
      banner: "banner_normal.jpg",
    });
    expect(html).toContain('type="application/rss+xml" href="/jane/rss"');
    expect(html).toContain('href="/pic/abc_400x400.jpg"');
    expect(html).toContain(
      '<meta property="og:image" content="https://nitter.example/pic/abc_400x400.jpg"',
    );
    expect(html).toContain('href="/pic/banner_normal.jpg"');
  });

  it("fires render/pre with a mutable context", async () => {
    const { ctx, hook } = await mount();
    ctx.on("render/pre", (page) => {
      page.title = "Overridden";
    });
    const html = await ctx.render.page({ body });
    expect(hook.pre).toBeDefined();
    expect(html).toContain("<title>Overridden | Nitter</title>");
  });

  it("runs render/post as a transform", async () => {
    const { ctx, hook } = await mount();
    const html = await ctx.render.page({ body });
    expect(hook.post).toContain(doctype);
    expect(html).toContain("<!-- post -->");
  });

  it("renders error pages", async () => {
    const { ctx } = await mount();
    const html = ctx.render.errorPage('User "jane" has been suspended', 404);
    expect(html).toContain("<title>HTTP 404 | Nitter</title>");
    // nitter writes the panel with `verbatim` (unescaped); the port keeps the
    // shell's auto-escaping, so the message arrives entity-encoded.
    expect(html).toContain("has been suspended");
    expect(html).toContain("panel-container");
    expect(html).toContain("error-panel");
  });

  it("escapes attacker-controlled text in the body (XSS regression)", async () => {
    const { ctx } = await mount();
    const html = await ctx.render.page({
      body: h("p", null, '<script>alert("x")</script>'),
    });
    // preact escapes `<` (but not `>`, which is inert outside a tag) and the
    // quotes inside the string.
    expect(html).toContain("&lt;script>");
    expect(html).toContain("&quot;x&quot;");
  });

  it("renders without picUrl (links empty, no crash)", async () => {
    const ctx = new Context();
    await ctx.plugin(renderPlugin, { title: "Nitter", hostname: "nitter.example", useHttps: true });
    const html = await ctx.render.page({ body, images: ["abc.jpg"] });
    expect(html).not.toContain("/pic/");
    expect(html).toContain('<meta property="og:image" content="https://nitter.example"');
  });
});
