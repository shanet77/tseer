import { Context } from "cordis";
import hello from "./plugins/hello.ts";

export interface CreateAppOptions {
  /** Name surfaced by the scaffold `hello` plugin. */
  name?: string;
}

/**
 * Mount the scaffold plugin list on a fresh cordis root context.
 *
 * Phase 0 keeps composition inline. Phase 1 extracts this into
 * `packages/kernel` as `createApp(config)` (config file + plugin list),
 * per docs/TS_PORT_PLAN.md §5.
 */
export async function createApp(options: CreateAppOptions = {}): Promise<Context> {
  const ctx = new Context();

  // Scaffold-only console exporter: cordis's logger buffers messages in a ring
  // buffer until an exporter is attached. Phase 1 replaces this with the
  // pino-backed ctx.logger seam (docs/TS_PORT_PLAN.md §1).
  ctx.logger.exporter({
    export(message) {
      const text = message.args.map((arg) => String(arg)).join(" ");
      console.log(`[${message.name}] ${message.type}: ${text}`);
    },
  });

  await ctx.plugin(hello, { name: options.name ?? "tseer" });
  return ctx;
}
