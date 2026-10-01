/**
 * `/.health` route plugin — port of nitter's debug router
 * (`routes/debug.nim`: `get "/.health"` → `respJson getSessionPoolHealth()`).
 *
 * `twitter-sessions` is a separate Phase 2 slice, so until it lands this
 * serves the empty-pool shape (byte-identical to Nim `getSessionPoolHealth()`
 * with an empty session pool, including `fromUnix(0)` timestamps). The
 * composition root can pass a real provider once the sessions seam exists —
 * no session code is scaffolded here.
 */
import type { HttpServer } from "@tseer/server";
import type { Context } from "cordis";

/** `fromUnix(0)` in Nim's `$` conversion — the empty-pool timestamp. */
const EPOCH = "1970-01-01T00:00:00Z";

/** Port of `getSessionPoolHealth()`'s JSON shape (nitter `auth.nim`). */
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

/** Health payload for an empty session pool (matches Nim's empty output). */
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
  /** Supplies session-pool health; omitted until `twitter-sessions` lands. */
  sessionHealth?: (() => SessionPoolHealth) | undefined;
}

export default function healthRoute(ctx: Context, options: HealthRouteOptions = {}): () => void {
  const server = ctx.get("server") as HttpServer | undefined;
  if (!server) throw new Error("health: ctx.server is not mounted (load serverPlugin first)");
  const disposeRoute = server.route({
    method: "GET",
    path: "/.health",
    handler: (_req, reply) => {
      const health = options.sessionHealth?.() ?? emptySessionHealth();
      // fastify normalizes JSON media types to include `charset=utf-8`
      // (semantically identical to nitter's `respJson` — JSON implies UTF-8).
      reply.send(JSON.stringify(health), "application/json");
    },
  });
  // Tie route removal to this fiber's scope (see about-route.ts).
  const disposeEffect = ctx.effect(() => disposeRoute);
  return () => {
    disposeRoute();
    void disposeEffect();
  };
}

// Cordis inject metadata: this plugin requires `ctx.server`.
healthRoute.inject = ["server"];
