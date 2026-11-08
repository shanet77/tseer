import {
  addFollow,
  applyPrefCookies,
  followsCookieWrite,
  isValidUsername,
  type PrefsService,
  parsePrefsParam,
  removeFollow,
  resetPrefCookies,
  updatePrefCookies,
} from "@tseer/prefs";
import type { AppRequest } from "@tseer/server";
import type { Render } from "@tseer/views";
import { findThemes, renderPreferences, viewsPublicDir } from "@tseer/views";
import type { Context } from "cordis";
import { mountRoutes, type RouteShell } from "./shell.ts";
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
  render: Render;
  shell: RouteShell;
  prefs: PrefsService;
  config?: { hostname?: string; useHttps?: boolean; staticDir?: string } | undefined;
}

export function registerPreferencesRoutes(deps: PreferencesRouteDeps): () => void {
  const { render, prefs, shell } = deps;
  const { raw, hook } = shell;

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

  raw({
    method: "GET",
    path: "/settings",
    handler: async (req, reply, requestPrefs) => {
      const themes = findThemes(deps.config?.staticDir ?? viewsPublicDir());
      const prefsCode = prefs.encode(requestPrefs);
      const prefsUrl = `${getUrlPrefix(deps.config ?? {})}/?prefs=${prefsCode}`;
      const body = renderPreferences(requestPrefs, refPath(req), themes, prefsUrl);
      return reply.html(
        await render.page({ body, title: "Preferences", path: getPath(req), prefs: requestPrefs }),
      );
    },
  });

  raw({
    method: "GET",
    path: "/settings/:i",
    handler: (_req, reply) => reply.redirect("/settings"),
  });

  raw({
    method: "POST",
    path: "/saveprefs",
    handler: (req, reply) => {
      const writes = updatePrefCookies(req.form, prefs.defaults);
      return reply.redirect(refPath(req), {
        headers: { "set-cookie": cookieHeaders(writes, req) },
      });
    },
  });

  raw({
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

  raw({
    method: "POST",
    path: "/enablehls",
    handler: (req, reply) =>
      reply.redirect(refPath(req), {
        headers: { "set-cookie": [setCookieHeader("hlsPlayback", "on", false)] },
      }),
  });

  raw({
    method: "POST",
    path: "/enablemp4",
    handler: (req, reply) =>
      reply.redirect(refPath(req), {
        headers: { "set-cookie": [setCookieHeader("mp4Playback", "on", false)] },
      }),
  });

  // Follow/unfollow snapshot the visitor's full list into the cookie. The list
  // starts from the instance default ([Home] follows) when no cookie is set.
  // Query-param overrides are ignored so `?follows=` can't leak into the cookie.
  for (const [action, apply] of [
    ["follow", addFollow],
    ["unfollow", removeFollow],
  ] as const) {
    raw({
      method: "POST",
      path: `/${action}/:name`,
      handler: (req, reply) => {
        const name = req.params["name"] ?? "";
        if (!isValidUsername(name)) return reply.text("Invalid username", { status: 400 });
        const current = prefs.parse(req.cookies).follows;
        const write = followsCookieWrite(apply(current, name), prefs.defaults);
        return reply.redirect(refPath(req), {
          headers: { "set-cookie": cookieHeaders([write], req) },
        });
      },
    });
  }

  hook((req, reply) => {
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
  });

  return shell.dispose;
}

export default function preferencesPlugin(
  ctx: Context,
  config?: { hostname?: string; useHttps?: boolean; staticDir?: string },
): () => void {
  return mountRoutes(ctx, "preferences", [], (resolve, shell) =>
    registerPreferencesRoutes({
      render: resolve<Render>("render"),
      prefs: resolve<PrefsService>("prefs"),
      shell,
      config,
    }),
  );
}

preferencesPlugin.inject = ["server", "render", "prefs"];
