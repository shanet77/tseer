export const CACHE_VERSION = "v1";

export const DEFAULT_KEY_PREFIX = "tseer";

export const namespaces = {
  user: "p",
  username: "i",
  tweet: "t",
  list: "l",
  rss: "rss",
  photoRail: "pr2",
  accountInfo: "ai",
  space: "sp",
  broadcast: "bc",
  community: "cm",
  communityModerators: "cmm",
  userIdBucket: "pid",
} as const;

export type CacheNamespace = (typeof namespaces)[keyof typeof namespaces];

export interface KeyOptions {
  prefix?: string | undefined;
  version?: string | undefined;
}

export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export class CacheKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CacheKeyError";
  }
}

function segment(value: string, what: string): string {
  if (value === "") throw new CacheKeyError(`empty ${what}`);
  if (value.includes(":")) {
    throw new CacheKeyError(`${what} must not contain ":" (got ${JSON.stringify(value)})`);
  }
  return value;
}

export function cacheKey(ns: string, key: string, options: KeyOptions = {}): string {
  const prefix = options.prefix ?? DEFAULT_KEY_PREFIX;
  const version = options.version ?? CACHE_VERSION;
  return `${prefix}:${version}:${segment(ns, "namespace")}:${key}`;
}

export function namespacePattern(ns: string, options: KeyOptions = {}): string {
  return `${cacheKey(ns, "", options).slice(0, -1)}*`;
}

export function allPattern(options: KeyOptions = {}): string {
  const prefix = options.prefix ?? DEFAULT_KEY_PREFIX;
  const version = options.version ?? CACHE_VERSION;
  return `${prefix}:${version}:*`;
}

export function userIdBucketKey(username: string, options: KeyOptions = {}): string {
  const name = normalizeUsername(username);
  return cacheKey(namespaces.userIdBucket, String(fnv1a32(name) % 1_000_000), options);
}

export function userIdField(username: string): string {
  return normalizeUsername(username);
}

export const userKeys = {
  profile: (username: string, options?: KeyOptions) =>
    cacheKey(namespaces.user, normalizeUsername(username), options),
  photoRail: (username: string, options?: KeyOptions) =>
    cacheKey(namespaces.photoRail, normalizeUsername(username), options),
  accountInfo: (username: string, options?: KeyOptions) =>
    cacheKey(namespaces.accountInfo, normalizeUsername(username), options),
  username: (userId: string, options?: KeyOptions) =>
    cacheKey(namespaces.username, userId, options),
};

export const entityKeys = {
  tweet: (id: string, options?: KeyOptions) => cacheKey(namespaces.tweet, id, options),
  list: (id: string, options?: KeyOptions) => cacheKey(namespaces.list, id, options),
  rss: (query: string, options?: KeyOptions) => cacheKey(namespaces.rss, query, options),
  space: (id: string, options?: KeyOptions) => cacheKey(namespaces.space, id, options),
  broadcast: (id: string, options?: KeyOptions) => cacheKey(namespaces.broadcast, id, options),
  community: (id: string, options?: KeyOptions) => cacheKey(namespaces.community, id, options),
  communityModerators: (id: string, options?: KeyOptions) =>
    cacheKey(namespaces.communityModerators, id, options),
};
