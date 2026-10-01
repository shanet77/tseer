/**
 * Serve `ctx.config.staticDir` at the URL root — nitter parity: Jester's
 * `staticDir` setting serves `<dir>/<path>` for paths no route claims
 * (`nitter.nim` settings block; the "." before-hook sends asset URLs here).
 * Fastify resolves specific routes before the root wildcard, so registered
 * routes (e.g. `/about`) always win over same-named files.
 */
import type { Context } from "cordis";

export default function staticRoute(ctx: Context): () => void {
  const dir = ctx.config.staticDir.trim();
  // Never mount an empty prefix dir: that would expose the CWD.
  if (!dir) return () => {};
  const dispose = ctx.server.static("/", dir);
  // Tie unmount to this fiber's scope (see about-route.ts).
  const disposeEffect = ctx.effect(() => dispose);
  return () => {
    dispose();
    void disposeEffect();
  };
}

// Cordis inject metadata: this plugin requires `ctx.server` + `ctx.config`.
staticRoute.inject = ["server", "config"];
