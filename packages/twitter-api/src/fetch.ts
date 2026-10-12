import { setTimeout as delay } from "node:timers/promises";
import type { HttpClient, HttpResponse } from "@tseer/http-client";
import type { Accounts, ApiSelector, LeasedAccount, Session } from "@tseer/twitter-sessions";
import { prettySession } from "@tseer/twitter-sessions";
import {
  ApiErrorCode,
  InternalError,
  NoSessionsError,
  RateLimitError,
  SessionKind,
} from "@tseer/types";
import type { ApiReq } from "./urls.ts";
import { toUrl } from "./urls.ts";

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const ERRORS_TO_SKIP: readonly ApiErrorCode[] = [
  ApiErrorCode.none,
  ApiErrorCode.doesntExist,
  ApiErrorCode.tweetNotFound,
  ApiErrorCode.timeout,
  ApiErrorCode.unauthorized,
  ApiErrorCode.badRequest,
];

const INVALIDATE_CODES: readonly ApiErrorCode[] = [
  ApiErrorCode.expiredToken,
  ApiErrorCode.badToken,
  ApiErrorCode.locked,
];

export interface FetchLogger {
  debug(message: string): void;
  warn(message: string): void;
}

export interface FetcherDeps {
  accounts: Accounts;
  http: HttpClient;
  genHeaders: (session: Session, url: string, skipTid: boolean) => Promise<Record<string, string>>;
}

export interface FetcherOptions {
  maxRetries?: number | undefined;
  retryDelayMs?: number | undefined;
  logger?: FetchLogger | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

export interface Fetcher {
  fetch(req: ApiReq): Promise<Json>;
  fetchRaw(req: ApiReq): Promise<string>;
}

function apiPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function parseErrorCodes(body: string): ApiErrorCode[] {
  const invalid = (): never => {
    throw new Error("fetch: response is not a valid Errors payload");
  };
  const payload: unknown = JSON.parse(body);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return invalid();
  const errors: unknown = (payload as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return invalid();
  return errors.map((entry): ApiErrorCode => {
    if (typeof entry !== "object" || entry === null) return invalid();
    const { code, message } = entry as { code?: unknown; message?: unknown };
    if (typeof message !== "string") return invalid();
    if (typeof code === "number") return code;
    if (typeof code === "string" && code in ApiErrorCode) {
      return ApiErrorCode[code as keyof typeof ApiErrorCode];
    }
    return invalid();
  });
}

function firstErrorCode(result: Json): ApiErrorCode {
  if (!Array.isArray(result) || result.length === 0) return ApiErrorCode.none;
  const first: unknown = result[0];
  if (typeof first !== "object" || first === null || Array.isArray(first)) {
    return ApiErrorCode.none;
  }
  const code = (first as { code?: unknown }).code;
  return typeof code === "number" ? code : ApiErrorCode.none;
}

function hasSkippableCode(codes: readonly ApiErrorCode[]): boolean {
  return codes.some((code) => ERRORS_TO_SKIP.includes(code));
}

function apiErrorAction(codes: readonly ApiErrorCode[]): "invalidate" | "limited" | undefined {
  if (codes.some((code) => INVALIDATE_CODES.includes(code))) return "invalidate";
  if (codes.includes(ApiErrorCode.rateLimited)) return "limited";
  return undefined;
}

export function createFetcher(deps: FetcherDeps, options: FetcherOptions = {}): Fetcher {
  const maxRetries = Math.max(1, options.maxRetries ?? 1);
  const retryDelayMs = options.retryDelayMs ?? 150;
  const sleep = options.sleep ?? ((ms: number) => delay(ms));
  const log = options.logger;

  function validateCredentials(session: Session): void {
    if (session.kind === SessionKind.oauth) {
      if (session.oauthToken.length === 0) {
        log?.warn(`[sessions] Empty oauth token, session: ${prettySession(session)}`);
        throw new RateLimitError();
      }
    } else if (session.authToken.length === 0 || session.ct0.length === 0) {
      log?.warn(`[sessions] Empty cookie credentials, session: ${prettySession(session)}`);
      throw new RateLimitError();
    }
  }

  async function run<T>(
    req: ApiReq,
    handle: (resp: HttpResponse, lease: LeasedAccount, url: string, session: Session) => Promise<T>,
  ): Promise<T> {
    const selector: ApiSelector = { oauth: req.oauth.endpoint, cookie: req.cookie.endpoint };
    let lastFailure: RateLimitError | undefined;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let lease: LeasedAccount | undefined;
      try {
        lease = await deps.accounts.lease(selector);
        const session = lease.account;
        validateCredentials(session);
        const url = toUrl(req, session.kind);
        const skipTid = (session.kind === SessionKind.oauth ? req.oauth : req.cookie).skipTid;
        const headers = await deps.genHeaders(session, url, skipTid);
        const resp = await deps.http.request(url, { method: "GET", headers, maxRetries: 1 });
        deps.accounts.release(lease, resp.rateLimit);
        return await handle(resp, lease, url, session);
      } catch (err) {
        if (lease !== undefined) deps.accounts.release(lease);
        if (err instanceof NoSessionsError || err instanceof InternalError) throw err;
        let failure: RateLimitError;
        if (err instanceof RateLimitError) {
          failure = err;
        } else {
          const cause = err as Error;
          log?.warn(
            `fetch: ${cause.name}: ${cause.message} --- url: ${req.cookie.endpoint}, ` +
              `session: ${lease === undefined ? "<none>" : prettySession(lease.account)}`,
          );
          failure = new RateLimitError(`fetch ${req.cookie.endpoint}: ${cause.message}`);
          failure.cause = cause;
        }
        lastFailure = failure;
        if (attempt < maxRetries) {
          log?.debug(
            `[sessions] Rate limited, retrying ${req.cookie.endpoint} request ` +
              `(${attempt}/${maxRetries})...`,
          );
          if (retryDelayMs > 0) await sleep(retryDelayMs);
        }
      }
    }
    throw lastFailure ?? new RateLimitError(`fetch ${req.cookie.endpoint}: request failed`);
  }

  function triageObjectErrors(
    body: string,
    lease: LeasedAccount,
    url: string,
    session: Session,
  ): void {
    const codes = parseErrorCodes(body);
    if (hasSkippableCode(codes)) return;
    log?.warn(
      `Fetch error, API: ${apiPath(url)}, errors: ${body}, session: ${prettySession(session)}`,
    );
    const action = apiErrorAction(codes);
    if (action === "invalidate") {
      const code = codes.find((c) => INVALIDATE_CODES.includes(c)) as ApiErrorCode;
      deps.accounts.reportError(lease, code);
      throw new RateLimitError();
    }
    if (action === "limited") {
      deps.accounts.reportError(lease, ApiErrorCode.rateLimited);
      throw new RateLimitError();
    }
  }

  function raiseOn400(resp: HttpResponse, url: string, session: Session, body: string): void {
    if (resp.status !== 400) return;
    log?.warn(`ERROR 400, ${apiPath(url)}: ${body}, session: ${prettySession(session)}`);
    throw new InternalError(url);
  }

  async function fetch(req: ApiReq): Promise<Json> {
    return run(req, async (resp, lease, url, session) => {
      const body = resp.body;
      if (body.startsWith('{"errors"')) triageObjectErrors(body, lease, url, session);

      let result: Json;
      if (body.startsWith("{") || body.startsWith("[")) {
        result = JSON.parse(body) as Json;
      } else {
        log?.warn(`${resp.status}: ${body} --- url: ${url}, session: ${prettySession(session)}`);
        result = null;
      }

      const code = firstErrorCode(result);
      if (code !== ApiErrorCode.none && !ERRORS_TO_SKIP.includes(code)) {
        log?.warn(
          `Fetch error, API: ${apiPath(url)}, error: ${code}, session: ${prettySession(session)}`,
        );
        if (INVALIDATE_CODES.includes(code)) {
          deps.accounts.reportError(lease, code);
          throw new RateLimitError();
        }
      }

      raiseOn400(resp, url, session, body);
      return result;
    });
  }

  async function fetchRaw(req: ApiReq): Promise<string> {
    return run(req, async (resp, lease, url, session) => {
      const body = resp.body;
      if (body.startsWith('{"errors"')) triageObjectErrors(body, lease, url, session);

      let result = body;
      if (!body.startsWith("{") && !body.startsWith("[")) {
        log?.warn(`${resp.status}: ${body} --- url: ${url}, session: ${prettySession(session)}`);
        result = "";
      }

      raiseOn400(resp, url, session, body);
      return result;
    });
  }

  return { fetch, fetchRaw };
}
