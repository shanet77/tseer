#!/usr/bin/env node
import type { TwitterApi } from "@tseer/twitter-api";
import { createApp } from "./index.ts";

function arg(name: string): string | undefined {
  const flag = `--${name}=`;
  return process.argv.find((a) => a.startsWith(flag))?.slice(flag.length);
}

const command = process.argv[2];
if (command === "debug") {
  const spec = process.argv[3] ?? "";
  const match = spec.match(/^user\/(.+)$/);
  if (!match) {
    console.error(
      `usage: tseer debug user/<name> | tseer web [--config=<path>] [--port=<n>] [--sessions=<path>]`,
    );
    process.exit(1);
  }
  const name = match[1];
  if (name === undefined) {
    console.error(`debug: empty user name`);
    process.exit(1);
  }
  const configPath = arg("config") ?? process.env.TSEER_CONF_FILE ?? process.env.NITTER_CONF_FILE;
  const sessionsPath = arg("sessions");
  const debugCtx = await createApp({
    ...(configPath ? { configPath } : { configText: "" }),
    ...(sessionsPath ? { sessionsPath } : {}),
  });
  const twitter = debugCtx.twitter as TwitterApi | undefined;
  if (!twitter) {
    console.error(
      "debug: ctx.twitter unavailable — sessions are required (pass --sessions=<path> or place sessions.jsonl)",
    );
    process.exit(1);
  }
  let user: Awaited<ReturnType<typeof twitter.user>>;
  try {
    user = await twitter.user(name);
  } catch (err) {
    console.error(`debug: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  if (!user) {
    console.error(`debug: user ${name} not found`);
    process.exit(1);
  }
  console.log(JSON.stringify(user, null, 2));
  process.exit(0);
}
if (command && command !== "web") {
  console.error(`usage: tseer web [--config=<path>] [--port=<n>] [--sessions=<path>]`);
  process.exit(1);
}

const configPath = arg("config") ?? process.env.TSEER_CONF_FILE ?? process.env.NITTER_CONF_FILE;
const portOverride = arg("port") === undefined ? undefined : Number.parseInt(arg("port") ?? "", 10);
if (portOverride !== undefined && !Number.isInteger(portOverride)) {
  console.error(`invalid --port value: ${arg("port")}`);
  process.exit(1);
}

const sessionsPath = arg("sessions");

const ctx = await createApp({
  ...(configPath ? { configPath } : { configText: "" }),
  ...(portOverride !== undefined ? { port: portOverride } : {}),
  ...(sessionsPath ? { sessionsPath } : {}),
});
const bound = await ctx.server.start();
console.log(`tseer web listening on http://${bound.address}:${bound.port} (GET /about)`);
console.log(
  `sessions: ${ctx.accounts.size} loaded; pool health at GET /.health` +
    (ctx.config.enableDebug ? ", per-session detail at GET /.sessions" : ""),
);
