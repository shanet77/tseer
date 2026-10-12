import { Buffer } from "node:buffer";
import type { MediaFetcher, MediaFetchResponse } from "../src/index.ts";

export interface StubResponse {
  status?: number | undefined;
  headers?: Record<string, string> | undefined;
  body?: string | Buffer | undefined;
}

export interface StubFetcherOptions {
  responses?: Record<string, StubResponse[] | StubResponse> | undefined;
  fallback?: StubResponse | undefined;
}

export class StubFetcher implements MediaFetcher {
  readonly calls: string[] = [];
  readonly aborted: string[] = [];
  private readonly responses: Record<string, StubResponse[]>;
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

export async function drain(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
