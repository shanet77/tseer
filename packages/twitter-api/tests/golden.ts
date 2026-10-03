/**
 * Typed loader for `fixtures/golden.json` — generated from nitter @ 376f149
 * by `fixtures/generate_goldens.nim` (see the header there for regeneration).
 * CI never runs the generator; the JSON is committed (plan §6).
 */
import { readFileSync } from "node:fs";

/** A `Query` as serialized by the harness (`kind` is the Nim enum name). */
export interface GoldenQuery {
  kind: string;
  view: string;
  text: string;
  filters: string[];
  includes: string[];
  excludes: string[];
  fromUser: string[];
  since: string;
  until: string;
  minLikes: string;
  sep: string;
}

export interface GoldenQueryCase {
  label: string;
  query: GoldenQuery;
  maxId: string;
  param: string;
  url: string;
}

export interface GoldenInitCase {
  label: string;
  params: Record<string, string>;
  name: string;
  query: GoldenQuery;
  param: string;
  url: string;
}

export interface GoldenUrlCase {
  label: string;
  cookie: string;
  oauth: string;
}

export interface GoldenEncodeUrlCase {
  input: string;
  usePlus: boolean;
  output: string;
}

export interface GoldenEncodeQueryCase {
  params: [string, string][];
  usePlus: boolean;
  omitEq: boolean;
  sep: string;
  output: string;
}

export interface GoldenSubstCase {
  label: string;
  template: string;
  args: string[];
  output?: string;
  error?: string;
}

export interface Golden {
  meta: { nitterCommit: string; generator: string };
  constants: Record<string, string>;
  encodeUrl: GoldenEncodeUrlCase[];
  encodeQuery: GoldenEncodeQueryCase[];
  subst: GoldenSubstCase[];
  urls: GoldenUrlCase[];
  query: GoldenQueryCase[];
  initQuery: GoldenInitCase[];
}

export const golden = JSON.parse(
  readFileSync(new URL("./fixtures/golden.json", import.meta.url), "utf8"),
) as Golden;
