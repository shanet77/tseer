// Per-visitor follow list. The instance's [Home] follows list is the default;
// once a visitor follows or unfollows anyone, the full resulting list is
// snapshotted into the `follows` cookie and used instead of the default.

export const FOLLOWS_PREF = "follows";
export const MAX_FOLLOWS = 150;

// Twitter usernames are [A-Za-z0-9_]. Restricting to that keeps cookie values
// free of `;`/`,`/`=` (cookies are written unencoded) and lets `.` serve as a
// separator that survives the comma-joined ?prefs= export.
const USERNAME = /^[A-Za-z0-9_]{1,50}$/;
const SEPARATOR = ".";

export function isValidUsername(name: string): boolean {
  return USERNAME.test(name);
}

/** Trim, strip a leading `@`, drop invalid names, dedupe case-insensitively, cap. */
export function normalizeFollows(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const follows: string[] = [];
  for (const raw of list) {
    const name = raw.trim().replace(/^@/, "");
    if (!isValidUsername(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    follows.push(name);
  }
  return follows.slice(0, MAX_FOLLOWS);
}

/** Parse the cookie/`?prefs=` wire format (`a.b.c`). */
export function decodeFollows(value: string): string[] {
  return normalizeFollows(value.split(SEPARATOR));
}

export function encodeFollows(follows: readonly string[]): string {
  return normalizeFollows(follows).join(SEPARATOR);
}

/** Parse free-form user input from the settings textarea (newlines, commas, spaces). */
export function parseFollowsInput(text: string): string[] {
  return normalizeFollows(text.split(/[\s,.]+/));
}

export function sameFollows(a: readonly string[], b: readonly string[]): boolean {
  const left = normalizeFollows(a);
  const right = normalizeFollows(b);
  return (
    left.length === right.length &&
    left.every((name, i) => name.toLowerCase() === right[i]?.toLowerCase())
  );
}

export function isFollowing(follows: readonly string[], username: string): boolean {
  const key = username.toLowerCase();
  return follows.some((name) => name.toLowerCase() === key);
}

export function addFollow(follows: readonly string[], username: string): string[] {
  if (isFollowing(follows, username)) return normalizeFollows(follows);
  return normalizeFollows([...follows, username]);
}

export function removeFollow(follows: readonly string[], username: string): string[] {
  const key = username.toLowerCase();
  return normalizeFollows(follows.filter((name) => name.toLowerCase() !== key));
}
