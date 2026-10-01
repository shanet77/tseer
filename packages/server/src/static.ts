/** Minimal static-file sender behind `HttpServer.static()`: safe reads, no indexes or ranges. */
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { FastifyReply } from "fastify";

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** Content type for a file path (extension map, octet-stream fallback). */
export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot).toLowerCase();
  return mimeTypes[ext] ?? "application/octet-stream";
}

/** Resolve `splat` under `dir`; returns `undefined` when it escapes `dir`. */
export function resolveWithin(dir: string, splat: string): string | undefined {
  const base = resolve(dir);
  const resolved = resolve(base, `./${splat}`);
  if (resolved !== base && !resolved.startsWith(base + sep)) return undefined;
  return resolved;
}

/** Plain-text 404 response. */
export function notFound(reply: FastifyReply): void {
  reply.code(404);
  reply.header("content-type", "text/plain; charset=utf-8");
  reply.send("not found");
}

/** Send a file (404 when missing, unreadable, or escaping `dir`). */
export async function sendStaticFile(
  reply: FastifyReply,
  dir: string,
  splat: string,
): Promise<void> {
  const resolved = resolveWithin(dir, splat);
  if (resolved === undefined) {
    notFound(reply);
    return;
  }
  let data: Buffer;
  try {
    data = await readFile(resolved);
  } catch {
    notFound(reply);
    return;
  }
  reply.header("content-type", contentTypeFor(resolved));
  reply.send(data);
}
