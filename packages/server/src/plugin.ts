/**
 * `serverPlugin`: default `ctx.server` provider (fastify behind the seam).
 * Owns the listener lifecycle: `start()` idempotently binds on first use and
 * the plugin disposer closes it, so unloading `serverPlugin` unwinds every
 * route, static mapping, and socket it created.
 */
import type { Context } from "cordis";
import { FastifyHttpServer } from "./server.ts";
import type { HttpServer, ServerAddress, ServerPluginOptions, StaticSpec } from "./types.ts";

declare module "cordis" {
  interface Context {
    /** Framework-agnostic HTTP server (fastify provider by default). */
    server: HttpServer;
  }

  interface Events {
    /** Fired after the server binds (plan §1 extension point). */
    "server/listening": (info: ServerAddress) => void;
  }
}

class ContextHttpServer implements HttpServer {
  readonly route: HttpServer["route"];
  readonly address: HttpServer["address"];
  readonly inject: HttpServer["inject"];
  private readonly inner: FastifyHttpServer;
  private readonly bindAddress: string;
  private readonly bindPort: number;
  private readonly onListening: (info: ServerAddress) => void;
  private startPromise: Promise<ServerAddress> | undefined;

  constructor(
    inner: FastifyHttpServer,
    options: { address: string; port: number },
    onListening: (info: ServerAddress) => void,
  ) {
    this.inner = inner;
    this.bindAddress = options.address;
    this.bindPort = options.port;
    this.onListening = onListening;
    this.route = (spec) => this.inner.route(spec);
    this.address = () => this.inner.address();
    this.inject = (options) => this.inner.inject(options);
    this.static = ((prefixOrSpec: string | StaticSpec, dir?: string) => {
      if (typeof prefixOrSpec === "string") return this.inner.static(prefixOrSpec, dir ?? "");
      return this.inner.static(prefixOrSpec);
    }) as HttpServer["static"];
  }

  readonly static: HttpServer["static"];

  start = (): Promise<ServerAddress> => {
    if (!this.startPromise) {
      this.startPromise = this.inner.start(this.bindAddress, this.bindPort).then((bound) => {
        this.onListening(bound);
        return bound;
      });
    }
    return this.startPromise;
  };

  close = async (): Promise<void> => {
    try {
      await this.inner.close();
    } finally {
      this.startPromise = undefined;
    }
  };
}

export default function serverPlugin(ctx: Context, options: ServerPluginOptions = {}): () => void {
  const inner = new FastifyHttpServer();
  const server = new ContextHttpServer(
    inner,
    { address: options.address ?? "127.0.0.1", port: options.port ?? 8080 },
    (info) => {
      ctx.emit("server/listening", info);
    },
  );
  const dispose = ctx.provide("server", server);
  return () => {
    void (dispose() as unknown as Promise<void>).finally(() => {
      void server.close();
    });
  };
}

export { FastifyHttpServer };
