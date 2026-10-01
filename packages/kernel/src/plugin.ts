/** Provide `ctx.config` and log load warnings through `ctx.logger`. */
import type { Context } from "cordis";
import type { LoadedConfig, TseerConfig } from "./schema.ts";

declare module "cordis" {
  interface Context {
    /** Validated tseer config (provided by the kernel config plugin). */
    config: TseerConfig;
  }
}

export interface ConfigPluginOptions {
  loaded: LoadedConfig;
}

/** Provide `ctx.config`; log unknown-key/invalid-value warnings on boot. */
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
