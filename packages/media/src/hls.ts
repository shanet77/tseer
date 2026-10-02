/**
 * HLS manifest rewriting — ported from nitter `src/formatters.nim`
 * (`getM3u8Url`, `proxifyVideo`).
 *
 * These live in `formatters.nim` upstream, but the only callers are the media,
 * broadcast, and space routes, and they need `getVidUrl` to sign what they
 * rewrite. They sit here rather than in `views` because they are URL rewriting,
 * not rendering.
 */

/** Nim's `m3u8Regex` (`url="(.+.m3u8)"`). */
const M3U8_URL = /url="([^"\n]+\.m3u8)"/;

/** `#EXT-X-MAP:URI="…"` — the init segment of an fMP4 stream. */
const EXT_X_MAP_URI = '#EXT-X-MAP:URI="';

/**
 * Media segment extensions the media proxy streams verbatim (nitter's
 * `".mp4" in url or ".ts" in url or ".m4s" in url or ".aac" in url`).
 *
 * Anchored on a query/fragment boundary so `.m3u8` does not match `.m4s`-style
 * lookalikes in a path component, and case-insensitive because twimg serves
 * both `.mp4` and `.MP4` style variants.
 */
export const PROXYABLE_EXTENSIONS = /\.(mp4|ts|m4s|aac)(\?|#|$)/i;

/** Extract the first `.m3u8` URL referenced by a media map / vmap document. */
export function getM3u8Url(content: string): string {
  return M3U8_URL.exec(content)?.[1] ?? "";
}

/** How `proxifyVideo` should treat resolved segment URLs. */
export interface ProxifyVideoOptions {
  /** Rewrite segments through `/video/<sig>/…`; when false they are left absolute. */
  proxy: boolean;
  /**
   * The manifest's own URL, used to resolve relative segment paths. Empty (the
   * nitter default, used for broadcast/space) falls back to the
   * `https://video.twimg.com` origin with no directory prefix.
   */
  manifestUrl?: string | undefined;
  /** Builds the rewritten link — `MediaSigner.vidUrl` in production. */
  vidUrl: (url: string) => string;
}

/** Default manifest origin when no `manifestUrl` is supplied (nitter hardcodes it). */
const DEFAULT_VIDEO_ORIGIN = "https://video.twimg.com";

/**
 * The URL a manifest line refers to, if any.
 *
 * Only two line shapes carry a URL out of a tag: an init segment
 * (`#EXT-X-MAP:URI="…"`) and an alternate rendition (`#EXT-X-MEDIA…URI="…"`).
 * Everything else is either a plain segment line or a comment we must not touch.
 */
function lineUrl(line: string): string {
  if (line.startsWith(EXT_X_MAP_URI)) {
    return line.endsWith('"') ? line.slice(EXT_X_MAP_URI.length, -1) : "";
  }
  if (line.startsWith("#EXT-X-MEDIA")) {
    const key = line.indexOf("URI=", 5);
    if (key === -1) return "";
    const open = line.indexOf('"', key + 4);
    if (open === -1) return "";
    const close = line.indexOf('"', open + 1);
    if (close === -1) return "";
    return line.slice(open + 1, close);
  }
  return line;
}

/**
 * Nim requires only that a relative reference contain a `.`. That is what keeps
 * bare sequence numbers (`seg1`) and `#EXT-X-*` tags from being mistaken for
 * URLs. It deliberately does not whitelist extensions: manifests also reference
 * variant sub-playlists and init segments whose names we cannot predict, and
 * silently dropping one breaks playback rather than failing loudly.
 */
const LOOKS_LIKE_A_REFERENCE = /\./;

/** Resolve a manifest-relative reference against the manifest's origin/directory. */
function resolveSegment(url: string, origin: string, dirPath: string): string {
  if (url.startsWith("/")) return origin + url;
  if (
    dirPath.length > 0 &&
    url.length > 0 &&
    !url.startsWith("#") &&
    !url.startsWith("http") &&
    LOOKS_LIKE_A_REFERENCE.test(url)
  ) {
    return dirPath + url;
  }
  return "";
}

/**
 * Rewrite an m3u8 manifest so segments are fetched through this instance
 * (port of `proxifyVideo`).
 *
 * nitter resolves relative references against the manifest's own URL, and a
 * few other callers (broadcast, space) pass no URL at all — those get the
 * `https://video.twimg.com` origin and no directory prefix, so only absolute
 * and root-relative segments can be rewritten.
 */
export function proxifyVideo(manifest: string, options: ProxifyVideoOptions): string {
  const { proxy, vidUrl } = options;
  const manifestUrl = options.manifestUrl ?? "";
  let origin = DEFAULT_VIDEO_ORIGIN;
  let dirPath = "";
  if (manifestUrl.length > 0) {
    try {
      const parsed = new URL(manifestUrl);
      origin = `${parsed.protocol}//${parsed.hostname}`;
      const slash = manifestUrl.lastIndexOf("/");
      // `> 8` is nitter's guard against slicing into the `https://` prefix.
      if (slash > 8) dirPath = manifestUrl.slice(0, slash + 1);
    } catch {
      // An unparseable manifest URL falls back to the defaults above.
    }
  }

  const replacements = new Map<string, string>();
  for (const line of manifest.split(/\r?\n/)) {
    const url = lineUrl(line);
    if (url.length === 0) continue;
    const resolved = resolveSegment(url, origin, dirPath);
    if (resolved.length === 0) continue;
    replacements.set(url, proxy ? vidUrl(resolved) : resolved);
  }

  let out = manifest;
  for (const [from, to] of replacements) {
    // `split`/`join` rather than `replaceAll` with a string pattern: the search
    // value is treated literally either way, but this also skips the regex path
    // for keys containing `$` or other replacement metacharacters.
    out = out.split(from).join(to);
  }
  return out;
}
