/** `@tseer/media` — `ctx.media` seam: HMAC signing + the streaming media proxy. */

export type { UndiciMediaFetcherOptions } from "./fetcher.ts";
export { DEFAULT_HEADERS_TIMEOUT_MS, UndiciMediaFetcher } from "./fetcher.ts";
export type { ProxifyVideoOptions } from "./hls.ts";
export { getM3u8Url, PROXYABLE_EXTENSIONS, proxifyVideo } from "./hls.ts";
export { default as mediaPlugin } from "./plugin.ts";
export type {
  ProxyFailure,
  ProxyMediaOptions,
  ProxyResult,
  ProxySuccess,
  SafeFetchOptions,
} from "./proxy.ts";
export { collect, DEFAULT_CACHE_CONTROL, proxyMedia, safeFetchText } from "./proxy.ts";
export { default as mediaRoutePlugin } from "./routes.ts";
export type { MediaSignerOptions } from "./sign.ts";
export { MediaSignerImpl } from "./sign.ts";
export type {
  MediaFetcher,
  MediaFetchOptions,
  MediaFetchResponse,
  MediaPluginOptions,
  MediaRoutePluginOptions,
  MediaSigner,
} from "./types.ts";
export {
  decodeSegment,
  decodeUrl,
  decodeUrlSafeBase64,
  encodeUrl,
  encodeUrlSafeBase64,
  fnv1a32,
  isTwitterUrl,
  mediaEtag,
  normalizeImgUrl,
  type SegmentEncoding,
} from "./urls.ts";
