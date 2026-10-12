import type { Context } from "cordis";
import { SessionPool } from "./pool.ts";
import {
  type LoadedSessions,
  loadSessionsFile,
  type SessionsWatcher,
  watchSessionsFile,
} from "./store.ts";
import type { AccountHealth, Session, SessionsPluginOptions } from "./types.ts";

declare module "cordis" {
  interface Context {
    accounts: SessionPool;
  }

  interface Events {
    "account/limited": (account: Session, api: string) => void;
    "account/invalidated": (account: Session) => void;
    "account/health": () => AccountHealth;
  }
}

interface SessionsConfig {
  enableDebug?: boolean | undefined;
  maxConcurrentReqs?: number | undefined;
}

function readConfig(ctx: Context): SessionsConfig | undefined {
  return ctx.get("config" as never) as SessionsConfig | undefined;
}

function resolvePath(explicit?: string): string {
  return (
    explicit ??
    process.env.TSEER_SESSIONS_FILE ??
    process.env.NITTER_SESSIONS_FILE ??
    "./sessions.jsonl"
  );
}

export default function twitterSessionsPlugin(
  ctx: Context,
  options: SessionsPluginOptions = {},
): () => void {
  const path = resolvePath(options.path);
  const sessions = options.sessions;
  let loaded: LoadedSessions;
  if (sessions === undefined) {
    try {
      loaded = loadSessionsFile(path);
    } catch (err) {
      ctx.logger.warn(`sessions: ${(err as Error).message}`);
      loaded = { sessions: [], warnings: [] };
    }
    ctx.logger.info(`sessions: parsed JSONL account sessions file: ${path}`);
  } else {
    loaded = { sessions: [...sessions], warnings: [] };
  }
  for (const warning of loaded.warnings) ctx.logger.warn(`sessions: ${warning}`);
  if (loaded.sessions.length > 0) {
    ctx.logger.info(
      `sessions: successfully added ${loaded.sessions.length} valid account sessions`,
    );
  }

  const config = readConfig(ctx);
  const debug = config?.enableDebug === true;
  const pool = new SessionPool(loaded.sessions, {
    maxConcurrentReqs: options.maxConcurrentReqs ?? config?.maxConcurrentReqs,
    leaseTimeoutMs: options.leaseTimeoutMs,
    hooks: {
      onLimited: (account, api) => ctx.emit("account/limited", account, api),
      onInvalidated: (account) => ctx.emit("account/invalidated", account),
      log: (message) => {
        if (debug) ctx.logger.debug(`sessions: ${message}`);
      },
    },
  });

  let stopWatching: SessionsWatcher | undefined;
  if (options.watch !== false && sessions === undefined && loaded.sessions.length > 0) {
    stopWatching = watchSessionsFile(
      path,
      (next) => {
        for (const warning of next.warnings) ctx.logger.warn(`sessions: ${warning}`);
        pool.replace(next.sessions);
        ctx.logger.info(`sessions: reloaded ${next.sessions.length} account sessions`);
      },
      (err) => ctx.logger.warn(`sessions: ${err.message}`),
    );
  }

  const dispose = ctx.provide("accounts", pool);
  return () => {
    stopWatching?.();
    void dispose();
  };
}
