import { Context } from "cordis";
import hello from "./plugins/hello.ts";

export interface CreateAppOptions {
  /** Name surfaced by the scaffold `hello` plugin. */
  name?: string;
}

/** Mount the scaffold plugin list on a fresh cordis root context. */
export async function createApp(options: CreateAppOptions = {}): Promise<Context> {
  const ctx = new Context();

  // cordis buffers log messages in a ring buffer until an exporter is attached.
  ctx.logger.exporter({
    export(message) {
      const text = message.args.map((arg) => String(arg)).join(" ");
      console.log(`[${message.name}] ${message.type}: ${text}`);
    },
  });

  await ctx.plugin(hello, { name: options.name ?? "tseer" });
  return ctx;
}
