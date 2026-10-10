// Build `public/css/style.css` from `sass/index.scss` and stage `public/`
// into `dist/public/` for the published bundle.
//
// TypeScript port of nitter's `tools/gencss.nim` (which runs
// `compileFile("src/sass/index.scss", outputPath = "public/css/style.css",
// includePaths = @["src/sass/include"])` via libsass). Dart-sass produces
// equivalent output; `@import`/`unquote` deprecations are silenced because the
// sources are verbatim upstream and keep the legacy style on purpose. One
// deliberate divergence: `include/_mixins.css` is renamed to
// `include/_mixins.scss` — its content is SCSS (`@mixin`), which libsass
// tolerated under a `.css` extension but dart-sass parses as plain CSS.
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as sass from "sass";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const result = sass.compile(resolve(root, "sass/index.scss"), {
  loadPaths: [resolve(root, "sass/include")],
  style: "expanded",
  // Sources stay verbatim upstream (legacy `@import`, global `unquote`);
  // only the `_mixins.css` -> `_mixins.scss` rename below was required.
  silenceDeprecations: ["import", "global-builtin"],
});

const cssPath = resolve(root, "public/css/style.css");
mkdirSync(dirname(cssPath), { recursive: true });
writeFileSync(cssPath, result.css);

cpSync(resolve(root, "public"), resolve(root, "dist/public"), { recursive: true });

console.log(`style.css: ${result.css.length} bytes -> public/css/style.css + dist/public/`);
