import type { Context } from "cordis";

export interface HelloOptions {
  name?: string;
}

export default function hello(ctx: Context, options: HelloOptions = {}) {
  const name = options.name ?? "tseer";
  const dispose = ctx.provide("hello", name);
  ctx.logger.info(`hello from ${name}`);
  return () => {
    ctx.logger.info(`goodbye from ${name}`);
    dispose();
  };
}
