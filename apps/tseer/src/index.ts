import { aboutPlugin, createApp as createKernelApp } from "@tseer/kernel";
import type { Context } from "cordis";
import hello from "./plugins/hello.ts";

export interface CreateAppOptions {
  /** Name surfaced by the scaffold `hello` plugin. */
  name?: string;
  /** Path to a `nitter.conf`-compatible INI file. */
  configPath?: string | undefined;
  /** Raw INI text (preferred in tests; skips file I/O). */
  configText?: string | undefined;
  /** Override for `config.port` (applied before the web plugin binds). */
  port?: number | undefined;
}

/** Mount the scaffold plugin list on a kernel-booted cordis context. */
export async function createApp(options: CreateAppOptions = {}): Promise<Context> {
  const ctx = await createKernelApp({
    configPath: options.configPath,
    configText: options.configText,
  });
  if (options.port !== undefined) ctx.config.port = options.port;

  await ctx.plugin(hello, { name: options.name ?? "tseer" });
  await ctx.plugin(aboutPlugin, {
    address: ctx.config.address,
    port: ctx.config.port,
    title: ctx.config.title,
  });
  return ctx;
}
