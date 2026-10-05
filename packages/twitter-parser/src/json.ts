/**
 * Tolerant JSON accessors — the port of nitter's `packedjson` accessor
 * patterns (`js{"a","b"}.getStr`, `getInt`, `getBool(default)`, `select`,
 * `?`) that `parser.nim`/`parserutils.nim` are built on.
 *
 * Upstream parsing stays hand-rolled and tolerant (plan §2: "upstream parsing
 * stays hand-rolled tolerant accessors") — no schema validation, because X's
 * payloads routinely drop or reshape fields and the parsers must degrade to
 * empty strings/zeros instead of throwing.
 *
 * `Json` includes `undefined`, which (like `null`) means "absent"; every
 * accessor treats both as nitter's `JNull`. Missing fields default the way
 * Nim's do: strings → `""`, ints → `0`, bools → the caller's default.
 */

/** Any JSON value upstream can return; `undefined` marks absent fields. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json } | undefined;

/** nitter's `isNull`/`notNull`: true for both missing and JSON null. */
export function isNull(node: Json): boolean {
  return node === undefined || node === null;
}

/** Walk `keys` like `js{"a","b"}`; returns `undefined` as soon as a step is null. */
export function at(node: Json, ...keys: string[]): Json {
  let current = node;
  for (const key of keys) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = current[key];
    if (current === null) return undefined;
  }
  return current;
}

/** `getStr`: first string found at the path, else `""`. */
export function str(node: Json, ...keys: string[]): string {
  const value = at(node, ...keys);
  return typeof value === "string" ? value : "";
}

/** `getStr(default)`. */
export function strDef(node: Json, fallback: string, ...keys: string[]): string {
  const value = at(node, ...keys);
  return typeof value === "string" ? value : fallback;
}

/** `getInt`: numbers only (Nim returns 0 for non-int kinds), else `0`. */
export function num(node: Json, ...keys: string[]): number {
  const value = at(node, ...keys);
  return typeof value === "number" ? value : 0;
}

/** `getInt(default)`. */
export function numDef(node: Json, fallback: number, ...keys: string[]): number {
  const value = at(node, ...keys);
  return typeof value === "number" ? value : fallback;
}

/** `getBool(default)`. */
export function boolDef(node: Json, fallback: boolean, ...keys: string[]): boolean {
  const value = at(node, ...keys);
  return typeof value === "boolean" ? value : fallback;
}

/** Iterate a JSON array at the path (`for x in js{"a"}`); missing → no iterations. */
export function each(node: Json, ...keys: string[]): Json[] {
  const value = at(node, ...keys);
  return Array.isArray(value) ? value : [];
}

/** Iterate the values of a JSON object at the path (`for v in js`); missing → none. */
export function eachValue(node: Json, ...keys: string[]): Json[] {
  const value = at(node, ...keys);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.values(value);
}

/** Entries of a JSON object at the path, as `[key, value]` pairs. */
export function entries(node: Json, ...keys: string[]): [string, Json][] {
  const value = at(node, ...keys);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.entries(value);
}

/** nitter's `select(a, b, …)`: the first operand that is not null. */
export function pick(...nodes: Json[]): Json {
  for (const node of nodes) {
    if (!isNull(node)) return node;
  }
  return undefined;
}

/** nitter's `?`: return-without-value when the node is null (callers return the default). */
export function orNull(node: Json): Json {
  return isNull(node) ? undefined : node;
}

/** `getTypeName`: `__typename` with `type` as the fallback. */
export function typeName(node: Json, ...keys: string[]): string {
  const value = at(node, ...keys);
  return str(value, "__typename") || str(value, "type");
}

/** `getEntryId`: `entryId` with `entry_id` as the fallback. */
export function entryId(node: Json): string {
  return str(node, "entryId") || str(node, "entry_id");
}

/** `getStrVal` (card binding values): `{"string_value": …}` at the path. */
export function strVal(node: Json, fallback = "", ...keys: string[]): string {
  const value = at(node, ...keys);
  return str(value, "string_value") || fallback;
}

/** `getImageStr`: string at the path with the `https://` and `pbs.twimg.com/` prefixes stripped. */
export function imageStr(node: Json, ...keys: string[]): string {
  const value = at(node, ...keys);
  let result = typeof value === "string" ? value : "";
  if (result.startsWith("https://")) result = result.slice("https://".length);
  if (result.startsWith("pbs.twimg.com/")) result = result.slice("pbs.twimg.com/".length);
  return result;
}

/** `getImageVal` (card binding values): `image_value.url`, prefix-stripped. */
export function imageVal(node: Json, ...keys: string[]): string {
  return imageStr(at(node, ...keys), "image_value", "url");
}

/** `getExpandedUrl`: `expanded_url` with `url`, then the caller's fallback. */
export function expandedUrl(node: Json, fallback = ""): string {
  return str(node, "expanded_url") || str(node, "url") || fallback;
}

/**
 * `parseBiggestInt` for id strings: keeps the digit characters, `""` on
 * anything else (ids are strings in the TS port — int64 does not fit a
 * `number`, and ids travel through URLs and JSON).
 */
export function idString(value: string): string {
  return /^[0-9]+$/.test(value) ? value : "";
}

/**
 * `getId(string)`: the digits after the last dash (`tweet-1234` → `"1234"`);
 * `""` when there is no numeric id (the TS "zero id").
 */
export function idFromEntry(value: string): string {
  const start = value.lastIndexOf("-");
  return idString(start < 0 ? value : value.slice(start + 1));
}

/** `getCursor`: `content.operation.cursor.value` (timeline replace-entry cursors). */
export function cursorValue(node: Json, ...keys: string[]): string {
  return str(at(node, ...keys), "content", "operation", "cursor", "value");
}
