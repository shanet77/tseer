import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getOauthHeader, percentEncode } from "../src/oauth1.ts";

interface OauthGoldenCase {
  label: string;
  url: string;
  token: string;
  tokenSecret: string;
  timestamp: string;
  header: string;
}

const golden = JSON.parse(
  readFileSync(new URL("./fixtures/oauth1_golden.json", import.meta.url), "utf8"),
) as OauthGoldenCase[];

describe("getOauthHeader", () => {
  it("matches the Nim-generated golden fixtures byte for byte", () => {
    expect(golden.length).toBeGreaterThan(0);
    for (const c of golden) {
      const now = () => Number(c.timestamp) * 1000;
      expect(getOauthHeader(c.url, c.token, c.tokenSecret, { now })).toBe(c.header);
    }
  });

  it("emits nitter's exact field order with nonce 0", () => {
    const header = getOauthHeader("https://x.com/i/api/graphql/abc/User", "tok", "sec", {
      now: () => 1_700_000_000_000,
    });
    const fields = header
      .replace(/^OAuth /, "")
      .split(", ")
      .map((part) => part.split("=")[0]);
    expect(fields).toEqual([
      "oauth_consumer_key",
      "oauth_signature_method",
      "oauth_timestamp",
      "oauth_nonce",
      "oauth_signature",
      "oauth_token",
      "oauth_version",
    ]);
    expect(header).toContain('oauth_nonce="0"');
    expect(header).toContain('oauth_timestamp="1700000000"');
  });

  it("omits oauth_token for an empty token", () => {
    const header = getOauthHeader("https://api.x.com/1.1/x.json", "", "", {
      now: () => 1_700_000_000_000,
    });
    expect(header).not.toContain("oauth_token=");
  });
});

describe("percentEncode", () => {
  it("passes unreserved bytes through and uppercases hex", () => {
    expect(percentEncode("abcXYZ019-._~")).toBe("abcXYZ019-._~");
    expect(percentEncode(" ")).toBe("%20");
    expect(percentEncode(",")).toBe("%2C");
    expect(percentEncode("+")).toBe("%2B");
    expect(percentEncode("=")).toBe("%3D");
    expect(percentEncode("/")).toBe("%2F");
  });

  it("encodes UTF-8 bytes", () => {
    expect(percentEncode("é")).toBe("%C3%A9");
    expect(percentEncode("☃")).toBe("%E2%98%83");
  });
});
