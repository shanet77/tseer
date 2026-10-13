import { type Cache, fnv1a32, namespaces } from "@tseer/cache";
import type { PrefsService, TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest, HttpServer, RouteSpec } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import {
  BadClientError,
  InternalError,
  NoSessionsError,
  type Query,
  QueryKind,
  RateLimitError,
  type TimelineResult,
  type Tweet,
} from "@tseer/types";
import type { Render } from "@tseer/views";
import { renderHome, renderHomeEmpty, toHtml } from "@tseer/views";
import type { Context } from "cordis";
import { createShowError } from "./errors.ts";
import { getCursor, getPath } from "./timeline.ts";

export const HOME_MAX_FOLLOWS = 150;
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
  follows?: string[] | undefined;
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

export function normalizeFollows(list: string[]): string[] {
  const seen = new Set<string>();
  const follows: string[] = [];
  for (const raw of list) {
    const name = raw.trim();
    if (name.length === 0) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    follows.push(name);
  }
  return follows.slice(0, HOME_MAX_FOLLOWS);
}

export interface HomeRouteDeps {
  server: HttpServer;
  twitter: TwitterApi;
  render: Render;
  prefs: PrefsService;
  follows: string[];
  chunkSize: number;
  cacheSeconds: number;
  getCache: () => Cache | undefined;
}

export function registerHomeRoutes(deps: HomeRouteDeps): () => void {
  const { server, twitter, render, prefs, follows, chunkSize, cacheSeconds } = deps;
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

  function homeCacheKey(cursor: string): string {
    return `${fnv1a32(follows.join(","))}:${cursor}`;
  }

  async function homeTimeline(cursor: string): Promise<TimelineResult> {
    const fetch = (): Promise<TimelineResult> => fetchHomeFeed(twitter, follows, cursor, chunkSize);
    const cache = deps.getCache();
    if (cache === undefined || cacheSeconds <= 0) return fetch();
    return cache.cached(namespaces.home, homeCacheKey(cursor), cacheSeconds, fetch);
  }

  async function showHome(req: AppRequest, reply: AppReply): Promise<void> {
    const requestPrefs = prefs.parse(req.cookies, req.query);
    const path = getPath(req);
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
    const timeline = await homeTimeline(cursor);

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
    handler: (req, reply) => guard(reply, undefined, () => showHome(req, reply)),
  });

  return () => {
    for (const dispose of disposers) dispose();
  };
}

export default function homePlugin(ctx: Context, options: HomePluginOptions = {}): () => void {
  const server = ctx.get("server" as never) as HttpServer | undefined;
  const twitter = ctx.get("twitter" as never) as TwitterApi | undefined;
  const render = ctx.get("render" as never) as Render | undefined;
  const prefs = ctx.get("prefs" as never) as PrefsService | undefined;
  const config = ctx.get("config" as never) as HomeServiceConfig | undefined;
  if (server === undefined)
    throw new Error("home: ctx.server is not mounted (load serverPlugin first)");
  if (twitter === undefined)
    throw new Error("home: ctx.twitter is not mounted (load twitterApiPlugin first)");
  if (render === undefined)
    throw new Error("home: ctx.render is not mounted (load renderPlugin first)");
  if (prefs === undefined)
    throw new Error("home: ctx.prefs is not mounted (load prefsPlugin first)");

  const configured = options.follows ?? config?.home?.follows ?? [];
  if (configured.length > HOME_MAX_FOLLOWS) {
    ctx.logger.warn(
      `home: ${configured.length} follows configured, using the first ${HOME_MAX_FOLLOWS}`,
    );
  }
  const follows = normalizeFollows(configured);
  const chunkSize = options.chunkSize ?? config?.home?.chunkSize ?? HOME_DEFAULT_CHUNK_SIZE;
  const cacheSeconds =
    options.cacheSeconds ?? config?.home?.cacheSeconds ?? HOME_DEFAULT_CACHE_SECONDS;

  const disposeRoutes = registerHomeRoutes({
    server,
    twitter,
    render,
    prefs,
    follows,
    chunkSize,
    cacheSeconds,
    getCache: () => ctx.get("cache" as never) as Cache | undefined,
  });
  const disposeEffect = ctx.effect(() => () => {
    disposeRoutes();
  });
  return () => {
    disposeRoutes();
    void disposeEffect();
  };
}

homePlugin.inject = ["server", "twitter", "render", "prefs"];
