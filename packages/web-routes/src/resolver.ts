/**
 * The resolver routes — port of nitter's `src/routes/resolver.nim`
 * (`/cards/:card/:id`, `/t.co/:url`), plus the error pages nitter's
 * `nitter.nim` maps the fetch errors to.
 *
 * Same four-seam shape as the timeline/status/search/rss plugins (`server` +
 * `twitter` + `render` + `prefs` via static `.inject`, `ctx.effect` cleanup,
 * `guard` error mapping). Each handler builds the upstream URL server-side,
 * resolves it through `twitter.resolve` (the `api.nim` `resolve` port: `HEAD`
 * with no redirect following → `location` header), rewrites the result with
 * `replaceUrls` (nitter applies the prefs *before* redirecting), and
 * redirects. An empty resolution answers the `Invalid <kind> link` error
 * page (`respResolved`).
 *
 * Divergences from the Nim original (documented at the call sites):
 * - `resolve` failures cannot throw (`""` on any error, like nitter's
 *   `except: discard`), so the `guard` only fires for seam-level failures.
 */

import type { PrefsService, TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest, HttpServer, RouteSpec } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import { BadClientError, InternalError, NoSessionsError, RateLimitError } from "@tseer/types";
import type { Render } from "@tseer/views";
import { replaceUrls } from "@tseer/views";
import type { Context } from "cordis";

export interface ResolverRouteDeps {
  server: HttpServer;
  twitter: TwitterApi;
  render: Render;
  prefs: PrefsService;
}

/** resolver.nim `https://cards.twitter.com/cards/$1/$2`. */
export function cardUrl(card: string, id: string): string {
  return `https://cards.twitter.com/cards/${card}/${id}`;
}

/** resolver.nim `https://t.co/ & @"url"`. */
export function tcoUrl(url: string): string {
  return `https://t.co/${url}`;
}

export function registerResolverRoutes(deps: ResolverRouteDeps): () => void {
  const { server, twitter, render, prefs } = deps;
  const disposers: (() => void)[] = [];
  const route = (spec: RouteSpec): void => {
    disposers.push(server.route(spec));
  };

  function showError(
    reply: AppReply,
    message: string,
    status = 200,
    requestPrefs?: TseerPreferences,
  ): void {
    void reply.html(render.errorPage(message, undefined, requestPrefs), { status });
  }

  /** nitter.nim's error pages: the fetch loop's failures get real pages. */
  async function guard(
    reply: AppReply,
    requestPrefs: TseerPreferences | undefined,
    body: () => Promise<void>,
  ): Promise<void> {
    try {
      await body();
    } catch (error) {
      if (error instanceof RateLimitError) {
        showError(
          reply,
          "Instance has been rate limited. Use another instance or try again later.",
          429,
          requestPrefs,
        );
        return;
      }
      if (error instanceof NoSessionsError) {
        showError(
          reply,
          "Instance has no auth tokens, or is fully rate limited. Use another instance or try again later.",
          429,
          requestPrefs,
        );
        return;
      }
      if (error instanceof InternalError) {
        showError(
          reply,
          "An error occurred, please open a GitHub issue with the URL you tried to visit.",
          500,
          requestPrefs,
        );
        return;
      }
      if (error instanceof BadClientError) {
        showError(reply, "Network error occurred, please try again.", 500, requestPrefs);
        return;
      }
      throw error;
    }
  }

  /** resolver.nim `respResolved`: empty → `Invalid <kind> link`, else redirect. */
  async function showResolved(
    req: AppRequest,
    reply: AppReply,
    url: string,
    kind: "card" | "t.co",
  ): Promise<void> {
    const requestPrefs = prefs.parse(req.cookies, req.query);
    const location = replaceUrls(await twitter.resolve(url), requestPrefs);
    if (location.length === 0) {
      showError(reply, `Invalid ${kind} link`, 200, requestPrefs);
      return;
    }
    await reply.redirect(location);
  }

  route({
    method: "GET",
    path: "/cards/:card/:id",
    handler: (req, reply) =>
      guard(reply, undefined, () =>
        showResolved(req, reply, cardUrl(req.params["card"] ?? "", req.params["id"] ?? ""), "card"),
      ),
  });

  route({
    method: "GET",
    path: "/t.co/:url",
    handler: (req, reply) =>
      guard(reply, undefined, () =>
        showResolved(req, reply, tcoUrl(req.params["url"] ?? ""), "t.co"),
      ),
  });

  return () => {
    for (const dispose of disposers) dispose();
  };
}

/** The resolver route plugin: `ctx.server` + `ctx.twitter` + `ctx.render` +
 * `ctx.prefs`. Unload it and only these routes disappear. */
export default function resolverPlugin(ctx: Context): () => void {
  const server = ctx.get("server" as never) as HttpServer | undefined;
  const twitter = ctx.get("twitter" as never) as TwitterApi | undefined;
  const render = ctx.get("render" as never) as Render | undefined;
  const prefs = ctx.get("prefs" as never) as PrefsService | undefined;
  if (server === undefined)
    throw new Error("resolver: ctx.server is not mounted (load serverPlugin first)");
  if (twitter === undefined)
    throw new Error("resolver: ctx.twitter is not mounted (load twitterApiPlugin first)");
  if (render === undefined)
    throw new Error("resolver: ctx.render is not mounted (load renderPlugin first)");
  if (prefs === undefined)
    throw new Error("resolver: ctx.prefs is not mounted (load prefsPlugin first)");
  // cordis rc.10 does not run a plugin's returned disposer through
  // fiber.dispose(); the cleanup must be a real effect (same as
  // timelinePlugin/mediaRoutePlugin).
  const disposeRoutes = registerResolverRoutes({ server, twitter, render, prefs });
  const disposeEffect = ctx.effect(() => () => {
    disposeRoutes();
  });
  return () => {
    disposeRoutes();
    void disposeEffect();
  };
}

resolverPlugin.inject = ["server", "twitter", "render", "prefs"];
