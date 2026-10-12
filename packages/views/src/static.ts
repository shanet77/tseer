import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { titleize } from "./formatters.ts";

export function viewsPublicDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [resolve(here, "public"), resolve(here, "../public")]) {
    if (existsSync(resolve(candidate, "css/fontello.css"))) return candidate;
  }
  return resolve(here, "../public");
}

export function findThemes(dir: string): string[] {
  try {
    return readdirSync(join(dir, "css", "themes"))
      .filter((file) => file.endsWith(".css"))
      .map((file) => titleize(file.slice(0, -".css".length).replaceAll("_", " ")))
      .sort();
  } catch {
    return [];
  }
}
