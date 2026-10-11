/**
 * The preferences routes — port of nitter's `src/routes/preferences.nim`.
 *
 * Routes:
 *   GET  /settings      — the prefs form (`renderPreferences`), themes discovered
 *                        from `staticDir/css/themes`, plus the `?prefs=` bookmark URL.
 *   GET  /settings/:i   — bare `/settings/:i` (Jester's `@i?`) redirects to `/settings`.
 *   POST /saveprefs     — apply the submitted form (`genUpdatePrefs`) and redirect to the
 *                        referer.
 *   POST /resetprefs    — expire every pref cookie (`genResetPrefs`) and bounce back to
 *                        `/settings?referer=…`.
 *   POST /enablehls     — set `hlsPlayback=on` (`savePref`), redirect to referer.
 *   POST /enablemp4     — set `mp4Playback=on`, redirect to referer.
 *   hook (`?prefs=`)    — `router_utils.nim` `applyUrlPrefs`: persist the bookmarked
 *                        prefs as cookies and strip the param, on every request.
 *
 * The cookie-write decisions (`updatePrefCookies`/`resetPrefCookies`/
 * `applyPrefCookies`) are pure functions in `@tseer/prefs`; this plugin owns
 * the HTTP half — serializing a write into a `Set-Cookie` header and the
 * `savePref` presence guard (only expire a cookie the request actually
 * carried). That split keeps the pref model framework-free while the route
 * stays a thin port of the Nim handlers.
 *
 * Same three-seam shape as the other route plugins (`server` + `render` +
 * `prefs` via static `.inject`, `ctx.effect` cleanup). No `twitter` seam: the
 * settings page and the cookie writes never touch X.
 *
 * Divergences from the Nim original (documented at the call sites):
 * - `/settings/:i` is a separate registration rather than Jester's optional
 *   `@i?`; a bare `/settings/` (trailing slash) is not registered.
 * - Expiry writes are skipped when the request never carried the cookie —
 *   ported verbatim from `savePref`'s `if not expire or pref in cookies(req)`.
 * - The `?prefs=` hook is a `ctx.server` request hook, not Jester's `before`
 *   block. Upstream's block runs before *every* route in one place; here the
 *   preferences plugin registers one hook that all requests pass through, and
 *   a disposed plugin takes it down with the routes. The param is stripped
 *   from the query before redirecting, so the bookmark URL redirects to itself
 *   minus `?prefs=` rather than re-applying on every load.
 */

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

/** `router_utils.nim` `getUrlPrefix`: the absolute origin for the `?prefs=` bookmark. */
function getUrlPrefix(cfg: { hostname?: string; useHttps?: boolean }): string {
  const host = cfg.hostname ?? "localhost";
  return cfg.useHttps === true ? `https://${host}` : `http://${host}`;
}

/** `router_utils.nim` `refPath()`: the `referer` form field, defaulting to "/". */
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

  /** `router_utils.nim` `savePref`: one `Set-Cookie` header value. `httpOnly`,
   * `path=/`, `secure` behind https, `SameSite=None` (secure) or `Lax`, 360d
   * forward (-10d to expire). Presence-guarded for expiries. */
  function setCookieHeader(name: string, value: string, expire: boolean): string {
    const cfg = deps.config ?? {};
    const sameSite = cfg.useHttps === true ? "None" : "Lax";
    const days = expire ? -10 : 360;
    const expires = new Date(Date.now() + days * 86_400_000).toUTCString();
    const secure = cfg.useHttps === true ? "; Secure" : "";
    return `${name}=${value}; Expires=${expires}; Path=/; HttpOnly${secure}; SameSite=${sameSite}`;
  }

  /** Collect `Set-Cookie` headers for a batch of writes, dropping the
   * expiries the `savePref` guard skips. */
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

  // GET /settings — the prefs form + `?prefs=` bookmark URL.
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

  // GET /settings/:i — Jester's bare `@i?` group; any subpath bounces home.
  route({
    method: "GET",
    path: "/settings/:i",
    handler: (_req, reply) => reply.redirect("/settings"),
  });

  // POST /saveprefs — apply the form, redirect to the referer.
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

  // POST /resetprefs — expire every pref cookie, bounce back to /settings.
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

  // POST /enablehls — set hlsPlayback=on, redirect to the referer.
  route({
    method: "POST",
    path: "/enablehls",
    handler: (req, reply) =>
      reply.redirect(refPath(req), {
        headers: { "set-cookie": [setCookieHeader("hlsPlayback", "on", false)] },
      }),
  });

  // POST /enablemp4 — set mp4Playback=on, redirect to the referer.
  route({
    method: "POST",
    path: "/enablemp4",
    handler: (req, reply) =>
      reply.redirect(refPath(req), {
        headers: { "set-cookie": [setCookieHeader("mp4Playback", "on", false)] },
      }),
  });

  // `router_utils.nim` `applyUrlPrefs` (Jester's `before` block in nitter.nim):
  // any request carrying `?prefs=<code>` persists those prefs as cookies and
  // strips the param, so a bookmarked URL like `/?prefs=theme=Auto,infiniteScroll=on`
  // configures the instance once and every later request reads the cookies.
  // The write set comes from `applyPrefCookies` (params win, everything else
  // expires); the redirect goes back to the same path minus `prefs`.
  //
  // The before block's `cond "." notin request.path` is ported as a skip:
  // dotted paths (static assets) fall through untouched, and
  // `/embed/Tweet.html` — the before block's one dot-allowing exception —
  // belongs to the embed plugin, not yet ported.
  disposers.push(
    server.hook((req, reply) => {
      if (req.path.includes(".")) return;
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

/** The preferences route plugin: `ctx.server` + `ctx.render` + `ctx.prefs`.
 * Unload it and only the settings routes disappear. */
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
  // cordis rc.10 does not run a plugin's returned disposer through
  // fiber.dispose(); the cleanup must be a real effect (same as the other
  // route plugins).
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
