import { describe, expect, it } from "vitest";
import * as endpoints from "../src/endpoints.ts";
import { EMPTY_QUERY } from "../src/search-query.ts";
import { golden } from "./golden.ts";

describe("endpoints constants", () => {
  const actual: Record<string, string> = { ...endpoints, EMPTY_QUERY };

  it("exports exactly the golden's constant set", () => {
    expect(Object.keys(actual).sort()).toEqual(Object.keys(golden.constants).sort());
  });

  for (const [name, value] of Object.entries(golden.constants)) {
    it(`matches nitter's ${name}`, () => {
      expect(actual[name]).toBe(value);
    });
  }
});
