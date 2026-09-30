/**
 * The `ctx.config` plugin: provides the validated config object and emits
 * load warnings through `ctx.logger`. The kernel owns the *contract*
 * (`TseerConfig` + loader); config *sources* stay swappable by providing a
 * different `TseerConfig` value under the same service name.
 */
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
