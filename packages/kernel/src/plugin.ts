import type { Context } from "cordis";
import type { LoadedConfig, TseerConfig } from "./schema.ts";

declare module "cordis" {
  interface Context {
    config: TseerConfig;
  }
}

export interface ConfigPluginOptions {
  loaded: LoadedConfig;
}

export default function config(ctx: Context, options: ConfigPluginOptions): () => void {
  const dispose = ctx.provide("config", options.loaded.config);
  for (const warning of options.loaded.warnings) {
    const where = warning.line === undefined ? "" : ` (line ${warning.line})`;
    ctx.logger.warn(`config${where}: ${warning.message}`);
  }
  return () => {
    void dispose();
  };
}
