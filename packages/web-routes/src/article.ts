/**
 * The article routes — port of nitter's `src/routes/article.nim`
 * (`/i/article/@id`, the `/@name/article/@id` and
 * `/@name/status/@id/article` redirects), plus the error pages nitter's
 * `nitter.nim` maps the fetch errors to.
 *
 * Same four-seam shape as the space/broadcast plugins (`server` + `twitter` +
 * `render` + `prefs` via static `.inject`, `ctx.effect` cleanup, `guard`
 * error mapping). The article object rides `twitter.article` (the
 * `getGraphArticle` port) and embedded tweets ride `twitter.tweetResults`
 * (the `getGraphTweetResults` batch port).
 *
 * Divergences from the Nim original (documented at the call sites):
 * - Jester's `cond`s are in-handler checks answering the global 404 page
 *   (`Page not found`), which is where a failed cond falls through upstream.
 *   `:id` stays dot-allowing at match time (nitter has no match-time cond on
 *   it) — the non-digit id answers in-handler. `:name` uses the shared
 *   dotless param, so dotted names fall through to static.
 * - The embedded-tweet batch fetch keeps upstream's bare `try/except
 *   discard`: any failure collapses to an empty tweet table (the article
 *   body renders without its embedded tweets), unlike the main fetch whose
 *   errors map to 429/500 pages via `guard`.
 * - The static `article` segment wins the radix node over the status
 *   plugin's `/:name/:s/:id/:m` catch-all and the timeline plugin's `:tab`,
 *   regardless of mount order — same precedent as the list/community
 *   plugins' static segments.
 */

import type { PrefsService, TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest, HttpServer, RouteSpec } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import type { Tweet } from "@tseer/types";
import { BadClientError, InternalError, NoSessionsError, RateLimitError } from "@tseer/types";
import { type Render, renderArticle } from "@tseer/views";
import type { Context } from "cordis";
import { createShowError } from "./errors.ts";
import { NAME_PARAM } from "./params.ts";
import { getPath } from "./timeline.ts";

/** space.nim-style in-handler digit cond (`allCharsInSet(Digits)`). */
const DIGITS = /^\d+$/;

export interface ArticleRouteDeps {
  server: HttpServer;
  twitter: TwitterApi;
  render: Render;
  prefs: PrefsService;
}

export function registerArticleRoutes(deps: ArticleRouteDeps): () => void {
  const { server, twitter, render, prefs } = deps;
  const disposers: (() => void)[] = [];
  const route = (spec: RouteSpec): void => {
    disposers.push(server.route(spec));
  };

  const showError = createShowError(render);

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

  /** article.nim's main handler: the article, then the embedded tweets
   * batch (whose failure is discarded verbatim), then the page. */
  async function showArticle(req: AppRequest, reply: AppReply): Promise<void> {
    const id = req.params["id"] ?? "";
    const requestPrefs = prefs.parse(req.cookies, req.query);
    if (!DIGITS.test(id)) {
      showError(reply, "Page not found", 404, requestPrefs);
      return;
    }
    const article = await twitter.article(id);
    if (article === undefined) {
      showError(reply, "Article not found", 404, requestPrefs);
      return;
    }

    const tweetIds = Object.values(article.entities)
      .filter((entity) => entity.kind === "TWEET")
      .map((entity) => entity.tweetId);
    const tweets = new Map<string, Tweet>();
    if (tweetIds.length > 0) {
      try {
        for (const tweet of (await twitter.tweetResults(tweetIds)) ?? []) {
          tweets.set(tweet.id, tweet);
        }
      } catch {
        // nitter's `except CatchableError: discard` — the body renders
        // without its embedded tweets
      }
    }

    const path = getPath(req);
    await reply.html(
      await render.page({
        body: renderArticle(article, tweets, path, requestPrefs, id),
        title: article.title,
        canonical: `https://x.com/${article.user.username}/article/${id}`,
        path,
        prefs: requestPrefs,
      }),
    );
  }

  /** The two redirect routes (`/@name/article/@id` and
   * `/@name/status/@id/article`): digit cond, then `redirect("/i/article/" & id)`. */
  async function redirectArticle(req: AppRequest, reply: AppReply): Promise<void> {
    const id = req.params["id"] ?? "";
    if (!DIGITS.test(id)) {
      showError(reply, "Page not found", 404, prefs.parse(req.cookies, req.query));
      return;
    }
    await reply.redirect(`/i/article/${id}`);
  }

  route({
    method: "GET",
    path: "/i/article/:id",
    handler: (req, reply) => guard(reply, undefined, () => showArticle(req, reply)),
  });

  route({
    method: "GET",
    path: `/${NAME_PARAM}/article/:id`,
    handler: (req, reply) => guard(reply, undefined, () => redirectArticle(req, reply)),
  });

  route({
    method: "GET",
    path: `/${NAME_PARAM}/status/:id/article`,
    handler: (req, reply) => guard(reply, undefined, () => redirectArticle(req, reply)),
  });

  return () => {
    for (const dispose of disposers) dispose();
  };
}

/** The article route plugin: `ctx.server` + `ctx.twitter` + `ctx.render` +
 * `ctx.prefs`. Unload it and only these routes disappear. */
export default function articlePlugin(ctx: Context): () => void {
  const server = ctx.get("server" as never) as HttpServer | undefined;
  const twitter = ctx.get("twitter" as never) as TwitterApi | undefined;
  const render = ctx.get("render" as never) as Render | undefined;
  const prefs = ctx.get("prefs" as never) as PrefsService | undefined;
  if (server === undefined)
    throw new Error("article: ctx.server is not mounted (load serverPlugin first)");
  if (twitter === undefined)
    throw new Error("article: ctx.twitter is not mounted (load twitterApiPlugin first)");
  if (render === undefined)
    throw new Error("article: ctx.render is not mounted (load renderPlugin first)");
  if (prefs === undefined)
    throw new Error("article: ctx.prefs is not mounted (load prefsPlugin first)");
  // cordis rc.10 does not run a plugin's returned disposer through
  // fiber.dispose(); the cleanup must be a real effect (same as the sibling
  // route plugins).
  const disposeRoutes = registerArticleRoutes({ server, twitter, render, prefs });
  const disposeEffect = ctx.effect(() => () => {
    disposeRoutes();
  });
  return () => {
    disposeRoutes();
    void disposeEffect();
  };
}

articlePlugin.inject = ["server", "twitter", "render", "prefs"];
