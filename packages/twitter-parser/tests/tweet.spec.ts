import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CardKind, MediaKind, VideoType } from "@tseer/types";
import { describe, expect, it } from "vitest";
import { parseUnifiedCard } from "../src/card.ts";
import type { Json } from "../src/json.ts";
import {
  newTweet,
  parseGraphTweet,
  parseGraphTweetResult,
  parseGraphTweetResults,
  parseTweet,
  parseTweetByRestId,
} from "../src/tweet.ts";

function fixture(name: string): Json {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), "utf8"),
  ) as Json;
}

describe("tweet parsers", () => {
  it("ports parseTweet: text expansion, stats, photo media", () => {
    const tweet = parseTweet(fixture("tweet_legacy"));
    expect(tweet.id).toBe("1001");
    expect(tweet.threadId).toBe("1001");
    expect(tweet.available).toBe(true);
    expect(tweet.time).toBe("2023-08-09T12:34:56.000Z");
    expect(tweet.user.id).toBe("1234567890");
    expect(tweet.stats).toEqual({ replies: 2, retweets: 3, likes: 4, views: 500 });
    expect(tweet.text).toBe(
      'check <a href="https://example.com/article">example.com/article</a> mention <a href="/bob_1" title="Bob">@bob_1</a> and <a href="/search?f=tweets&q=%23tag">#tag</a> <a href="https://pic.twitter.com/abc">pic.twitter.com/abc</a>',
    );
    expect(tweet.media).toHaveLength(1);
    expect(tweet.media[0]).toEqual({
      kind: MediaKind.photoMedia,
      photo: { url: "media/abc.jpg", altText: "a photo" },
    });
  });

  it("ports parseGraphTweet with the user from core", () => {
    const legacy = fixture("tweet_legacy");
    const tweet = parseGraphTweet({
      rest_id: "1001",
      core: {
        user_results: {
          result: {
            rest_id: "1234567890",
            legacy: {
              id_str: "1234567890",
              screen_name: "jack",
              name: "Jack",
            },
          },
        },
      },
      legacy,
    });
    expect(tweet.id).toBe("1001");
    expect(tweet.user.username).toBe("jack");
    expect(tweet.user.fullname).toBe("Jack");
  });

  it("ports video parsing (variants, mp4 resolution, attribution)", () => {
    const tweet = parseTweet(fixture("tweet_video"));
    const video = tweet.media[0];
    expect(video?.kind).toBe(MediaKind.videoMedia);
    if (video?.kind !== MediaKind.videoMedia) throw new Error("not a video");
    expect(video.video.thumb).toBe("ext_tw_video_thumb/1.jpg");
    expect(video.video.durationMs).toBe(15000);
    expect(video.video.title).toBe("Shared video");
    expect(video.video.available).toBe(true);
    expect(video.video.variants).toEqual([
      {
        contentType: VideoType.mp4,
        url: "https://video.twimg.com/ext_tw_video/1/pu/vid/720x1280/a.mp4",
        bitrate: 1000000,
        resolution: 1280,
      },
      {
        contentType: VideoType.m3u8,
        url: "https://video.twimg.com/ext_tw_video/1/pu/pl/a.m3u8",
        bitrate: 0,
        resolution: 0,
      },
    ]);
    expect(tweet.attribution?.username).toBe("clapper");
    expect(tweet.attributionLink).toBe("/clapper002");
  });

  it("ports parseCard (summary, t.co rewrite, image)", () => {
    const tweet = parseGraphTweet(fixture("tweet_card"));
    const card = tweet.card;
    expect(card).toMatchObject({
      kind: CardKind.summary,
      url: "https://blog.example.com/post",
      title: "A blog post",
      dest: "blog.example.com",
      text: "some text",
      image: "card_img/1.jpg",
    });
  });

  it("ports parsePoll (values, leader, votes, future deadline)", () => {
    const tweet = parseGraphTweet(fixture("tweet_poll"));
    expect(tweet.poll).toMatchObject({
      options: ["Yes", "No"],
      values: [10, 5],
      votes: 15,
      leader: 0,
    });
    expect(tweet.poll?.status).toMatch(/ days$/);
  });

  it("ports the tombstone and unavailable shapes", () => {
    const tombstone = parseGraphTweet({
      __typename: "TweetTombstone",
      tombstone: { richText: { text: "This Tweet was deleted. Learn more" } },
    });
    expect(tombstone.available).toBe(false);
    expect(tombstone.text).toBe("This Tweet was deleted.");

    expect(parseGraphTweet({ __typename: "TweetUnavailable" })).toEqual(newTweet());
    expect(parseGraphTweet(undefined)).toEqual(newTweet());
  });

  it("ports quoted tweets and retweets", () => {
    const quote = parseGraphTweet({
      rest_id: "2000",
      legacy: {
        id_str: "2000",
        full_text: "quoting",
        is_quote_status: true,
        quoted_status_id_str: "1001",
      },
      quoted_status_result: {
        result: { rest_id: "1001", legacy: { id_str: "1001", full_text: "original" } },
      },
    });
    expect(quote.quote?.id).toBe("1001");
    expect(quote.quote?.text).toBe("original");

    const retweet = parseGraphTweet({
      rest_id: "2001",
      legacy: {
        id_str: "2001",
        full_text: "rt",
        retweeted_status_result: {
          result: { rest_id: "1001", legacy: { id_str: "1001", full_text: "original" } },
        },
      },
    });
    expect(retweet.retweet?.id).toBe("1001");
  });

  it("ports the unwrappers", () => {
    const payload = {
      data: {
        tweet_result: { result: { rest_id: "1001", legacy: { id_str: "1001", full_text: "x" } } },
      },
    };
    expect(parseGraphTweetResult(payload).id).toBe("1001");
    expect(parseGraphTweetResult({ data: {} }).available).toBe(false);

    const restId = {
      data: { tweetResult: { result: { rest_id: "2002", legacy: { id_str: "2002" } } } },
    };
    expect(parseTweetByRestId(restId).id).toBe("2002");

    const batch = {
      data: {
        tweetResult: [{ result: { rest_id: "1", legacy: { id_str: "1" } } }, { result: null }],
      },
    };
    expect(parseGraphTweetResults(batch)).toHaveLength(1);
  });

  it("ports the unified card parser", () => {
    const card = parseUnifiedCard(JSON.stringify(fixture("unified_card")));
    expect(card).toMatchObject({
      kind: CardKind.summary,
      url: "https://promo.example.com",
      dest: "Topic",
      image: "media/promo.jpg",
    });
  });
});
