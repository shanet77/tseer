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
      } catch {}
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
