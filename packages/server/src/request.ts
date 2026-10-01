/** Validate a route path (`/about`, `/user/:name`, never empty/relative). */
import type { FastifyRequest } from "fastify";
import type { AppRequest, HttpMethod } from "./types.ts";

export const httpMethods: readonly HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

/** Normalize a user-supplied method to uppercase; throws on unknown values. */
export function normalizeMethod(method: string): HttpMethod {
  const upper = method.toUpperCase();
  if ((httpMethods as readonly string[]).includes(upper)) return upper as HttpMethod;
  throw new Error(`server: unsupported method "${method}"`);
}

/** Validate a route path (`/about`, `/user/:name`, never empty/relative). */
export function normalizePath(path: string): string {
  if (path.length === 0 || !path.startsWith("/")) {
    throw new Error(`server: route path must start with "/", got "${path}"`);
  }
  return path;
}

/** Normalize a static prefix (`/static`); the root prefix `/` is rejected. */
export function normalizePrefix(prefix: string): string {
  if (!prefix.startsWith("/") || prefix === "/") {
    throw new Error(`server: static prefix must start with "/" and not be "/", got "${prefix}"`);
  }
  return prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
}

/** Parse a `Cookie` header into a name/value map (first value wins). */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in cookies) continue;
    cookies[name] = decodeURIComponentSafe(part.slice(eq + 1).trim());
  }
  return cookies;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function toQuery(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null) return {};
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      const last = value[value.length - 1];
      if (last !== undefined) query[key] = String(last);
    } else if (value !== undefined) {
      query[key] = String(value);
    }
  }
  return query;
}

function toParams(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null) return {};
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value !== undefined) params[key] = String(value);
  }
  return params;
}

function toHeaders(raw: unknown): Record<string, string | undefined> {
  if (typeof raw !== "object" || raw === null) return {};
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) headers[key.toLowerCase()] = value.map(String).join(", ");
    else if (value !== undefined) headers[key.toLowerCase()] = String(value);
  }
  return headers;
}

/** Map a fastify request onto the seam's `AppRequest`. */
export function toAppRequest(request: FastifyRequest): AppRequest {
  const rawUrl = request.raw.url ?? "/";
  const queryIndex = rawUrl.indexOf("?");
  return {
    method: request.method.toUpperCase(),
    path: queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex),
    rawQuery: queryIndex === -1 ? "" : rawUrl.slice(queryIndex + 1),
    query: toQuery(request.query),
    params: toParams(request.params),
    headers: toHeaders(request.headers),
    cookies: parseCookies(request.headers.cookie),
  };
}
