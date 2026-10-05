/**
 * `twitterApiPlugin` — the default `ctx.twitter` provider (plan §1's
 * "the provider seam"). Wires the platform seams together: `ctx.accounts`
 * (lease/release), `ctx.http` (transport), `tid.nim` (transaction ids), and
 * the `apiutils.nim` fetch loop.
 *
 * `inject` defers execution until `accounts` and `http` are provided (same
 * pattern as `mediaRoutePlugin`), so mount order only needs the seams to
 * exist *eventually* — and a context without sessions never provides
 * `ctx.twitter` at all.
 */
import type { HttpClient } from "@tseer/http-client";
import type { Parsers } from "@tseer/twitter-parser";
import type { Accounts, Session } from "@tseer/twitter-sessions";
import type { Context } from "cordis";
import { createDomainTwitterApi, type TwitterApi } from "./domain.ts";
import { createFetcher } from "./fetch.ts";
import { createTwitterApi } from "./fetchers.ts";
import { genHeaders } from "./headers.ts";
import { createTidGenerator } from "./tid.ts";

declare module "cordis" {
  interface Context {
    /** Plan §3 provider seam: parsed domain objects (fetch → parse). */
    twitter: TwitterApi;
  }
}

/**
 * Subset of `ctx.config` this seam reads. Declared locally so `twitter-api`
 * never imports `@tseer/kernel` (import boundaries are seams); the kernel's
 * `TseerConfig` satisfies it structurally.
 */
interface TwitterConfig {
  disableTid?: boolean | undefined;
  maxRetries?: number | undefined;
  retryDelayMs?: number | undefined;
}

export interface TwitterApiPluginOptions {
  /** nitter `disableTid`: drop `x-client-transaction-id`, use bearer v2. */
  disableTid?: boolean | undefined;
  /** nitter `maxRetries`: fetch attempts across sessions (default 1). */
  maxRetries?: number | undefined;
  /** nitter `retryDelayMs`: delay between attempts (default 150). */
  retryDelayMs?: number | undefined;
}

export default function twitterApiPlugin(
  ctx: Context,
  options: TwitterApiPluginOptions = {},
): () => void {
  const config = ctx.get("config" as never) as TwitterConfig | undefined;
  const accounts = ctx.get("accounts" as never) as Accounts | undefined;
  const http = ctx.get("http" as never) as HttpClient | undefined;
  const parsers = ctx.get("parsers" as never) as Parsers | undefined;
  if (accounts === undefined) {
    throw new Error("twitter: ctx.accounts is not mounted (load twitterSessionsPlugin first)");
  }
  if (http === undefined) {
    throw new Error("twitter: ctx.http is not mounted (load httpClientPlugin first)");
  }
  if (parsers === undefined) {
    throw new Error("twitter: ctx.parsers is not mounted (load parsersPlugin first)");
  }

  const disableTid = options.disableTid ?? config?.disableTid ?? false;
  const maxRetries = options.maxRetries ?? config?.maxRetries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? config?.retryDelayMs ?? 150;

  // Lazy: no network happens until the first tid is needed.
  const tid = createTidGenerator();
  const fetcher = createFetcher(
    {
      accounts,
      http,
      genHeaders: (session: Session, url: string, skipTid: boolean) =>
        genHeaders(session, url, skipTid, {
          disableTid,
          genTid: tid.genTid,
        }),
    },
    {
      maxRetries,
      retryDelayMs,
      logger: ctx.logger,
    },
  );

  const dispose = ctx.provide(
    "twitter",
    createDomainTwitterApi(createTwitterApi(fetcher), parsers),
  );
  return () => {
    void dispose();
  };
}

twitterApiPlugin.inject = ["accounts", "http"];
