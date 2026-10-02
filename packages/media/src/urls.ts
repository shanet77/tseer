/**
 * Media URL validation, the two path encodings, and the ETag hash.
 *
 * Ported from nitter `src/utils.nim` (`twitterDomains`, `isTwitterUrl`,
 * `normalizeImgUrl`, `encodeUrl`) and `src/routes/media.nim` (`$hash(url)`).
 */

/**
 * Hosts the media proxy is allowed to fetch, verbatim from `utils.nim`.
 *
 * This allowlist is the SSRF guard for nitter #1411: `/pic/<url>` takes an
 * attacker-supplied URL, so an unrestricted proxy would happily fetch
 * `http://169.254.169.254/…` from the instance's own network. Nothing here
 * widens the list; an operator who wants another CDN host edits this constant.
 */
const TWITTER_DOMAINS: ReadonlySet<string> = new Set([
  "twitter.com",
  "pic.twitter.com",
  "twimg.com",
  "abs.twimg.com",
  "pbs.twimg.com",
  "video.twimg.com",
  "x.com",
  "pscp.tv",
  "video.pscp.tv",
]);

/**
 * Suffix match for the per-video CDN hosts, ported from `isTwitterUrl`
 * (`uri.hostname.endsWith(".video.pscp.tv")`). The leading dot keeps
 * `evil-video.pscp.tv.attacker.com` from matching, same as in Nim.
 */
const VIDEO_HOST_SUFFIX = ".video.pscp.tv";

/**
 * True when `url` is an http(s) URL served by an allowlisted X media host.
 * Unparseable input is rejected rather than throwing — callers treat a false
 * result as "not our problem", not as a fatal error.
 */
export function isTwitterUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return TWITTER_DOMAINS.has(host) || host.endsWith(VIDEO_HOST_SUFFIX);
}

/**
 * Expand a bare twimg media path into a fetchable absolute URL (port of
 * `normalizeImgUrl`): prefix `pbs.twimg.com/` when the host is missing, then
 * `https://`. A URL that already starts with `http` is returned untouched —
 * note the Nim test is `startsWith("http")`, not a scheme parse, so `httpfoo`
 * is also left alone. Preserved for byte-compatibility.
 */
export function normalizeImgUrl(url: string): string {
  let out = url;
  if (!out.startsWith("http")) {
    if (!out.includes("twimg.com")) out = `pbs.twimg.com/${out}`;
    out = `https://${out}`;
  }
  return out;
}
/** RFC 3986 unreserved set; everything else is percent-encoded. */
const UNRESERVED = /[A-Za-z0-9\-._~]/;

/**
 * Percent-encode a media URL for embedding in a path segment (Nim's
 * `uri.encodeUrl`, RFC 3986).
 *
 * Deliberate divergence: Nim encodes spaces as `+` under `usePlus = true`. We
 * encode them as `%20` instead. The `server` seam hands us route params that
 * fastify has *already* percent-decoded, so our decoder never sees a `+`. If we
 * emitted `+` for spaces a space would survive as a literal `+` in the decoded
 * param, whereas a real `+` inside a media URL arrives as `%2B` and decodes
 * correctly. Encoding spaces as `%20` keeps the round trip exact; nothing but
 * the literal-space case differs, and media URLs do not contain spaces.
 */
export function encodeUrl(value: string): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const char = String.fromCharCode(byte);
    if (byte < 0x80 && UNRESERVED.test(char)) {
      out += char;
      continue;
    }
    out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/**
 * Percent-decode a raw (undecoded) path segment (Nim's `uri.decodeUrl`).
 *
 * This is the inverse of {@link encodeUrl}. It is deliberately **not** what the
 * routes use: fastify has already percent-decoded `AppRequest.params`, so
 * applying this a second time would corrupt any URL whose path legitimately
 * contains a `%` escape — `…/a%2Fb.jpg` would come back as `…/a/b.jpg`. See
 * {@link decodeSegment}, which is the decode the routes actually perform.
 */
export function decodeUrl(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Nim's decoder emits malformed escapes verbatim rather than raising.
    return value;
  }
}

/**
 * URL-safe base64 with padding — the `enc` path encoding (Nim's
 * `encode(link, safe = true)`, which substitutes `-`/`_` for `+`/`/`).
 */
export function encodeUrlSafeBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/**
 * Decode a base64 path segment.
 *
 * Accepts both alphabets: Nim's `base64` decode table maps the standard *and*
 * URL-safe characters to the same values, so `decode()` round-trips a payload
 * built with `safe = true` or `safe = false` alike. Node's lenient `base64`
 * decoder does the same, which also means it tolerates stray characters
 * instead of raising.
 */
export function decodeUrlSafeBase64(value: string): string {
  return Buffer.from(value, "base64").toString("utf8");
}

/** Which path encoding a link was built with (the `enc` route variant). */
export type SegmentEncoding = "enc" | "percent";

/**
 * Recover the media URL from a matched route's `url` parameter.
 *
 * `segment` is a **fastify route param, and therefore already percent-decoded**
 * (find-my-way decodes it on match). That makes the decode asymmetric, which is
 * the whole point of this function:
 * - `percent`: nothing left to do. Decoding again would be an *error*, not a
 *   no-op — a URL whose path legitimately contains `%2F` or `%20` would come
 *   back with a different path than the one we signed and cached an ETag for.
 * - `enc`: base64 is not touched by the router, so this one genuinely does need
 *   decoding.
 *
 * The route knows which encoding the link was built with (`/pic/enc/…` versus
 * `/pic/…`), which is strictly more reliable than re-deriving it the way nitter
 * does by inspecting whether its optional regex group happened to match.
 */
export function decodeSegment(segment: string, encoding: SegmentEncoding): string {
  return encoding === "enc" ? decodeUrlSafeBase64(segment) : segment;
}

/** FNV-1a constants — the same hash `packages/cache` uses for stable buckets. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Deterministic 32-bit FNV-1a over the UTF-8 bytes, as an unsigned integer. */
export function fnv1a32(value: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of Buffer.from(value, "utf8")) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/**
 * ETag for a proxied media URL, from `$hash(url)` in `routes/media.nim`.
 *
 * See `packages/cache` on the same substitution: Nim's `hash` is only stable
 * within a build, so it would reshuffle across upgrades and invalidate every
 * client's cache. An ETag wants the opposite property — it must stay
 * *identical* across restarts for `If-None-Match` to ever hit — so this is a
 * stable hash. `fnv1a32(url)`, not the redirect target: nitter hashes the
 * request URL, so a redirect keeps the same ETag.
 */
export function mediaEtag(url: string): string {
  return fnv1a32(url).toString(16).padStart(8, "0");
}
