/** `GET /about` route plugin served through `ctx.server`; static HTML stub. */
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
  const disposeEffect = ctx.effect(() => disposeRoute);
  return () => {
    disposeRoute();
    void disposeEffect();
  };
}

aboutRoute.inject = ["server"];
