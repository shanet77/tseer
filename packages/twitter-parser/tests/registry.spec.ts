import { QueryKind } from "@tseer/types";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";
import type { ParseFn, ParserKind } from "../src/plugin.ts";
import parsersPlugin from "../src/plugin.ts";
import { Parsers } from "../src/registry.ts";

const QUERY = {
  kind: QueryKind.tweets,
  view: "",
  text: "x",
  filters: [],
  includes: [],
  excludes: [],
  fromUser: [],
  since: "",
  until: "",
  minLikes: "",
  sep: "",
};

describe("Parsers registry", () => {
  it("parses every registered kind", () => {
    const parsers = new Parsers();
    expect(parsers.has("user")).toBe(true);
    expect(
      parsers.parse("user", {
        user_results: { result: { rest_id: "1", core: { screen_name: "a" } } },
      }),
    ).toMatchObject({ id: "1", username: "a" });
    expect(parsers.parse("tweetResult", { data: {} })).toMatchObject({ available: false });
    expect(parsers.parse("space", { data: {} })).toMatchObject({ id: "" });
    expect(parsers.parse("tweetResults", { data: { tweetResult: [] } })).toEqual([]);
    expect(parsers.parse("photoRail", { data: {} })).toEqual([]);
  });

  it("attaches the query and after options to envelopes", () => {
    const parsers = new Parsers();
    const page = parsers.parse("searchTweets", {}, { after: "CUR", query: QUERY });
    expect(page).toMatchObject({ beginning: false, bottom: "" });
    expect((page as { query: { kind: QueryKind } }).query.kind).toBe(QueryKind.tweets);
  });

  it("supports overriding a kind and restoring it via the disposer", () => {
    const parsers = new Parsers();
    const disposer = parsers.register("user" as ParserKind, () => "overridden");
    expect(parsers.parse("user", {})).toBe("overridden");
    disposer();
    expect(parsers.parse("user", {})).toMatchObject({ username: "" });
  });

  it("returns undefined for unregistered kinds", () => {
    const parsers = new Parsers();
    expect(parsers.parse("nonexistent" as ParserKind, {})).toBeUndefined();
  });

  it("lets an override replace a default (the seam's point)", () => {
    const parsers = new Parsers();
    const override: ParseFn = (json) => json;
    parsers.register("timeline", override);
    expect(parsers.parse("timeline", { custom: true })).toEqual({ custom: true });
  });
});

describe("parsersPlugin", () => {
  it("provides ctx.parsers and unwinds on dispose", async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(parsersPlugin, {});
    expect(ctx.parsers.has("conversation")).toBe(true);

    await fiber.dispose();
    expect(ctx.get("parsers" as never)).toBeUndefined();
  });
});
