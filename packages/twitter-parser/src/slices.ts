import { expandedUrl, type Json } from "./json.ts";

export const TWIMG = "pbs.twimg.com/";
export const HTTPS = "https://";

export const TCO = "https://t.co";

const TWITTER_DOMAINS = new Set([
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

export function isTwitterUrl(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    return (
      (protocol === "http:" || protocol === "https:") &&
      (TWITTER_DOMAINS.has(hostname) || hostname.endsWith(".video.pscp.tv"))
    );
  } catch {
    return false;
  }
}

export function shorten(text: string, length = 28): string {
  return text.length > length ? text.slice(0, length) + "…" : text;
}

export function shortLink(text: string, length = 28): string {
  return shorten(text.replace(/^https?:\/\/(www[0-9]?\.)?/, ""), length);
}

export function anchor(text: string, href: string, title?: string): string {
  const attrs = `href="${href}"${title === undefined ? "" : ` title="${xmlEscape(title)}"`}`;
  return `<a ${attrs}>${text}</a>`;
}

export function xmlEscape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export type ReplaceSliceKind = "remove" | "url" | "hashtag" | "mention";

export interface ReplaceSlice {
  a: number;
  b: number;
  kind: ReplaceSliceKind;
  url?: string;
  display?: string;
}

export function extractSlice(entity: { indices?: unknown }): { a: number; b: number } {
  const indices = Array.isArray(entity.indices) ? entity.indices : [];
  const a = typeof indices[0] === "number" ? indices[0] : 0;
  const b = typeof indices[1] === "number" ? indices[1] : 0;
  return { a, b };
}

export function extractUrls(
  result: ReplaceSlice[],
  entity: Json,
  textLen: number,
  hideTwitter = false,
  hideArticle = false,
): void {
  const url = expandedUrl(entity);
  const slice = extractSlice(entity as { indices?: unknown });

  if (hideArticle && isTwitterUrl(url) && url.includes("/article/")) {
    if (slice.a < textLen) result.push({ kind: "remove", a: slice.a, b: slice.b });
  } else if (hideTwitter && slice.b >= textLen && isTwitterUrl(url)) {
    if (slice.a < textLen) result.push({ kind: "remove", a: slice.a, b: slice.b });
  } else {
    result.push({ kind: "url", url, display: shortLink(url), a: slice.a, b: slice.b });
  }
}

export function extractHashtags(result: ReplaceSlice[], entity: { indices?: unknown }): void {
  const slice = extractSlice(entity);
  result.push({ kind: "hashtag", a: slice.a, b: slice.b });
}

export function deduplicate(slices: ReplaceSlice[]): void {
  for (let i = 0; i < slices.length; i += 1) {
    for (let j = i + 1; j < slices.length; ) {
      if (slices[i]?.a === slices[j]?.a) slices.splice(j, 1);
      else j += 1;
    }
  }
}

export function cmpSlice(x: ReplaceSlice, y: ReplaceSlice): number {
  return x.a < y.b ? -1 : x.a > y.b ? 1 : 0;
}

export function replacedWith(
  runes: string[],
  repls: ReplaceSlice[],
  textSlice: { a: number; b: number },
): string {
  const runeLen = runes.length;
  const safeStart = Math.max(0, textSlice.a);
  const safeEnd = Math.min(runeLen, textSlice.b);

  const validRepls = repls.filter(
    (rep) => rep.a >= 0 && rep.b >= 0 && rep.b <= runeLen && rep.a <= rep.b,
  );

  const extractLowerBound = (i: number, idx: number): number => {
    if (i <= 0) return safeStart;
    const prev = validRepls[idx];
    if (prev === undefined) return safeStart;
    return Math.min(prev.b, runeLen);
  };

  let result = "";
  for (const [i, rep] of validRepls.entries()) {
    const lower = extractLowerBound(i, i - 1);
    if (lower < rep.a) result += xmlEscape(runes.slice(lower, rep.a).join(""));
    switch (rep.kind) {
      case "hashtag": {
        if (rep.a + 1 < rep.b) {
          const name = runes.slice(rep.a + 1, rep.b).join("");
          const symbol = runes[rep.a] ?? "";
          result += anchor(xmlEscape(symbol + name), `/search?f=tweets&q=%23${name}`);
        }
        break;
      }
      case "mention": {
        result += anchor(xmlEscape(runes.slice(rep.a, rep.b).join("")), rep.url ?? "", rep.display);
        break;
      }
      case "url": {
        result += anchor(xmlEscape(rep.display ?? ""), rep.url ?? "");
        break;
      }
      case "remove": {
        break;
      }
    }
  }

  const restLower = extractLowerBound(validRepls.length, validRepls.length - 1);
  if (restLower >= 0 && restLower <= safeEnd) {
    result += xmlEscape(runes.slice(restLower, safeEnd).join(""));
  }
  return result;
}

export const UN_REGEX = /(^|[^A-z0-9\-_./?])@([A-z0-9_]{1,15})/g;
export const HT_REGEX = /(^|[^\w\-_./?])([#＃$])([\w_]+)/g;

export function replaceMentions(text: string): string {
  return text.replaceAll(UN_REGEX, (_match, prefix: string, name: string) => {
    return `${prefix}<a href="/${name}">@${name}</a>`;
  });
}

export function replaceHashtags(text: string): string {
  return text.replaceAll(HT_REGEX, (_match, prefix: string, symbol: string, name: string) => {
    return `${prefix}<a href="/search?f=tweets&q=%23${name}">${symbol}${name}</a>`;
  });
}
