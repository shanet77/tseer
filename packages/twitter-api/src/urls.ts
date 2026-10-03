/**
 * URL construction for API requests: ports of Nim's `std/uri`
 * (`encodeUrl`/`encodeQuery`), nitter's `toUrl` dual-URL mapping from
 * `apiutils.nim`, and the `ApiUrl`/`ApiReq` request types from `types.nim`.
 *
 * Byte-fidelity matters here: X receives the query string as built, and the
 * golden fixtures (`tests/fixtures/golden.json`) pin exact output from Nim's
 * real stdlib.
 */
import { SessionKind } from "@tseer/types";

/** One endpoint + its query params; port of `types.nim` `ApiUrl`. */
export interface ApiUrl {
  endpoint: string;
  params: [string, string][];
  /** Skip the client transaction id header (cookie-auth V2 endpoints). */
  skipTid: boolean;
}

/**
 * The dual-URL request: one variant per session kind, port of `types.nim`
 * `ApiReq`. `toUrl` picks the variant; `oauth` and `cookie` may differ in
 * endpoint hash, variables, and `skipTid`.
 */
export interface ApiReq {
  oauth: ApiUrl;
  cookie: ApiUrl;
}

/**
 * Port of `std/uri.encodeUrl`: RFC 3986 unreserved bytes pass through, space
 * becomes `+` (or `%20` when `usePlus` is false), everything else is
 * `%XX`-encoded over the UTF-8 bytes with uppercase hex (Nim's `toHex`).
 */
export function encodeUrl(value: string, usePlus = true): string {
  const bytes = Buffer.from(value, "utf8");
  let out = "";
  for (const byte of bytes) {
    const isUnreserved =
      (byte >= 0x30 && byte <= 0x39) || // 0-9
      (byte >= 0x41 && byte <= 0x5a) || // A-Z
      (byte >= 0x61 && byte <= 0x7a) || // a-z
      byte === 0x2d || // -
      byte === 0x2e || // .
      byte === 0x5f || // _
      byte === 0x7e; // ~
    if (isUnreserved) out += String.fromCharCode(byte);
    else if (byte === 0x20) out += usePlus ? "+" : "%20";
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/**
 * Port of `std/uri.encodeQuery` with its defaults: pairs joined by `sep`,
 * keys and values through `encodeUrl(usePlus)`, `=` omitted for empty values
 * (`omitEq`).
 */
export function encodeQuery(
  params: readonly (readonly [string, string])[],
  usePlus = true,
  omitEq = true,
  sep = "&",
): string {
  let out = "";
  for (const [key, value] of params) {
    if (out.length > 0) out += sep;
    out += encodeUrl(key, usePlus);
    if (!omitEq || value.length > 0) out += `=${encodeUrl(value, usePlus)}`;
  }
  return out;
}

// The two API bases from `apiutils.nim` `toUrl`; `path` mirrors what
// `parseUri` yields for each (used by the `/` path join below).
const OAUTH_BASE = { origin: "https://api.x.com", path: "" };
const COOKIE_BASE = { origin: "https://x.com", path: "/i/api" };

/** Port of `std/uri`'s `/` path join for the fixed bases above. */
function joinUrlPath(base: { origin: string; path: string }, segment: string): string {
  const { path } = base;
  if (path.length === 0) {
    return base.origin + (segment.startsWith("/") ? segment : `/${segment}`);
  }
  if (path.endsWith("/")) {
    return base.origin + path + (segment.startsWith("/") ? segment.slice(1) : segment);
  }
  return base.origin + path + (segment.startsWith("/") ? segment : `/${segment}`);
}

/**
 * Port of `apiutils.nim` `toUrl`: pick the session-kind variant, prefix the
 * endpoint with `graphql/` (bare `1.1/` REST endpoints keep no prefix), join
 * onto the kind's base URL, and append the encoded params.
 */
export function toUrl(req: ApiReq, kind: SessionKind): string {
  const url = kind === SessionKind.oauth ? req.oauth : req.cookie;
  const base = kind === SessionKind.oauth ? OAUTH_BASE : COOKIE_BASE;
  const prefix = url.endpoint.startsWith("1.1/") ? "" : "graphql/";
  const path = joinUrlPath(base, `${prefix}${url.endpoint}`);
  const query = encodeQuery(url.params);
  return query.length > 0 ? `${path}?${query}` : path;
}
