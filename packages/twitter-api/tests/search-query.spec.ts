import type { Query, QueryKind } from "@tseer/types";
import { describe, expect, it } from "vitest";
import { EMPTY_QUERY, genQueryParam, genQueryUrl, initQuery, VALID_FILTERS } from "../src/index.ts";
import { type GoldenQuery, golden } from "./golden.ts";

function toQuery(raw: GoldenQuery): Query {
  return { ...raw, kind: raw.kind as QueryKind };
}

describe("genQueryParam / genQueryUrl", () => {
  for (const c of golden.query) {
    it(c.label, () => {
      const query = toQuery(c.query);
      expect(genQueryParam(query, c.maxId)).toBe(c.param);
      expect(genQueryUrl(query)).toBe(c.url);
    });
  }
});

describe("initQuery", () => {
  for (const c of golden.initQuery) {
    it(c.label, () => {
      const query = initQuery(c.params, c.name);
      expect(query).toEqual(toQuery(c.query));
      expect(genQueryParam(query)).toBe(c.param);
      expect(genQueryUrl(query)).toBe(c.url);
    });
  }
});

describe("query.nim vocabulary", () => {
  it("pins validFilters order from query.nim", () => {
    expect([...VALID_FILTERS]).toEqual([
      "media",
      "images",
      "twimg",
      "videos",
      "native_video",
      "consumer_video",
      "spaces",
      "links",
      "news",
      "quote",
      "mentions",
      "replies",
      "retweets",
      "nativeretweets",
    ]);
  });

  it("pins emptyQuery", () => {
    expect(EMPTY_QUERY).toBe("include:nativeretweets");
    expect(genQueryParam(initQuery({}))).toBe(EMPTY_QUERY);
  });
});
