import type { Session } from "@tseer/twitter-sessions";
import { SessionKind } from "@tseer/types";
import { BEARER_TOKEN, BEARER_TOKEN_2 } from "./endpoints.ts";
import { getOauthHeader } from "./oauth1.ts";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

export interface GenHeadersOptions {
  disableTid: boolean;
  genTid?: ((path: string) => Promise<string>) | undefined;
  now?: (() => number) | undefined;
}

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
