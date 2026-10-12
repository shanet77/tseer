export interface MediaSigner {
  readonly base64Media: boolean;
  sign(url: string): string;
  verify(url: string, signature: string): boolean;
  picUrl(url: string): string;
  origPicUrl(url: string): string;
  vidUrl(url: string): string;
}

export interface MediaFetchOptions {
  headers?: Record<string, string> | undefined;
  headersTimeoutMs?: number | undefined;
}

export interface MediaFetchResponse {
  status: number;
  headers: Record<string, string>;
  body: AsyncIterable<Uint8Array>;
  abort(): void;
}

export interface MediaFetcher {
  fetch(url: string, options?: MediaFetchOptions): Promise<MediaFetchResponse>;
  close(): Promise<void>;
}

export interface MediaPluginOptions {
  hmacKey?: string | undefined;
  base64Media?: boolean | undefined;
}

export interface MediaRoutePluginOptions {
  fetcher?: MediaFetcher | undefined;
  proxy?: string | undefined;
  proxyAuth?: string | undefined;
  maxConns?: number | undefined;
  proxyVideos?: boolean | undefined;
  maxAttempts?: number | undefined;
  headersTimeoutMs?: number | undefined;
  cacheControl?: string | undefined;
}
