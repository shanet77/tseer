import { Buffer } from "node:buffer";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { RateLimitError } from "@tseer/types";
import { Context } from "cordis";
import { Agent, ProxyAgent } from "undici";
import { describe, expect, it } from "vitest";
import {
  createDispatcher,
  httpClientPlugin,
  type OutboundRequest,
  type OutboundResponse,
} from "../src/index.ts";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

async function listen(handler: Handler): Promise<{ origin: string; server: Server }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server has no port");
  return { origin: `http://127.0.0.1:${address.port}`, server };
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

describe("buffered requests", () => {
  it("performs GET/POST, normalizes headers, and parses rate-limit headers", async () => {
    const seen: {
      method?: string | undefined;
      header?: string | undefined;
      body?: string | undefined;
    } = {};
    const { origin, server } = await listen((req, res) => {
      seen.method = req.method;
      seen.header = req.headers["x-client"] as string | undefined;
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        seen.body = Buffer.concat(chunks).toString();
        res.writeHead(200, {
          "content-type": "application/json",
          "X-Custom-Header": "yes",
          "x-rate-limit-limit": "50",
          "x-rate-limit-remaining": "42",
          "x-rate-limit-reset": "1760000000",
        });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    try {
      const ctx = new Context();
      await ctx.plugin(httpClientPlugin);
      const res = await ctx.http.request(`${origin}/ping`, {
        method: "POST",
        headers: { "x-client": "tseer" },
        body: '{"q":1}',
      });

      expect(res.status).toBe(200);
      expect(res.headers["x-custom-header"]).toBe("yes");
      expect(res.url).toBe(`${origin}/ping`);
      expect(JSON.parse(res.body)).toEqual({ ok: true });
      expect(res.rateLimit).toEqual({ limit: 50, remaining: 42, reset: 1760000000 });
      expect(seen.method).toBe("POST");
      expect(seen.header).toBe("tseer");
      expect(seen.body).toBe('{"q":1}');
    } finally {
      await closeServer(server);
    }
  });

  it("decompresses gzip response bodies", async () => {
    const { origin, server } = await listen((_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip", "content-type": "application/json" });
      res.end(gzipSync(Buffer.from(JSON.stringify({ gzipped: true }))));
    });
    try {
      const ctx = new Context();
      await ctx.plugin(httpClientPlugin);
      const res = await ctx.http.request(`${origin}/gz`);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ gzipped: true });
    } finally {
      await closeServer(server);
    }
  });
});

describe("retry policy", () => {
  it("retries 503s, emits http/request and http/response per attempt, rewrites headers", async () => {
    let hits = 0;
    const receivedRewrites: (string | string[] | undefined)[] = [];
    const { origin, server } = await listen((req, res) => {
      hits++;
      receivedRewrites.push(req.headers["x-rewrite"]);
      if (hits === 1) {
        res.writeHead(503);
        res.end("nope");
      } else {
        res.writeHead(200);
        res.end("ok");
      }
    });
    try {
      const ctx = new Context();
      await ctx.plugin(httpClientPlugin, { maxRetries: 3, retryDelayMs: 0 });
      const requests: OutboundRequest[] = [];
      const responses: OutboundResponse[] = [];
      ctx.on("http/request", (req) => {
        requests.push(req);
        req.headers["x-rewrite"] = "rewritten";
      });
      ctx.on("http/response", (res) => responses.push(res));

      const res = await ctx.http.request(`${origin}/flaky`);

      expect(res.status).toBe(200);
      expect(res.body).toBe("ok");
      expect(hits).toBe(2);
      expect(receivedRewrites).toEqual(["rewritten", "rewritten"]);
      expect(requests.map((r) => r.attempt)).toEqual([1, 2]);
      expect(responses.map((r) => r.status)).toEqual([503, 200]);
      expect(responses[0]?.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await closeServer(server);
    }
  });

  it("throws RateLimitError once 429 attempts are exhausted", async () => {
    let hits = 0;
    const { origin, server } = await listen((_req, res) => {
      hits++;
      res.writeHead(429, { "content-type": "text/plain" });
      res.end("Too Many Requests");
    });
    try {
      const ctx = new Context();
      await ctx.plugin(httpClientPlugin, { maxRetries: 3, retryDelayMs: 0 });
      await expect(ctx.http.request(`${origin}/limited`)).rejects.toThrow(
        /status 429 \(attempt 3\/3\)/,
      );
      await expect(ctx.http.request(`${origin}/limited`)).rejects.toThrow(RateLimitError);
      expect(hits).toBe(6);
    } finally {
      await closeServer(server);
    }
  });

  it("treats Cloudflare HTML as retryable, or returns it when detection is off", async () => {
    const cfBody = "<!DOCTYPE html><html><head><title>Just a moment...</title></head>Cloudflare";
    let hits = 0;
    const { origin, server } = await listen((_req, res) => {
      hits++;
      res.writeHead(403, { "content-type": "text/html" });
      res.end(cfBody);
    });
    try {
      const ctx = new Context();
      await ctx.plugin(httpClientPlugin, { maxRetries: 2, retryDelayMs: 0 });

      await expect(ctx.http.request(`${origin}/challenge`)).rejects.toThrow(
        /cloudflare html \("Just a moment\..."\)/,
      );
      expect(hits).toBe(2);

      const passthrough = await ctx.http.request(`${origin}/challenge`, {
        detectCloudflare: false,
      });
      expect(passthrough.status).toBe(403);
      expect(passthrough.body).toBe(cfBody);
      expect(hits).toBe(3);
    } finally {
      await closeServer(server);
    }
  });

  it("wraps transport errors as RateLimitError", async () => {
    const ctx = new Context();
    await ctx.plugin(httpClientPlugin, { maxRetries: 1 });
    await expect(ctx.http.request("http://127.0.0.1:1/never")).rejects.toThrow(RateLimitError);
    await expect(ctx.http.request("http://127.0.0.1:1/never")).rejects.toThrow(
      /transport error:.*\[ECONNREFUSED\]/,
    );
  });

  it("times out unresponsive servers (headers timeout)", async () => {
    const { origin, server } = await listen(() => {});
    try {
      const ctx = new Context();
      await ctx.plugin(httpClientPlugin, { maxRetries: 1, timeoutMs: 100 });
      await expect(ctx.http.request(`${origin}/hang`)).rejects.toThrow(
        /\[UND_ERR_HEADERS_TIMEOUT\]/,
      );
    } finally {
      await closeServer(server);
    }
  });
});

describe("proxy transport", () => {
  it("builds a pooled Agent by default and a ProxyAgent when a proxy is set", () => {
    expect(createDispatcher({ maxConns: 5 })).toBeInstanceOf(Agent);
    expect(createDispatcher({ proxy: "http://127.0.0.1:9090" })).toBeInstanceOf(ProxyAgent);
    expect(createDispatcher()).toBeInstanceOf(Agent);
  });

  it("forwards through the configured proxy with basic Proxy-Authorization", async () => {
    let proxySeen: { url?: string | undefined; auth?: string | string[] | undefined } = {};
    const { origin, server } = await listen((req, res) => {
      proxySeen = { url: req.url, auth: req.headers["proxy-authorization"] };
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("proxied");
    });
    try {
      const ctx = new Context();
      await ctx.plugin(httpClientPlugin, { proxy: origin, proxyAuth: "user:pass" });
      const res = await ctx.http.request("http://example.invalid/whatever");

      expect(res.status).toBe(200);
      expect(res.body).toBe("proxied");
      expect(proxySeen.url).toBe("http://example.invalid/whatever");
      expect(proxySeen.auth).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
    } finally {
      await closeServer(server);
    }
  });

  it("rewrites API URLs through apiProxy (graphql paths only)", async () => {
    let seenPath: string | undefined;
    const { origin, server } = await listen((req, res) => {
      seenPath = req.url;
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    try {
      const ctx = new Context();
      await ctx.plugin(httpClientPlugin, { apiProxy: origin });
      const res = await ctx.http.request("https://x.com/i/api/graphql/QueryId");

      expect(res.status).toBe(200);
      expect(seenPath).toBe("/x.com/i/api/graphql/QueryId");
      expect(res.url).toBe(`${origin}/x.com/i/api/graphql/QueryId`);
    } finally {
      await closeServer(server);
    }
  });
});

describe("plugin lifecycle", () => {
  it("provides ctx.http and unwinds it on dispose", async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(httpClientPlugin);
    expect(ctx.get("http")).toBeDefined();

    await fiber.dispose();
    expect(ctx.get("http")).toBeUndefined();
  });
});
