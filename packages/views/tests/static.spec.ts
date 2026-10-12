import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { themeOptions } from "@tseer/prefs";
import * as sass from "sass";
import { describe, expect, it } from "vitest";
import { viewsPublicDir } from "../src/static.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const pub = viewsPublicDir();

function toTheme(theme: string): string {
  return theme.toLowerCase().replace(" ", "_");
}

describe("views static assets", () => {
  it("resolves to the checked-in public dir", () => {
    expect(pub).toBe(resolve(pkgRoot, "public"));
    expect(existsSync(join(pub, "css/fontello.css"))).toBe(true);
  });

  it("covers every asset URL the page shell emits", () => {
    const expected = [
      "css/fontello.css",
      "js/hls.min.js",
      "js/hlsPlayback.js",
      "js/infiniteScroll.js",
      "logo.png",
      "apple-touch-icon.png",
      "favicon-32x32.png",
      "favicon-16x16.png",
      "site.webmanifest",
      "safari-pinned-tab.svg",
      "fonts/fontello.woff2",
    ];
    for (const file of expected) expect(existsSync(join(pub, file)), file).toBe(true);
  });

  it("ships a theme file for every theme option", () => {
    const themes = readdirSync(join(pub, "css/themes")).filter((f) => f.endsWith(".css"));
    expect(themes.length).toBe(9);
    for (const option of themeOptions) {
      expect(existsSync(join(pub, `css/themes/${toTheme(option)}.css`)), option).toBe(true);
    }
  });

  it("keeps vendored JS/fonts whole", () => {
    expect(existsSync(join(pub, "js/embedResize.js"))).toBe(true);
    expect(existsSync(join(pub, "js/widgets.js"))).toBe(true);
    expect(existsSync(join(pub, "fonts/LICENSE.txt"))).toBe(true);
  });

  it("keeps style sources out of the served tree", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
      );
    expect(walk(pub).filter((f) => f.endsWith(".scss"))).toEqual([]);
    expect(walk(resolve(pkgRoot, "sass")).filter((f) => f.endsWith(".scss")).length).toBe(24);
  });

  it("compiles sass/index.scss to style.css (tools/gencss.nim port)", () => {
    const result = sass.compile(resolve(pkgRoot, "sass/index.scss"), {
      loadPaths: [resolve(pkgRoot, "sass/include")],
      style: "expanded",
      silenceDeprecations: ["import", "global-builtin"],
    });
    expect(result.css.length).toBeGreaterThan(50_000);
    expect(result.css).toContain("--bg_color");
    expect(result.css).toContain(".timeline-item");
    expect(result.css).toContain(".tweet-body");
  });
});
