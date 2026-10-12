export function normalizeApiProxy(url: string): string {
  if (url.length === 0) return "";
  let normalized = `${url.replace(/^\/+|\/+$/g, "")}/`;
  if (!normalized.includes("http")) normalized = `http://${normalized}`;
  return normalized;
}

export function usesApiProxy(url: string, apiProxy: string): boolean {
  if (apiProxy.length === 0) return false;
  return !new URL(url).pathname.includes("/1.1/");
}

export function applyApiProxy(url: string, apiProxy: string): string {
  if (!usesApiProxy(url, apiProxy)) return url;
  return url.replace("https://", apiProxy);
}
