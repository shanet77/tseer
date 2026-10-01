/** `x-rate-limit-*` header parsing — port of nitter's `apiutils.nim` `fetchImpl`. */
import type { RateLimit } from "@tseer/types";

const RL_REMAINING = "x-rate-limit-remaining";
const RL_RESET = "x-rate-limit-reset";
const RL_LIMIT = "x-rate-limit-limit";
const NP_CACHE = "x-np-cache";

function toInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse the `x-rate-limit-*` response headers into a `RateLimit`.
 *
 * Nitter only records a fresh rate limit when the response did not come from
 * the edge cache (`x-np-cache: HIT`/`STALE`) and all three headers parse.
 * Header names are expected lowercased (as returned by `HttpClient`); missing
 * or malformed headers yield `undefined` instead of Nim's `ValueError`
 * (tolerant by design — upstream junk must not crash the fetch).
 */
export function parseRateLimitHeaders(
  headers: Record<string, string | undefined>,
): RateLimit | undefined {
  const cacheStatus = headers[NP_CACHE];
  if (cacheStatus === "HIT" || cacheStatus === "STALE") return undefined;
  if (headers[RL_REMAINING] === undefined) return undefined;
  const remaining = toInt(headers[RL_REMAINING]);
  const reset = toInt(headers[RL_RESET]);
  const limit = toInt(headers[RL_LIMIT]);
  if (remaining === undefined || reset === undefined || limit === undefined) return undefined;
  return { limit, remaining, reset };
}
