import { RankingMode, SessionKind } from "@tseer/types";
import { describe, expect, it } from "vitest";
import {
  ARTICLE_FIELD_TOGGLES,
  GRAPH_ABOUT_ACCOUNT,
  GRAPH_AUDIO_SPACE,
  GRAPH_BROADCAST,
  GRAPH_COMMUNITY,
  GRAPH_COMMUNITY_HASHTAGS,
  GRAPH_COMMUNITY_MEDIA,
  GRAPH_COMMUNITY_MEMBERS,
  GRAPH_COMMUNITY_MODERATORS,
  GRAPH_COMMUNITY_TWEETS,
  GRAPH_FOLLOWERS,
  GRAPH_LIST_BY_ID,
  GRAPH_LIST_MEMBERS,
  GRAPH_LIST_TWEETS,
  GRAPH_SEARCH_TIMELINE,
  GRAPH_TWEET,
  GRAPH_TWEET_RESULT,
  GRAPH_TWEET_RESULT_BY_REST_ID,
  GRAPH_TWEET_RESULTS_BY_REST_IDS,
  GRAPH_USER,
  GRAPH_USER_ARTICLES,
  GRAPH_USER_BY_ID,
  GRAPH_USER_MEDIA,
  GRAPH_USER_MEDIA_V2,
  GRAPH_USER_TWEETS_AND_REPLIES,
  GRAPH_USER_TWEETS_AND_REPLIES_V2,
  GRAPH_USER_TWEETS_V2,
  GRAPH_USER_V2,
  TWEET_DETAIL_FIELD_TOGGLES,
} from "../src/endpoints.ts";
import type { Json } from "../src/fetch.ts";
import { createTwitterApi, type TwitterApiFetchers } from "../src/fetchers.ts";
import { initQuery } from "../src/search-query.ts";
import type { ApiReq } from "../src/urls.ts";

function recordingFetcher(jsonResult: Json = { ok: true }) {
  const json: ApiReq[] = [];
  const raw: ApiReq[] = [];
  const fetcher: TwitterApiFetchers = {
    fetch: (req) => {
      json.push(req);
      return Promise.resolve(jsonResult);
    },
    fetchRaw: (req) => {
      raw.push(req);
      return Promise.resolve("<raw>");
    },
  };
  return { json, raw, fetcher };
}

function side(req: ApiReq, kind: SessionKind = SessionKind.cookie) {
  return kind === SessionKind.oauth ? req.oauth : req.cookie;
}

function variables(req: ApiReq, kind: SessionKind = SessionKind.cookie): string {
  return side(req, kind).params.find(([key]) => key === "variables")?.[1] ?? "";
}

function hasParam(req: ApiReq, name: string, kind: SessionKind = SessionKind.cookie): boolean {
  return side(req, kind).params.some(([key]) => name === key);
}

describe("createTwitterApi", () => {
  describe("guards", () => {
    it("skips fetches the way nitter's early returns do", async () => {
      const { json, raw, fetcher } = recordingFetcher();
      const api = createTwitterApi(fetcher);

      expect(await api.user("")).toBeUndefined();
      expect(await api.userById("")).toBeUndefined();
      expect(await api.userById("12a")).toBeUndefined();
      expect(await api.tweets("")).toBeUndefined();
      expect(await api.tweet("")).toBeUndefined();
      expect(await api.list("")).toBeUndefined();
      expect(await api.followers("")).toBeUndefined();
      expect(await api.community("")).toBeUndefined();
      expect(await api.article("")).toBeUndefined();
      expect(await api.space("")).toBeUndefined();
      expect(await api.broadcast("")).toBeUndefined();
      expect(await api.broadcastStream("")).toBeUndefined();
      expect(json).toHaveLength(0);
      expect(raw).toHaveLength(0);
    });

    it("accepts an all-digit user id", async () => {
      const { raw, fetcher } = recordingFetcher();
      const api = createTwitterApi(fetcher);
      await api.userById("123456");
      expect(raw).toHaveLength(1);
      expect(side(raw[0] as ApiReq).endpoint).toBe(GRAPH_USER_BY_ID);
      expect(variables(raw[0] as ApiReq)).toContain('"userId":"123456"');
    });
  });

  describe("user", () => {
    it("ports getGraphUser's dual URL and cookie-side field toggles", async () => {
      const { raw, fetcher } = recordingFetcher();
      const api = createTwitterApi(fetcher);
      await api.user("nasa");

      const req = raw[0] as ApiReq;
      expect(side(req, SessionKind.cookie).endpoint).toBe(GRAPH_USER);
      expect(variables(req, SessionKind.cookie)).toBe(
        '{"screen_name":"nasa","withGrokTranslatedBio":false}',
      );
      expect(
        side(req, SessionKind.cookie).params.find(([key]) => key === "fieldToggles")?.[1],
      ).toBe(TWEET_DETAIL_FIELD_TOGGLES);
      expect(side(req, SessionKind.oauth).endpoint).toBe(GRAPH_USER_V2);
      expect(variables(req, SessionKind.oauth)).toBe('{"screen_name":"nasa"}');
      expect(hasParam(req, "fieldToggles", SessionKind.oauth)).toBe(false);
    });
  });

  describe("timelines", () => {
    it("maps each TimelineKind onto its endpoint with the cursor fragment", async () => {
      const { json, fetcher } = recordingFetcher();
      const api = createTwitterApi(fetcher);

      await api.tweets("42");
      expect(side(json[0] as ApiReq).endpoint).toBe(GRAPH_USER_TWEETS_V2);
      expect(hasParam(json[0] as ApiReq, "fieldToggles")).toBe(true);

      await api.tweetsAndReplies("42", "scroll:abc");
      const replies = json[1] as ApiReq;
      expect(side(replies, SessionKind.cookie).endpoint).toBe(GRAPH_USER_TWEETS_AND_REPLIES);
      expect(side(replies, SessionKind.oauth).endpoint).toBe(GRAPH_USER_TWEETS_AND_REPLIES_V2);
      expect(side(replies, SessionKind.oauth).skipTid).toBe(true);
      expect(side(replies, SessionKind.cookie).skipTid).toBe(false);
      expect(variables(replies)).toContain('"cursor":"scroll:abc"');

      await api.media("42");
      expect(side(json[2] as ApiReq, SessionKind.cookie).endpoint).toBe(GRAPH_USER_MEDIA);
      expect(side(json[2] as ApiReq, SessionKind.oauth).endpoint).toBe(GRAPH_USER_MEDIA_V2);

      await api.articles("42");
      expect(side(json[3] as ApiReq).endpoint).toBe(GRAPH_USER_ARTICLES);
    });
  });

  describe("search", () => {
    it("compiles the query and pins the variables key order", async () => {
      const { json, fetcher } = recordingFetcher();
      const api = createTwitterApi(fetcher);

      const result = await api.search(initQuery({ f: "top", q: "hello" }));

      expect(result.beginning).toBe(true);
      const req = json[0] as ApiReq;
      expect(side(req).endpoint).toBe(GRAPH_SEARCH_TIMELINE);
      expect(variables(req)).toBe(
        '{"rawQuery":"include:nativeretweets hello","count":20,"querySource":"typed_query",' +
          '"product":"Top","withGrokTranslatedBio":true,"withQuickPromoteEligibilityTweetFields":false}',
      );
    });

    it.each([
      ["media without fromUser", { f: "media", q: "x" }, undefined, "Media"],
      ["media with fromUser", { f: "media", q: "x" }, "nasa", "Latest"],
      ["tweets", { f: "tweets", q: "x" }, undefined, "Latest"],
    ])("maps %s to product %s", async (_label, params, name, product) => {
      const { json, fetcher } = recordingFetcher();
      const api = createTwitterApi(fetcher);
      await api.search(initQuery(params, name));
      expect(variables(json[0] as ApiReq)).toContain(`"product":"${product}"`);
    });

    it("passes a scroll cursor through and reports beginning only when empty", async () => {
      const { json, fetcher } = recordingFetcher();
      const api = createTwitterApi(fetcher);

      const first = await api.search(initQuery({ q: "x" }), "scroll:1");
      expect(first.beginning).toBe(false);
      expect(variables(json[0] as ApiReq)).toContain('"cursor":"scroll:1"');

      await api.search(initQuery({ q: "x" }));
      expect(variables(json[1] as ApiReq)).not.toContain('"cursor"');
    });

    it("converts a maxid: cursor into a max_id query operand (#1372)", async () => {
      const { json, fetcher } = recordingFetcher();
      const api = createTwitterApi(fetcher);

      await api.search(initQuery({ q: "x" }), "maxid:999");

      const rawQuery = JSON.parse(variables(json[0] as ApiReq)) as { rawQuery: string };
      expect(rawQuery.rawQuery.endsWith(" max_id:999")).toBe(true);
      expect(variables(json[0] as ApiReq)).not.toContain('"cursor"');
    });

    it("skips the request for an empty or emptyQuery compile", async () => {
      const { json, fetcher } = recordingFetcher();
      const api = createTwitterApi(fetcher);

      const viaEmptyQuery = await api.search(initQuery({}));
      expect(viaEmptyQuery).toEqual({ json: undefined, beginning: true });

      const viaSkippedInclude = await api.search(initQuery({ "e-nativeretweets": "" }));
      expect(viaSkippedInclude).toEqual({ json: undefined, beginning: true });

      expect(json).toHaveLength(0);
    });
  });

  describe("product search", () => {
    it("uses query.text verbatim with product People/Lists", async () => {
      const { json, fetcher } = recordingFetcher();
      const api = createTwitterApi(fetcher);

      await api.userSearch(initQuery({ f: "users", q: "bob" }));
      expect(variables(json[0] as ApiReq)).toContain('"product":"People"');
      expect(variables(json[0] as ApiReq)).toContain('"rawQuery":"bob"');

      await api.listSearch(initQuery({ f: "lists", q: "news" }));
      expect(variables(json[1] as ApiReq)).toContain('"product":"Lists"');
      expect(variables(json[1] as ApiReq)).toContain('"rawQuery":"news"');
    });

    it("skips the request when the search text is empty", async () => {
      const { json, fetcher } = recordingFetcher();
      const api = createTwitterApi(fetcher);
      expect(await api.userSearch(initQuery({ f: "users" }))).toEqual({
        json: undefined,
        beginning: true,
      });
      expect(json).toHaveLength(0);
    });
  });

  describe("lists and connections", () => {
    it("ports list timelines, metadata, and members", async () => {
      const { json, raw, fetcher } = recordingFetcher();
      const api = createTwitterApi(fetcher);

      await api.list("9", "scroll:c");
      const timeline = json[0] as ApiReq;
      expect(side(timeline).endpoint).toBe(GRAPH_LIST_TWEETS);
      expect(variables(timeline)).toContain('"rest_id":"9"');
      expect(variables(timeline)).toContain('"cursor":"scroll:c"');

      await api.listInfo("9");
      expect(side(json[1] as ApiReq).endpoint).toBe(GRAPH_LIST_BY_ID);
      expect(variables(json[1] as ApiReq)).toBe('{"listId":"9"}');

      await api.listMembers("9");
      const members = raw[0] as ApiReq;
      expect(side(members).endpoint).toBe(GRAPH_LIST_MEMBERS);
      expect(variables(members)).toBe(
        '{"listId":"9","withBirdwatchPivots":false,"withDownvotePerspective":false,' +
          '"withReactionsMetadata":false,"withReactionsPerspective":false}',
      );

      await api.listMembers("9", "scroll:c");
      expect(variables(raw[1] as ApiReq)).toContain('"cursor":"scroll:c"');
    });

    it("ports followers with the cursor appended last", async () => {
      const { raw, fetcher } = recordingFetcher();
      const api = createTwitterApi(fetcher);

      await api.followers("5");
      expect(side(raw[0] as ApiReq).endpoint).toBe(GRAPH_FOLLOWERS);
      expect(variables(raw[0] as ApiReq)).toBe(
        '{"userId":"5","count":20,"includePromotedContent":false,"withGrokTranslatedBio":true}',
      );

      await api.followers("5", "scroll:c");
      expect(variables(raw[1] as ApiReq)).toContain('"cursor":"scroll:c"');
    });
  });

  describe("communities", () => {
    it("ports the community timeline family", async () => {
      const { json, fetcher } = recordingFetcher();
      const api = createTwitterApi(fetcher);

      await api.community("9");
      expect(side(json[0] as ApiReq).endpoint).toBe(GRAPH_COMMUNITY_TWEETS);
      expect(variables(json[0] as ApiReq)).toContain('"communityId":"9"');
      expect(variables(json[0] as ApiReq)).toContain('"rankingMode":"Relevance"');

      await api.community("9", "scroll:c", RankingMode.Recency);
      expect(variables(json[1] as ApiReq)).toContain('"cursor":"scroll:c"');
      expect(variables(json[1] as ApiReq)).toContain('"rankingMode":"Recency"');

      await api.communityInfo("9");
      expect(side(json[2] as ApiReq).endpoint).toBe(GRAPH_COMMUNITY);
      expect(variables(json[2] as ApiReq)).toBe('{"communityId":"9"}');

      await api.communityMedia("9");
      expect(side(json[3] as ApiReq).endpoint).toBe(GRAPH_COMMUNITY_MEDIA);

      await api.communityHashtags("9", 'tag"with\\quotes');
      expect(side(json[4] as ApiReq).endpoint).toBe(GRAPH_COMMUNITY_HASHTAGS);
      expect(variables(json[4] as ApiReq)).toContain('"hashtags":["tagwithquotes"]');
    });

    it("ports the slice requests: variables only, cursor null when absent", async () => {
      const { json, fetcher } = recordingFetcher();
      const api = createTwitterApi(fetcher);

      await api.communityMembers("9");
      const req = json[0] as ApiReq;
      expect(side(req).endpoint).toBe(GRAPH_COMMUNITY_MEMBERS);
      expect(hasParam(req, "features")).toBe(false);
      expect(variables(req)).toBe('{"communityId":"9","cursor":null}');

      await api.communityMembers("9", "scroll:c");
      expect(variables(json[1] as ApiReq)).toBe('{"communityId":"9","cursor":"scroll:c"}');

      await api.communityModerators("9");
      expect(side(json[2] as ApiReq).endpoint).toBe(GRAPH_COMMUNITY_MODERATORS);
      expect(variables(json[2] as ApiReq)).toBe('{"communityId":"9","cursor":null}');
    });
  });

  describe("tweets, articles, spaces", () => {
    it("ports the tweet fetchers and their toggles", async () => {
      const { json, raw, fetcher } = recordingFetcher();
      const api = createTwitterApi(fetcher);

      await api.tweet("77", "scroll:c", RankingMode.Recency);
      const conversation = json[0] as ApiReq;
      expect(side(conversation).endpoint).toBe(GRAPH_TWEET);
      expect(variables(conversation)).toContain('"postId":"77"');
      expect(variables(conversation)).toContain('"ranking_mode":"Recency"');
      expect(variables(conversation)).toContain('"cursor":"scroll:c"');

      await api.tweetResult("77");
      expect(side(json[1] as ApiReq).endpoint).toBe(GRAPH_TWEET_RESULT);
      expect(variables(json[1] as ApiReq)).toBe('{"rest_id":"77"}');

      await api.tweetByRestId("77");
      expect(side(json[2] as ApiReq).endpoint).toBe(GRAPH_TWEET_RESULT_BY_REST_ID);
      expect(side(json[2] as ApiReq).params.find(([key]) => key === "fieldToggles")?.[1]).toBe(
        ARTICLE_FIELD_TOGGLES,
      );

      await api.tweetResults(["1", "2"]);
      expect(side(json[3] as ApiReq).endpoint).toBe(GRAPH_TWEET_RESULTS_BY_REST_IDS);
      expect(variables(json[3] as ApiReq)).toContain('"tweetIds":["1","2"]');

      await api.editHistory("77");
      expect(variables(json[4] as ApiReq)).toContain('"tweetId":"77"');

      await api.article("77");
      const article = raw[0] as ApiReq;
      expect(side(article).endpoint).toBe(GRAPH_TWEET_RESULT_BY_REST_ID);
      expect(variables(article)).toContain('"tweetId":"77"');
      expect(side(article).params.find(([key]) => key === "fieldToggles")?.[1]).toBe(
        ARTICLE_FIELD_TOGGLES,
      );
    });

    it("ports about/space/broadcast/photo-rail variables", async () => {
      const { json, fetcher } = recordingFetcher();
      const api = createTwitterApi(fetcher);

      await api.aboutAccount("nasa");
      expect(side(json[0] as ApiReq).endpoint).toBe(GRAPH_ABOUT_ACCOUNT);
      expect(variables(json[0] as ApiReq)).toBe('{"screenName":"nasa"}');

      await api.space("123");
      expect(side(json[1] as ApiReq).endpoint).toBe(GRAPH_AUDIO_SPACE);
      expect(variables(json[1] as ApiReq)).toBe(
        '{"id":"123","isMetatagsQuery":false,"withReplays":true,"withListeners":true}',
      );

      await api.broadcast("bc1");
      expect(side(json[2] as ApiReq).endpoint).toBe(GRAPH_BROADCAST);
      expect(variables(json[2] as ApiReq)).toBe('{"id":"bc1"}');

      await api.photoRail("5");
      expect(side(json[3] as ApiReq, SessionKind.cookie).endpoint).toBe(GRAPH_USER_MEDIA);
      expect(variables(json[3] as ApiReq)).toContain('"userId":"5"');
      expect(variables(json[3] as ApiReq)).toContain('"count":100');
    });

    it("digs the broadcast stream url out of source", async () => {
      const custom = (json: Json): TwitterApiFetchers => ({
        fetch: () => Promise.resolve(json),
        fetchRaw: () => Promise.resolve(""),
      });
      const api = createTwitterApi(
        custom({ source: { noRedirectPlaybackUrl: "https://video.x/master.m3u8" } }),
      );
      expect(await api.broadcastStream("mk")).toBe("https://video.x/master.m3u8");

      const fallback = createTwitterApi(custom({ source: { location: "https://cdn.x/f" } }));
      expect(await fallback.broadcastStream("mk")).toBe("https://cdn.x/f");

      const missing = createTwitterApi(custom({ source: {} }));
      expect(await missing.broadcastStream("mk")).toBeUndefined();
    });
  });
});
