import { allPrefs } from "@tseer/prefs";
import type { IniDocument } from "./ini.ts";
import { configSchema, gallerySizeOptions, type LoadedConfig, mediaViewOptions } from "./schema.ts";

const preferenceKinds: Record<string, "string" | "bool" | "gallerySize" | "mediaView"> = {};
for (const pref of allPrefs) {
  preferenceKinds[pref.name] =
    pref.kind === "checkbox"
      ? "bool"
      : pref.name === "theme"
        ? "string"
        : pref.name === "gallerySize"
          ? "gallerySize"
          : pref.name === "mediaView"
            ? "mediaView"
            : "string";
}

function lower(value: string): string {
  return value.toLowerCase();
}

const truthy = new Set(["1", "true", "yes", "on"]);
const falsy = new Set(["0", "false", "no", "off"]);

export function extractPreferences(
  doc: IniDocument,
  consumed: Set<string>,
  warnings: { line?: number | undefined; message: string }[],
): Record<string, unknown> {
  const rawPrefs: Record<string, unknown> = {};
  const section = [...doc.sections.values()].find((s) => lower(s.name) === "preferences");
  if (!section) return rawPrefs;
  for (const [name, stored] of section.values) {
    const match = Object.keys(preferenceKinds).find((k) => lower(k) === lower(name));
    consumed.add(`${lower(section.name)} ${lower(name)}`);
    if (!match) {
      warnings.push({
        line: stored.line,
        message: `[${section.name}]${name}: unknown preference key, ignoring`,
      });
      continue;
    }
    const kind = preferenceKinds[match] ?? "string";
    if (stored.value === "") {
      if (kind === "string") rawPrefs[match] = "";
      continue;
    }
    if (kind === "string") {
      rawPrefs[match] = stored.value;
    } else if (kind === "bool") {
      const lowered = lower(stored.value.trim());
      if (falsy.has(lowered)) rawPrefs[match] = false;
      else if (truthy.has(lowered)) rawPrefs[match] = true;
      else {
        warnings.push({
          line: stored.line,
          message:
            `[${section.name}]${name}: invalid boolean "${stored.value}", ` +
            `expected one of true/false/yes/no/on/off/1/0; using default`,
        });
      }
    } else {
      const options = kind === "gallerySize" ? gallerySizeOptions : mediaViewOptions;
      const option = options.find((o) => lower(o) === lower(stored.value));
      if (option) rawPrefs[match] = option;
      else {
        warnings.push({
          line: stored.line,
          message:
            `[${section.name}]${name}: invalid option "${stored.value}", ` +
            `expected one of ${options.join("/")}; using default`,
        });
      }
    }
  }
  return rawPrefs;
}

export function finalizeConfig(raw: Record<string, unknown>): LoadedConfig {
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${String(issue.path.join(".")) || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`invalid configuration: ${detail}`);
  }
  const config = parsed.data;
  if (!config.enableRSS) {
    config.enableRSSUserTweets = false;
    config.enableRSSUserReplies = false;
    config.enableRSSUserMedia = false;
    config.enableRSSUserArticles = false;
    config.enableRSSSearch = false;
    config.enableRSSList = false;
  }
  return { config, warnings: [] };
}
