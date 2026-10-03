import { RankingMode, SessionKind } from "@tseer/types";
import { describe, expect, it } from "vitest";
import {
  COMMUNITY_MEMBERS_VARS,
  GRAPH_COMMUNITY_MEMBERS,
  GRAPH_SEARCH_TIMELINE,
  REST_LIVE_STREAM,
} from "../src/endpoints.ts";
import {
  apiReq,
  communitySliceReq,
  cursorParam,
  mediaUrl,
  restReq,
  subst,
  tweetDetailUrl,
  userArticlesUrl,
  userTweetsAndRepliesUrl,
  userTweetsUrl,
  userUrl,
} from "../src/index.ts";
import type { ApiReq } from "../src/urls.ts";
import { toUrl } from "../src/urls.ts";
import { golden } from "./golden.ts";

describe("subst", () => {
  for (const c of golden.subst) {
    it(c.label, () => {
      if (c.error !== undefined) {
        expect(() => subst(c.template, c.args)).toThrow(c.error);
      } else {
        expect(subst(c.template, c.args)).toBe(c.output);
      }
    });
  }
});

// One entry per golden urls case; the labels double as the coverage contract.
const builders: Record<string, () => ApiReq> = {
  "userUrl simple": () => userUrl("nasa"),
  "userUrl underscore": () => userUrl("foo_bar"),
  "userUrl json chars": () => userUrl('a"b\\c'),
  "mediaUrl no cursor": () => mediaUrl("12345", ""),
  "mediaUrl cursor": () => mediaUrl("12345", cursorParam("scroll:abc")),
  "mediaUrl cursor json chars": () => mediaUrl("12345", cursorParam('cur:"x"\\y')),
  "userTweetsUrl no cursor": () => userTweetsUrl("12345", ""),
  "userTweetsUrl cursor": () => userTweetsUrl("12345", cursorParam("scroll:abc")),
  "userTweetsAndRepliesUrl no cursor": () => userTweetsAndRepliesUrl("12345", ""),
  "userTweetsAndRepliesUrl cursor": () =>
    userTweetsAndRepliesUrl("12345", cursorParam("scroll:abc")),
  "userArticlesUrl no cursor": () => userArticlesUrl("12345", ""),
  "userArticlesUrl cursor": () => userArticlesUrl("12345", cursorParam("scroll:abc")),
  "tweetDetailUrl default": () => tweetDetailUrl("12345", ""),
  "tweetDetailUrl recency cursor": () =>
    tweetDetailUrl("12345", cursorParam("scroll:abc"), RankingMode.Recency),
  "tweetDetailUrl likes": () => tweetDetailUrl("12345", "", RankingMode.Likes),
  "restReq no params": () => restReq(`${REST_LIVE_STREAM}abc123`),
  "restReq with params": () => restReq("1.1/foo.json", [["a", "b c"]]),
  "apiReq search variables": () =>
    apiReq(GRAPH_SEARCH_TIMELINE, '{"rawQuery":"nasa from:alice","count":20}'),
  communitySliceReq: () =>
    communitySliceReq(GRAPH_COMMUNITY_MEMBERS, subst(COMMUNITY_MEMBERS_VARS, ["777", "null"])),
};

describe("ApiReq builders", () => {
  it("registers a builder for every golden case", () => {
    expect(golden.urls.map((c) => c.label).sort()).toEqual(Object.keys(builders).sort());
  });

  for (const c of golden.urls) {
    it(c.label, () => {
      const build = builders[c.label];
      if (build === undefined) throw new Error(`no builder registered for ${c.label}`);
      const req = build();
      expect(toUrl(req, SessionKind.cookie)).toBe(c.cookie);
      expect(toUrl(req, SessionKind.oauth)).toBe(c.oauth);
    });
  }

  it("sets skipTid only on the oauth side of userTweetsAndRepliesUrl", () => {
    const req = userTweetsAndRepliesUrl("12345", "");
    expect(req.cookie.skipTid).toBe(false);
    expect(req.oauth.skipTid).toBe(true);
  });

  it("orders genParams as variables, features, fieldToggles", () => {
    const req = apiReq("X/Y", "{}", "{}");
    expect(req.cookie.params.map(([key]) => key)).toEqual([
      "variables",
      "features",
      "fieldToggles",
    ]);
  });
});
