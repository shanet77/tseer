#!/usr/bin/env node
import { createApp } from "./index.ts";

function arg(name: string): string | undefined {
  const flag = `--${name}=`;
  return process.argv.find((a) => a.startsWith(flag))?.slice(flag.length);
}

const command = process.argv[2];
if (command && command !== "web") {
  console.error(`usage: tseer web [--config=<path>] [--port=<n>]`);
  process.exit(1);
}

const configPath = arg("config") ?? process.env.TSEER_CONF_FILE ?? process.env.NITTER_CONF_FILE;
const portOverride = arg("port") === undefined ? undefined : Number.parseInt(arg("port") ?? "", 10);
if (portOverride !== undefined && !Number.isInteger(portOverride)) {
  console.error(`invalid --port value: ${arg("port")}`);
  process.exit(1);
}

const ctx = await createApp(
  configPath ? { configPath, port: portOverride } : { configText: "", port: portOverride },
);
const bound = await ctx.server.start();
console.log(`tseer web listening on http://${bound.address}:${bound.port} (GET /about)`);
