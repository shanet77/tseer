import type { HttpClient, HttpRequestOptions, HttpResponse } from "@tseer/http-client";
import {
  type Accounts,
  type ApiSelector,
  createSession,
  SessionPool,
} from "@tseer/twitter-sessions";
import { InternalError, NoSessionsError, RateLimitError, SessionKind } from "@tseer/types";
import { describe, expect, it, vi } from "vitest";
import { apiReq } from "../src/client.ts";
import { GRAPH_USER_TWEETS_V2 } from "../src/endpoints.ts";
import { createFetcher, type FetcherDeps, type Json } from "../src/fetch.ts";

const ENDPOINT = "abc/UserQuery";

function cookiePool(): SessionPool {
  return new SessionPool([
    createSession({
      kind: SessionKind.cookie,
      id: "1",
      username: "alice",
      authToken: "auth",
      ct0: "ct0",
    }),
  ]);
}

function spyAccounts(pool: SessionPool): { accounts: Accounts; selectors: ApiSelector[] } {
  const selectors: ApiSelector[] = [];
  return {
    selectors,
    accounts: {
      lease: async (selector) => {
        selectors.push(selector);
        return pool.lease(selector);
      },
      release: (lease, headers) => pool.release(lease, headers),
      reportError: (lease, code, message) => pool.reportError(lease, code, message),
      health: () => pool.health(),
      debug: () => pool.debug(),
    },
  };
}

interface Recorded {
  url: string;
  options: HttpRequestOptions;
}

function httpStub(results: ReadonlyArray<HttpResponse | Error>): {
  http: HttpClient;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  return {
    calls,
    http: {
      async request(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
        calls.push({ url, options });
        const next = results[Math.min(calls.length - 1, results.length - 1)];
        if (next === undefined) throw new Error("httpStub: no scripted response");
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

function resp(body: string, overrides: Partial<HttpResponse> = {}): HttpResponse {
  return {
    status: 200,
    headers: {},
    body,
    url: "https://x.com/i/api/graphql/abc/UserQuery",
    ...overrides,
  };
}

function deps(
  pool: SessionPool,
  http: HttpClient,
  seen: { skipTid?: boolean; url?: string } = {},
): FetcherDeps {
  return {
    accounts: spyAccounts(pool).accounts,
    http,
    genHeaders: (_session, url, skipTid) => {
      seen.skipTid = skipTid;
      seen.url = url;
      return Promise.resolve({ Authorization: "test" });
    },
  };
}

function options(extra: Record<string, unknown> = {}) {
  return { maxRetries: 1, retryDelayMs: 0, ...extra };
}

describe("createFetcher", () => {
  it("leases the dual selector, requests the cookie URL, and feeds rate-limit headers back", async () => {
    const pool = cookiePool();
    const spy = spyAccounts(pool);
    const { http, calls } = httpStub([
      resp('{"data":{"user":1}}', {
        rateLimit: { limit: 100, remaining: 42, reset: 999 },
      }),
    ]);
    const seen: { skipTid?: boolean; url?: string } = {};
    const fetcher = createFetcher({ ...deps(pool, http, seen), accounts: spy.accounts }, options());

    const result = await fetcher.fetch(apiReq(ENDPOINT, "{}"));

    expect(result).toEqual({ data: { user: 1 } });
    expect(spy.selectors).toEqual([{ oauth: ENDPOINT, cookie: ENDPOINT }]);
    expect(calls).toHaveLength(1);
    expect(
      calls[0]?.url.startsWith(
        `https://x.com/i/api/graphql/${ENDPOINT}?variables=%7B%7D&features=`,
      ),
    ).toBe(true);
    expect(calls[0]?.options.maxRetries).toBe(1);
    expect(calls[0]?.options.headers).toEqual({ Authorization: "test" });
    expect(seen.skipTid).toBe(false);

    const session = pool.all()[0];
    expect(session?.apis.get(ENDPOINT)).toEqual({ limit: 100, remaining: 42, reset: 999 });
    expect(session?.pending).toBe(0);
  });

  it("picks the oauth URL and skipTid for oauth sessions", async () => {
    const pool = new SessionPool([
      createSession({
        kind: SessionKind.oauth,
        id: "5",
        username: "bob",
        oauthToken: "tok",
        oauthSecret: "sec",
      }),
    ]);
    const { http, calls } = httpStub([resp("{}")]);
    const seen: { skipTid?: boolean; url?: string } = {};
    const fetcher = createFetcher(deps(pool, http, seen), options());

    const req = apiReq(ENDPOINT, "{}", "", true);
    await fetcher.fetch(req);

    expect(calls[0]?.url).toContain("https://api.x.com/graphql/");
    expect(seen.skipTid).toBe(true);
  });

  it("re-leases and retries on RateLimitError up to maxRetries", async () => {
    const pool = cookiePool();
    const { http, calls } = httpStub([new RateLimitError("status 429"), resp('{"ok":true}')]);
    const fetcher = createFetcher(deps(pool, http), options({ maxRetries: 2 }));

    expect(await fetcher.fetch(apiReq(ENDPOINT, "{}"))).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(pool.all()[0]?.pending).toBe(0);
  });

  it("throws RateLimitError once attempts are exhausted", async () => {
    const pool = cookiePool();
    const { http, calls } = httpStub([new RateLimitError("status 429")]);
    const fetcher = createFetcher(deps(pool, http), options({ maxRetries: 2 }));

    await expect(fetcher.fetch(apiReq(ENDPOINT, "{}"))).rejects.toBeInstanceOf(RateLimitError);
    expect(calls).toHaveLength(2);
  });

  it("marks the session limited on error code 88 (reportError → setLimited)", async () => {
    const pool = cookiePool();
    const { http } = httpStub([resp('{"errors":[{"code":88,"message":"Rate limit exceeded"}]}')]);
    const fetcher = createFetcher(deps(pool, http), options());

    await expect(fetcher.fetch(apiReq(ENDPOINT, "{}"))).rejects.toBeInstanceOf(RateLimitError);
    expect(pool.all()[0]?.limited).toBe(true);
  });

  it("invalidates the session on error code 89", async () => {
    const pool = cookiePool();
    const { http } = httpStub([
      resp('{"errors":[{"code":89,"message":"Could not authenticate you"}]}'),
    ]);
    const fetcher = createFetcher(deps(pool, http), options());

    await expect(fetcher.fetch(apiReq(ENDPOINT, "{}"))).rejects.toBeInstanceOf(RateLimitError);
    expect(pool.size).toBe(0);
  });

  it("ignores skippable error codes without touching the session", async () => {
    const pool = cookiePool();
    const { http } = httpStub([resp('{"errors":[{"code":34,"message":"User not found"}]}')]);
    const fetcher = createFetcher(deps(pool, http), options());

    const result = (await fetcher.fetch(apiReq(ENDPOINT, "{}"))) as Json;
    expect(result).toHaveProperty("errors");
    expect(pool.all()[0]?.limited).toBe(false);
    expect(pool.size).toBe(1);
  });

  it("logs non-special codes and returns the payload (fetch-level triage)", async () => {
    const pool = cookiePool();
    const { http } = httpStub([resp('[{"code":50,"message":"User not found"}]')]);
    const logger = { debug: vi.fn(), warn: vi.fn() };
    const fetcher = createFetcher(deps(pool, http), options({ logger }));

    const result = await fetcher.fetch(apiReq(ENDPOINT, "{}"));
    expect(result).toEqual([{ code: 50, message: "User not found" }]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Fetch error"));
    expect(pool.size).toBe(1);
  });

  it("invalidates from an array payload carrying code 89", async () => {
    const pool = cookiePool();
    const { http } = httpStub([resp('[{"code":89,"message":"Could not authenticate you"}]')]);
    const fetcher = createFetcher(deps(pool, http), options());

    await expect(fetcher.fetch(apiReq(ENDPOINT, "{}"))).rejects.toBeInstanceOf(RateLimitError);
    expect(pool.size).toBe(0);
  });

  it("returns null/empty string for non-JSON bodies (fetch vs fetchRaw)", async () => {
    const pool = cookiePool();
    const { http, calls } = httpStub([resp("<!doctype html><html></html>", { status: 200 })]);
    const fetcher = createFetcher(deps(pool, http), options());

    expect(await fetcher.fetch(apiReq(ENDPOINT, "{}"))).toBeNull();
    expect(await fetcher.fetchRaw(apiReq(ENDPOINT, "{}"))).toBe("");
    expect(calls).toHaveLength(2);
  });

  it("passes a JSON body through fetchRaw untouched", async () => {
    const pool = cookiePool();
    const { http } = httpStub([resp('{"a":1}')]);
    const fetcher = createFetcher(deps(pool, http), options());

    expect(await fetcher.fetchRaw(apiReq(ENDPOINT, "{}"))).toBe('{"a":1}');
  });

  it("converts a malformed JSON body into a retryable RateLimitError", async () => {
    const pool = cookiePool();
    const { http } = httpStub([resp('{"data":')]);
    const fetcher = createFetcher(deps(pool, http), options());

    await expect(fetcher.fetch(apiReq(ENDPOINT, "{}"))).rejects.toBeInstanceOf(RateLimitError);
  });

  it("raises InternalError on HTTP 400 after parsing, without retrying", async () => {
    const pool = cookiePool();
    const { http, calls } = httpStub([resp('{"errors":[]}', { status: 400 })]);
    const fetcher = createFetcher(deps(pool, http), options({ maxRetries: 3 }));

    await expect(fetcher.fetch(apiReq(ENDPOINT, "{}"))).rejects.toBeInstanceOf(InternalError);
    expect(calls).toHaveLength(1);
    expect(pool.all()[0]?.pending).toBe(0);
  });

  it("propagates NoSessionsError without retrying", async () => {
    const pool = new SessionPool([]);
    const { http, calls } = httpStub([resp("{}")]);
    const fetcher = createFetcher(deps(pool, http), options({ maxRetries: 3 }));

    await expect(fetcher.fetch(apiReq(ENDPOINT, "{}"))).rejects.toBeInstanceOf(NoSessionsError);
    expect(calls).toHaveLength(0);
  });

  it("rejects an invalid Errors payload like jsony would (retryable)", async () => {
    const pool = cookiePool();
    const { http } = httpStub([resp('{"errors":"nope"}')]);
    const fetcher = createFetcher(deps(pool, http), options());

    await expect(fetcher.fetch(apiReq(ENDPOINT, "{}"))).rejects.toBeInstanceOf(RateLimitError);
  });

  it("releases the lease when credential validation fails (nitter leaks it)", async () => {
    const pool = new SessionPool([
      createSession({ kind: SessionKind.cookie, id: "1", authToken: "", ct0: "" }),
    ]);
    const account = pool.all()[0];
    if (account === undefined) throw new Error("expected one session");
    const { http, calls } = httpStub([resp("{}")]);
    const fetcher = createFetcher(
      {
        accounts: {
          lease: async () => ({ account, api: ENDPOINT, released: false }),
          release: (lease, headers) => pool.release(lease, headers),
          reportError: (lease, code, message) => pool.reportError(lease, code, message),
          health: () => pool.health(),
          debug: () => pool.debug(),
        },
        http,
        genHeaders: () => Promise.resolve({}),
      },
      options({ maxRetries: 2 }),
    );

    await expect(fetcher.fetch(apiReq(ENDPOINT, "{}"))).rejects.toBeInstanceOf(RateLimitError);
    expect(calls).toHaveLength(0);
    expect(pool.all()[0]?.pending).toBe(0);
  });

  it("keeps the lease selector's endpoint identical to the pool exemption key", () => {
    expect(GRAPH_USER_TWEETS_V2).toBe("LE3eTyeqhBh2g-fX85O2eQ/UserWithProfileTweetsQueryV2");
  });
});
