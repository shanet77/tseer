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
