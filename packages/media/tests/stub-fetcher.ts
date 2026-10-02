import { Buffer } from "node:buffer";
import type { MediaFetcher, MediaFetchResponse } from "../src/index.ts";

/**
 * A `MediaFetcher` driven by a per-URL script, so the proxy's policy can be
 * tested without a network — and, more importantly, so *no test can* accidentally
 * reach one. Every URL is fake; `isTwitterUrl` still gates what is fetchable,
 * because that is the behaviour under test.
 */
export interface StubResponse {
  status?: number | undefined;
  headers?: Record<string, string> | undefined;
  /** Body bytes; `""` yields no chunks, mirroring an empty upstream body. */
  body?: string | Buffer | undefined;
}

export interface StubFetcherOptions {
  /** Responses keyed by URL, consumed in order per key (so retries can differ). */
  responses?: Record<string, StubResponse[] | StubResponse> | undefined;
  /** Response used when a URL is not in `responses`. Default 404. */
  fallback?: StubResponse | undefined;
}

export class StubFetcher implements MediaFetcher {
  /** Every URL requested, in order, including retries. */
  readonly calls: string[] = [];
  /** Bodies aborted without being consumed. */
  readonly aborted: string[] = [];
  private readonly responses: Record<string, StubResponse[]>;
  /** How many times each URL has been requested (per-URL script cursor). */
  private readonly cursor: Record<string, number> = {};
  private readonly fallback: StubResponse;
  private closed = false;

  constructor(options: StubFetcherOptions = {}) {
    this.responses = {};
    for (const [url, value] of Object.entries(options.responses ?? {})) {
      this.responses[url] = Array.isArray(value) ? [...value] : [value];
    }
    this.fallback = options.fallback ?? { status: 404 };
  }

  async fetch(url: string): Promise<MediaFetchResponse> {
    this.calls.push(url);
    // The last scripted response repeats, so a single entry covers N retries and
    // a script of [503, 200] models exactly one failure followed by recovery.
    // An unscripted URL falls back, rather than the other way round.
    const script = this.responses[url];
    const spec =
      script === undefined
        ? this.fallback
        : (script[Math.min(this.cursor[url] ?? 0, script.length - 1)] ?? this.fallback);
    this.cursor[url] = (this.cursor[url] ?? 0) + 1;
    const status = spec.status ?? 200;
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(spec.headers ?? {})) {
      headers[name.toLowerCase()] = value;
    }
    const payload = spec.body === undefined ? "" : spec.body;
    const chunks =
      typeof payload === "string" ? [Buffer.from(payload, "utf8")] : [Buffer.from(payload)];

    let aborted = false;
    let consumed = false;
    // Arrow functions, so `this` stays the fetcher: the response object literal
    // below has no `aborted` array of its own.
    const self = this;
    return {
      status,
      headers,
      body: {
        async *[Symbol.asyncIterator]() {
          if (aborted) return;
          consumed = true;
          for (const chunk of chunks) yield chunk;
        },
      },
      abort() {
        if (consumed || aborted) return;
        aborted = true;
        self.aborted.push(url);
      },
    };
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

/** Collect an async iterable into a single Buffer (for asserting on bodies). */
export async function drain(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
