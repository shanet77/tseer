import { SessionKind } from "@tseer/types";

export interface ApiUrl {
  endpoint: string;
  params: [string, string][];
  skipTid: boolean;
}

export interface ApiReq {
  oauth: ApiUrl;
  cookie: ApiUrl;
}

export function encodeUrl(value: string, usePlus = true): string {
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
    else if (byte === 0x20) out += usePlus ? "+" : "%20";
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

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

const OAUTH_BASE = { origin: "https://api.x.com", path: "" };
const COOKIE_BASE = { origin: "https://x.com", path: "/i/api" };

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

export function toUrl(req: ApiReq, kind: SessionKind): string {
  const url = kind === SessionKind.oauth ? req.oauth : req.cookie;
  const base = kind === SessionKind.oauth ? OAUTH_BASE : COOKIE_BASE;
  const prefix = url.endpoint.startsWith("1.1/") ? "" : "graphql/";
  const path = joinUrlPath(base, `${prefix}${url.endpoint}`);
  const query = encodeQuery(url.params);
  return query.length > 0 ? `${path}?${query}` : path;
}
