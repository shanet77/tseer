import type { TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import type { Tweet } from "@tseer/types";
import { type Render, renderArticle } from "@tseer/views";
import type { Context } from "cordis";
import { NAME_PARAM } from "./params.ts";
import { mountRoutes, type RouteShell } from "./shell.ts";
import { getPath } from "./timeline.ts";

const DIGITS = /^\d+$/;

export interface ArticleRouteDeps {
  twitter: TwitterApi;
  render: Render;
  shell: RouteShell;
}

export function registerArticleRoutes(deps: ArticleRouteDeps): () => void {
  const { twitter, render, shell } = deps;
  const { route, showError } = shell;

  async function showArticle(
    req: AppRequest,
    reply: AppReply,
    requestPrefs: TseerPreferences,
  ): Promise<void> {
    const id = req.params["id"] ?? "";
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

  async function redirectArticle(
    req: AppRequest,
    reply: AppReply,
    requestPrefs: TseerPreferences,
  ): Promise<void> {
    const id = req.params["id"] ?? "";
    if (!DIGITS.test(id)) {
      showError(reply, "Page not found", 404, requestPrefs);
      return;
    }
    await reply.redirect(`/i/article/${id}`);
  }

  route({
    method: "GET",
    path: "/i/article/:id",
    handler: showArticle,
  });

  route({
    method: "GET",
    path: `/${NAME_PARAM}/article/:id`,
    handler: redirectArticle,
  });

  route({
    method: "GET",
    path: `/${NAME_PARAM}/status/:id/article`,
    handler: redirectArticle,
  });

  return shell.dispose;
}

export default function articlePlugin(ctx: Context): () => void {
  return mountRoutes(ctx, "article", ["twitter"], (resolve, shell) =>
    registerArticleRoutes({
      twitter: resolve<TwitterApi>("twitter"),
      render: resolve<Render>("render"),
      shell,
    }),
  );
}

articlePlugin.inject = ["server", "twitter", "render", "prefs"];
