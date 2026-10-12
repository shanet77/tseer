const M3U8_URL = /url="([^"\n]+\.m3u8)"/;

const EXT_X_MAP_URI = '#EXT-X-MAP:URI="';

export const PROXYABLE_EXTENSIONS = /\.(mp4|ts|m4s|aac)(\?|#|$)/i;

export function getM3u8Url(content: string): string {
  return M3U8_URL.exec(content)?.[1] ?? "";
}

export interface ProxifyVideoOptions {
  proxy: boolean;
  manifestUrl?: string | undefined;
  vidUrl: (url: string) => string;
}

const DEFAULT_VIDEO_ORIGIN = "https://video.twimg.com";

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

const LOOKS_LIKE_A_REFERENCE = /\./;

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
      if (slash > 8) dirPath = manifestUrl.slice(0, slash + 1);
    } catch {}
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
    out = out.split(from).join(to);
  }
  return out;
}
