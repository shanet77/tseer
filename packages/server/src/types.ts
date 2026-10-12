export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export type HttpMethodInput = HttpMethod | Lowercase<HttpMethod>;

export interface AppRequest {
  method: string;
  path: string;
  rawQuery: string;
  query: Record<string, string>;
  params: Record<string, string>;
  headers: Record<string, string | undefined>;
  cookies: Record<string, string>;
  form: Record<string, string>;
}

export interface ReplyOptions {
  status?: number | undefined;
  headers?: Record<string, string | string[]> | undefined;
}

export interface AppReply {
  html(body: string, options?: ReplyOptions): Promise<void> | void;
  text(body: string, options?: ReplyOptions): Promise<void> | void;
  json(body: unknown, options?: ReplyOptions): Promise<void> | void;
  redirect(to: string, options?: ReplyOptions): Promise<void> | void;
  send(
    body: string | Buffer | Uint8Array,
    contentType: string,
    options?: ReplyOptions,
  ): Promise<void> | void;
  stream?(
    body: AsyncIterable<Uint8Array>,
    contentType: string,
    options?: ReplyOptions,
  ): Promise<void> | void;
}

export type RouteHandler = (req: AppRequest, reply: AppReply) => Promise<void> | void;

export type RequestHook = (req: AppRequest, reply: AppReply) => Promise<void> | void;

export interface RouteSpec {
  method: HttpMethodInput;
  path: string;
  handler: RouteHandler;
}

export interface StaticSpec {
  prefix: string;
  dir: string;
}

export interface ServerPluginOptions {
  address?: string | undefined;
  port?: number | undefined;
}

export interface InjectOptions {
  method?: string | undefined;
  url: string;
  headers?: Record<string, string> | undefined;
  payload?: string | Buffer | undefined;
}

export interface InjectResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  json<T = unknown>(): T;
}

export interface ServerAddress {
  address: string;
  port: number;
}

export interface HttpServer {
  route(spec: RouteSpec): () => void;
  hook(handler: RequestHook): () => void;
  static(prefix: string, dir: string): () => void;
  static(spec: StaticSpec): () => void;
  start(): Promise<ServerAddress>;
  close(): Promise<void>;
  inject(options: InjectOptions): Promise<InjectResult>;
  address(): ServerAddress | undefined;
}
