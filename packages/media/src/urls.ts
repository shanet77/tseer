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

const VIDEO_HOST_SUFFIX = ".video.pscp.tv";

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

export function normalizeImgUrl(url: string): string {
  let out = url;
  if (!out.startsWith("http")) {
    if (!out.includes("twimg.com")) out = `pbs.twimg.com/${out}`;
    out = `https://${out}`;
  }
  return out;
}
const UNRESERVED = /[A-Za-z0-9\-._~]/;

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

export function decodeUrl(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function encodeUrlSafeBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function decodeUrlSafeBase64(value: string): string {
  return Buffer.from(value, "base64").toString("utf8");
}

export type SegmentEncoding = "enc" | "percent";

export function decodeSegment(segment: string, encoding: SegmentEncoding): string {
  return encoding === "enc" ? decodeUrlSafeBase64(segment) : segment;
}

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function fnv1a32(value: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of Buffer.from(value, "utf8")) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

export function mediaEtag(url: string): string {
  return fnv1a32(url).toString(16).padStart(8, "0");
}
