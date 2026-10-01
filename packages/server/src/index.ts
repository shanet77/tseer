/** `@tseer/server` — `ctx.server` seam: fastify listener, route registry. */
export { default as serverPlugin } from "./plugin.ts";
export { toAppReply } from "./reply.ts";
export { normalizePath, normalizePrefix, parseCookies, toAppRequest } from "./request.ts";
export { FastifyHttpServer, httpMethods, normalizeMethod } from "./server.ts";
export { contentTypeFor, resolveWithin } from "./static.ts";
export type {
  AppReply,
  AppRequest,
  HttpMethod,
  HttpMethodInput,
  HttpServer,
  InjectOptions,
  InjectResult,
  ReplyOptions,
  RouteHandler,
  RouteSpec,
  ServerAddress,
  ServerPluginOptions,
  StaticSpec,
} from "./types.ts";
