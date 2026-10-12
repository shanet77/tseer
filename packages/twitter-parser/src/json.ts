export type Json = string | number | boolean | null | Json[] | { [key: string]: Json } | undefined;

export function isNull(node: Json): boolean {
  return node === undefined || node === null;
}

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

export function str(node: Json, ...keys: string[]): string {
  const value = at(node, ...keys);
  return typeof value === "string" ? value : "";
}

export function strDef(node: Json, fallback: string, ...keys: string[]): string {
  const value = at(node, ...keys);
  return typeof value === "string" ? value : fallback;
}

export function num(node: Json, ...keys: string[]): number {
  const value = at(node, ...keys);
  return typeof value === "number" ? value : 0;
}

export function numDef(node: Json, fallback: number, ...keys: string[]): number {
  const value = at(node, ...keys);
  return typeof value === "number" ? value : fallback;
}

export function boolDef(node: Json, fallback: boolean, ...keys: string[]): boolean {
  const value = at(node, ...keys);
  return typeof value === "boolean" ? value : fallback;
}

export function each(node: Json, ...keys: string[]): Json[] {
  const value = at(node, ...keys);
  return Array.isArray(value) ? value : [];
}

export function eachValue(node: Json, ...keys: string[]): Json[] {
  const value = at(node, ...keys);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.values(value);
}

export function entries(node: Json, ...keys: string[]): [string, Json][] {
  const value = at(node, ...keys);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.entries(value);
}

export function pick(...nodes: Json[]): Json {
  for (const node of nodes) {
    if (!isNull(node)) return node;
  }
  return undefined;
}

export function orNull(node: Json): Json {
  return isNull(node) ? undefined : node;
}

export function typeName(node: Json, ...keys: string[]): string {
  const value = at(node, ...keys);
  return str(value, "__typename") || str(value, "type");
}

export function entryId(node: Json): string {
  return str(node, "entryId") || str(node, "entry_id");
}

export function strVal(node: Json, fallback = "", ...keys: string[]): string {
  const value = at(node, ...keys);
  return str(value, "string_value") || fallback;
}

export function imageStr(node: Json, ...keys: string[]): string {
  const value = at(node, ...keys);
  let result = typeof value === "string" ? value : "";
  if (result.startsWith("https://")) result = result.slice("https://".length);
  if (result.startsWith("pbs.twimg.com/")) result = result.slice("pbs.twimg.com/".length);
  return result;
}

export function imageVal(node: Json, ...keys: string[]): string {
  return imageStr(at(node, ...keys), "image_value", "url");
}

export function expandedUrl(node: Json, fallback = ""): string {
  return str(node, "expanded_url") || str(node, "url") || fallback;
}

export function idString(value: string): string {
  return /^[0-9]+$/.test(value) ? value : "";
}

export function idFromEntry(value: string): string {
  const start = value.lastIndexOf("-");
  return idString(start < 0 ? value : value.slice(start + 1));
}

export function cursorValue(node: Json, ...keys: string[]): string {
  return str(at(node, ...keys), "content", "operation", "cursor", "value");
}
