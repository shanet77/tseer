/** Default `ctx.http` provider (undici); owns the dispatcher lifecycle. */
import type { Context } from "cordis";
import { UndiciHttpClient } from "./client.ts";
import type {
  CloudflareInfo,
  HttpClient,
  HttpClientPluginOptions,
  OutboundRequest,
  OutboundResponse,
  RetryInfo,
} from "./types.ts";

declare module "cordis" {
  interface Context {
    /** Outbound HTTP client (undici pool + proxy + retry by default). */
    http: HttpClient;
  }

  interface Events {
    /** Fired before each attempt; listeners may rewrite `req.headers`. */
    "http/request": (req: OutboundRequest) => void;
    /** Fired after each completed attempt. */
    "http/response": (res: OutboundResponse) => void;
  }
}

export default function httpClientPlugin(
  ctx: Context,
  options: HttpClientPluginOptions = {},
): () => void {
  const client = new UndiciHttpClient(options, {
    onRequest: (req) => ctx.emit("http/request", req),
    onResponse: (res) => ctx.emit("http/response", res),
    onRetry: (info: RetryInfo) =>
      ctx.logger.debug(
        `http: ${info.request.method} ${info.request.url} failed (${info.reason}); ` +
          `attempt ${info.attempt}/${info.totalAttempts}, retrying in ${info.delayMs}ms`,
      ),
    onCloudflare: (info: CloudflareInfo) =>
      ctx.logger.warn(`http: [cloudflare] ${info.status} (${info.title}), url: ${info.url}`),
  });
  const dispose = ctx.provide("http", client);
  return () => {
    void (dispose() as unknown as Promise<void>).finally(() => {
      void client.close();
    });
  };
}
