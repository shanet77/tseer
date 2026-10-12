import { createDispatcher } from "@tseer/http-client";
import { type Dispatcher, request as undiciRequest } from "undici";
import type { MediaFetcher, MediaFetchOptions, MediaFetchResponse } from "./types.ts";

export const DEFAULT_HEADERS_TIMEOUT_MS = 5_000;

export interface UndiciMediaFetcherOptions {
  proxy?: string | undefined;
  proxyAuth?: string | undefined;
  maxConns?: number | undefined;
  headersTimeoutMs?: number | undefined;
}

function flatten(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

const NO_REDIRECTS = 0;

type UndiciRequestOptions = NonNullable<Parameters<typeof undiciRequest>[1]>;

function withRedirects(base: UndiciRequestOptions, maxRedirections: number): UndiciRequestOptions {
  return { ...base, maxRedirections } as UndiciRequestOptions;
}

export class UndiciMediaFetcher implements MediaFetcher {
  private readonly dispatcher: Dispatcher;
  private readonly headersTimeoutMs: number;

  constructor(options: UndiciMediaFetcherOptions = {}) {
    this.dispatcher = createDispatcher({
      maxConns: options.maxConns,
      proxy: options.proxy,
      proxyAuth: options.proxyAuth,
    });
    this.headersTimeoutMs = options.headersTimeoutMs ?? DEFAULT_HEADERS_TIMEOUT_MS;
  }

  async fetch(url: string, options: MediaFetchOptions = {}): Promise<MediaFetchResponse> {
    const response = await undiciRequest(
      url,
      withRedirects(
        {
          method: "GET",
          dispatcher: this.dispatcher,
          headers: options.headers ?? {},
          headersTimeout: options.headersTimeoutMs ?? this.headersTimeoutMs,
        },
        NO_REDIRECTS,
      ),
    );

    let aborted = false;
    return {
      status: response.statusCode,
      headers: flatten(response.headers),
      body: response.body,
      abort() {
        if (aborted) return;
        aborted = true;
        response.body.destroy();
      },
    };
  }

  close(): Promise<void> {
    return this.dispatcher.close();
  }
}
