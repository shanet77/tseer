/** Minimal `GET /about` web plugin on `node:http` (superseded by `ctx.server`). */
import { createServer, type Server } from "node:http";
import type { Context } from "cordis";

export interface AboutPluginOptions {
  address?: string | undefined;
  port?: number | undefined;
  title?: string | undefined;
}

declare module "cordis" {
  interface Context {
    /** Legacy `node:http` listener handle (superseded by `ctx.server`). */
    aboutServer?: Server | undefined;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderAbout(title: string): string {
  const safe = escapeHtml(title);
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
    `<title>About — ${safe}</title></head>` +
    `<body><main><h1>About ${safe}</h1>` +
    `<p>${safe} is a privacy-focused Twitter front-end ` +
    `(TypeScript port of <a href="https://github.com/zedeus/nitter">nitter</a>).</p>` +
    `</main></body></html>`
  );
}

export default function about(ctx: Context, options: AboutPluginOptions = {}): () => void {
  const address = options.address ?? "127.0.0.1";
  const port = options.port ?? 8080;
  const server = createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/about" || req.url === "/about/")) {
      const body = renderAbout(options.title ?? "tseer");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  });
  server.listen(port, address);
  const dispose = ctx.provide("aboutServer", server);
  return () => {
    dispose();
    server.close();
  };
}
