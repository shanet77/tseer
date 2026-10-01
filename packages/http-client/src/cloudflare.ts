/** Cloudflare HTML detection — port of nitter's `apiutils.nim`. */

/**
 * Detect Cloudflare HTML error pages returned instead of JSON
 * (port of `isCloudflareHtml`).
 */
export function isCloudflareHtml(body: string): boolean {
  if (body.length < 14 || body[0] !== "<") return false;
  return body.slice(0, 14).toLowerCase() === "<!doctype html" && body.includes("Cloudflare");
}

/**
 * Extract `<title>` from Cloudflare HTML for log diagnostics
 * (port of `cfTitle`; `"unknown"` when absent).
 */
export function cfTitle(body: string): string {
  const start = body.indexOf("<title>");
  if (start < 0) return "unknown";
  const contentStart = start + 7;
  const stop = body.indexOf("</title>", contentStart);
  if (stop < 0) return "unknown";
  return body.slice(contentStart, stop).trim().split(/\s+/).join(" ");
}
