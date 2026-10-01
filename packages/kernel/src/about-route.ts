/**
 * `about` route plugin: serves `GET /about` through `ctx.server`.
 * Phase 2 moves the Phase 1 `node:http` stub onto the server seam without
 * changing the response contract (static HTML stub; plain-text 404s come
 * from the server package). Phase 4 replaces `renderAbout` with the real
 * themed view; the route registration stays the same.
 */

import type { HttpServer } from "@tseer/server";
import type { Context } from "cordis";
import { renderAbout } from "./about.ts";

export interface AboutRouteOptions {
  title?: string | undefined;
}

export default function aboutRoute(ctx: Context, options: AboutRouteOptions = {}): () => void {
  const server = ctx.get("server") as HttpServer | undefined;
  if (!server) throw new Error("about: ctx.server is not mounted (load serverPlugin first)");
  const disposeRoute = server.route({
    method: "GET",
    path: "/about",
    handler: (_req, reply) => {
      reply.html(renderAbout(options.title ?? "tseer"));
    },
  });
  // Keep route removal tied to this fiber's scope (cordis unwinds the
  // callback's return value on unload) rather than only the returned
  // disposer — `fiber.dispose()` must remove the route either way.
  const disposeEffect = ctx.effect(() => disposeRoute);
  return () => {
    disposeRoute();
    void disposeEffect();
  };
}

// Cordis inject metadata: this plugin requires `ctx.server`.
aboutRoute.inject = ["server"];
