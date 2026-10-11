/**
 * The proxy fetch loop — a port of nitter's `proxyMedia`
 * (`src/routes/media.nim`).
 *
 * The load-bearing behaviour, in order:
 * - Redirects are **not** followed automatically. A `3xx` is only followed when
 *   its `Location` re-passes the domain allowlist; otherwise the request is
 *   refused with 403. Combined with `maxRedirections: 0` on the fetcher, that is
 *   what closes nitter #1411.
 * - Three attempts. A `404` is final and returned immediately; a redirect
 *   consumes an attempt (so a redirect chain cannot spin forever); anything
 *   else — timeouts, transport errors, other statuses — is retried.
 * - The ETag comes from the **requested** URL, not the redirect target, so a
 *   redirected image keeps one stable validator.
 */
import { Buffer } from "node:buffer";
import type { MediaFetcher, MediaFetchResponse } from "./types.ts";
import { isTwitterUrl, mediaEtag } from "./urls.ts";

/** `maxAge` from `routes/media.nim` — one week. */
export const DEFAULT_CACHE_CONTROL = "max-age=604800";

/** Status returned immediately, without retrying (nitter's early `Http404`). */
const FINAL_STATUS = 404;

/** Total attempts including the first (nitter's `0 .. 2`). */
const DEFAULT_MAX_ATTEMPTS = 3;

/** Why a proxy attempt did not produce a body. */
export type ProxyFailure =
  /** Upstream answered 404; nitter returns this without retrying. */
  | "notFound"
  /** Redirected off the allowlist (SSRF guard) — 403. */
  | "forbiddenRedirect"
  /** Ran out of attempts after timeouts — 504. */
  | "timeout"
  /** Ran out of attempts for any other reason — 404. */
  | "exhausted";

/** A proxy attempt that succeeded: headers plus an unread body. */
export interface ProxySuccess {
  ok: true;
  status: number;
  headers: Record<string, string>;
  etag: string;
  /** Upstream body. Consume it, or call `abort()` to release the socket. */
  body: AsyncIterable<Uint8Array>;
  abort(): void;
}

/** A proxy attempt that failed; `status` is what the route should answer with. */
export interface ProxyFailureResult {
  ok: false;
  reason: ProxyFailure;
  status: number;
}

/** Outcome of one {@link proxyMedia} call. */
export type ProxyResult = ProxySuccess | ProxyFailureResult;

/** Dependencies for {@link proxyMedia}. */
export interface ProxyMediaOptions {
  fetcher: MediaFetcher;
  /** `Cache-Control` for successful responses. */
  cacheControl?: string | undefined;
  /** Total attempts including the first (default 3). */
  maxAttempts?: number | undefined;
  /** Headers-phase timeout in milliseconds. */
  headersTimeoutMs?: number | undefined;
  /** Retry log sink (nitter `echo`s a `[media] Retry …` line). */
  onRetry?: ((message: string) => void) | undefined;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}
/**
 * Fetch `url` through the proxy policy, returning a readable body.
 *
 * Never throws for upstream trouble — every failure mode is a typed result, so
 * the route can map it to a status code without a try/catch. Transport errors
 * are converted too: here they are retryable, not exceptional.
 */
export async function proxyMedia(url: string, options: ProxyMediaOptions): Promise<ProxyResult> {
  const { fetcher } = options;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const cacheControl = options.cacheControl ?? DEFAULT_CACHE_CONTROL;
  // Computed once from the request URL, never from the redirect target.
  const etag = mediaEtag(url);

  // Nim's `fetchUrl`: the URL actually requested, which a redirect may change.
  let target = url;
  let timedOut = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const last = attempt === maxAttempts;
    let response: MediaFetchResponse | undefined;
    try {
      response = await fetcher.fetch(target, { headersTimeoutMs: options.headersTimeoutMs });
    } catch (err) {
      timedOut = isTimeout(err);
      const code = (err as NodeJS.ErrnoException)?.code;
      options.onRetry?.(
        `[media] attempt ${attempt}/${maxAttempts} failed: ${describe(err)}` +
          (typeof code === "string" ? ` [${code}]` : "") +
          (last ? "" : ", retrying"),
      );
      if (last) break;
      continue;
    }

    if (response.status === 200) {
      return {
        ok: true,
        status: 200,
        etag,
        headers: { ...response.headers, "cache-control": cacheControl, etag },
        body: response.body,
        abort: () => response.abort(),
      };
    }

    // Only a 200 is a success; every other status must release its socket.
    const location = response.headers["location"];
    response.abort();

    if (response.status === FINAL_STATUS) return { ok: false, reason: "notFound", status: 404 };

    if (isRedirect(response.status) && location !== undefined && location.length > 0) {
      if (!isTwitterUrl(location)) {
        // The redirect leaves the allowlist — refuse rather than re-open #1411.
        return { ok: false, reason: "forbiddenRedirect", status: 403 };
      }
      target = location;
      options.onRetry?.(`[media] following redirect (${attempt}/${maxAttempts}), url: ${target}`);
      if (last) break;
      continue;
    }

    timedOut = false;
    options.onRetry?.(
      `[media] attempt ${attempt}/${maxAttempts} got status ${response.status}, url: ${target}` +
        (last ? "" : ", retrying"),
    );
    if (last) break;
  }

  return timedOut
    ? { ok: false, reason: "timeout", status: 504 }
    : { ok: false, reason: "exhausted", status: 404 };
}

/** Whether an error is a headers-phase timeout rather than a connect failure. */
function isTimeout(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === "UND_ERR_HEADERS_TIMEOUT" || code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
    return true;
  }
  return err instanceof Error && err.name === "HeadersTimeoutError";
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Collect a body into one buffer.
 *
 * Only for callers that genuinely need bytes in hand (the m3u8/vmap manifest
 * fetches). Media segments are streamed, never collected.
 */
export async function collect(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Knobs {@link safeFetchText} passes down to {@link proxyMedia}. */
export interface SafeFetchOptions {
  fetcher: MediaFetcher;
  /** Total attempts including the first (default 3, like `proxyMedia`). */
  maxAttempts?: number | undefined;
  /** Headers-phase timeout in milliseconds. */
  headersTimeoutMs?: number | undefined;
  /** Retry log sink. */
  onRetry?: ((message: string) => void) | undefined;
}

/**
 * Fetch a playlist body as text (nitter's `safeFetch`).
 *
 * Swallows every failure and yields `""` — a dead manifest is an empty playlist,
 * not a 500. The allowlist is re-checked here because this is a second,
 * separately-controlled fetch (a `.vmap` resolves to a *different* URL than the
 * one that was signed; a space's m3u8 URL comes straight from the API payload).
 *
 * Lives beside `proxyMedia` so the media route and the space route share one
 * implementation of the nitter `safeFetch` semantics: no auto-redirect follow,
 * the allowlist re-checked on every decoded URL, and discarded responses
 * aborted (inside `proxyMedia`).
 */
export async function safeFetchText(url: string, options: SafeFetchOptions): Promise<string> {
  if (!isTwitterUrl(url)) return "";
  const result = await proxyMedia(url, {
    fetcher: options.fetcher,
    maxAttempts: options.maxAttempts,
    headersTimeoutMs: options.headersTimeoutMs,
    onRetry: options.onRetry,
  });
  if (!result.ok) return "";
  try {
    return (await collect(result.body)).toString("utf8");
  } catch {
    return "";
  }
}
