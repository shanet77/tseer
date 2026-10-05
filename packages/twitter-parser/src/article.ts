/**
 * Article parsing — the port of `experimental/parser/article.nim`
 * (`parseGraphArticle`). Field access mirrors the jsony structs, including
 * the rename hooks (`type` → `block_kind`/`entity_kind`, `__typename` →
 * `type_name`).
 */
import type {
  Article,
  ArticleEntity,
  ArticleMedia,
  ArticleParagraph,
  ArticleStyle,
  User,
} from "@tseer/types";
import { fromUnixSeconds, parseTwitterDate } from "./dates.ts";
import { at, entries, type Json, num, str } from "./json.ts";

/** First key with an array value (jsony exact-name fields vs snake_case upstream). */
function eachAlt(node: Json, ...keys: string[]): Json[] {
  for (const key of keys) {
    const value = at(node, key);
    if (Array.isArray(value)) return value;
  }
  return [];
}

/** First key with a numeric value. */
function numAlt(node: Json, ...keys: string[]): number {
  for (const key of keys) {
    const value = at(node, key);
    if (typeof value === "number") return value;
  }
  return 0;
}

import { parseUserResult } from "./user.ts";

function stripImageUrl(url: string): string {
  let result = url;
  if (result.startsWith("https://")) result = result.slice("https://".length);
  if (result.startsWith("pbs.twimg.com/")) result = result.slice("pbs.twimg.com/".length);
  return result;
}

/** Port of `parseGraphArticle`; `undefined` when there is no article. */
export function parseGraphArticle(json: Json): Article | undefined {
  if (typeof json === "string") {
    try {
      json = JSON.parse(json) as Json;
    } catch {
      return undefined;
    }
  }
  if (json === undefined || json === null) return undefined;

  const tweet = at(json, "data", "tweetResult", "result");
  const article = at(tweet, "article", "articleResults", "result");
  const title = str(article, "title");
  if (title.length === 0) return undefined;

  const publishedAt = numAlt(
    at(article, "metadata"),
    "first_published_at_secs",
    "firstPublishedAtSecs",
  );
  const time =
    publishedAt > 0
      ? fromUnixSeconds(publishedAt)
      : parseTwitterDate(str(tweet, "legacy", "created_at"));

  const user: User = parseUserResult(at(tweet, "core", "userResults", "result"));

  const result: Article = {
    title,
    coverImage: stripImageUrl(str(article, "cover_media", "media_info", "original_img_url")),
    user,
    time,
    stats: {
      replies: num(tweet, "legacy", "reply_count"),
      retweets: num(tweet, "legacy", "retweet_count"),
      likes: num(tweet, "legacy", "favorite_count"),
      views: 0,
    },
    paragraphs: [],
    entities: {},
    media: {},
  };

  const views = str(tweet, "views", "count");
  if (views.length > 0) {
    const parsed = Number.parseInt(views, 10);
    if (!Number.isNaN(parsed)) result.stats.views = parsed;
  }

  for (const blk of eachAlt(article, "contentState", "blocks")) {
    const paragraph: ArticleParagraph = {
      text: str(blk, "text"),
      kind: str(blk, "block_kind") || str(blk, "type"),
      inlineStyles: eachAlt(
        blk,
        "inlineStyleRanges",
        "inline_style_ranges",
      ) as unknown as ArticleStyle[],
      entityRanges: eachAlt(
        blk,
        "entityRanges",
        "entity_ranges",
      ) as unknown as import("@tseer/types").ArticleEntityRange[],
    };
    result.paragraphs.push(paragraph);
  }

  for (const [key, entry] of entries(article, "contentState", "entity_map")) {
    const parsedKey = Number.parseInt(key, 10);
    if (Number.isNaN(parsedKey)) continue;

    const entity: ArticleEntity = {
      kind: str(entry, "entity_kind") || str(entry, "type"),
      url: "",
      mediaIds: [],
      tweetId: "",
      markdown: "",
      caption: "",
    };
    switch (entity.kind) {
      case "LINK": {
        entity.url = str(entry, "data", "url");
        break;
      }
      case "MEDIA": {
        for (const mi of eachAlt(at(entry, "data"), "media_items", "mediaItems")) {
          entity.mediaIds.push(str(mi, "media_id") || str(mi, "mediaId"));
        }
        entity.caption = str(entry, "data", "caption");
        break;
      }
      case "TWEET": {
        entity.tweetId = str(entry, "data", "tweet_id") || str(entry, "data", "tweetId");
        break;
      }
      case "MARKDOWN": {
        entity.markdown = str(entry, "data", "markdown");
        break;
      }
      default: {
        break;
      }
    }
    result.entities[parsedKey] = entity;
  }

  for (const me of eachAlt(article, "media_entities")) {
    const typeName = str(me, "media_info", "type_name") || str(me, "media_info", "__typename");
    const media: ArticleMedia = { kind: typeName, url: "" };
    const videoInfo = at(me, "media_info", "video_info");
    if (videoInfo !== undefined) {
      const variants = eachAlt(videoInfo, "variants");
      if (typeName === "ApiGif") {
        const first = variants[0];
        if (first !== undefined) media.url = str(first, "url");
      } else if (typeName === "ApiVideo") {
        let bestBitrate = -1;
        for (const v of variants) {
          if (num(v, "bitrate") > bestBitrate) {
            bestBitrate = num(v, "bitrate");
            media.url = str(v, "url");
          }
        }
      }
    } else if (typeName === "ApiImage") {
      media.url = stripImageUrl(str(me, "media_info", "original_img_url"));
    }
    result.media[str(me, "media_id") || str(me, "mediaId")] = media;
  }

  return result;
}
