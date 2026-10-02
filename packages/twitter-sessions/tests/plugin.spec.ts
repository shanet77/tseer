import { SessionKind } from "@tseer/types";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";
import twitterSessionsPlugin from "../src/plugin.ts";
import { createSession } from "../src/session.ts";
import { SessionsFileError } from "../src/store.ts";

const DUAL = { oauth: "gql/oauth", cookie: "gql/cookie" };

describe("twitterSessionsPlugin", () => {
  it("provides ctx.accounts from inline sessions", async () => {
    const ctx = new Context();
    await ctx.plugin(twitterSessionsPlugin, {
      sessions: [
        createSession({
          kind: SessionKind.cookie,
          id: "1",
          username: "alice",
          authToken: "auth",
          ct0: "ct0",
        }),
      ],
      watch: false,
    });
    expect(ctx.accounts.size).toBe(1);
    const lease = await ctx.accounts.lease(DUAL);
    expect(lease.account.username).toBe("alice");
    expect(lease.api).toBe("gql/cookie");
    expect(ctx.accounts.health().sessions.total).toBe(1);
  });

  it("emits account/limited and account/invalidated", async () => {
    const ctx = new Context();
    await ctx.plugin(twitterSessionsPlugin, {
      sessions: [
        createSession({ kind: SessionKind.cookie, id: "1", authToken: "a", ct0: "c" }),
        createSession({ kind: SessionKind.cookie, id: "2", authToken: "a", ct0: "c" }),
      ],
      watch: false,
    });
    const limited: string[] = [];
    const invalidated: string[] = [];
    ctx.on("account/limited", (_account, api) => limited.push(api));
    ctx.on("account/invalidated", (account) => invalidated.push(account.id));

    // Two sessions: the first is marked limited (code 88), the second is
    // invalidated outright (code 89) so the pool drains to empty.
    const lease = await ctx.accounts.lease(DUAL);
    ctx.accounts.reportError(lease, 88);
    expect(limited).toEqual(["gql/cookie"]);
    expect(ctx.accounts.size).toBe(2);

    // The pool picks randomly, so target the session that is still usable.
    const target = ctx.accounts.all().find((s) => !s.limited);
    if (target === undefined) throw new Error("expected one un-limited session");
    const lease2 = await ctx.accounts.lease(DUAL);
    ctx.accounts.reportError({ ...lease2, account: target }, 89);
    expect(invalidated).toEqual([target.id]);
    expect(ctx.accounts.size).toBe(1);
  });

  it("boots with an empty pool when the sessions file is missing", async () => {
    const ctx = new Context();
    await ctx.plugin(twitterSessionsPlugin, { path: "/nonexistent/sessions.jsonl", watch: false });
    expect(ctx.accounts.size).toBe(0);
  });

  it("unloads cleanly and drops ctx.accounts", async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(twitterSessionsPlugin, {
      sessions: [createSession({ kind: SessionKind.cookie, id: "1", authToken: "a", ct0: "c" })],
      watch: false,
    });
    expect(ctx.accounts.size).toBe(1);
    await fiber.dispose();
    expect(ctx.accounts).toBeUndefined();
  });
});

describe("store errors", () => {
  it("exposes a typed error for bad paths", () => {
    expect(new SessionsFileError("boom")).toBeInstanceOf(Error);
  });
});
