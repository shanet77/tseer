import { Parsers } from "@tseer/twitter-parser";
import { type Query, QueryKind } from "@tseer/types";
import { describe, expect, it } from "vitest";
import { createDomainTwitterApi } from "../src/domain.ts";
import type { Json } from "../src/fetch.ts";
import type { RawTwitterApi } from "../src/fetchers.ts";

function stubRaw(handlers: Partial<RawTwitterApi>): RawTwitterApi {
  const base: RawTwitterApi = {
    user: async () => "{}",
    userById: async () => "{}",
    aboutAccount: async () => ({}),
    tweets: async () => ({}),
    tweetsAndReplies: async () => ({}),
    media: async () => ({}),
    articles: async () => ({}),
    photoRail: async () => ({}),
    tweet: async () => ({}),
    tweetResult: async () => ({}),
    tweetByRestId: async () => ({}),
    tweetResults: async () => ({}),
    editHistory: async () => ({}),
    search: async () => ({ json: undefined, beginning: true }),
    userSearch: async () => ({ json: undefined, beginning: true }),
    listSearch: async () => ({ json: undefined, beginning: true }),
    list: async () => ({}),
    listInfo: async () => ({}),
    listBySlug: async () => ({}),
    listMembers: async () => "{}",
    followers: async () => "{}",
    following: async () => "{}",
    community: async () => ({}),
    communityInfo: async () => ({}),
    communityMedia: async () => ({}),
    communityMembers: async () => ({}),
    communityModerators: async () => ({}),
    communityHashtags: async () => ({}),
    article: async () => "{}",
    space: async () => ({}),
    broadcast: async () => ({}),
    broadcastStream: async () => undefined,
    resolve: async () => "",
  };
  return { ...base, ...handlers } as RawTwitterApi;
}

const QUERY: Query = {
  kind: QueryKind.tweets,
  view: "",
  text: "test",
  filters: [],
  includes: [],
  excludes: [],
  fromUser: [],
  since: "",
  until: "",
  minLikes: "",
  sep: "",
};

describe("createDomainTwitterApi", () => {
  it("parses users from raw fetchRaw bodies (the getGraphUser port)", async () => {
    const raw = stubRaw({
      user: async () => '{"user_results":{"result":{"rest_id":"1","core":{"screen_name":"nasa"}}}}',
    });
    const api = createDomainTwitterApi(raw, new Parsers());
    expect(await api.user("nasa")).toMatchObject({ id: "1", username: "nasa" });
  });

  it("treats non-JSON raw bodies as a miss", async () => {
    const raw = stubRaw({ user: async () => "" });
    const api = createDomainTwitterApi(raw, new Parsers());
    expect(await api.user("nasa")).toBeUndefined();
  });

  it("composes the timeline parser and keeps the pinned tweet", async () => {
    const body = {
      data: {
        user: {
          result: {
            timeline: {
              timeline: {
                instructions: [
                  {
                    type: "TimelineAddEntries",
                    entries: [
                      {
                        entryId: "tweet-5",
                        content: {
                          itemContent: {
                            tweet_results: {
                              result: { rest_id: "5", legacy: { id_str: "5", full_text: "hi" } },
                            },
                          },
                        },
                      },
                      { entryId: "cursor-bottom-C", content: { value: "C" } },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    } as unknown as Json;
    const raw = stubRaw({ tweets: async () => body });
    const api = createDomainTwitterApi(raw, new Parsers());
    const page = await api.tweets("1", "OLD");
    expect(page?.tweets.beginning).toBe(false);
    expect(page?.tweets.bottom).toBe("C");
    expect(page?.tweets.content.map((t) => t.id)).toEqual(["5"]);
  });

  it("ports the tweet two-request replies composition", async () => {
    const conversation = (ids: string[]): Json =>
      ({
        data: {
          timelineResponse: {
            instructions: [
              {
                type: "TimelineAddEntries",
                entries: ids.map((id) => ({
                  entryId: `tweet-${id}`,
                  content: {
                    itemContent: {
                      tweet_results: {
                        result: { rest_id: id, legacy: { id_str: id, full_text: `t${id}` } },
                      },
                    },
                  },
                })),
              },
            ],
          },
        },
      }) as Json;
    const raw = stubRaw({
      tweet: async (_id, cursor) =>
        (cursor ?? "").length > 0
          ? ({
              data: {
                timelineResponse: {
                  instructions: [
                    {
                      type: "TimelineAddEntries",
                      entries: [
                        {
                          entryId: "conversationthread-1",
                          content: {
                            items: [
                              {
                                entryId: "tweet-7",
                                item: {
                                  content: {
                                    tweet_results: {
                                      result: {
                                        rest_id: "7",
                                        legacy: { id_str: "7", full_text: "t7" },
                                      },
                                    },
                                  },
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            } as Json)
          : conversation(["1", "2", "3"]),
    });
    const api = createDomainTwitterApi(raw, new Parsers());

    const first = await api.tweet("1");
    expect(first?.tweet.id).toBe("1");
    expect(first?.replies.content).toHaveLength(0);
    expect(first?.replies.beginning).toBe(true);

    const paged = await api.tweet("1", "CURSOR");
    expect(paged?.replies.content[0]?.content.map((t) => t.id)).toEqual(["7"]);
    expect(paged?.replies.beginning).toBe(false);
  });

  it("ports the #1372 repeat-page clearing in search", async () => {
    const raw: RawTwitterApi = stubRaw({
      search: async () => ({ json: { data: {} } as Json, beginning: false }),
    });
    const parsers = new Parsers();
    const disposer = parsers.register("searchTweets", (json, options) => ({
      content: [{ id: "1" }],
      top: "",
      bottom: "SAME",
      beginning: (options.after ?? "").length === 0,
      query: QUERY,
      ...(json as object),
    }));
    const api = createDomainTwitterApi(raw, parsers);

    const repeated = await api.search(QUERY, "SAME");
    expect(repeated?.content).toHaveLength(0);

    const fresh = await api.search(QUERY, "DIFFERENT");
    expect(fresh?.content).toHaveLength(1);
    expect(fresh?.query.text).toBe("test");
    disposer();
  });

  it("returns an empty envelope when the query compiles to nothing", async () => {
    const raw = stubRaw({});
    const api = createDomainTwitterApi(raw, new Parsers());
    const result = await api.search({ ...QUERY, text: "" });
    expect(result).toMatchObject({ beginning: true, content: [] });
  });

  it("parses fetchRaw string bodies (list members) and passes the raw stream through", async () => {
    const body = JSON.stringify({
      data: {
        list: {
          members_timeline: {
            timeline: {
              instructions: [
                {
                  type: "TimelineAddEntries",
                  entries: [
                    {
                      entryId: "user-1",
                      content: {
                        entryType: "TimelineTimelineItem",
                        itemContent: {
                          user_results: {
                            result: { rest_id: "1", legacy: { id_str: "1", screen_name: "jack" } },
                          },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    });
    const raw = stubRaw({
      listMembers: async () => body,
      broadcastStream: async () => "https://video.twimg.com/x.m3u8",
    });
    const api = createDomainTwitterApi(raw, new Parsers());
    expect((await api.listMembers("55"))?.content.map((u) => u.username)).toEqual(["jack"]);
    expect(await api.broadcastStream("mk")).toBe("https://video.twimg.com/x.m3u8");
  });
});
