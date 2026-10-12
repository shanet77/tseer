import type { PrefsService } from "@tseer/prefs";
import type { AppReply, AppRequest, HttpServer, RouteSpec } from "@tseer/server";
import type { Render } from "@tseer/views";
import { renderFeature } from "@tseer/views";
import type { Context } from "cordis";
import { createShowError } from "./errors.ts";
import { NAME_PARAM } from "./params.ts";

export interface UnsupportedRouteDeps {
  server: HttpServer;
  render: Render;
  prefs: PrefsService;
}

export function registerUnsupportedRoutes(deps: UnsupportedRouteDeps): () => void {
  const { server, render, prefs } = deps;
  const showError = createShowError(render);
  const disposers: (() => void)[] = [];
  const route = (spec: RouteSpec): void => {
    disposers.push(server.route(spec));
  };

  async function feature(req: AppRequest, reply: AppReply): Promise<void> {
    const requestPrefs = prefs.parse(req.cookies, req.query);
    await reply.html(
      await render.page({ body: renderFeature(), path: req.path, prefs: requestPrefs }),
    );
  }

  async function featureUnless(
    req: AppRequest,
    reply: AppReply,
    denied: readonly string[],
  ): Promise<void> {
    const i = req.params["i"] ?? "";
    if (denied.includes(i)) {
      showError(reply, "Page not found", 404, prefs.parse(req.cookies, req.query));
      return;
    }
    await feature(req, reply);
  }

  route({ method: "GET", path: "/about/feature", handler: feature });

  route({ method: "GET", path: "/login", handler: feature });
  route({ method: "GET", path: "/login/:i", handler: feature });

  route({ method: "GET", path: `/${NAME_PARAM}/lists`, handler: feature });

  route({ method: "GET", path: "/intent", handler: feature });
  route({
    method: "GET",
    path: "/intent/:i",
    handler: (req, reply) => featureUnless(req, reply, ["user", "follow"]),
  });

  route({ method: "GET", path: "/i", handler: feature });
  route({
    method: "GET",
    path: "/i/:i",
    handler: (req, reply) => featureUnless(req, reply, ["status", "lists", "user"]),
  });
  route({
    method: "GET",
    path: "/i/:i/:j",
    handler: (req, reply) => featureUnless(req, reply, ["status", "lists", "user"]),
  });

  return () => {
    for (const dispose of disposers) dispose();
  };
}

export default function unsupportedPlugin(ctx: Context): () => void {
  const server = ctx.get("server" as never) as HttpServer | undefined;
  const render = ctx.get("render" as never) as Render | undefined;
  const prefs = ctx.get("prefs" as never) as PrefsService | undefined;
  if (server === undefined)
    throw new Error("unsupported: ctx.server is not mounted (load serverPlugin first)");
  if (render === undefined)
    throw new Error("unsupported: ctx.render is not mounted (load renderPlugin first)");
  if (prefs === undefined)
    throw new Error("unsupported: ctx.prefs is not mounted (load prefsPlugin first)");
  const disposeRoutes = registerUnsupportedRoutes({ server, render, prefs });
  const disposeEffect = ctx.effect(() => () => {
    disposeRoutes();
  });
  return () => {
    disposeRoutes();
    void disposeEffect();
  };
}

unsupportedPlugin.inject = ["server", "render", "prefs"];
