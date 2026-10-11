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
  /**
   * The parsed body as strings, for `application/x-www-form-urlencoded`
   * POSTs (the preferences routes; Jester merges form fields into
   * `request.params`). Empty for bodyless requests.
   */
  form: Record<string, string>;
}

/** Options accepted by `AppReply` helpers. */
export interface ReplyOptions {
  status?: number | undefined;
  /**
   * Extra response headers. Array values become repeated headers (fastify
   * appends each `set-cookie` separately rather than joining with ", ").
   */
  headers?: Record<string, string | string[]> | undefined;
}

/** Framework-agnostic response builder handed to route handlers. */
export interface AppReply {
  /** Send an HTML body (`text/html; charset=utf-8`). */
  html(body: string, options?: ReplyOptions): Promise<void> | void;
  /** Send plain text (`text/plain; charset=utf-8`). */
  text(body: string, options?: ReplyOptions): Promise<void> | void;
  /** Send JSON (`application/json; charset=utf-8`). */
  json(body: unknown, options?: ReplyOptions): Promise<void> | void;
  /** Issue a redirect (default `302`); `options` carries an explicit status
   * or extra headers (e.g. the pref cookies on `/saveprefs`' redirect). */
  redirect(to: string, options?: ReplyOptions): Promise<void> | void;
  /** Send a raw body with an explicit content type. */
  send(
    body: string | Buffer | Uint8Array,
    contentType: string,
    options?: ReplyOptions,
  ): Promise<void> | void;
  /**
   * Stream a body to the client without buffering it (media proxying).
   *
   * Optional on the seam: providers that cannot stream may omit it, so
   * consumers must feature-detect (`if (reply.stream) …`) and fall back to
   * `send()`. Buffers belong in memory only when a provider forces the fallback.
   */
  stream?(
    body: AsyncIterable<Uint8Array>,
    contentType: string,
    options?: ReplyOptions,
  ): Promise<void> | void;
}

/** Route handler: framework-agnostic request in, reply out. */
export type RouteHandler = (req: AppRequest, reply: AppReply) => Promise<void> | void;

/**
 * A request hook (nitter's Jester `before` block): runs before every route
 * handler. It may reply itself (redirect/error — short-circuiting the
 * route) or return to continue. Mount hooks before `start()` — fastify
 * binds instance hooks when the instance becomes ready.
 */
export type RequestHook = (req: AppRequest, reply: AppReply) => Promise<void> | void;

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

/** The `ctx.server` seam: `route()`/`static()` register, `hook()` runs before
 * every handler, `start()`/`close()` bind, `inject()` tests. */
export interface HttpServer {
  /** Register a route; returns a disposer that unregisters it. */
  route(spec: RouteSpec): () => void;
  /** Register a request hook (Jester's `before`); returns a disposer. */
  hook(handler: RequestHook): () => void;
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
