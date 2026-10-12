import type { RateLimit } from "@tseer/types";

export interface OutboundRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | undefined;
  attempt: number;
}

export interface OutboundResponse {
  request: OutboundRequest;
  status: number;
  headers: Record<string, string>;
  durationMs: number;
}

export interface HttpRequestOptions {
  method?: string | undefined;
  headers?: Record<string, string> | undefined;
  body?: string | undefined;
  timeoutMs?: number | undefined;
  maxRetries?: number | undefined;
  retryDelayMs?: number | undefined;
  detectCloudflare?: boolean | undefined;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  url: string;
  rateLimit?: RateLimit | undefined;
}

export interface HttpClient {
  request(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;
}

export interface RetryInfo {
  request: OutboundRequest;
  attempt: number;
  totalAttempts: number;
  reason: string;
  delayMs: number;
}

export interface CloudflareInfo {
  url: string;
  status: number;
  title: string;
}

export interface HttpClientHooks {
  onRequest(req: OutboundRequest): void;
  onResponse(res: OutboundResponse): void;
  onRetry?(info: RetryInfo): void;
  onCloudflare?(info: CloudflareInfo): void;
}

export interface HttpClientPluginOptions {
  maxConns?: number | undefined;
  proxy?: string | undefined;
  proxyAuth?: string | undefined;
  apiProxy?: string | undefined;
  maxRetries?: number | undefined;
  retryDelayMs?: number | undefined;
  timeoutMs?: number | undefined;
}
