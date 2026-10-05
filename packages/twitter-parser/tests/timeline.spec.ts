import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { QueryKind } from "@tseer/types";
import { describe, expect, it } from "vitest";
import type { Json } from "../src/json.ts";
import {
  parseAudioSpace,
  parseBroadcastInfo,
  parseGraphCommunity,
  parseGraphList,
  parseGraphSearchList,
} from "../src/misc.ts";
import {
  parseGraphCommunityMembers,
  parseGraphCommunityTimeline,
  parseGraphConversation,
  parseGraphEditHistory,
  parseGraphFollowers,
  parseGraphListMembers,
  parseGraphPhotoRail,
  parseGraphSearchLists,
  parseGraphSearchTweets,
  parseGraphSearchUsers,
  parseGraphTimeline,
} from "../src/timeline.ts";

function fixture(name: string): Json {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), "utf8"),
  ) as Json;
}

describe("timeline parsers", () => {
  it("ports parseGraphTimeline (entries, conversation modules, pin, bottom cursor)", () => {
    const { tweets, pinned } = parseGraphTimeline(fixture("timeline"), "");
    expect(tweets.beginning).toBe(true);
    expect(tweets.content.map((t) => t.id)).toEqual(["1001", "2000"]);
    expect(tweets.bottom).toBe("XYZCURSOR");
    expect(pinned?.id).toBe("3000");
    expect(pinned?.pinned).toBe(true);
    expect(pinned?.text).toBe("pinned tweet");

    const page2 = parseGraphTimeline(fixture("timeline"), "XYZCURSOR");
    expect(page2.tweets.beginning).toBe(false);
    expect(page2.pinned).toBeUndefined();
  });

  it("ports parseGraphConversation (before, self thread, tombstone, cursor)", () => {
    const conv = parseGraphConversation(fixture("conversation"), "1001");
    expect(conv.tweet.id).toBe("1001");
    expect(conv.tweet.text).toBe("the main tweet");
    expect(conv.before.content.map((t) => t.id)).toEqual(["999", "998"]);
    expect(conv.after.content.map((t) => t.id)).toEqual(["2001"]);
    expect(conv.replies.bottom).toBe("CONVCURSOR");
  });

  it("ports the timeline cursor for an empty after-cursor", () => {
    expect(parseGraphTimeline({}, "").tweets.bottom).toBe("");
    expect(parseGraphTimeline({}, "").tweets.beginning).toBe(true);
  });

  it("ports search parsing for tweets, users and lists (replace-entry cursor)", () => {
    const tweets = parseGraphSearchTweets(fixture("search_tweets"));
    expect(tweets.content.map((t) => t.id)).toEqual(["1001"]);
    expect(tweets.bottom).toBe("NEWCURSOR");
    expect(tweets.beginning).toBe(true);

    const users = parseGraphSearchUsers(fixture("search_users"));
    expect(users.content.map((u) => u.username)).toEqual(["jack"]);
    expect(users.bottom).toBe("UCURSOR");
    expect(users.query.kind).toBe(QueryKind.users);

    expect(parseGraphSearchLists({}, "").content).toHaveLength(0);
  });

  it("ports the photo rail (16 cap)", () => {
    const rail = parseGraphPhotoRail({
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
                        entryId: "tweet-1",
                        content: {
                          itemContent: {
                            tweet_results: {
                              result: {
                                rest_id: "1",
                                legacy: {
                                  id_str: "1",
                                  full_text: "pic",
                                  extended_entities: {
                                    media: [
                                      {
                                        __typename: "photo",
                                        media_url_https: "https://pbs.twimg.com/media/1.jpg",
                                      },
                                    ],
                                  },
                                },
                              },
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
      },
    });
    expect(rail).toEqual([{ url: "media/1.jpg", tweetId: "1", color: "" }]);
  });

  it("ports parseGraphEditHistory", () => {
    const history = parseGraphEditHistory(
      {
        data: {
          tweet_result_by_rest_id: {
            result: {
              edit_history_timeline: {
                timeline: {
                  instructions: [
                    {
                      type: "TimelineAddEntries",
                      entries: [
                        {
                          entryId: "latestTweet",
                          content: {
                            items: [
                              {
                                entryId: "tweet-2",
                                item: {
                                  content: {
                                    tweet_results: {
                                      result: {
                                        rest_id: "2",
                                        legacy: { id_str: "2", full_text: "newest" },
                                      },
                                    },
                                  },
                                },
                              },
                            ],
                          },
                        },
                        {
                          entryId: "staleTweets",
                          content: {
                            items: [
                              {
                                entryId: "tweet-1",
                                item: {
                                  content: {
                                    tweet_results: {
                                      result: {
                                        rest_id: "1",
                                        legacy: { id_str: "1", full_text: "oldest" },
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
            },
          },
        },
      },
      "2",
    );
    expect(history.latest.text).toBe("newest");
    expect(history.history.map((t) => t.text)).toEqual(["oldest"]);
  });

  it("ports list members and followers parsing", () => {
    const members = parseGraphListMembers(fixture("list_members"), "");
    expect(members.content.map((u) => u.username)).toEqual(["jack"]);
    expect(members.bottom).toBe("MCURSOR");
    expect(members.query.kind).toBe(QueryKind.userList);

    const followers = parseGraphFollowers(fixture("followers"), "x", QueryKind.followers);
    expect(followers.bottom).toBe("FCURSOR");
    expect(followers.content).toHaveLength(1);
    expect(followers.query.kind).toBe(QueryKind.followers);
  });
});

describe("entity metadata parsers", () => {
  it("ports parseGraphList and parseGraphSearchList", () => {
    const list = parseGraphList(fixture("list"));
    expect(list).toMatchObject({
      id: "555",
      name: "My List",
      description: "a list",
      members: 3,
      username: "",
      userId: "",
    });

    const searchList = parseGraphSearchList({
      id_str: "556",
      name: "Another",
      user_results: {
        result: { rest_id: "1234567890", core: { screen_name: "jack", name: "Jack" } },
      },
      followers_context: "some context",
      facepile_urls: ["a.jpg", "b.jpg"],
    });
    expect(searchList).toMatchObject({
      list: { id: "556", username: "jack" },
      followersContext: "some context",
      facepiles: ["a.jpg", "b.jpg"],
    });
  });

  it("ports parseGraphCommunity", () => {
    const community = parseGraphCommunity(fixture("community"));
    expect(community).toMatchObject({
      id: "777",
      name: "Community",
      description: "a community",
      memberCount: 50,
      joinPolicy: "Open",
      category: "Tech",
      banner: "community_banner/1.jpg",
      createdAt: "2023-11-14T22:13:20.000Z",
      creator: { username: "jack" },
      rules: [{ name: "Be nice", description: "no meanness" }],
      hashtags: ["tseer"],
    });
    expect(parseGraphCommunity({})).toMatchObject({ id: "" });
  });

  it("ports parseAudioSpace", () => {
    const space = parseAudioSpace(fixture("space"));
    expect(space).toMatchObject({
      id: "SP1",
      title: "Space title",
      state: "RUNNING",
      mediaKey: "mk1",
      totalLiveListeners: 12,
      availableForReplay: false,
      startTime: "2023-11-14T22:13:20.000Z",
      creator: { username: "jack" },
    });
    expect(space.admins[0]).toMatchObject({ username: "jack", isVerified: true });
    expect(space.speakers).toHaveLength(0);
  });

  it("ports parseBroadcastInfo", () => {
    const broadcast = parseBroadcastInfo(fixture("broadcast"));
    expect(broadcast).toMatchObject({
      id: "BC1",
      title: "Live now",
      state: "RUNNING",
      thumb: "https://pbs.twimg.com/bc.jpg",
      mediaKey: "bckey",
      totalWatched: 100,
      startTime: "2023-11-14T22:13:20.000Z",
      endTime: "2023-11-14T23:13:20.000Z",
      replayStart: 30,
      availableForReplay: true,
      user: { username: "jack" },
    });
    expect(broadcast.m3u8Url).toBe("");
  });

  it("ports parseGraphCommunityTimeline and members", () => {
    const timeline = parseGraphCommunityTimeline({
      data: {
        communityResults: {
          result: {
            ranked_community_timeline: {
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
                              result: {
                                rest_id: "5",
                                legacy: { id_str: "5", full_text: "community post" },
                              },
                            },
                          },
                        },
                      },
                      { entryId: "cursor-bottom-CC", content: { value: "CC" } },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    });
    expect(timeline.content.map((t) => t.id)).toEqual(["5"]);
    expect(timeline.bottom).toBe("CC");

    const members = parseGraphCommunityMembers({
      data: {
        communityResults: {
          result: {
            members_slice: {
              items_results: [
                { result: { rest_id: "1234567890", core: { screen_name: "jack" } } },
                { result: {} },
              ],
              slice_info: { next_cursor: "NC" },
            },
          },
        },
      },
    });
    expect(members.content.map((u) => u.username)).toEqual(["jack"]);
    expect(members.bottom).toBe("NC");
  });
});
