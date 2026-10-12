import type { HttpServer } from "@tseer/server";
import type { Context } from "cordis";

const EPOCH = "1970-01-01T00:00:00Z";

export interface SessionPoolHealth {
  sessions: {
    total: number;
    limited: number;
    oauth: { total: number; limited: number };
    cookie: { total: number; limited: number };
    oldest: string;
    newest: string;
    average: string;
  };
  requests: {
    total: number;
    apis: Record<string, number>;
  };
}

export function emptySessionHealth(): SessionPoolHealth {
  return {
    sessions: {
      total: 0,
      limited: 0,
      oauth: { total: 0, limited: 0 },
      cookie: { total: 0, limited: 0 },
      oldest: EPOCH,
      newest: EPOCH,
      average: EPOCH,
    },
    requests: { total: 0, apis: {} },
  };
}

export interface HealthRouteOptions {
  sessionHealth?: (() => SessionPoolHealth) | undefined;
  sessionDebug?: (() => unknown) | undefined;
  enableDebug?: boolean | undefined;
}

export default function healthRoute(ctx: Context, options: HealthRouteOptions = {}): () => void {
  const server = ctx.get("server") as HttpServer | undefined;
  if (!server) throw new Error("health: ctx.server is not mounted (load serverPlugin first)");
  const disposeRoute = server.route({
    method: "GET",
    path: "/.health",
    handler: (_req, reply) => {
      const health = options.sessionHealth?.() ?? emptySessionHealth();
      reply.send(JSON.stringify(health), "application/json");
    },
  });
  const disposers: Array<() => void> = [disposeRoute];
  if (options.sessionDebug !== undefined && options.enableDebug === true) {
    disposers.push(
      server.route({
        method: "GET",
        path: "/.sessions",
        handler: (_req, reply) => {
          reply.send(JSON.stringify(options.sessionDebug?.() ?? {}), "application/json");
        },
      }),
    );
  }
  const disposeEffect = ctx.effect(() => () => {
    for (const dispose of disposers) dispose();
  });
  return () => {
    for (const dispose of disposers) dispose();
    void disposeEffect();
  };
}

healthRoute.inject = ["server"];
