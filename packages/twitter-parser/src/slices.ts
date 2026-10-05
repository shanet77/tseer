/**
 * Entity-slice rewriting — the port of `parserutils.nim`'s `ReplaceSlice`
 * machinery (`extractUrls`-produced slices → `replacedWith` HTML) plus the
 * `unRegex`/`htRegex` mention/hashtag post-processing and `formatters.nim`'s
 * `shortLink`.
 *
 * Tweet/user text is rewritten on *codepoints* (Nim's `toRunes`), not UTF-16
 * units — X entity indices are codepoint-based, so `[...text]` is the only
 * correct JS indexing here.
 *
 * Divergence from the Nim original: the hashtag regex is `parserutils.nim`'s
 * `re` version everywhere. `experimental/parser/user.nim` used a slightly
 * different `nre` pattern (possessive quantifiers, negative lookahead) for
 * user bios; the ported pattern covers the same cases without the lookahead.
 */
import { expandedUrl, type Json } from "./json.ts";

/** `utils.nim`/`formatters.nim` constants used by the parsers. */
export const TWIMG = "pbs.twimg.com/";
export const HTTPS = "https://";

/** `formatters.nim` `tco`. */
export const TCO = "https://t.co";

/**
 * `utils.nim` `twitterDomains` + `isTwitterUrl`: hostname match (exact or a
 * `.video.pscp.tv` subdomain). Unparseable input yields `false` (Nim's
 * `parseUri` of garbage has an empty hostname).
 */
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

/** `formatters.nim` `shorten` (28 chars + ellipsis). */
export function shorten(text: string, length = 28): string {
  return text.length > length ? text.slice(0, length) + "…" : text;
}

/** `formatters.nim` `shortLink`: strip the `www0.` host prefix, then shorten. */
export function shortLink(text: string, length = 28): string {
  return shorten(text.replace(/^https?:\/\/(www[0-9]?\.)?/, ""), length);
}

/**
 * `htmlgen.a(text, href, title)` — the anchor form the replaced text uses.
 * Ported verbatim: text and href go in raw (Nim escapes neither; the callers
 * escape what parserutils.nim escapes), only `title` is attribute-escaped.
 */
export function anchor(text: string, href: string, title?: string): string {
  const attrs = `href="${href}"${title === undefined ? "" : ` title="${xmlEscape(title)}"`}`;
  return `<a ${attrs}>${text}</a>`;
}

/**
 * `xmltree.escape` — the escaping `parserutils.nim` applies to anchor
 * display text (and to note-tweet text at the end of expansion).
 */
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
  /**
   * Codepoint range, half-open (`a` inclusive, `b` exclusive) — Twitter's
   * raw entity indices. Nim's `..<` folds the exclusivity into `slice.b` at
   * construction; this port keeps the raw index and translates each Nim rune
   * expression (`a.succ .. b` → `slice(a+1, b)`) at its use site.
   */
  a: number;
  b: number;
  kind: ReplaceSliceKind;
  url?: string;
  display?: string;
}

/** Port of `parserutils.nim` `extractSlice`: a URL/hashtag entity's `indices`. */
export function extractSlice(entity: { indices?: unknown }): { a: number; b: number } {
  const indices = Array.isArray(entity.indices) ? entity.indices : [];
  const a = typeof indices[0] === "number" ? indices[0] : 0;
  const b = typeof indices[1] === "number" ? indices[1] : 0;
  return { a, b };
}

/** Port of `extractUrls` (the `parserutils.nim` version, with the article/hideTwitter removal cases). */
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

/** Port of `extractHashtags`. */
export function extractHashtags(result: ReplaceSlice[], entity: { indices?: unknown }): void {
  const slice = extractSlice(entity);
  result.push({ kind: "hashtag", a: slice.a, b: slice.b });
}

/** Port of `deduplicate`: drop later slices sharing the same start. */
export function deduplicate(slices: ReplaceSlice[]): void {
  for (let i = 0; i < slices.length; i += 1) {
    for (let j = i + 1; j < slices.length; ) {
      if (slices[i]?.a === slices[j]?.a) slices.splice(j, 1);
      else j += 1;
    }
  }
}

/** Port of the `cmp` proc: sorts by `x.slice.a` against `y.slice.b` (kept verbatim, quirk included). */
export function cmpSlice(x: ReplaceSlice, y: ReplaceSlice): number {
  return x.a < y.b ? -1 : x.a > y.b ? 1 : 0;
}

/**
 * Port of `replacedWith`: splice the slices into the rune array as HTML
 * anchors. The validity filter (`rep.slice.a >= 0 and rep.slice.b >= 0 and
 * rep.slice.b < runeLen and rep.slice.a <= rep.slice.b`) and the clamped
 * bounds are ported verbatim — upstream entity indices are attacker-
 * controlled and routinely point past the text.
 */
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
    if (lower < rep.a) result += runes.slice(lower, rep.a).join("");
    switch (rep.kind) {
      case "hashtag": {
        if (rep.a + 1 < rep.b) {
          const name = runes.slice(rep.a + 1, rep.b).join("");
          const symbol = runes[rep.a] ?? "";
          result += anchor(symbol + name, `/search?f=tweets&q=%23${name}`);
        }
        break;
      }
      case "mention": {
        result += anchor(runes.slice(rep.a, rep.b).join(""), rep.url ?? "", rep.display);
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
    result += runes.slice(restLower, safeEnd).join("");
  }
  return result;
}

/**
 * The `unRegex`/`htRegex` post-processing both expanders finish with
 * (`replacef` → `replace` with a capture-aware callback; `$1`/`$2`/`$3` are
 * the capture groups).
 */
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
