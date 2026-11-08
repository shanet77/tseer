import { type Cache, fnv1a32, namespaces } from "@tseer/cache";
import { MAX_FOLLOWS, normalizeFollows, type TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import { type Query, QueryKind, type TimelineResult, type Tweet } from "@tseer/types";
import type { Render } from "@tseer/views";
import { renderHome, renderHomeEmpty, toHtml } from "@tseer/views";
import type { Context } from "cordis";
import { mountRoutes, type RouteShell } from "./shell.ts";
import { getCursor, getPath } from "./timeline.ts";

export const HOME_MAX_FOLLOWS = MAX_FOLLOWS;
export { normalizeFollows };
export const HOME_DEFAULT_CHUNK_SIZE = 12;
export const HOME_DEFAULT_CACHE_SECONDS = 120;

interface HomeServiceConfig {
  home?:
    | {
        follows?: string[] | undefined;
        chunkSize?: number | undefined;
        cacheSeconds?: number | undefined;
      }
    | undefined;
}

export interface HomePluginOptions {
  chunkSize?: number | undefined;
  cacheSeconds?: number | undefined;
}

export function homeQuery(users: string[]): Query {
  return {
    kind: QueryKind.tweets,
    view: "",
    text: "",
    filters: [],
    includes: [],
    excludes: [],
    fromUser: users,
    since: "",
    until: "",
    minLikes: "",
    sep: "",
  };
}

export function chunkList<T>(items: T[], size: number): T[][] {
  const step = size < 1 ? 1 : size;
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += step) chunks.push(items.slice(i, i + step));
  return chunks;
}

export function mergeHomeTweets(pages: TimelineResult[]): Tweet[] {
  const seen = new Set<string>();
  const merged: Tweet[] = [];
  for (const page of pages) {
    for (const tweet of page.content) {
      if (tweet.id.length === 0 || seen.has(tweet.id)) continue;
      seen.add(tweet.id);
      merged.push(tweet);
    }
  }
  merged.sort((a, b) => {
    const left = BigInt(a.id);
    const right = BigInt(b.id);
    if (right < left) return -1;
    if (right > left) return 1;
    return 0;
  });
  return merged;
}

export function nextHomeCursor(tweets: Tweet[]): string {
  let min: bigint | undefined;
  for (const tweet of tweets) {
    const id = BigInt(tweet.id);
    if (min === undefined || id < min) min = id;
  }
  if (min === undefined) return "";
  const next = min - 1n;
  return next > 0n ? `maxid:${next}` : "";
}

export async function fetchHomeFeed(
  twitter: TwitterApi,
  follows: string[],
  cursor: string,
  chunkSize: number,
): Promise<TimelineResult> {
  const pages: TimelineResult[] = [];
  for (const chunk of chunkList(follows, chunkSize)) {
    const page = await twitter.search(homeQuery(chunk), cursor);
    if (page !== undefined) pages.push(page);
  }
  const content = mergeHomeTweets(pages);
  return {
    content,
    top: "",
    bottom: nextHomeCursor(content),
    beginning: cursor.length === 0,
    query: homeQuery(follows),
  };
}

export interface HomeRouteDeps {
  twitter: TwitterApi;
  render: Render;
  shell: RouteShell;
  chunkSize: number;
  cacheSeconds: number;
  getCache: () => Cache | undefined;
}

export function registerHomeRoutes(deps: HomeRouteDeps): () => void {
  const { twitter, render, shell, chunkSize, cacheSeconds } = deps;
  const { route } = shell;

  function homeCacheKey(follows: string[], cursor: string): string {
    const key = follows.map((name) => name.toLowerCase()).join(",");
    return `${fnv1a32(key)}:${cursor}`;
  }

  async function homeTimeline(follows: string[], cursor: string): Promise<TimelineResult> {
    const fetch = (): Promise<TimelineResult> => fetchHomeFeed(twitter, follows, cursor, chunkSize);
    const cache = deps.getCache();
    if (cache === undefined || cacheSeconds <= 0) return fetch();
    return cache.cached(namespaces.home, homeCacheKey(follows, cursor), cacheSeconds, fetch);
  }

  async function showHome(
    req: AppRequest,
    reply: AppReply,
    requestPrefs: TseerPreferences,
  ): Promise<void> {
    const path = getPath(req);
    // The visitor's cookie list, or the instance's [Home] follows by default.
    const follows = requestPrefs.follows;
    if (follows.length === 0) {
      await reply.html(
        await render.page({
          body: renderHomeEmpty(),
          title: "Home",
          path,
          prefs: requestPrefs,
        }),
      );
      return;
    }

    const cursor = getCursor(req);
    const timeline = await homeTimeline(follows, cursor);

    if (req.query["scroll"] !== undefined) {
      if (timeline.content.length === 0) {
        void reply.text("", { status: 204 });
        return;
      }
      const fragment = { ...timeline, beginning: true };
      await reply.html(toHtml(renderHome(fragment, requestPrefs, path)));
      return;
    }

    await reply.html(
      await render.page({
        body: renderHome(timeline, requestPrefs, path),
        title: "Home",
        path,
        prefs: requestPrefs,
      }),
    );
  }

  route({
    method: "GET",
    path: "/",
    handler: showHome,
  });

  return shell.dispose;
}

export default function homePlugin(ctx: Context, options: HomePluginOptions = {}): () => void {
  return mountRoutes(ctx, "home", ["twitter"], (resolve, shell) => {
    const config = resolve<HomeServiceConfig | undefined>("config");
    // The instance follow list is the `follows` pref default (wired into
    // prefsPlugin); it's only read here to warn about the cap.
    const configured = config?.home?.follows ?? [];
    if (configured.length > HOME_MAX_FOLLOWS) {
      ctx.logger.warn(
        `home: ${configured.length} follows configured, using the first ${HOME_MAX_FOLLOWS}`,
      );
    }
    const chunkSize = options.chunkSize ?? config?.home?.chunkSize ?? HOME_DEFAULT_CHUNK_SIZE;
    const cacheSeconds =
      options.cacheSeconds ?? config?.home?.cacheSeconds ?? HOME_DEFAULT_CACHE_SECONDS;

    return registerHomeRoutes({
      twitter: resolve<TwitterApi>("twitter"),
      render: resolve<Render>("render"),
      shell,
      chunkSize,
      cacheSeconds,
      getCache: () => resolve<Cache | undefined>("cache"),
    });
  });
}

homePlugin.inject = ["server", "twitter", "render", "prefs"];
