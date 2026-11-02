import type { TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest } from "@tseer/server";
import type { Render } from "@tseer/views";
import { renderFeature } from "@tseer/views";
import type { Context } from "cordis";
import { NAME_PARAM } from "./params.ts";
import { mountRoutes, type RouteShell } from "./shell.ts";

export interface UnsupportedRouteDeps {
  render: Render;
  shell: RouteShell;
}

export function registerUnsupportedRoutes(deps: UnsupportedRouteDeps): () => void {
  const { render, shell } = deps;
  const { raw, showError } = shell;

  async function feature(
    req: AppRequest,
    reply: AppReply,
    requestPrefs: TseerPreferences,
  ): Promise<void> {
    await reply.html(
      await render.page({ body: renderFeature(), path: req.path, prefs: requestPrefs }),
    );
  }

  async function featureUnless(
    req: AppRequest,
    reply: AppReply,
    requestPrefs: TseerPreferences,
    denied: readonly string[],
  ): Promise<void> {
    const i = req.params["i"] ?? "";
    if (denied.includes(i)) {
      showError(reply, "Page not found", 404, requestPrefs);
      return;
    }
    await feature(req, reply, requestPrefs);
  }

  raw({ method: "GET", path: "/about/feature", handler: feature });

  raw({ method: "GET", path: "/login", handler: feature });
  raw({ method: "GET", path: "/login/:i", handler: feature });

  raw({ method: "GET", path: `/${NAME_PARAM}/lists`, handler: feature });

  raw({ method: "GET", path: "/intent", handler: feature });
  raw({
    method: "GET",
    path: "/intent/:i",
    handler: (req, reply, requestPrefs) =>
      featureUnless(req, reply, requestPrefs, ["user", "follow"]),
  });

  raw({ method: "GET", path: "/i", handler: feature });
  raw({
    method: "GET",
    path: "/i/:i",
    handler: (req, reply, requestPrefs) =>
      featureUnless(req, reply, requestPrefs, ["status", "lists", "user"]),
  });
  raw({
    method: "GET",
    path: "/i/:i/:j",
    handler: (req, reply, requestPrefs) =>
      featureUnless(req, reply, requestPrefs, ["status", "lists", "user"]),
  });

  return shell.dispose;
}

export default function unsupportedPlugin(ctx: Context): () => void {
  return mountRoutes(ctx, "unsupported", [], (resolve, shell) =>
    registerUnsupportedRoutes({ render: resolve<Render>("render"), shell }),
  );
}

unsupportedPlugin.inject = ["server", "render", "prefs"];
