import { readFile } from "node:fs/promises";
import { parseIni } from "./ini.ts";
import { loadConfigFromIni } from "./load.ts";
import type { LoadedConfig } from "./schema.ts";

export function parseConfigText(text: string): LoadedConfig {
  return loadConfigFromIni(parseIni(text));
}

export async function readConfigFile(path: string): Promise<LoadedConfig> {
  const text = await readFile(path, "utf8");
  try {
    return parseConfigText(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid config in ${path}: ${detail}`);
  }
}
