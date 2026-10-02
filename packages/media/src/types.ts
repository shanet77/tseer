/** `ctx.media` contract: media URL signing, plus the proxy's transport port. */

/**
 * The signing seam consumers inject (views build links; the media routes verify
 * the one signature nitter actually checks).
 *
 * Deliberately narrower than the whole media feature: `ctx.media` is pure and
 * synchronous, so a theme can call it without pulling in the proxy, a fetcher,
 * or `ctx.server`. The proxy routes live behind `mediaRoutePlugin` and reach
 * for the fetcher separately.
 */
export interface MediaSigner {
  /** Whether generated links use the `/…/enc/` URL-safe base64 variant. */
  readonly base64Media: boolean;
  /** HMAC-SHA256 of `url`, truncated to nitter's 13 hex chars. */
  sign(url: string): string;
  /** Constant-time signature check. */
  verify(url: string, signature: string): boolean;
  /** Proxied image link (`/pic/…`); empty input yields `""`, as in nitter. */
  picUrl(url: string): string;
  /** Original-resolution image link (`/pic/orig/…`). */
  origPicUrl(url: string): string;
  /** Signed video/manifest link (`/video/<sig>/…`). */
  vidUrl(url: string): string;
}

/** Per-request knobs for a media fetch. */
export interface MediaFetchOptions {
  /** Extra request headers (none are sent by default). */
  headers?: Record<string, string> | undefined;
  /** Headers-phase timeout in milliseconds (default `DEFAULT_TIMEOUT_MS`). */
  headersTimeoutMs?: number | undefined;
}

/**
 * An upstream media response, still unread.
 *
 * `body` must be consumed or `abort()` called — a dropped response without an
 * abort holds its socket out of the pool.
 */
export interface MediaFetchResponse {
  /** HTTP status code. */
  status: number;
  /** Response headers, lowercased names. */
  headers: Record<string, string>;
  /** Body chunks as they arrive off the wire. */
  body: AsyncIterable<Uint8Array>;
  /** Abandon the response and release its socket. */
  abort(): void;
}

/**
 * Transport port for the media proxy — the thing that makes #1411 untestable
 * without it.
 *
 * This is deliberately *not* `ctx.http`. That client is the JSON API client: it
 * buffers whole bodies, retries `429`/`503`, and treats Cloudflare HTML as a
 * retryable failure. None of that applies to a 40 MB video segment — buffering
 * it would defeat streaming, and its retry/CF policy would corrupt binary
 * payloads. It also does not follow redirects by default, which is the property
 * the proxy most depends on.
 */
export interface MediaFetcher {
  /** Perform a GET without following redirects. */
  fetch(url: string, options?: MediaFetchOptions): Promise<MediaFetchResponse>;
  /** Release pooled sockets. */
  close(): Promise<void>;
}

/** Options for `mediaPlugin` (maps straight onto `ctx.config`). */
export interface MediaPluginOptions {
  /** `config.hmacKey`. */
  hmacKey?: string | undefined;
  /** `config.base64Media`. */
  base64Media?: boolean | undefined;
}

/** Options for the `/pic` + `/video` route plugin. */
export interface MediaRoutePluginOptions {
  /** Transport override (tests, or a shared pool owned elsewhere). */
  fetcher?: MediaFetcher | undefined;
  /** `config.proxy` / `config.proxyAuth`, for the default fetcher. */
  proxy?: string | undefined;
  proxyAuth?: string | undefined;
  /** `config.httpMaxConns`, for the default fetcher's pool. */
  maxConns?: number | undefined;
  /**
   * Whether to rewrite manifest segment URLs through the proxy. Wired to
   * `requestPrefs().proxyVideos` once the `prefs` seam lands; defaults to true
   * (nitter's default preference).
   */
  proxyVideos?: boolean | undefined;
  /** Total attempts per upstream fetch, including the first (default 3). */
  maxAttempts?: number | undefined;
  /** Headers-phase timeout in milliseconds (default 5000, nitter's `withTimeout`). */
  headersTimeoutMs?: number | undefined;
  /** `Cache-Control` on proxied media (default `max-age=604800`, 7 days). */
  cacheControl?: string | undefined;
}
