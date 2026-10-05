/**
 * Port of `apiutils.nim` `genHeaders` (+ its private `getOauthHeader`/
 * `getCookieHeader` helpers): the per-request header set, bearer vs OAuth1 vs
 * cookie auth, and the `x-client-transaction-id` fallback chain.
 *
 * Header names are emitted title-cased (Nim's `newHttpHeaders(...,
 * titleCase=true)` does the same); HTTP header names are case-insensitive, so
 * this only pins the wire casing for the golden tests.
 */

import type { Session } from "@tseer/twitter-sessions";
import { SessionKind } from "@tseer/types";
import { BEARER_TOKEN, BEARER_TOKEN_2 } from "./endpoints.ts";
import { getOauthHeader } from "./oauth1.ts";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

export interface GenHeadersOptions {
  /** nitter `disableTid` config: skip the tid and use the v2 bearer token. */
  disableTid: boolean;
  /** The `tid.nim` generator; only called on the cookie + non-skipTid path. */
  genTid?: ((path: string) => Promise<string>) | undefined;
  /** Clock forwarded to OAuth1 signing so tests can pin the timestamp. */
  now?: (() => number) | undefined;
}

/**
 * Port of `apiutils.nim` `genHeaders(session, url, skipTid)`.
 *
 * The bearer fallback condition is ported verbatim: `disableTid`, the
 * endpoint's own `skipTid`, or a `/1.1/` path all select `BEARER_TOKEN_2`
 * without a transaction id; otherwise `BEARER_TOKEN` + `genTid(path)`.
 */
export async function genHeaders(
  session: Session,
  url: string,
  skipTid: boolean,
  options: GenHeadersOptions,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: "*/*",
    "Accept-Encoding": "gzip",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    Origin: "https://x.com",
    "User-Agent": USER_AGENT,
    "X-Twitter-Active-User": "yes",
    "X-Twitter-Client-Language": "en",
    Priority: "u=1, i",
  };

  if (session.kind === SessionKind.oauth) {
    headers.Authorization = getOauthHeader(url, session.oauthToken, session.oauthSecret, {
      now: options.now,
    });
    return headers;
  }

  headers["X-Twitter-Auth-Type"] = "OAuth2Session";
  headers["X-Csrf-Token"] = session.ct0;
  headers.Cookie = `auth_token=${session.authToken}; ct0=${session.ct0}`;
  headers.Referer = "https://x.com/";
  headers["Sec-Ch-Ua"] = `"Google Chrome";v="142", "Chromium";v="142", "Not A(Brand";v="24"`;
  headers["Sec-Ch-Ua-Mobile"] = "?0";
  headers["Sec-Ch-Ua-Platform"] = `"Windows"`;
  headers["Sec-Fetch-Dest"] = "empty";
  headers["Sec-Fetch-Mode"] = "cors";
  headers["Sec-Fetch-Site"] = "same-origin";

  const path = new URL(url).pathname;
  if (options.disableTid || skipTid || path.includes("/1.1/")) {
    headers.Authorization = BEARER_TOKEN_2;
  } else {
    headers.Authorization = BEARER_TOKEN;
    if (options.genTid === undefined) {
      throw new Error("genHeaders: tid enabled but no genTid configured");
    }
    headers["X-Client-Transaction-Id"] = await options.genTid(path);
  }
  return headers;
}
