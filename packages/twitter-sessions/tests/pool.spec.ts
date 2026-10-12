import { NoSessionsError, SessionKind } from "@tseer/types";
import { describe, expect, it } from "vitest";
import { SessionPool, snowflakeToEpoch } from "../src/pool.ts";
import { createSession } from "../src/session.ts";
import { GRAPH_USER_TWEETS_V2, HOUR_IN_SECONDS, resolveApi } from "../src/types.ts";

const NOW = 1_760_000_000;

function cookie(id: string, over: Partial<ReturnType<typeof createSession>> = {}) {
  return createSession({
    kind: SessionKind.cookie,
    id,
    username: `user${id}`,
    authToken: "auth",
    ct0: "ct0",
    ...over,
  });
}

function oauth(id: string, over: Partial<ReturnType<typeof createSession>> = {}) {
  return createSession({
    kind: SessionKind.oauth,
    id,
    username: `oauth${id}`,
    oauthToken: `${id}-token`,
    oauthSecret: "secret",
    ...over,
  });
}

const DUAL = { oauth: "gql/oauth", cookie: "gql/cookie" };

function makePool(sessions: ReturnType<typeof createSession>[], options = {}) {
  return new SessionPool(sessions, { now: () => NOW, random: () => 0, ...options });
}

function at(pool: SessionPool, index: number): ReturnType<typeof createSession> {
  const session = pool.all()[index];
  if (session === undefined) throw new Error(`fixture is missing session at index ${index}`);
  return session;
}

describe("resolveApi", () => {
  it("maps the dual oauth/cookie endpoints by session kind", () => {
    expect(resolveApi(DUAL, SessionKind.oauth)).toBe("gql/oauth");
    expect(resolveApi(DUAL, SessionKind.cookie)).toBe("gql/cookie");
    expect(resolveApi("single", SessionKind.oauth)).toBe("single");
  });
});

describe("lease", () => {
  it("leases a ready session and increments pending", async () => {
    const pool = makePool([cookie("1")]);
    const lease = await pool.lease(DUAL);
    expect(lease.api).toBe("gql/cookie");
    expect(lease.released).toBe(false);
    expect(lease.account.pending).toBe(1);
  });

  it("skips sessions missing credentials", async () => {
    const pool = makePool([cookie("1", { authToken: "" })]);
    await expect(pool.lease(DUAL)).rejects.toBeInstanceOf(NoSessionsError);
  });

  it("respects the concurrency cap (nitter's `pending > maxConcurrentReqs`)", async () => {
    const pool = makePool([cookie("1")], { maxConcurrentReqs: 2 });
    const a = await pool.lease(DUAL);
    const b = await pool.lease(DUAL);
    const c = await pool.lease(DUAL);
    expect(a.account.pending).toBe(3);
    expect(b.account.id).toBe("1");
    expect(c.account.id).toBe("1");
    await expect(pool.lease(DUAL)).rejects.toBeInstanceOf(NoSessionsError);
    pool.release(c);
    await expect(pool.lease(DUAL)).resolves.toBeTruthy();
  });

  it("throws NoSessionsError on an empty pool", async () => {
    await expect(makePool([]).lease(DUAL)).rejects.toBeInstanceOf(NoSessionsError);
  });

  it("waits for a release when leaseTimeoutMs is set", async () => {
    const pool = makePool([cookie("1")], { maxConcurrentReqs: 1, leaseTimeoutMs: 500 });
    const held = await pool.lease(DUAL);
    held.account.pending = 5;
    const pending = pool.lease(DUAL);
    setTimeout(() => {
      held.account.pending = 0;
      pool.release(held);
    }, 20);
    const lease = await pending;
    expect(lease.account.id).toBe("1");
  });
});

describe("release", () => {
  it("decrements pending once and records rate-limit headers", async () => {
    const pool = makePool([cookie("1")]);
    const lease = await pool.lease(DUAL);
    pool.release(lease, { limit: 50, remaining: 42, reset: NOW + 900 });
    expect(lease.account.pending).toBe(0);
    expect(lease.account.apis.get("gql/cookie")).toEqual({
      limit: 50,
      remaining: 42,
      reset: NOW + 900,
    });
  });

  it("is idempotent for a released lease", async () => {
    const pool = makePool([cookie("1")]);
    const lease = await pool.lease(DUAL);
    pool.release(lease);
    lease.account.pending = 3;
    pool.release(lease);
    expect(lease.account.pending).toBe(3);
  });
});

describe("setRateLimit race guard", () => {
  it("ignores a stale-window update with more remaining", () => {
    const pool = makePool([cookie("1")]);
    const session = cookie("1");
    session.apis.set("api", { limit: 50, remaining: 10, reset: NOW + 100 });
    pool.setRateLimit(session, "api", { limit: 50, remaining: 40, reset: NOW + 50 });
    expect(session.apis.get("api")).toEqual({ limit: 50, remaining: 10, reset: NOW + 100 });
  });

  it("lowers remaining within the same window", () => {
    const pool = makePool([]);
    const session = cookie("1");
    session.apis.set("api", { limit: 50, remaining: 40, reset: NOW + 100 });
    pool.setRateLimit(session, "api", { limit: 50, remaining: 12, reset: NOW + 100 });
    expect(session.apis.get("api")?.remaining).toBe(12);
  });

  it("overwrites on a newer window", () => {
    const pool = makePool([]);
    const session = cookie("1");
    session.apis.set("api", { limit: 50, remaining: 40, reset: NOW + 100 });
    pool.setRateLimit(session, "api", { limit: 50, remaining: 49, reset: NOW + 200 });
    expect(session.apis.get("api")).toEqual({ limit: 50, remaining: 49, reset: NOW + 200 });
  });
});

describe("limited state machine", () => {
  it("treats a session as limited within the hour and resets after it", () => {
    let now = NOW;
    const pool = makePool([cookie("1")], { now: () => now });
    const session = at(pool, 0);
    pool.setLimited(session, "gql/cookie");
    expect(session.limited).toBe(true);
    expect(pool.isLimited(session, "gql/cookie")).toBe(true);

    now = NOW + HOUR_IN_SECONDS + 1;
    expect(pool.isLimited(session, "gql/cookie")).toBe(false);
    expect(session.limited).toBe(false);
  });

  it("never limits graphUserTweetsV2 (nitter's exemption)", () => {
    const pool = makePool([cookie("1")]);
    const session = at(pool, 0);
    pool.setLimited(session, GRAPH_USER_TWEETS_V2);
    expect(pool.isLimited(session, GRAPH_USER_TWEETS_V2)).toBe(false);
    expect(pool.isLimited(session, "gql/cookie")).toBe(true);
  });

  it("limits a low-remaining API whose window has not reset", () => {
    const pool = makePool([cookie("1")]);
    const session = at(pool, 0);
    session.apis.set("gql/cookie", { limit: 50, remaining: 10, reset: NOW + 900 });
    expect(pool.isLimited(session, "gql/cookie")).toBe(true);
    session.apis.set("gql/cookie", { limit: 50, remaining: 11, reset: NOW + 900 });
    expect(pool.isLimited(session, "gql/cookie")).toBe(false);
    session.apis.set("gql/cookie", { limit: 50, remaining: 0, reset: NOW - 1 });
    expect(pool.isLimited(session, "gql/cookie")).toBe(false);
  });
});

describe("reportError", () => {
  it("marks limited on 88 and invalidates on expired/bad/locked tokens", async () => {
    for (const code of [89, 239, 326]) {
      const pool = makePool([cookie("1")]);
      const lease = await pool.lease(DUAL);
      pool.reportError(lease, code);
      expect(pool.size).toBe(0);
      expect(lease.released).toBe(true);
    }
    const pool = makePool([cookie("1")]);
    const lease = await pool.lease(DUAL);
    pool.reportError(lease, 88);
    expect(pool.size).toBe(1);
    expect(lease.account.limited).toBe(true);
    expect(lease.released).toBe(true);
  });
});

describe("health", () => {
  it("returns the empty-pool shape", () => {
    const health = makePool([]).health();
    expect(health.sessions.total).toBe(0);
    expect(health.sessions.oldest).toBe("1970-01-01T00:00:00Z");
    expect(health.requests).toEqual({ total: 0, apis: {} });
  });

  it("counts kinds, limits, and in-window request usage", () => {
    const pool = makePool([cookie("1"), oauth("2"), oauth("3", { limited: true })]);
    at(pool, 2).apis.set("gql/oauth", { limit: 50, remaining: 40, reset: NOW + 900 });
    at(pool, 0).apis.set("gql/cookie", { limit: 20, remaining: 5, reset: NOW + 900 });
    at(pool, 0).apis.set("stale", { limit: 20, remaining: 0, reset: NOW - 1 });

    const health = pool.health();
    expect(health.sessions.total).toBe(3);
    expect(health.sessions.limited).toBe(1);
    expect(health.sessions.oauth).toEqual({ total: 2, limited: 1 });
    expect(health.sessions.cookie).toEqual({ total: 1, limited: 0 });
    expect(health.requests.total).toBe(25);
    expect(health.requests.apis).toEqual({ "gql/oauth": 10, "gql/cookie": 15 });
  });
});

describe("debug", () => {
  it("omits sessions with no in-window API status", () => {
    const pool = makePool([cookie("1"), oauth("2")]);
    at(pool, 1).apis.set("gql/oauth", { limit: 50, remaining: 40, reset: NOW + 900 });
    expect(Object.keys(pool.debug())).toEqual(["2"]);
    expect(pool.debug()["2"]).toEqual({
      kind: SessionKind.oauth,
      apis: { "gql/oauth": { remaining: 40, reset: NOW + 900 } },
      pending: 0,
    });
  });

  it("flags limited sessions", () => {
    const pool = makePool([cookie("1")]);
    const session = at(pool, 0);
    pool.setLimited(session, "gql/cookie");
    session.apis.set("gql/cookie", { limit: 50, remaining: 0, reset: NOW + 900 });
    expect(pool.debug()["1"]?.limited).toBe(true);
  });
});

describe("snowflakeToEpoch", () => {
  it("decodes the twitter epoch from a snowflake id", () => {
    expect(snowflakeToEpoch("0")).toBe(0);
    expect(snowflakeToEpoch("")).toBe(0);
    expect(snowflakeToEpoch("not-a-number")).toBe(0);
    expect(snowflakeToEpoch("4194304")).toBeCloseTo(1288834974.658, 3);
    expect(snowflakeToEpoch("4194304000")).toBeCloseTo(1288834975.657, 3);
  });
});
