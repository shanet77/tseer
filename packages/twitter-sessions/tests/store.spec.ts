import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionKind } from "@tseer/types";
import { describe, expect, it } from "vitest";
import { loadSessionsFile, parseSessionsJsonl, SessionsFileError } from "../src/store.ts";

function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

function tempFile(contents: string, name = "sessions.jsonl"): string {
  const dir = mkdtempSync(join(tmpdir(), "tseer-sessions-"));
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

describe("parseSessionsJsonl", () => {
  it("parses the real sessions.jsonl format (cookie + oauth lines)", () => {
    const { sessions, warnings } = parseSessionsJsonl(
      [
        '{"kind": "cookie", "id": "1234567890123456789", "username": "test_user", "auth_token": "aaaaaabbbbbb", "ct0": "11111111"}',
        '{"kind": "oauth", "username": "oauth_user", "oauthToken": "1234567890-AbCdEfGhIjKl", "oauthTokenSecret": "shh"}',
        "",
      ].join("\n"),
    );
    expect(warnings).toEqual([]);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({
      kind: SessionKind.cookie,
      id: "1234567890123456789",
      username: "test_user",
      authToken: "aaaaaabbbbbb",
      ct0: "11111111",
    });
    expect(sessions[1]).toMatchObject({
      kind: SessionKind.oauth,
      id: "1234567890",
      oauthSecret: "shh",
    });
  });

  it("skips bad lines with a warning instead of aborting the file", () => {
    const { sessions, warnings } = parseSessionsJsonl(
      [
        '{"kind": "cookie", "id": "1", "auth_token": "a", "ct0": "c"}',
        "{oops",
        '{"kind": "nope"}',
      ].join("\n"),
    );
    expect(sessions).toHaveLength(1);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^line 2:/);
    expect(warnings[1]).toMatch(/^line 3:.*Unknown session kind: nope/);
  });
});

describe("loadSessionsFile", () => {
  it("loads the checked-in fixture", () => {
    const { sessions, warnings } = loadSessionsFile(fixture("sessions.jsonl"));
    expect(warnings).toEqual([]);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.kind).toBe(SessionKind.cookie);
    expect(sessions[1]?.kind).toBe(SessionKind.oauth);
  });

  it("rejects a .json path (nitter quits on this)", () => {
    const path = tempFile("{}", "sessions.json");
    expect(() => loadSessionsFile(path)).toThrow(SessionsFileError);
    expect(() => loadSessionsFile(path)).toThrow(/must be a valid JSONL file/);
  });

  it("reports a missing file as required", () => {
    expect(() => loadSessionsFile("/nonexistent/sessions.jsonl")).toThrow(
      /not found. This file is required/,
    );
  });
});
