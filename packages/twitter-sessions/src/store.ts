import { readFileSync, watch as watchFile } from "node:fs";
import { parseSessionLine } from "./session.ts";
import type { Session } from "./types.ts";

export class SessionsFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionsFileError";
  }
}

export interface LoadedSessions {
  sessions: Session[];
  warnings: string[];
}

export function parseSessionsJsonl(text: string): LoadedSessions {
  const sessions: Session[] = [];
  const warnings: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line === "") continue;
    try {
      sessions.push(parseSessionLine(line));
    } catch (err) {
      warnings.push(`line ${i + 1}: ${(err as Error).message}`);
    }
  }
  return { sessions, warnings };
}

export function loadSessionsFile(path: string): LoadedSessions {
  if (path.endsWith(".json")) {
    throw new SessionsFileError(
      ".json is not supported, the file must be a valid JSONL file ending in .jsonl",
    );
  }
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new SessionsFileError(
        `${path} not found. This file is required to authenticate API requests.`,
      );
    }
    throw err;
  }
  return parseSessionsJsonl(text);
}

export type SessionsWatcher = () => void;

export function watchSessionsFile(
  path: string,
  onChange: (loaded: LoadedSessions) => void,
  onError?: ((err: Error) => void) | undefined,
): SessionsWatcher {
  let timer: NodeJS.Timeout | undefined;
  const reload = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      try {
        onChange(loadSessionsFile(path));
      } catch (err) {
        onError?.(err as Error);
      }
    }, 100);
  };
  const watcher = watchFile(path, { persistent: false }, reload);
  watcher.on("error", (err) => onError?.(err as Error));
  return () => {
    if (timer !== undefined) clearTimeout(timer);
    watcher.close();
  };
}
