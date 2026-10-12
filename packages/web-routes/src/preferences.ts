import {
  applyPrefCookies,
  type PrefsService,
  parsePrefsParam,
  resetPrefCookies,
  updatePrefCookies,
} from "@tseer/prefs";
import type { AppRequest, HttpServer, RouteSpec } from "@tseer/server";
import type { Render } from "@tseer/views";
import { findThemes, renderPreferences, viewsPublicDir } from "@tseer/views";
import type { Context } from "cordis";
import { getPath } from "./timeline.ts";

function getUrlPrefix(cfg: { hostname?: string; useHttps?: boolean }): string {
  const host = cfg.hostname ?? "localhost";
  return cfg.useHttps === true ? `https://${host}` : `http://${host}`;
}

function refPath(req: AppRequest): string {
  const referer = req.form["referer"] ?? req.query["referer"] ?? "";
  return referer.length > 0 ? referer : "/";
}

export interface PreferencesRouteDeps {
  server: HttpServer;
  render: Render;
  prefs: PrefsService;
  config?: { hostname?: string; useHttps?: boolean; staticDir?: string } | undefined;
}

export function registerPreferencesRoutes(deps: PreferencesRouteDeps): () => void {
  const { server, render, prefs } = deps;
  const disposers: (() => void)[] = [];
  const route = (spec: RouteSpec): void => {
    disposers.push(server.route(spec));
  };

  function setCookieHeader(name: string, value: string, expire: boolean): string {
    const cfg = deps.config ?? {};
    const sameSite = cfg.useHttps === true ? "None" : "Lax";
    const days = expire ? -10 : 360;
    const expires = new Date(Date.now() + days * 86_400_000).toUTCString();
    const secure = cfg.useHttps === true ? "; Secure" : "";
    return `${name}=${value}; Expires=${expires}; Path=/; HttpOnly${secure}; SameSite=${sameSite}`;
  }

  function cookieHeaders(
    writes: { name: string; value: string; expire: boolean }[],
    req: AppRequest,
  ): string[] {
    const headers: string[] = [];
    for (const write of writes) {
      if (write.expire && !(write.name in req.cookies)) continue;
      headers.push(setCookieHeader(write.name, write.value, write.expire));
    }
    return headers;
  }

  route({
    method: "GET",
    path: "/settings",
    handler: async (req, reply) => {
      const requestPrefs = prefs.parse(req.cookies, req.query);
      const themes = findThemes(deps.config?.staticDir ?? viewsPublicDir());
      const prefsCode = prefs.encode(requestPrefs);
      const prefsUrl = `${getUrlPrefix(deps.config ?? {})}/?prefs=${prefsCode}`;
      const body = renderPreferences(requestPrefs, refPath(req), themes, prefsUrl);
      return reply.html(
        await render.page({ body, title: "Preferences", path: getPath(req), prefs: requestPrefs }),
      );
    },
  });

  route({
    method: "GET",
    path: "/settings/:i",
    handler: (_req, reply) => reply.redirect("/settings"),
  });

  route({
    method: "POST",
    path: "/saveprefs",
    handler: (req, reply) => {
      const writes = updatePrefCookies(req.form, prefs.defaults);
      return reply.redirect(refPath(req), {
        headers: { "set-cookie": cookieHeaders(writes, req) },
      });
    },
  });

  route({
    method: "POST",
    path: "/resetprefs",
    handler: (req, reply) => {
      const writes = resetPrefCookies();
      const referer = refPath(req);
      return reply.redirect(`/settings?referer=${encodeURIComponent(referer)}`, {
        headers: { "set-cookie": cookieHeaders(writes, req) },
      });
    },
  });

  route({
    method: "POST",
    path: "/enablehls",
    handler: (req, reply) =>
      reply.redirect(refPath(req), {
        headers: { "set-cookie": [setCookieHeader("hlsPlayback", "on", false)] },
      }),
  });

  route({
    method: "POST",
    path: "/enablemp4",
    handler: (req, reply) =>
      reply.redirect(refPath(req), {
        headers: { "set-cookie": [setCookieHeader("mp4Playback", "on", false)] },
      }),
  });

  disposers.push(
    server.hook((req, reply) => {
      if (req.path.includes(".") && req.path !== "/embed/Tweet.html") return;
      const code = req.query["prefs"] ?? "";
      if (code.length === 0) return;
      const writes = applyPrefCookies(parsePrefsParam(code));
      const clean = new URLSearchParams();
      for (const [key, value] of Object.entries(req.query)) {
        if (key !== "prefs" && value.length > 0) clean.set(key, value);
      }
      const query = clean.toString();
      const target = query.length > 0 ? `${req.path}?${query}` : req.path;
      void reply.redirect(target, { headers: { "set-cookie": cookieHeaders(writes, req) } });
    }),
  );

  return () => {
    for (const dispose of disposers) dispose();
  };
}

export default function preferencesPlugin(
  ctx: Context,
  config?: { hostname?: string; useHttps?: boolean; staticDir?: string },
): () => void {
  const server = ctx.get("server" as never) as HttpServer | undefined;
  const render = ctx.get("render" as never) as Render | undefined;
  const prefs = ctx.get("prefs" as never) as PrefsService | undefined;
  if (server === undefined)
    throw new Error("preferences: ctx.server is not mounted (load serverPlugin first)");
  if (render === undefined)
    throw new Error("preferences: ctx.render is not mounted (load renderPlugin first)");
  if (prefs === undefined)
    throw new Error("preferences: ctx.prefs is not mounted (load prefsPlugin first)");
  const disposeRoutes = registerPreferencesRoutes({ server, render, prefs, config });
  const disposeEffect = ctx.effect(() => () => {
    disposeRoutes();
  });
  return () => {
    disposeRoutes();
    void disposeEffect();
  };
}

preferencesPlugin.inject = ["server", "render", "prefs"];
