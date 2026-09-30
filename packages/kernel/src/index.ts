/** `@tseer/kernel` — cordis boot, `ctx.config` contract, logger, `/about`. */

export type { AboutPluginOptions } from "./about.ts";
export { default as aboutPlugin, renderAbout } from "./about.ts";
export type { CreateAppOptions } from "./app.ts";
export { createApp } from "./app.ts";
export { parseConfigText, readConfigFile } from "./files.ts";
export type { IniDocument, IniSection, IniValue, IniWarning } from "./ini.ts";
export { parseIni } from "./ini.ts";
export type { IniSectionName } from "./load.ts";
export { iniSections, loadConfigFromIni } from "./load.ts";
export type { LoggerPluginOptions } from "./logger.ts";
export { default as loggerPlugin } from "./logger.ts";
export type { ConfigPluginOptions } from "./plugin.ts";
export { default as configPlugin } from "./plugin.ts";
export { extractPreferences, finalizeConfig } from "./preferences.ts";
export type {
  ConfigWarning,
  LoadedConfig,
  TseerConfig,
  TseerPreferences,
} from "./schema.ts";
export { configSchema, preferencesSchema } from "./schema.ts";
