/** Merge raw INI values over the zod defaults: unknown/invalid warn, out-of-range fails. */
import type { IniDocument } from "./ini.ts";
import { extractPreferences, finalizeConfig } from "./preferences.ts";
import type { ConfigWarning, LoadedConfig } from "./schema.ts";

export type { ConfigWarning, LoadedConfig, TseerConfig, TseerPreferences } from "./schema.ts";
export { configSchema, preferencesSchema } from "./schema.ts";

export const iniSections = ["Server", "Cache", "Config", "Plugins", "Preferences"] as const;
export type IniSectionName = (typeof iniSections)[number];

interface FieldSource {
  section: IniSectionName;
  keys: string[];
  kind: "string" | "int" | "bool";
}

/** Flat config field -> `[Section]key` lookup (read order per key list). */
const fieldSources: Record<string, FieldSource> = {
  address: { section: "Server", keys: ["address"], kind: "string" },
  port: { section: "Server", keys: ["port"], kind: "int" },
  useHttps: { section: "Server", keys: ["https"], kind: "bool" },
  httpMaxConns: { section: "Server", keys: ["httpMaxConnections"], kind: "int" },
  staticDir: { section: "Server", keys: ["staticDir"], kind: "string" },
  title: { section: "Server", keys: ["title"], kind: "string" },
  hostname: { section: "Server", keys: ["hostname"], kind: "string" },
  listCacheTime: { section: "Cache", keys: ["listMinutes"], kind: "int" },
  rssCacheTime: { section: "Cache", keys: ["rssMinutes"], kind: "int" },
  redisHost: { section: "Cache", keys: ["redisHost"], kind: "string" },
  redisPort: { section: "Cache", keys: ["redisPort"], kind: "int" },
  redisConns: { section: "Cache", keys: ["redisConnections"], kind: "int" },
  redisMaxConns: { section: "Cache", keys: ["redisMaxConnections"], kind: "int" },
  redisPassword: { section: "Cache", keys: ["redisPassword"], kind: "string" },
  hmacKey: { section: "Config", keys: ["hmacKey"], kind: "string" },
  base64Media: { section: "Config", keys: ["base64Media"], kind: "bool" },
  minTokens: { section: "Config", keys: ["tokenCount"], kind: "int" },
  enableRSS: { section: "Config", keys: ["enableRSS"], kind: "bool" },
  enableRSSUserTweets: { section: "Config", keys: ["enableRSSUserTweets"], kind: "bool" },
  enableRSSUserReplies: { section: "Config", keys: ["enableRSSUserReplies"], kind: "bool" },
  enableRSSUserMedia: { section: "Config", keys: ["enableRSSUserMedia"], kind: "bool" },
  enableRSSUserArticles: { section: "Config", keys: ["enableRSSUserArticles"], kind: "bool" },
  enableRSSSearch: { section: "Config", keys: ["enableRSSSearch"], kind: "bool" },
  enableRSSList: { section: "Config", keys: ["enableRSSList"], kind: "bool" },
  enableDebug: { section: "Config", keys: ["enableDebug"], kind: "bool" },
  proxy: { section: "Config", keys: ["proxy"], kind: "string" },
  proxyAuth: { section: "Config", keys: ["proxyAuth"], kind: "string" },
  apiProxy: { section: "Config", keys: ["apiProxy"], kind: "string" },
  disableTid: { section: "Config", keys: ["disableTid"], kind: "bool" },
  maxConcurrentReqs: { section: "Config", keys: ["maxConcurrentReqs"], kind: "int" },
  maxRetries: { section: "Config", keys: ["maxRetries"], kind: "int" },
  retryDelayMs: { section: "Config", keys: ["retryDelayMs"], kind: "int" },
};

interface StoredValue {
  name: string;
  value: string;
  line: number;
}

function lower(value: string): string {
  return value.toLowerCase();
}

function findSection(doc: IniDocument, name: IniSectionName) {
  for (const section of doc.sections.values()) {
    if (lower(section.name) === lower(name)) return section;
  }
  return undefined;
}

function findValue(section: { values: Map<string, { value: string; line: number }> }, key: string) {
  for (const [name, stored] of section.values) {
    if (lower(name) === lower(key)) return { name, ...stored };
  }
  return undefined;
}

const truthy = new Set(["1", "true", "yes", "on"]);
const falsy = new Set(["0", "false", "no", "off", ""]);

/** One `[Plugins]` list entry: trimmed, with one pair of surrounding double
 * quotes stripped (each comma-separated segment is quoted independently). */
function cleanListEntry(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

type Coerced = { ok: true; value: string | number | boolean } | { ok: false; reason: string };

function coerce(raw: string, kind: "string" | "int" | "bool"): Coerced {
  if (kind === "string") return { ok: true, value: raw };
  const text = raw.trim();
  if (kind === "bool") {
    const lowered = lower(text);
    if (truthy.has(lowered)) return { ok: true, value: true };
    if (falsy.has(lowered)) return { ok: true, value: false };
    return {
      ok: false,
      reason: `invalid boolean "${raw}", expected one of true/false/yes/no/on/off/1/0`,
    };
  }
  if (!/^[+-]?\d+$/.test(text)) return { ok: false, reason: `invalid integer "${raw}"` };
  return { ok: true, value: Number.parseInt(text, 10) };
}

/** Merge raw INI values over zod defaults; unknown keys warn, invalid warn. */
export function loadConfigFromIni(doc: IniDocument): LoadedConfig {
  const warnings: ConfigWarning[] = doc.warnings.map((w) => ({ ...w }));
  const raw: Record<string, unknown> = {};
  const consumed = new Set<string>();

  for (const [field, source] of Object.entries(fieldSources)) {
    const section = findSection(doc, source.section);
    if (!section) continue;
    let stored: StoredValue | undefined;
    let usedKey = "";
    for (const candidate of source.keys) {
      const hit = findValue(section, candidate);
      if (hit) {
        stored = hit;
        usedKey = candidate;
        break;
      }
    }
    if (!stored) continue;
    consumed.add(`${lower(section.name)} ${lower(stored.name)}`);
    if (stored.value === "") continue;
    const coerced = coerce(stored.value, source.kind);
    if (coerced.ok) raw[field] = coerced.value;
    else {
      warnings.push({
        line: stored.line,
        message: `[${section.name}]${usedKey}: ${coerced.reason}; using default`,
      });
    }
  }

  const rawPrefs = extractPreferences(doc, consumed, warnings);
  if (Object.keys(rawPrefs).length > 0) raw.preferences = rawPrefs;

  const pluginsSection = findSection(doc, "Plugins");
  if (pluginsSection) {
    const lists: Record<string, string[]> = {};
    for (const key of ["add", "remove"] as const) {
      const stored = findValue(pluginsSection, key);
      if (!stored) continue;
      consumed.add(`${lower(pluginsSection.name)} ${lower(stored.name)}`);
      lists[key] = stored.value
        .split(",")
        .map(cleanListEntry)
        .filter((entry) => entry !== "");
    }
    if (Object.keys(lists).length > 0) raw.plugins = lists;
  }

  for (const section of doc.sections.values()) {
    const known = iniSections.some((name) => lower(name) === lower(section.name));
    if (!known) {
      warnings.push({ line: section.line, message: `unknown section [${section.name}], ignoring` });
      continue;
    }
    for (const [name, stored] of section.values) {
      if (!consumed.has(`${lower(section.name)} ${lower(name)}`)) {
        warnings.push({
          line: stored.line,
          message: `[${section.name}]${name}: unknown key, ignoring`,
        });
      }
    }
  }

  const loaded = finalizeConfig(raw);
  return { config: loaded.config, warnings };
}
