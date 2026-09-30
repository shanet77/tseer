/** File-level config loading: read text, parse INI, merge over defaults. */
import { readFile } from "node:fs/promises";
import { parseIni } from "./ini.ts";
import { loadConfigFromIni } from "./load.ts";
import type { LoadedConfig } from "./schema.ts";

/** Parse raw INI text (used by tests and the file loader). */
export function parseConfigText(text: string): LoadedConfig {
  return loadConfigFromIni(parseIni(text));
}

/** Read + parse a `nitter.conf`-compatible INI file. */
export async function readConfigFile(path: string): Promise<LoadedConfig> {
  const text = await readFile(path, "utf8");
  try {
    return parseConfigText(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid config in ${path}: ${detail}`);
  }
}
