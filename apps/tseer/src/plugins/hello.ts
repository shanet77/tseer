import type { Context } from "cordis";

export interface HelloOptions {
  /** Name used in the greeting. */
  name?: string;
}

/**
 * Scaffold plugin: proves plugin mounting, service reflection, and disposal
 * wiring work end to end. Replaced by the real seam plugins in Phase 1
 * (docs/TS_PORT_PLAN.md §5).
 */
export default function hello(ctx: Context, options: HelloOptions = {}) {
  const name = options.name ?? "tseer";
  const dispose = ctx.provide("hello", name);
  ctx.logger.info(`hello from ${name}`);
  return () => {
    ctx.logger.info(`goodbye from ${name}`);
    dispose();
  };
}
