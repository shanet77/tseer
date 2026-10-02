import { SessionKind } from "@tseer/types";
import type { Session } from "./types.ts";

export interface RawSession {
  kind?: string | undefined;
  id?: string | undefined;
  username?: string | undefined;
  oauthToken?: string | undefined;
  oauthTokenSecret?: string | undefined;
  authToken?: string | undefined;
  ct0?: string | undefined;
  /** Snake_case spellings, as written by the session generators in the wild. */
  auth_token?: string | undefined;
  oauth_token?: string | undefined;
  oauth_token_secret?: string | undefined;
}

export class SessionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionParseError";
  }
}

function str(value: string | undefined): string {
  return value ?? "";
}

function toId(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "" || !/^\d+$/.test(trimmed)) return "0";
  return trimmed;
}

function emptyState(): Session {
  return {
    kind: SessionKind.oauth,
    id: "0",
    username: "",
    oauthToken: "",
    oauthSecret: "",
    authToken: "",
    ct0: "",
    apis: new Map(),
    pending: 0,
    limited: false,
    limitedAt: 0,
  };
}

export function createSession(init: Partial<Session>): Session {
  return { ...emptyState(), ...init };
}

export function parseSession(raw: RawSession): Session {
  const kind = str(raw.kind) === "" ? SessionKind.oauth : str(raw.kind);
  if (kind === SessionKind.oauth) {
    const token = str(raw.oauthToken) || str(raw.oauth_token);
    const dash = token.indexOf("-");
    const idPart = dash === -1 ? token : token.slice(0, dash);
    return createSession({
      kind: SessionKind.oauth,
      id: toId(idPart),
      username: str(raw.username),
      oauthToken: token,
      oauthSecret: str(raw.oauthTokenSecret) || str(raw.oauth_token_secret),
    });
  }
  if (kind === SessionKind.cookie) {
    return createSession({
      kind: SessionKind.cookie,
      id: toId(str(raw.id)),
      username: str(raw.username),
      authToken: str(raw.authToken) || str(raw.auth_token),
      ct0: str(raw.ct0),
    });
  }
  throw new SessionParseError(`Unknown session kind: ${kind}`);
}

export function parseSessionLine(line: string): Session {
  const trimmed = line.trim();
  if (trimmed === "") throw new SessionParseError("empty session line");
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch (err) {
    throw new SessionParseError(`invalid session JSON: ${(err as Error).message}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SessionParseError("session line is not a JSON object");
  }
  return parseSession(value as RawSession);
}

export function hasCredentials(session: Session): boolean {
  if (session.kind === SessionKind.oauth) return session.oauthToken.length > 0;
  return session.authToken.length > 0 && session.ct0.length > 0;
}

export function prettySession(session: Session | undefined): string {
  if (!session) return "<null>";
  let label: string;
  if (BigInt(session.id) > 0n && session.username.length > 0)
    label = `${session.id} (${session.username})`;
  else if (session.username.length > 0) label = session.username;
  else if (BigInt(session.id) > 0n) label = session.id;
  else label = "<unknown>";
  return `${session.kind} ${label}`;
}
