/** `@tseer/http-client` — `ctx.http` seam: undici pool, proxy, retry, CF detection. */
export { applyApiProxy, normalizeApiProxy, usesApiProxy } from "./api-proxy.ts";
export { createDispatcher, DEFAULT_TIMEOUT_MS, UndiciHttpClient } from "./client.ts";
export { cfTitle, isCloudflareHtml } from "./cloudflare.ts";
export { default as httpClientPlugin } from "./plugin.ts";
export { parseRateLimitHeaders } from "./rate-limit.ts";
export type {
  CloudflareInfo,
  HttpClient,
  HttpClientHooks,
  HttpClientPluginOptions,
  HttpRequestOptions,
  HttpResponse,
  OutboundRequest,
  OutboundResponse,
  RetryInfo,
} from "./types.ts";
