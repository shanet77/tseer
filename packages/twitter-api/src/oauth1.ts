import { createHmac } from "node:crypto";
import { CONSUMER_KEY, CONSUMER_SECRET } from "./endpoints.ts";

export function percentEncode(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  let out = "";
  for (const byte of bytes) {
    const isUnreserved =
      (byte >= 0x30 && byte <= 0x39) ||
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      byte === 0x2d ||
      byte === 0x2e ||
      byte === 0x5f ||
      byte === 0x7e;
    if (isUnreserved) out += String.fromCharCode(byte);
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

function hmacSha1(key: string, text: string): string {
  return createHmac("sha1", key).update(text, "utf8").digest("base64");
}

function parseQuery(pairs: string): [string, string][] {
  const result: [string, string][] = [];
  for (const pair of pairs.split("&")) {
    const eq = pair.indexOf("=");
    if (eq !== -1) result.push([pair.slice(0, eq), pair.slice(eq + 1)]);
  }
  return result;
}

type Param = readonly [string, string];

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

export interface OauthHeaderOptions {
  now?: (() => number) | undefined;
}

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

  let header =
    `OAuth oauth_consumer_key="${CONSUMER_KEY}", oauth_signature_method="HMAC-SHA1", ` +
    `oauth_timestamp="${timestamp}", oauth_nonce="0", oauth_signature="${percentEncode(signature)}"`;
  if (oauthToken.length > 0) header += `, oauth_token="${oauthToken}"`;
  header += `, oauth_version="1.0"`;
  return header;
}
