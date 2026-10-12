/**
 * The unsupported-feature routes — port of nitter's `src/routes/unsupported.nim`.
 *
 * Every path here renders the same "Unsupported feature" panel
 * (`views/feature.nim` → `renderFeature`). These are the routes nitter
 * explicitly acknowledges but does not implement; the panel points at the
 * issue tracker so a curious visitor knows why the page is empty.
 *
 * Routes (nitter → here):
 *   /about/feature                  → same (static, no conflict with the
 *                                     `/about` stub in kernel).
 *   /login, /login/:i               → Jester's `/login/?@i?` (optional bare
 *                                     segment + optional param).
 *   /:name/lists                    → Jester's `/@name/lists/?`. The bare
 *                                     path only — upstream's list timeline
 *                                     (`/@name/lists/@slug`, list.nim) is the
 *                                     list plugin's (`./list.ts`), so this
 *                                     route must not claim `:slug`.
 *   /intent, /intent/:i             → Jester's `/intent/?@i?`.
 *   /i, /i/:i, /i/:i/:j             → Jester's `/i/@i?/@j?`.
 *
 * The `cond @"i" notin [...]` guards from the Nim original are enforced
 * in-handler rather than at match time: a caught value answers the 404 error
 * page instead of the panel (in Jester a failed cond skips the route, which
 * falls through to the same global 404 handler). The `/i/:i/:j` param routes
 * sit *under* the static segments sibling plugins own — `/i/user/:id`
 * (timeline), `/i/status/:id` (status), `/i/lists/:id/rss` (rss) — and
 * fastify's radix router prefers static segments over params, so those keep
 * resolving to their real handlers regardless of plugin mount order; the
 * in-handler guard covers the case where the sibling is not mounted.
 *
 * Divergence from the Nim original: Jester's `/?`-suffixed patterns match a
 * trailing slash (`/login/`, `/intent/`, `/i/`, `/nasa/lists/` all render the
 * panel upstream); fastify's default strict trailing-slash matching answers
 * 404. A seam-wide `ignoreTrailingSlash` would over-match where Jester's
 * per-pattern `/?` does not, so the strict behavior is kept.
 *
 * Same three-seam shape as the other route plugins (`server` + `render` +
 * `prefs` via static `.inject`, `ctx.effect` cleanup). No `twitter` seam: the
 * panel is static.
 */

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

  /** Render the unsupported panel under the page shell. */
  async function feature(req: AppRequest, reply: AppReply): Promise<void> {
    const requestPrefs = prefs.parse(req.cookies, req.query);
    await reply.html(
      await render.page({ body: renderFeature(), path: req.path, prefs: requestPrefs }),
    );
  }

  /** `cond @"i" notin denied` → the panel; a caught value → the 404 page. */
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

  // /about/feature
  route({ method: "GET", path: "/about/feature", handler: feature });

  // /login + /login/:i (Jester `/login/?@i?`)
  route({ method: "GET", path: "/login", handler: feature });
  route({ method: "GET", path: "/login/:i", handler: feature });

  // /:name/lists (Jester `/@name/lists/?`). The bare path only; upstream's
  // list timeline (`/@name/lists/@slug`, list.nim) is the list plugin's job
  // (./list.ts).
  route({ method: "GET", path: `/${NAME_PARAM}/lists`, handler: feature });

  // /intent + /intent/:i (Jester `/intent/?@i?`); `user`/`follow` are timeline's.
  route({ method: "GET", path: "/intent", handler: feature });
  route({
    method: "GET",
    path: "/intent/:i",
    handler: (req, reply) => featureUnless(req, reply, ["user", "follow"]),
  });

  // /i + /i/:i + /i/:i/:j (Jester `/i/@i?/?@j?`). `status`, `lists`, `user` are
  // caught by the `cond` guard; the static segments sibling plugins own are
  // matched ahead of these param routes by the radix router (see header).
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

/** The unsupported route plugin: `ctx.server` + `ctx.render` + `ctx.prefs`.
 * Unload it and only these placeholder routes disappear. */
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
  // cordis rc.10 does not run a plugin's returned disposer through
  // fiber.dispose(); the cleanup must be a real effect (same as the other
  // route plugins).
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
