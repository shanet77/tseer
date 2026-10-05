import { createSession, type Session } from "@tseer/twitter-sessions";
import { SessionKind } from "@tseer/types";
import { describe, expect, it, vi } from "vitest";
import { BEARER_TOKEN, BEARER_TOKEN_2 } from "../src/endpoints.ts";
import { genHeaders } from "../src/headers.ts";

const GQL_URL = "https://x.com/i/api/graphql/abc/UserByScreenName?variables=x";
const REST_URL = "https://x.com/i/api/1.1/help/configuration.json";

function cookieSession(): Session {
  return createSession({
    kind: SessionKind.cookie,
    id: "1",
    username: "alice",
    authToken: "auth-token",
    ct0: "csrf-token",
  });
}

function oauthSession(): Session {
  return createSession({
    kind: SessionKind.oauth,
    id: "1",
    username: "alice",
    oauthToken: "oauth-token",
    oauthSecret: "oauth-secret",
  });
}

describe("genHeaders", () => {
  it("signs oauth sessions with Authorization only (no cookie headers)", async () => {
    const genTid = vi.fn(async () => "tid");
    const headers = await genHeaders(oauthSession(), "https://api.x.com/graphql/abc/User", false, {
      disableTid: false,
      genTid,
      now: () => 1_700_000_000_000,
    });

    expect(headers.Authorization).toMatch(/^OAuth oauth_consumer_key="/);
    expect(headers.Authorization).toContain('oauth_timestamp="1700000000"');
    expect(headers.Cookie).toBeUndefined();
    expect(headers["X-Csrf-Token"]).toBeUndefined();
    expect(headers["X-Client-Transaction-Id"]).toBeUndefined();
    expect(genTid).not.toHaveBeenCalled();
    expect(headers.Accept).toBe("*/*");
    expect(headers["User-Agent"]).toContain("Chrome/142");
    expect(headers.Origin).toBe("https://x.com");
    expect(headers.Priority).toBe("u=1, i");
  });

  it("uses bearer + tid for cookie sessions", async () => {
    const genTid = vi.fn(async () => "tid-abc");
    const headers = await genHeaders(cookieSession(), GQL_URL, false, {
      disableTid: false,
      genTid,
    });

    expect(headers.Authorization).toBe(BEARER_TOKEN);
    expect(headers["X-Client-Transaction-Id"]).toBe("tid-abc");
    expect(genTid).toHaveBeenCalledWith("/i/api/graphql/abc/UserByScreenName");
    expect(headers.Cookie).toBe("auth_token=auth-token; ct0=csrf-token");
    expect(headers["X-Csrf-Token"]).toBe("csrf-token");
    expect(headers["X-Twitter-Auth-Type"]).toBe("OAuth2Session");
    expect(headers.Referer).toBe("https://x.com/");
    expect(headers["Sec-Ch-Ua"]).toBe(
      '"Google Chrome";v="142", "Chromium";v="142", "Not A(Brand";v="24"',
    );
    expect(headers["Sec-Fetch-Mode"]).toBe("cors");
  });

  it.each([
    ["disableTid", { disableTid: true }, false],
    ["skipTid", { disableTid: false }, true],
  ])("falls back to bearer v2 on %s", async (_label, options, skipTid) => {
    const genTid = vi.fn(async () => "tid-abc");
    const headers = await genHeaders(cookieSession(), GQL_URL, skipTid, {
      disableTid: options.disableTid,
      genTid,
    });
    expect(headers.Authorization).toBe(BEARER_TOKEN_2);
    expect(headers["X-Client-Transaction-Id"]).toBeUndefined();
    expect(genTid).not.toHaveBeenCalled();
  });

  it("falls back to bearer v2 on /1.1/ paths even with tid enabled", async () => {
    const genTid = vi.fn(async () => "tid-abc");
    const headers = await genHeaders(cookieSession(), REST_URL, false, {
      disableTid: false,
      genTid,
    });
    expect(headers.Authorization).toBe(BEARER_TOKEN_2);
    expect(genTid).not.toHaveBeenCalled();
  });

  it("throws when tid is enabled but no generator is configured", async () => {
    await expect(
      genHeaders(cookieSession(), GQL_URL, false, { disableTid: false }),
    ).rejects.toThrow("no genTid configured");
  });
});
