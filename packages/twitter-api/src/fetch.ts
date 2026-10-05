/**
 * The fetch layer — a port of nitter's `apiutils.nim`: the `retry` template,
 * `fetchImpl`, and the `fetch`/`fetchRaw` procs, on top of the platform
 * seams (`ctx.accounts` + `ctx.http`).
 *
 * Structure vs the Nim original:
 * - nitter's `retry` template re-leases a session per attempt; that loop
 *   lives here, and each attempt calls `ctx.http` with `maxRetries: 1` so the
 *   two retry layers cannot multiply. This preserves the *load-bearing*
 *   semantic: every retry may pick a different session (rate-limited ones are
 *   skipped by the pool), exactly like nitter. It also means `ctx.http`'s own
 *   transport retry is bypassed for API calls — the fetch loop subsumes it.
 * - `release(lease, resp.rateLimit)` runs right after the response, before
 *   body triage (nitter recorded rate-limit headers before triage too, then
 *   released in `finally`). The `Accounts` seam has no standalone
 *   `setRateLimit`, and `release` is idempotent, so the later `finally`
 *   release and the error paths collapse onto one call.
 * - Divergence: nitter *leaks* `pending` when credential validation fails
 *   (the raise happens outside `fetchImpl`'s `finally`); here the catch
 *   releases, so the slot always returns to the pool.
 * - `OSError`/`BadClientError` passthroughs are not ported: `ctx.http`
 *   already normalizes transport failures and 503s into `RateLimitError`
 *   (documented in `http-client`).
 */
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

/** Any JSON value upstream can return. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Error codes nitter's `errorsToSkip` swallows (no log, no session action). */
const ERRORS_TO_SKIP: readonly ApiErrorCode[] = [
  ApiErrorCode.none,
  ApiErrorCode.doesntExist,
  ApiErrorCode.tweetNotFound,
  ApiErrorCode.timeout,
  ApiErrorCode.unauthorized,
  ApiErrorCode.badRequest,
];

/** Codes that invalidate the session (nitter: `expiredToken, badToken, locked`). */
const INVALIDATE_CODES: readonly ApiErrorCode[] = [
  ApiErrorCode.expiredToken,
  ApiErrorCode.badToken,
  ApiErrorCode.locked,
];

/** Minimal logger surface used here (satisfied by `ctx.logger`). */
export interface FetchLogger {
  debug(message: string): void;
  warn(message: string): void;
}

export interface FetcherDeps {
  accounts: Accounts;
  http: HttpClient;
  /** Port of `apiutils.nim` `genHeaders`; injected so tests can stub tid. */
  genHeaders: (session: Session, url: string, skipTid: boolean) => Promise<Record<string, string>>;
}

export interface FetcherOptions {
  /**
   * Total attempts across sessions (nitter `maxRetries`, default 1 = no
   * retries). Each attempt re-leases, so this is also the rotation budget.
   */
  maxRetries?: number | undefined;
  /** Fixed delay between attempts (nitter `retryDelayMs`, default 150). */
  retryDelayMs?: number | undefined;
  logger?: FetchLogger | undefined;
  /** Sleep between attempts (default: `node:timers/promises`; tests stub it). */
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

/** The two nitter procs this ports: `fetch` (JSON) and `fetchRaw` (text). */
export interface Fetcher {
  /** Port of `apiutils.nim` `fetch`: parse the body as JSON. */
  fetch(req: ApiReq): Promise<Json>;
  /** Port of `apiutils.nim` `fetchRaw`: the raw body text. */
  fetchRaw(req: ApiReq): Promise<string>;
}

function apiPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Port of the `Errors` shape as parsed by jsony (`experimental/types/
 * common.nim`): a strict `{errors: [{code, message}]}` object. `code` accepts
 * a number or an `ApiErrorCode` name (jsony's enum hook does both); anything
 * else raises, and the caller converts that to `RateLimitError` like
 * nitter's catch-all does with `fromJson`.
 */
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

/** Port of `parserutils.nim` `getError`: the first array element's code. */
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

/** nitter's triage order: invalidate-set first, `rateLimited` only as `elif`. */
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
    // Port of `getAndValidateSession`; the pool filters on the same rules,
    // but `Accounts` is a seam and another provider may not.
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

  /**
   * Port of the `retry` template: lease → attempt → on `RateLimitError`,
   * release and re-lease (up to `maxRetries` attempts). `handle` runs after a
   * successful response, with the rate-limit headers already recorded.
   */
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

  /**
   * Port of `fetchImpl`'s body triage for `{"errors"` payloads: skippable
   * codes are ignored, everything else logs, and 89/239/326 → `reportError`
   * (invalidate) or 88 → `reportError` (limited), each raising
   * `RateLimitError` to trigger a re-lease — nitter's if/elif order.
   */
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

  /** Port of `fetchImpl`'s `Http400` branch (runs after parse, per nitter). */
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
        // A malformed body raises here → converted → retried, like nitter's
        // `parseJson` raising into `fetchImpl`'s catch-all.
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
