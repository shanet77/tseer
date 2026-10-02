import { createDispatcher } from "@tseer/http-client";
import { type Dispatcher, request as undiciRequest } from "undici";
import type { MediaFetcher, MediaFetchOptions, MediaFetchResponse } from "./types.ts";

/**
 * Undici-backed `MediaFetcher`: pooled connections, streamed bodies, and
 * redirects left unfollowed.
 *
 * The three properties the proxy depends on, all of which come from *not*
 * reusing `ctx.http`:
 * - `maxRedirections: 0`. `proxyMedia` re-validates every `Location` against the
 *   domain allowlist itself; letting undici follow one automatically would walk
 *   straight off the allowlisted host and re-open nitter #1411.
 * - No buffering. The body is handed back as an `AsyncIterable`, so a 40 MB
 *   segment never lands in memory.
 * - `headersTimeout` only. nitter's `withTimeout(resFut, 5000)` bounds waiting
 *   for the *response head*; a long transfer is legitimate and must not be cut
 *   off mid-segment, so there is deliberately no body timeout here.
 *
 * `createDispatcher` is reused from `@tseer/http-client` so the outbound proxy
 * (`config.proxy`/`proxyAuth`) and pool size behave identically to API traffic —
 * but the dispatcher is this instance's own, and `close()` only drains this pool.
 */

/** Default headers-phase timeout; matches nitter's 5 s `withTimeout`. */
export const DEFAULT_HEADERS_TIMEOUT_MS = 5_000;

/** Options for {@link UndiciMediaFetcher}. */
export interface UndiciMediaFetcherOptions {
  /** `config.proxy`, e.g. `http://127.0.0.1:8118`. */
  proxy?: string | undefined;
  /** `config.proxyAuth` (`user:pass`), sent as basic `Proxy-Authorization`. */
  proxyAuth?: string | undefined;
  /** `config.httpMaxConns`. */
  maxConns?: number | undefined;
  /** Headers-phase timeout in milliseconds (default {@link DEFAULT_HEADERS_TIMEOUT_MS}). */
  headersTimeoutMs?: number | undefined;
}

function flatten(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

/**
 * The whole point: a redirect is a decision for `proxyMedia`, which re-checks
 * the allowlist. See the class comment.
 */
/**
 * Redirects are never followed: a `Location` is a decision for `proxyMedia`,
 * which re-checks it against the domain allowlist. This is the single most
 * important behavior of the whole package — auto-following would walk off the
 * allowlisted host and re-open nitter #1411.
 */
const NO_REDIRECTS = 0;

type UndiciRequestOptions = NonNullable<Parameters<typeof undiciRequest>[1]>;

function withRedirects(base: UndiciRequestOptions, maxRedirections: number): UndiciRequestOptions {
  // `maxRedirections` is honoured by undici at runtime but is absent from the
  // published `request()` overload's option type, hence the widened cast.
  return { ...base, maxRedirections } as UndiciRequestOptions;
}

/** Default `MediaFetcher` provider (undici). */
export class UndiciMediaFetcher implements MediaFetcher {
  private readonly dispatcher: Dispatcher;
  private readonly headersTimeoutMs: number;

  constructor(options: UndiciMediaFetcherOptions = {}) {
    this.dispatcher = createDispatcher({
      maxConns: options.maxConns,
      proxy: options.proxy,
      proxyAuth: options.proxyAuth,
    });
    this.headersTimeoutMs = options.headersTimeoutMs ?? DEFAULT_HEADERS_TIMEOUT_MS;
  }

  async fetch(url: string, options: MediaFetchOptions = {}): Promise<MediaFetchResponse> {
    const response = await undiciRequest(
      url,
      withRedirects(
        {
          method: "GET",
          dispatcher: this.dispatcher,
          headers: options.headers ?? {},
          headersTimeout: options.headersTimeoutMs ?? this.headersTimeoutMs,
        },
        NO_REDIRECTS,
      ),
    );

    let aborted = false;
    return {
      status: response.statusCode,
      headers: flatten(response.headers),
      body: response.body,
      abort() {
        if (aborted) return;
        aborted = true;
        // Destroying the readable releases the socket back to the pool; without
        // this, every discarded response would leak a connection.
        response.body.destroy();
      },
    };
  }

  close(): Promise<void> {
    return this.dispatcher.close();
  }
}
