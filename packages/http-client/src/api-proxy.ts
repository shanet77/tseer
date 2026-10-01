/**
 * `apiProxy` semantics — port of nitter's `apiutils.nim` (`setApiProxy` and
 * the URL rewrite inside `fetchImpl`): the configured proxy is a URL prefix,
 * so `https://x.com/i/api/graphql/…` becomes `<apiProxy>x.com/i/api/graphql/…`
 * for GraphQL/REST paths — `/1.1/` endpoints bypass it.
 */

/** Normalize a configured `apiProxy` value (port of `setApiProxy`). */
export function normalizeApiProxy(url: string): string {
  if (url.length === 0) return "";
  let normalized = `${url.replace(/^\/+|\/+$/g, "")}/`;
  if (!normalized.includes("http")) normalized = `http://${normalized}`;
  return normalized;
}

/** True when `url`'s path goes through `apiProxy` (everything except `/1.1/`). */
export function usesApiProxy(url: string, apiProxy: string): boolean {
  if (apiProxy.length === 0) return false;
  return !new URL(url).pathname.includes("/1.1/");
}

/** Apply the `apiProxy` prefix rewrite (port of `fetchImpl`'s `getContent`). */
export function applyApiProxy(url: string, apiProxy: string): string {
  if (!usesApiProxy(url, apiProxy)) return url;
  // Ported verbatim: nitter replaces the scheme with the normalized prefix.
  return url.replace("https://", apiProxy);
}
