import { Buffer } from "node:buffer";
import type { MediaFetcher, MediaFetchResponse } from "./types.ts";
import { isTwitterUrl, mediaEtag } from "./urls.ts";

export const DEFAULT_CACHE_CONTROL = "max-age=604800";

const FINAL_STATUS = 404;

const DEFAULT_MAX_ATTEMPTS = 3;

export type ProxyFailure = "notFound" | "forbiddenRedirect" | "timeout" | "exhausted";

export interface ProxySuccess {
  ok: true;
  status: number;
  headers: Record<string, string>;
  etag: string;
  body: AsyncIterable<Uint8Array>;
  abort(): void;
}

export interface ProxyFailureResult {
  ok: false;
  reason: ProxyFailure;
  status: number;
}

export type ProxyResult = ProxySuccess | ProxyFailureResult;

export interface ProxyMediaOptions {
  fetcher: MediaFetcher;
  cacheControl?: string | undefined;
  maxAttempts?: number | undefined;
  headersTimeoutMs?: number | undefined;
  onRetry?: ((message: string) => void) | undefined;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}
export async function proxyMedia(url: string, options: ProxyMediaOptions): Promise<ProxyResult> {
  const { fetcher } = options;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const cacheControl = options.cacheControl ?? DEFAULT_CACHE_CONTROL;
  const etag = mediaEtag(url);

  let target = url;
  let timedOut = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const last = attempt === maxAttempts;
    let response: MediaFetchResponse | undefined;
    try {
      response = await fetcher.fetch(target, { headersTimeoutMs: options.headersTimeoutMs });
    } catch (err) {
      timedOut = isTimeout(err);
      const code = (err as NodeJS.ErrnoException)?.code;
      options.onRetry?.(
        `[media] attempt ${attempt}/${maxAttempts} failed: ${describe(err)}` +
          (typeof code === "string" ? ` [${code}]` : "") +
          (last ? "" : ", retrying"),
      );
      if (last) break;
      continue;
    }

    if (response.status === 200) {
      return {
        ok: true,
        status: 200,
        etag,
        headers: { ...response.headers, "cache-control": cacheControl, etag },
        body: response.body,
        abort: () => response.abort(),
      };
    }

    const location = response.headers["location"];
    response.abort();

    if (response.status === FINAL_STATUS) return { ok: false, reason: "notFound", status: 404 };

    if (isRedirect(response.status) && location !== undefined && location.length > 0) {
      if (!isTwitterUrl(location)) {
        return { ok: false, reason: "forbiddenRedirect", status: 403 };
      }
      target = location;
      options.onRetry?.(`[media] following redirect (${attempt}/${maxAttempts}), url: ${target}`);
      if (last) break;
      continue;
    }

    timedOut = false;
    options.onRetry?.(
      `[media] attempt ${attempt}/${maxAttempts} got status ${response.status}, url: ${target}` +
        (last ? "" : ", retrying"),
    );
    if (last) break;
  }

  return timedOut
    ? { ok: false, reason: "timeout", status: 504 }
    : { ok: false, reason: "exhausted", status: 404 };
}

function isTimeout(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === "UND_ERR_HEADERS_TIMEOUT" || code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
    return true;
  }
  return err instanceof Error && err.name === "HeadersTimeoutError";
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function collect(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export interface SafeFetchOptions {
  fetcher: MediaFetcher;
  maxAttempts?: number | undefined;
  headersTimeoutMs?: number | undefined;
  onRetry?: ((message: string) => void) | undefined;
}

export async function safeFetchText(url: string, options: SafeFetchOptions): Promise<string> {
  if (!isTwitterUrl(url)) return "";
  const result = await proxyMedia(url, {
    fetcher: options.fetcher,
    maxAttempts: options.maxAttempts,
    headersTimeoutMs: options.headersTimeoutMs,
    onRetry: options.onRetry,
  });
  if (!result.ok) return "";
  try {
    return (await collect(result.body)).toString("utf8");
  } catch {
    return "";
  }
}
