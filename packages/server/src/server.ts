/**
 * Fastify-backed `HttpServer` (the default `ctx.server` provider).
 * Fastify types never cross the seam: handlers see `AppRequest`/`AppReply`,
 * and route removal is logical (a disposed route answers 404) because
 * fastify has no route-removal API.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { toAppReply } from "./reply.ts";
import { normalizeMethod, normalizePath, normalizePrefix, toAppRequest } from "./request.ts";
import { notFound, sendStaticFile } from "./static.ts";
import type { InjectOptions, InjectResult, RouteSpec, ServerAddress, StaticSpec } from "./types.ts";

export { httpMethods, normalizeMethod } from "./request.ts";

type HttpServerStatic = {
  (prefix: string, dir: string): () => void;
  (spec: StaticSpec): () => void;
};

/** Implementation behind `ctx.server` (created by `serverPlugin`). */
export class FastifyHttpServer {
  readonly route: (spec: RouteSpec) => () => void;
  readonly address: () => ServerAddress | undefined;
  readonly start: (address: string, port: number) => Promise<ServerAddress>;
  readonly close: () => Promise<void>;
  readonly inject: (options: InjectOptions) => Promise<InjectResult>;
  readonly isStarted: () => boolean;
  private readonly fastify: FastifyInstance;
  private started = false;
  private startPromise: Promise<ServerAddress> | undefined;

  constructor(fastify?: FastifyInstance) {
    this.fastify = fastify ?? Fastify({ trustProxy: false });
    this.fastify.setNotFoundHandler((_request, reply) => {
      notFound(reply);
    });
    this.fastify.setErrorHandler((error: Error, _request, reply) => {
      if (reply.sent) return;
      reply.code(500);
      reply.header("content-type", "text/plain; charset=utf-8");
      reply.send(`internal server error: ${error.message}`);
    });

    this.route = (spec) => {
      const method = normalizeMethod(spec.method);
      const path = normalizePath(spec.path);
      let active = true;
      this.fastify.route({
        method,
        url: path,
        handler: async (request, reply) => {
          if (!active) {
            notFound(reply);
            return;
          }
          await spec.handler(toAppRequest(request), toAppReply(reply));
        },
      });
      return () => {
        active = false;
      };
    };

    this.address = () => {
      const info = this.fastify.server.address();
      if (typeof info === "object" && info !== null) {
        return { address: info.address, port: info.port };
      }
      return undefined;
    };

    this.start = (address, port) => {
      if (!this.startPromise) {
        this.startPromise = this.fastify.listen({ host: address, port }).then(() => {
          this.started = true;
          const bound = this.address();
          if (!bound) throw new Error("server: fastify did not report a bound address");
          return bound;
        });
      }
      return this.startPromise;
    };

    this.close = async () => {
      try {
        await this.fastify.close();
      } finally {
        this.started = false;
        this.startPromise = undefined;
      }
    };

    this.isStarted = () => this.started;

    this.inject = async (options): Promise<InjectResult> => {
      const response = await this.fastify.inject({
        method: ((options.method ?? "GET").toUpperCase() ?? "GET") as "GET",
        url: options.url,
        ...(options.headers === undefined ? {} : { headers: options.headers }),
        ...(options.payload === undefined ? {} : { payload: options.payload }),
      });
      const headers: Record<string, string> = {};
      const rawHeaders = response.headers as unknown as Record<
        string,
        string | string[] | undefined
      >;
      for (const [name, value] of Object.entries(rawHeaders)) {
        if (value === undefined) continue;
        headers[name] = Array.isArray(value) ? value.join(", ") : String(value);
      }
      const body = response.payload as unknown as string;
      const status = response.statusCode as unknown as number;
      return {
        status,
        headers,
        body,
        json<T = unknown>(): T {
          return JSON.parse(body) as T;
        },
      };
    };
  }

  readonly serveStatic: {
    (prefix: string, dir: string): () => void;
    (spec: StaticSpec): () => void;
  } = ((prefixOrSpec: string | StaticSpec, dir?: string): (() => void) => {
    const prefix = typeof prefixOrSpec === "string" ? prefixOrSpec : prefixOrSpec.prefix;
    const directory = typeof prefixOrSpec === "string" ? dir : prefixOrSpec.dir;
    if (directory === undefined) throw new Error("server: static() requires a directory");
    const clean = normalizePrefix(prefix);
    let active = true;
    this.fastify.get(`${clean}/*`, async (request, reply) => {
      if (!active) {
        notFound(reply);
        return;
      }
      const splat = (request.params as Record<string, string | undefined>)["*"] ?? "";
      await sendStaticFile(reply, directory, splat);
    });
    return () => {
      active = false;
    };
  }) as {
    (prefix: string, dir: string): () => void;
    (spec: StaticSpec): () => void;
  };

  readonly static: HttpServerStatic = ((prefixOrSpec: string | StaticSpec, dir?: string) => {
    if (typeof prefixOrSpec === "string") return this.serveStatic(prefixOrSpec, dir ?? "");
    return this.serveStatic(prefixOrSpec);
  }) as HttpServerStatic;
}
