/** `ctx.server` contract: framework-agnostic route seam ported from nitter's Jester layer. */

/** HTTP methods accepted by `HttpServer.route()`. Uppercase canonical form. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/** Loose method spelling accepted at the boundary; normalized to `HttpMethod`. */
export type HttpMethodInput = HttpMethod | Lowercase<HttpMethod>;

/** Framework-agnostic inbound request. Only parsed values cross the seam. */
export interface AppRequest {
  /** Uppercase HTTP method (`GET`, `POST`, …). */
  method: string;
  /** Path without query string (always starts with `/`). */
  path: string;
  /** Raw query string without the leading `?` (empty string when absent). */
  rawQuery: string;
  /** Parsed query params; repeated keys keep the last value. */
  query: Record<string, string>;
  /** Route params captured from `:name` segments (URL-decoded). */
  params: Record<string, string>;
  /** Request headers, lowercased names. */
  headers: Record<string, string | undefined>;
  /** Parsed cookies (`Cookie` header only; no signed-cookie support yet). */
  cookies: Record<string, string>;
}

/** Options accepted by `AppReply` helpers. */
export interface ReplyOptions {
  status?: number | undefined;
  headers?: Record<string, string> | undefined;
}

/** Framework-agnostic response builder handed to route handlers. */
export interface AppReply {
  /** Send an HTML body (`text/html; charset=utf-8`). */
  html(body: string, options?: ReplyOptions): Promise<void> | void;
  /** Send plain text (`text/plain; charset=utf-8`). */
  text(body: string, options?: ReplyOptions): Promise<void> | void;
  /** Send JSON (`application/json; charset=utf-8`). */
  json(body: unknown, options?: ReplyOptions): Promise<void> | void;
  /** Issue a redirect (default `302`). */
  redirect(to: string, status?: number | undefined): Promise<void> | void;
  /** Send a raw body with an explicit content type. */
  send(
    body: string | Buffer | Uint8Array,
    contentType: string,
    options?: ReplyOptions,
  ): Promise<void> | void;
}

/** Route handler: framework-agnostic request in, reply out. */
export type RouteHandler = (req: AppRequest, reply: AppReply) => Promise<void> | void;

/** Route registration accepted by `HttpServer.route()`. */
export interface RouteSpec {
  method: HttpMethodInput;
  path: string;
  handler: RouteHandler;
}

/** Static-file mapping accepted by `HttpServer.static()`. */
export interface StaticSpec {
  /**
   * URL prefix: `/static` serves at `<prefix>/<file>`, `/` at the URL root
   * (nitter's Jester `staticDir` behavior — registered routes always win).
   */
  prefix: string;
  /** Directory served from disk. */
  dir: string;
}

/** Options for `serverPlugin` (the fastify-backed `ctx.server` provider). */
export interface ServerPluginOptions {
  /** Bind address (default `127.0.0.1`). */
  address?: string | undefined;
  /** Bind port (`0` picks an ephemeral port; default `8080`). */
  port?: number | undefined;
}

/** Options for `HttpServer.inject()` (test helper over fastify `inject`). */
export interface InjectOptions {
  method?: string | undefined;
  url: string;
  headers?: Record<string, string> | undefined;
  payload?: string | Buffer | undefined;
}

/** Framework-agnostic result returned by `HttpServer.inject()`. */
export interface InjectResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  json<T = unknown>(): T;
}

/** Address the listener bound to (after `start()`). */
export interface ServerAddress {
  address: string;
  port: number;
}

/** The `ctx.server` seam: `route()`/`static()` register, `start()`/`close()` bind, `inject()` tests. */
export interface HttpServer {
  /** Register a route; returns a disposer that unregisters it. */
  route(spec: RouteSpec): () => void;
  /** Serve files under `dir` at URL `prefix` (or via a `StaticSpec`). */
  static(prefix: string, dir: string): () => void;
  static(spec: StaticSpec): () => void;
  /** Start listening (idempotent; resolves with the bound address). */
  start(): Promise<ServerAddress>;
  /** Stop listening (idempotent). */
  close(): Promise<void>;
  /** Dispatch a fake request without sockets (tests; mirrors fastify inject). */
  inject(options: InjectOptions): Promise<InjectResult>;
  /** Bound address, or `undefined` before `start()`. */
  address(): ServerAddress | undefined;
}
