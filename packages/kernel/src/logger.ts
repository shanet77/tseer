import type { Context } from "cordis";
import pino, { type Logger as PinoLogger } from "pino";

export interface LoggerPluginOptions {
  debug?: boolean | undefined;
  level?: string | undefined;
}

const levelOrder = ["error", "warn", "info", "debug"] as const;
type Level = (typeof levelOrder)[number];

function normalizeLevel(level: string | undefined, debug: boolean): Level {
  const fallback: Level = debug ? "debug" : "info";
  if (!level) return fallback;
  const lowered = level.toLowerCase();
  return (levelOrder as readonly string[]).includes(lowered) ? (lowered as Level) : fallback;
}

function writeMessage(log: PinoLogger, type: string, name: string, args: unknown[]): void {
  const text = args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" ");
  if (type === "error") log.error({ plugin: name }, text);
  else if (type === "warn") log.warn({ plugin: name }, text);
  else if (type === "debug") log.debug({ plugin: name }, text);
  else log.info({ plugin: name }, text);
}

export default function logger(ctx: Context, options: LoggerPluginOptions = {}): () => void {
  const debug = options.debug ?? false;
  const level = normalizeLevel(options.level, debug);
  const log: PinoLogger = debug
    ? pino({ level, transport: { target: "pino-pretty", options: { colorize: true } } })
    : pino({ level });

  const exporter = {
    levels: { debug: 3, info: 2, warn: 1, error: 0 },
    export(message: { name: string; type: string; level: number; args: unknown[] }): void {
      const rank = levelOrder.indexOf(level);
      const incoming = levelOrder.indexOf(message.type as Level);
      if (incoming === -1 || incoming > rank) return;
      writeMessage(log, message.type, message.name, message.args);
    },
  };
  const dispose = ctx.logger.exporter(exporter);
  return () => {
    void dispose();
  };
}
