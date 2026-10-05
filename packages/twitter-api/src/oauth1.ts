/**
 * OAuth 1.0a request signing — a port of nitter's private `getOauthHeader`
 * proc from `apiutils.nim`, built on the algorithm of its nimble dependency
 * `oauth == 0.11` (CORDEA/oauth `src/oauth1.nim`).
 *
 * No npm dependency is used on purpose: HMAC-SHA1 ships in `node:crypto`, and
 * a generic OAuth 1.0a library cannot reproduce the two details nitter's wire
 * format depends on — the fixed `nonce: "0"` and the exact header field order
 * (signature before token, version last). Byte-fidelity is checked against the
 * original Nim code by `tests/fixtures/oauth1_golden.json` (generated with
 * `tests/fixtures/generate_oauth_golden.nim`, which imports the real library).
 *
 * Algorithm notes mirrored from CORDEA/oauth:
 * - The signature base string percent-encodes the oauth params once, but appends
 *   the URL's query pairs *raw* (as built by `toUrl`), then percent-encodes the
 *   whole normalized parameter string — for canonical query encodings this
 *   agrees with RFC 5849, which is why `getOauthHeader` first rewrites `+` to
 *   `%20` and `,` to `%2C` in the URL before signing.
 * - Parameters are sorted byte-wise by key, then value, and joined `k=v` with
 *   `&` (the query is parsed by splitting on `&`, keeping only pairs that
 *   contain `=`, splitting at the *first* `=`).
 */
import { createHmac } from "node:crypto";
import { CONSUMER_KEY, CONSUMER_SECRET } from "./endpoints.ts";

/**
 * Port of CORDEA/oauth's `percentEncode` (same rules as RFC 5849's
 * pct-encoding): unreserved bytes pass through, everything else becomes
 * `%XX` over the UTF-8 bytes with uppercase hex.
 */
export function percentEncode(value: string): string {
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
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** Port of CORDEA/oauth's `hmacSha1`: standard HMAC-SHA1, base64 encoded. */
function hmacSha1(key: string, text: string): string {
  return createHmac("sha1", key).update(text, "utf8").digest("base64");
}

/** Port of CORDEA/oauth's `parseQuery` (split at the first `=` only). */
function parseQuery(pairs: string): [string, string][] {
  const result: [string, string][] = [];
  for (const pair of pairs.split("&")) {
    const eq = pair.indexOf("=");
    if (eq !== -1) result.push([pair.slice(0, eq), pair.slice(eq + 1)]);
  }
  return result;
}

/** One oauth parameter as it enters the signature base string. */
type Param = readonly [string, string];

/** Port of CORDEA/oauth's `getSignatureBaseString` (GET, empty body). */
function signatureBaseString(url: string, params: readonly Param[]): string {
  const oauthPairs: Param[] = params.map(([key, value]) => [
    percentEncode(key),
    percentEncode(value),
  ]);

  const parsed = new URL(url);
  const baseUrl = `${parsed.protocol}//${parsed.hostname}${parsed.port.length > 0 ? `:${parsed.port}` : ""}${parsed.pathname}`;
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const all: Param[] = [...oauthPairs, ...parseQuery(query)];

  all.sort(([keyA, valueA], [keyB, valueB]) => {
    if (keyA !== keyB) return keyA < keyB ? -1 : 1;
    if (valueA === valueB) return 0;
    return valueA < valueB ? -1 : 1;
  });

  const normalized = all.map(([key, value]) => `${key}=${value}`).join("&");
  return `GET&${percentEncode(baseUrl)}&${percentEncode(normalized)}`;
}

/** Options for {@link getOauthHeader}; `now` exists so tests pin the clock. */
export interface OauthHeaderOptions {
  /** Seconds since the epoch (default `Date.now()`); nitter rounds it. */
  now?: (() => number) | undefined;
}

/**
 * Port of `apiutils.nim` `getOauthHeader`: sign `url` for `oauthToken` and
 * return the `Authorization` header value.
 *
 * The URL preprocessing (`,` → `%2C`, `+` → `%20`) and the fixed nonce `"0"`
 * are load-bearing: they are what makes the signature byte-identical to
 * nitter's for the same URL and timestamp.
 */
export function getOauthHeader(
  url: string,
  oauthToken: string,
  oauthTokenSecret: string,
  options: OauthHeaderOptions = {},
): string {
  const now = options.now ?? Date.now;
  const encodedUrl = url.replaceAll(",", "%2C").replaceAll("+", "%20");
  const timestamp = String(Math.round(now() / 1000));

  const params: Param[] = [
    ["oauth_consumer_key", CONSUMER_KEY],
    ["oauth_nonce", "0"],
    ["oauth_signature_method", "HMAC-SHA1"],
    ["oauth_timestamp", timestamp],
    ["oauth_version", "1.0"],
    ...(oauthToken.length > 0 ? ([["oauth_token", oauthToken]] as Param[]) : []),
  ];

  const signature = hmacSha1(
    `${percentEncode(CONSUMER_SECRET)}&${percentEncode(oauthTokenSecret)}`,
    signatureBaseString(encodedUrl, params),
  );

  // Header order mirrors CORDEA's `getOauth1RequestHeader`: the fields appear
  // in declaration order (not sorted), the signature is percent-encoded, and
  // `oauth_token` is appended after it.
  let header =
    `OAuth oauth_consumer_key="${CONSUMER_KEY}", oauth_signature_method="HMAC-SHA1", ` +
    `oauth_timestamp="${timestamp}", oauth_nonce="0", oauth_signature="${percentEncode(signature)}"`;
  if (oauthToken.length > 0) header += `, oauth_token="${oauthToken}"`;
  header += `, oauth_version="1.0"`;
  return header;
}
