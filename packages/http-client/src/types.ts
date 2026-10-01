/** `ctx.http` contract: outbound HTTP seam (pooling, proxy, retries, CF detection). */
import type { RateLimit } from "@tseer/types";

/**
 * Mutable outbound request passed to `http/request` listeners before each
 * attempt — listeners may rewrite `headers` (plan §1 event: "rewrite headers, audit").
 */
export interface OutboundRequest {
  /** Uppercase HTTP method. */
  method: string;
  /** Absolute URL (after `apiProxy` rewriting, if configured). */
  url: string;
  /** Request headers; listeners may rewrite values before the send. */
  headers: Record<string, string>;
  /** Request body (`undefined` for GET/HEAD). */
  body?: string | undefined;
  /** 1-based attempt number within the retry loop. */
  attempt: number;
}

/** Completed attempt passed to `http/response` listeners (plan §1 event). */
export interface OutboundResponse {
  /** The attempt that produced this response. */
  request: OutboundRequest;
  /** HTTP status code. */
  status: number;
  /** Response headers, lowercased names. */
  headers: Record<string, string>;
  /** Wall-clock duration of the attempt in milliseconds. */
  durationMs: number;
}

/** Options accepted by `HttpClient.request()`. */
export interface HttpRequestOptions {
  /** Uppercase HTTP method (default `GET`). */
  method?: string | undefined;
  /** Request headers (merged into the per-attempt copy listeners see). */
  headers?: Record<string, string> | undefined;
  /** Request body. */
  body?: string | undefined;
  /**
   * Per-request timeout for headers and body (default 30 000 ms).
   * Note: undici schedules header/body timeouts on its low-resolution fast
   * timer (~1 s), so sub-second values fire on the next tick instead.
   */
  timeoutMs?: number | undefined;
  /**
   * Total attempts for retryable failures (default from the plugin options).
   * Matches nitter's `maxRetries` config semantics: the value is the number of
   * attempts, floored at 1 — `1` (nitter's default) means "no retries".
   */
  maxRetries?: number | undefined;
  /** Fixed delay between attempts (default from the plugin options). */
  retryDelayMs?: number | undefined;
  /**
   * Treat Cloudflare HTML challenge pages as retryable failures and never
   * return them as the response (default `true`; port of `isCloudflareHtml`
   * handling in nitter's `apiutils.nim`).
   */
  detectCloudflare?: boolean | undefined;
}

/** Buffered response returned by `HttpClient.request()`. */
export interface HttpResponse {
  /** HTTP status code. */
  status: number;
  /** Response headers, lowercased names. */
  headers: Record<string, string>;
  /** Decoded body as text (gzip responses are decompressed). */
  body: string;
  /** Final URL (after `apiProxy` rewriting, if configured). */
  url: string;
  /** Parsed `x-rate-limit-*` headers when present and not edge-cached. */
  rateLimit?: RateLimit | undefined;
}

/** The `ctx.http` seam: buffered outbound requests with retry and CF detection. */
export interface HttpClient {
  /**
   * Perform a request. Retryable failures (transport errors, 429/503,
   * transient empty 404s, Cloudflare HTML) are retried per the options and
   * surface as `RateLimitError` once attempts are exhausted.
   */
  request(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;
}

/** Diagnostics for a retryable failure that will be re-attempted. */
export interface RetryInfo {
  /** The attempt that just failed. */
  request: OutboundRequest;
  /** 1-based number of the attempt that just failed. */
  attempt: number;
  /** Total attempts allowed for this request. */
  totalAttempts: number;
  /** Why the attempt failed (e.g. `status 429`, `transport error: … [code]`). */
  reason: string;
  /** Delay before the next attempt, in milliseconds. */
  delayMs: number;
}

/** Cloudflare challenge diagnostics (port of nitter's `[cloudflare]` log line). */
export interface CloudflareInfo {
  /** Final URL of the request. */
  url: string;
  /** HTTP status of the challenge response. */
  status: number;
  /** Extracted `<title>` text (nitter `cfTitle`). */
  title: string;
}

/**
 * Callbacks a provider invokes around each attempt. The plugin maps
 * `onRequest`/`onResponse` onto the `http/request`/`http/response` cordis
 * events and the rest onto `ctx.logger`.
 */
export interface HttpClientHooks {
  /** Before each attempt; may mutate `req.headers`. */
  onRequest(req: OutboundRequest): void;
  /** After each completed attempt (fires even when the attempt will retry). */
  onResponse(res: OutboundResponse): void;
  /** Before sleeping between attempts. */
  onRetry?(info: RetryInfo): void;
  /** Cloudflare HTML detected in a response body. */
  onCloudflare?(info: CloudflareInfo): void;
}

/** Options for `httpClientPlugin` (mapped from `ctx.config` by the composition root). */
export interface HttpClientPluginOptions {
  /** Pooled connections per origin (nitter `httpMaxConns`; default 100). */
  maxConns?: number | undefined;
  /** Outbound proxy URL (nitter `proxy`), e.g. `http://127.0.0.1:8118`. */
  proxy?: string | undefined;
  /** `user:pass` basic auth for `proxy` (nitter `proxyAuth`). */
  proxyAuth?: string | undefined;
  /** API URL prefix proxy (nitter `apiProxy`; see `normalizeApiProxy`). */
  apiProxy?: string | undefined;
  /** Total attempts for retryable failures (nitter `maxRetries`; default 1). */
  maxRetries?: number | undefined;
  /** Fixed delay between attempts (nitter `retryDelayMs`; default 150). */
  retryDelayMs?: number | undefined;
  /** Per-request timeout in milliseconds (default 30 000; ~1 s timer granularity, see `HttpRequestOptions.timeoutMs`). */
  timeoutMs?: number | undefined;
}
