import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as sass from "sass";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const result = sass.compile(resolve(root, "sass/index.scss"), {
  loadPaths: [resolve(root, "sass/include")],
  style: "expanded",
  silenceDeprecations: ["import", "global-builtin"],
});

const cssPath = resolve(root, "public/css/style.css");
mkdirSync(dirname(cssPath), { recursive: true });
writeFileSync(cssPath, result.css);

cpSync(resolve(root, "public"), resolve(root, "dist/public"), { recursive: true });

console.log(`style.css: ${result.css.length} bytes -> public/css/style.css + dist/public/`);
