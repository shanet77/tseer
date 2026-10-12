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
    twitter: TwitterApi;
  }
}

interface TwitterConfig {
  disableTid?: boolean | undefined;
  maxRetries?: number | undefined;
  retryDelayMs?: number | undefined;
}

export interface TwitterApiPluginOptions {
  disableTid?: boolean | undefined;
  maxRetries?: number | undefined;
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
