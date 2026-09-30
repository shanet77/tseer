/**
 * `createApp`: kernel boot — fresh cordis context + logger/config plugins.
 * Phase 1 keeps the composition root minimal: pino logging, validated config,
 * and the `/about` stub live behind the same seam packages Phase 2+ extend.
 */
import { Context } from "cordis";
import { readConfigFile } from "./files.ts";
import { parseIni } from "./ini.ts";
import { loadConfigFromIni } from "./load.ts";
import loggerPlugin from "./logger.ts";
import configPlugin from "./plugin.ts";
import type { LoadedConfig } from "./schema.ts";

export interface CreateAppOptions {
  /** Pre-loaded config (skips file I/O; preferred in tests). */
  loaded?: LoadedConfig | undefined;
  /** Raw INI text (parsed in-memory; preferred over `configPath`). */
  configText?: string | undefined;
  /** Path to a `nitter.conf`-compatible INI file. */
  configPath?: string | undefined;
  /** Forwarded to the pino logger plugin. */
  logLevel?: string | undefined;
}

export async function createApp(options: CreateAppOptions = {}): Promise<Context> {
  let loaded: LoadedConfig;
  if (options.loaded) loaded = options.loaded;
  else if (options.configText !== undefined)
    loaded = loadConfigFromIni(parseIni(options.configText));
  else {
    const path = options.configPath ?? "./nitter.conf";
    try {
      loaded = await readConfigFile(path);
    } catch (err) {
      if (options.configPath === undefined && (err as NodeJS.ErrnoException)?.code === "ENOENT") {
        loaded = loadConfigFromIni(parseIni(""));
      } else throw err;
    }
  }

  const ctx = new Context();
  await ctx.plugin(loggerPlugin, {
    debug: loaded.config.enableDebug,
    level: options.logLevel,
  });
  await ctx.plugin(configPlugin, { loaded });
  ctx.logger.info(
    `tseer booted (${loaded.config.title} @ ${loaded.config.hostname}:${loaded.config.port})`,
  );
  if (loaded.config.hmacKey === "secretkey") {
    ctx.logger.warn("config: using the default hmacKey; set a unique random value");
  }
  return ctx;
}
