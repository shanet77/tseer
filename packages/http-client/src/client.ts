/**
 * undici-backed `HttpClient`: connection pooling (`Agent`), proxy
 * (`ProxyAgent`), fixed-delay retry, gzip decoding, and Cloudflare detection.
 *
 * Ported behavior notes (nitter `http_pool.nim` + `apiutils.nim`):
 * - Retryable failures: transport errors (any exception → `RateLimitError` in
 *   Nim), `429`, `503`, transient empty `404`s, and Cloudflare HTML. Once the
 *   attempts are exhausted the request throws `RateLimitError` (nitter's
 *   `retry` template ends with `raise rateLimitError()`).
 * - Deviations from Nim, deliberate: `503` retries count toward `maxRetries`
 *   (nitter's `pool.use` gave one extra immediate "bad client" retry), and a
 *   final `400` is returned to the caller instead of raising `InternalError`
 *   — error mapping belongs to `twitter-api`, not the transport.
 */
import { Buffer } from "node:buffer";
import { setTimeout as delay } from "node:timers/promises";
import { gunzip } from "node:zlib";
import { RateLimitError } from "@tseer/types";
import type { Dispatcher } from "undici";
import { Agent, ProxyAgent, request as undiciRequest } from "undici";
import { applyApiProxy, normalizeApiProxy } from "./api-proxy.ts";
import { cfTitle, isCloudflareHtml } from "./cloudflare.ts";
import { parseRateLimitHeaders } from "./rate-limit.ts";
import type {
  HttpClient,
  HttpClientHooks,
  HttpClientPluginOptions,
  HttpRequestOptions,
  HttpResponse,
  OutboundRequest,
} from "./types.ts";

/** Default per-request timeout (headers + body), in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Default pool size when `maxConns` is unset (nitter `httpMaxConns`). */
const DEFAULT_MAX_CONNS = 100;

/** Default retry policy when unset (nitter `config.nim` defaults). */
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 150;

type UndiciRequestOptions = NonNullable<Parameters<typeof undiciRequest>[1]>;
type RawHeaders = Record<string, string | string[] | undefined>;

const NOOP_HOOKS: HttpClientHooks = {
  onRequest: () => {},
  onResponse: () => {},
};

function gunzipAsync(bytes: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    gunzip(bytes, (err, result) => (err ? reject(err) : resolve(result)));
  });
}

/** Normalize raw undici headers: lowercase names, join multi-value headers. */
function flattenHeaders(raw: RawHeaders): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

function hasGzipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Decode a response body: gunzip when the wire bytes are gzip (undici's
 * `request()` does not decompress on its own — nitter unzips with zippy).
 */
async function decodeBody(bytes: Uint8Array, contentEncoding: string | undefined): Promise<string> {
  if (contentEncoding?.includes("gzip") && hasGzipMagic(bytes)) {
    return new TextDecoder().decode(await gunzipAsync(Buffer.from(bytes)));
  }
  return new TextDecoder().decode(bytes);
}

/** Status-based retryable failures (port of the checks in `fetchImpl`). */
function retryableStatus(status: number, body: string): string | undefined {
  if (status === 429) return "status 429";
  if (body.startsWith("429 Too Many Requests")) return "429 response body";
  if (status === 503) return "status 503";
  if (status === 404 && body.length === 0) return "transient 404 (empty body)";
  return undefined;
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    const suffix = typeof code === "string" ? ` [${code}]` : "";
    return `transport error: ${err.message}${suffix}`;
  }
  return `transport error: ${String(err)}`;
}

function rateLimitFailure(
  request: OutboundRequest,
  reason: string,
  attempt: number,
  totalAttempts: number,
): RateLimitError {
  return new RateLimitError(
    `${request.method} ${request.url}: ${reason} (attempt ${attempt}/${totalAttempts})`,
  );
}

/**
 * Build the undici dispatcher: pooled `Agent`, or `ProxyAgent` when a proxy is
 * configured (basic-auth `proxyAuth` becomes the `Proxy-Authorization` header —
 * undici's `token` is passed through verbatim).
 */
export function createDispatcher(options: HttpClientPluginOptions = {}): Dispatcher {
  const connections = options.maxConns ?? DEFAULT_MAX_CONNS;
  const uri = normalizeProxyUrl(options.proxy ?? "");
  if (uri.length === 0) return new Agent({ connections });
  const proxyOptions: ProxyAgent.Options = { uri, connections };
  const auth = options.proxyAuth ?? "";
  if (auth.length > 0) proxyOptions.token = `Basic ${Buffer.from(auth, "utf8").toString("base64")}`;
  return new ProxyAgent(proxyOptions);
}

/** Default `ctx.http` provider: undici pool + proxy + retry + CF detection. */
export class UndiciHttpClient implements HttpClient {
  private readonly dispatcher: Dispatcher;
  private readonly apiProxy: string;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;
  private readonly hooks: HttpClientHooks;

  constructor(options: HttpClientPluginOptions = {}, hooks: HttpClientHooks = NOOP_HOOKS) {
    this.dispatcher = createDispatcher(options);
    this.apiProxy = normalizeApiProxy(options.apiProxy ?? "");
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.hooks = hooks;
  }

  async request(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
    const method = (options.method ?? "GET").toUpperCase();
    const maxRetries = Math.max(1, options.maxRetries ?? this.maxRetries);
    const retryDelayMs = options.retryDelayMs ?? this.retryDelayMs;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const detectCloudflare = options.detectCloudflare ?? true;
    const target = applyApiProxy(url, this.apiProxy);
    const baseHeaders = options.headers ?? {};

    let failure: RateLimitError | undefined;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const request: OutboundRequest = {
        method,
        url: target,
        headers: { ...baseHeaders },
        body: options.body,
        attempt,
      };
      this.hooks.onRequest(request);
      const started = Date.now();
      let reason: string;
      let cause: unknown;
      try {
        const sendOptions: UndiciRequestOptions = {
          method: request.method as Dispatcher.HttpMethod,
          headers: request.headers,
          headersTimeout: timeoutMs,
          bodyTimeout: timeoutMs,
        };
        if (request.body !== undefined) sendOptions.body = request.body;
        const response = await undiciRequest(request.url, {
          ...sendOptions,
          dispatcher: this.dispatcher,
        });
        const status = response.statusCode;
        const headers = flattenHeaders(response.headers);
        const bytes = new Uint8Array(await response.body.arrayBuffer());
        this.hooks.onResponse({ request, status, headers, durationMs: Date.now() - started });

        const body = await decodeBody(bytes, headers["content-encoding"]);
        const cloudflare = detectCloudflare && isCloudflareHtml(body);
        const statusReason = cloudflare
          ? `cloudflare html ("${cfTitle(body)}")`
          : retryableStatus(status, body);
        if (statusReason === undefined) {
          return {
            status,
            headers,
            body,
            url: request.url,
            rateLimit: parseRateLimitHeaders(headers),
          };
        }
        if (cloudflare) {
          this.hooks.onCloudflare?.({ url: request.url, status, title: cfTitle(body) });
        }
        reason = statusReason;
      } catch (err) {
        reason = describeError(err);
        cause = err;
      }
      failure = rateLimitFailure(request, reason, attempt, maxRetries);
      if (cause !== undefined) failure.cause = cause;
      if (attempt < maxRetries) {
        this.hooks.onRetry?.({
          request,
          attempt,
          totalAttempts: maxRetries,
          reason,
          delayMs: retryDelayMs,
        });
        await delay(retryDelayMs);
      }
    }
    throw failure ?? new RateLimitError(`${method} ${target}: request failed`);
  }

  /** Close the dispatcher (drains pooled connections). */
  close(): Promise<void> {
    return this.dispatcher.close();
  }
}

/** Ensure a proxy URL carries a scheme (nitter assumes one; we normalize). */
function normalizeProxyUrl(url: string): string {
  if (url.length === 0) return "";
  return /^https?:\/\//i.test(url) ? url : `http://${url}`;
}
