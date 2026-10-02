import { SessionKind } from "@tseer/types";
import { describe, expect, it } from "vitest";
import {
  createSession,
  hasCredentials,
  parseSession,
  parseSessionLine,
  prettySession,
} from "../src/session.ts";

describe("parseSession", () => {
  it("defaults an empty kind to oauth and splits the id from the token", () => {
    const session = parseSession({
      username: "someone",
      oauthToken: "1234567890-AbCdEfGhIjKlMnOpQrStUvWxYz",
      oauthTokenSecret: "shh",
    });
    expect(session.kind).toBe(SessionKind.oauth);
    expect(session.id).toBe("1234567890");
    expect(session.username).toBe("someone");
    expect(session.oauthToken).toBe("1234567890-AbCdEfGhIjKlMnOpQrStUvWxYz");
    expect(session.oauthSecret).toBe("shh");
    expect(session.pending).toBe(0);
    expect(session.limited).toBe(false);
    expect(session.apis.size).toBe(0);
  });

  it("parses a cookie session with its id field", () => {
    const session = parseSession({
      kind: "cookie",
      id: "42",
      username: "cookie_user",
      authToken: "auth",
      ct0: "ct0",
    });
    expect(session.kind).toBe(SessionKind.cookie);
    expect(session.id).toBe("42");
    expect(session.authToken).toBe("auth");
    expect(session.ct0).toBe("ct0");
  });

  it("defaults a missing/invalid cookie id to 0", () => {
    expect(parseSession({ kind: "cookie", authToken: "a", ct0: "b" }).id).toBe("0");
    expect(parseSession({ kind: "cookie", id: "not-a-number", authToken: "a", ct0: "b" }).id).toBe(
      "0",
    );
  });

  it("rejects an unknown kind", () => {
    expect(() => parseSession({ kind: "bearer" })).toThrow("Unknown session kind: bearer");
  });
});

describe("parseSessionLine", () => {
  it("rejects blank, non-JSON, and non-object lines", () => {
    expect(() => parseSessionLine("   ")).toThrow("empty session line");
    expect(() => parseSessionLine("{oops")).toThrow("invalid session JSON");
    expect(() => parseSessionLine("[1,2]")).toThrow("not a JSON object");
  });
});

describe("hasCredentials", () => {
  it("requires the credential fields for each kind", () => {
    expect(hasCredentials(createSession({ kind: SessionKind.oauth, oauthToken: "t" }))).toBe(true);
    expect(hasCredentials(createSession({ kind: SessionKind.oauth }))).toBe(false);
    expect(
      hasCredentials(createSession({ kind: SessionKind.cookie, authToken: "a", ct0: "c" })),
    ).toBe(true);
    expect(hasCredentials(createSession({ kind: SessionKind.cookie, authToken: "a" }))).toBe(false);
    expect(hasCredentials(createSession({ kind: SessionKind.cookie, ct0: "c" }))).toBe(false);
  });
});

describe("prettySession", () => {
  it("prefers id + username, then username, then id, then unknown", () => {
    expect(prettySession(createSession({ id: "7", username: "bob" }))).toBe("oauth 7 (bob)");
    expect(prettySession(createSession({ id: "0", username: "bob" }))).toBe("oauth bob");
    expect(prettySession(createSession({ id: "7", username: "" }))).toBe("oauth 7");
    expect(prettySession(createSession({ id: "0", username: "" }))).toBe("oauth <unknown>");
    expect(prettySession(undefined)).toBe("<null>");
  });
});
