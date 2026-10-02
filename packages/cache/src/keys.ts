/**
 * Key layout. Ported from `redis_cache.nim`'s `uidKey`/`userKey`/`listKey`/
 * `tweetKey` templates plus the inline `"rss:"`/`"pr2:"`/`"ai:"`/`"sp:"`/`"bc:"`/
 * `"cm:"`/`"cmm:"`/`"i:"` literals, so an existing nitter redis can be read and
 * written by the same build.
 *
 * Every key is `<prefix>:<version>:<ns>:<key>`. The version segment is what lets
 * a changed value shape be rolled out by bumping one constant instead of
 * scanning and deleting (`redis_cache.nim` did that with `migrate`).
 */

/** Bump when a cached value's shape changes; old keys are left to expire. */
export const CACHE_VERSION = "v1";

/** Default instance prefix, matching nitter's unprefixed single-tenant layout. */
export const DEFAULT_KEY_PREFIX = "tseer";

/** The namespace per cached entity, as used by `redis_cache.nim`. */
export const namespaces = {
  /** `p:<username>` — parsed `User` profile. */
  user: "p",
  /** `i:<userId>` — reverse lookup, user id to username. */
  username: "i",
  /** `t:<id>` — single tweet. */
  tweet: "t",
  /** `l:<listId>` — a twitter list. */
  list: "l",
  /** `rss:<query>` — rendered RSS feed + min cursor. */
  rss: "rss",
  /** `pr2:<username>` — profile photo rail. */
  photoRail: "pr2",
  /** `ai:<username>` — about/account info. */
  accountInfo: "ai",
  /** `sp:<id>` — audio space. */
  space: "sp",
  /** `bc:<id>` — broadcast/live. */
  broadcast: "bc",
  /** `cm:<id>` — community. */
  community: "cm",
  /** `cmm:<id>` — community moderators. */
  communityModerators: "cmm",
  /** `pid:<bucket>` — username to user id hash bucket. */
  userIdBucket: "pid",
} as const;

export type CacheNamespace = (typeof namespaces)[keyof typeof namespaces];

export interface KeyOptions {
  prefix?: string | undefined;
  version?: string | undefined;
}

/** FNV-1a, 32-bit. Deterministic across processes, unlike Nim's per-run `hash`. */
export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Usernames are case-insensitive upstream, so every username key is lowercased. */
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

/** Fully-qualified key for a namespace entry. */
export function cacheKey(ns: string, key: string, options: KeyOptions = {}): string {
  const prefix = options.prefix ?? DEFAULT_KEY_PREFIX;
  const version = options.version ?? CACHE_VERSION;
  return `${prefix}:${version}:${segment(ns, "namespace")}:${key}`;
}

/** Glob matching every key in a namespace; used by `clear(ns)`. */
export function namespacePattern(ns: string, options: KeyOptions = {}): string {
  return `${cacheKey(ns, "", options).slice(0, -1)}*`;
}

/** Glob matching every key of this prefix+version pair; used by `clear()`. */
export function allPattern(options: KeyOptions = {}): string {
  const prefix = options.prefix ?? DEFAULT_KEY_PREFIX;
  const version = options.version ?? CACHE_VERSION;
  return `${prefix}:${version}:*`;
}

/** `pid:<bucket>`: the hash bucket holding a username's user id. */
export function userIdBucketKey(username: string, options: KeyOptions = {}): string {
  const name = normalizeUsername(username);
  return cacheKey(namespaces.userIdBucket, String(fnv1a32(name) % 1_000_000), options);
}

/** Field name of a username inside its `pid:` bucket hash. */
export function userIdField(username: string): string {
  return normalizeUsername(username);
}

/** The username-keyed helpers below all lower-case, matching nitter's `toLower`. */
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
