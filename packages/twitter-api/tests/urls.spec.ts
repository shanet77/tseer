import { describe, expect, it } from "vitest";
import { encodeQuery, encodeUrl } from "../src/urls.ts";
import { golden } from "./golden.ts";

describe("encodeUrl", () => {
  for (const c of golden.encodeUrl) {
    it(`${JSON.stringify(c.input)} (usePlus=${c.usePlus})`, () => {
      expect(encodeUrl(c.input, c.usePlus)).toBe(c.output);
    });
  }
});

describe("encodeQuery", () => {
  for (const c of golden.encodeQuery) {
    it(`${JSON.stringify(c.params)} (sep=${JSON.stringify(c.sep)})`, () => {
      expect(encodeQuery(c.params, c.usePlus, c.omitEq, c.sep)).toBe(c.output);
    });
  }
});
