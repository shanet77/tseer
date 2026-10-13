import { Context } from "cordis";
import { readConfigFile } from "./files.ts";
import { parseIni } from "./ini.ts";
import { applyEnvOverrides, loadConfigFromIni } from "./load.ts";
import loggerPlugin from "./logger.ts";
import configPlugin from "./plugin.ts";
import type { LoadedConfig } from "./schema.ts";

export interface CreateAppOptions {
  loaded?: LoadedConfig | undefined;
  configText?: string | undefined;
  configPath?: string | undefined;
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
  const config = applyEnvOverrides(loaded.config);
  const envApplied = config !== loaded.config;
  loaded = { ...loaded, config };
  await ctx.plugin(loggerPlugin, {
    debug: loaded.config.enableDebug,
    level: options.logLevel,
  });
  await ctx.plugin(configPlugin, { loaded });
  ctx.logger.info(
    `tseer booted (${loaded.config.title} @ ${loaded.config.hostname}:${loaded.config.port})`,
  );
  if (envApplied) {
    ctx.logger.info(
      `config: TSEER_HOME_FOLLOWS override applied (${loaded.config.home.follows.length} follows)`,
    );
  }
  if (loaded.config.hmacKey === "secretkey") {
    ctx.logger.warn("config: using the default hmacKey; set a unique random value");
  }
  return ctx;
}
