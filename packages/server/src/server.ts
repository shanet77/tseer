/** Fastify-backed `HttpServer` (default provider); disposed routes answer 404 (fastify can't unregister). */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { toAppReply } from "./reply.ts";
import {
  normalizeMethod,
  normalizePath,
  normalizePrefix,
  parseFormBody,
  toAppRequest,
} from "./request.ts";
import { notFound, sendStaticFile } from "./static.ts";
import type {
  InjectOptions,
  InjectResult,
  RequestHook,
  RouteSpec,
  ServerAddress,
  StaticSpec,
} from "./types.ts";

export { httpMethods, normalizeMethod } from "./request.ts";

type HttpServerStatic = {
  (prefix: string, dir: string): () => void;
  (spec: StaticSpec): () => void;
};

/** Implementation behind `ctx.server` (created by `serverPlugin`). */
export class FastifyHttpServer {
  readonly route: (spec: RouteSpec) => () => void;
  readonly hook: (handler: RequestHook) => () => void;
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
    // Forms post urlencoded bodies (the preferences routes); fastify ships
    // JSON/text parsers only, so the seam parses them into `req.form` itself.
    this.fastify.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_request, body, done) => {
        try {
          done(null, parseFormBody(body as string));
        } catch (error) {
          done(error as Error, undefined);
        }
      },
    );

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

    this.hook = (handler) => {
      // Jester's `before`: runs before every handler, may reply itself
      // (redirect short-circuits routing via `reply.sent`) or continue.
      // Like routes, a disposed hook becomes a no-op — fastify can't remove
      // an instance hook after registration.
      let active = true;
      const wrapped = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        if (!active) return;
        await handler(toAppRequest(request), toAppReply(reply));
      };
      this.fastify.addHook("onRequest", wrapped);
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
    // Root prefix (`/`) becomes a `/*` wildcard: fastify's radix router gives
    // specific routes precedence, so registered routes always beat static.
    const routeUrl = clean === "/" ? "/*" : `${clean}/*`;
    let active = true;
    this.fastify.get(routeUrl, async (request, reply) => {
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
