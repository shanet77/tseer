import type { HttpClient, HttpResponse } from "@tseer/http-client";
import { parsersPlugin } from "@tseer/twitter-parser";
import { createSession, SessionPool } from "@tseer/twitter-sessions";
import { SessionKind } from "@tseer/types";
import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";
import { BEARER_TOKEN_2 } from "../src/endpoints.ts";
import twitterApiPlugin from "../src/plugin.ts";

function ok(body: string): HttpResponse {
  return { status: 200, headers: {}, body, url: "https://x.com/i/api/graphql/x/y" };
}

function stubHttp(body: string): HttpClient & { calls: number } {
  const stub = {
    calls: 0,
    request: vi.fn(async (): Promise<HttpResponse> => {
      stub.calls += 1;
      return ok(body);
    }),
  };
  return stub as HttpClient & { calls: number };
}

describe("twitterApiPlugin", () => {
  it("provides ctx.twitter once accounts and http exist", async () => {
    const ctx = new Context();
    const http = stubHttp(
      '{"user_results":{"result":{"rest_id":"1","core":{"screen_name":"nasa"}}}}',
    );
    const pool = new SessionPool([
      createSession({
        kind: SessionKind.cookie,
        id: "1",
        username: "alice",
        authToken: "auth",
        ct0: "ct0",
      }),
    ]);

    ctx.provide("http", http);
    ctx.provide("accounts", pool);
    await ctx.plugin(parsersPlugin, {});
    // disableTid keeps this test off the network (no pair fetch).
    const fiber = await ctx.plugin(twitterApiPlugin, { disableTid: true });

    expect(ctx.twitter).toBeDefined();
    const user = await ctx.twitter.user("nasa");
    expect(user).toMatchObject({ id: "1", username: "nasa" });
    expect(http.calls).toBe(1);

    // Real headers flowed through: the pool recorded the endpoint's rate limit
    // only if the response headers were fed back (none here), and the lease
    // came back to zero pending.
    expect(pool.all()[0]?.pending).toBe(0);

    await fiber.dispose();
    expect(ctx.twitter).toBeUndefined();
  });

  it("selects bearer v2 + the cookie URL end to end when disableTid is set", async () => {
    const ctx = new Context();
    const seen: string[] = [];
    const http: HttpClient = {
      async request(url, options = {}) {
        seen.push(options.headers?.Authorization ?? "");
        expect(url.startsWith("https://x.com/i/api/")).toBe(true);
        return ok("{}");
      },
    };
    const pool = new SessionPool([
      createSession({ kind: SessionKind.cookie, id: "1", authToken: "a", ct0: "c" }),
    ]);
    ctx.provide("http", http);
    ctx.provide("accounts", pool);
    await ctx.plugin(parsersPlugin, {});
    await ctx.plugin(twitterApiPlugin, { disableTid: true });

    await ctx.twitter.aboutAccount("nasa");
    expect(seen).toEqual([BEARER_TOKEN_2]);
  });

  it("throws a helpful error when ctx.accounts is missing", () => {
    const ctx = new Context();
    ctx.provide("http", stubHttp("{}"));
    expect(() => twitterApiPlugin(ctx)).toThrow("ctx.accounts is not mounted");
  });

  it("throws a helpful error when ctx.parsers is missing", () => {
    const ctx = new Context();
    ctx.provide("http", stubHttp("{}"));
    ctx.provide("accounts", new SessionPool([]));
    expect(() => twitterApiPlugin(ctx)).toThrow("ctx.parsers is not mounted");
  });
});
