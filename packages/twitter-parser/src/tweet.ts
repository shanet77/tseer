/**
 * Tweet parsers — the port of `parser.nim`'s `parseTweet`, `parseGraphTweet`,
 * `parseMediaEntities`, `parseLegacyMediaEntities`, `parseCommunityNote`,
 * and the three unwrappers (`parseGraphTweetResult`, `parseTweetByRestId`,
 * `parseGraphTweetResults`).
 *
 * The "unset" id is `""` (Nim's zero int64); `available: false` marks the
 * empty/tombstone tweets Nim builds as `Tweet()`.
 */
import { CardKind, type Media, MediaKind, type Tweet, type User, VideoType } from "@tseer/types";
import { parseCard, parsePoll, parsePromoVideo, parseVideo, parseVideoVariants } from "./card.ts";
import { fromUnixMilliseconds, parseTwitterDate } from "./dates.ts";
import {
  expandBirdwatchEntities,
  expandNoteTweetEntities,
  expandTweetEntities,
  expandTweetEntitiesV2,
} from "./entities.ts";
import {
  at,
  boolDef,
  each,
  idFromEntry,
  idString,
  imageStr,
  isNull,
  type Json,
  num,
  pick,
  str,
  strDef,
} from "./json.ts";
import { isTwitterUrl } from "./slices.ts";
import { newUser, parseGraphUser, parseUser } from "./user.ts";

/** A default-constructed `Tweet` (Nim's `Tweet()`; `available` starts false). */
export function newTweet(): Tweet {
  return {
    id: "",
    threadId: "",
    replyId: "",
    user: newUser(),
    text: "",
    time: "",
    reply: [],
    pinned: false,
    hasThread: false,
    available: false,
    tombstone: "",
    location: "",
    source: "",
    stats: { replies: 0, retweets: 0, likes: 0, views: 0 },
    attributionLink: "",
    mediaTags: [],
    media: [],
    history: [],
    note: "",
    isAd: false,
    isAI: false,
  };
}

/** Port of `parseCommunityNote`. */
function parseCommunityNote(js: Json): string {
  let result = str(js, "subtitle", "text");
  const entities = at(js, "subtitle", "entities");
  if (entities !== undefined) {
    result = expandBirdwatchEntities(result, entities);
  }
  return result;
}

function emptyUserStub(id: string): User {
  return { ...newUser(), id };
}

function addMedia(tweet: Tweet, media: Media): void {
  tweet.media.push(media);
}

/** Port of `parseLegacyMediaEntities` (legacy `extended_entities`). */
function parseLegacyMediaEntities(js: Json, result: Tweet): void {
  for (const m of each(js, "extended_entities", "media")) {
    const kind = str(m, "__typename") || str(m, "type");
    if (kind === "photo") {
      addMedia(result, {
        kind: MediaKind.photoMedia,
        photo: { url: imageStr(m, "media_url_https"), altText: str(m, "ext_alt_text") },
      });
    } else if (kind === "video") {
      addMedia(result, { kind: MediaKind.videoMedia, video: parseVideo(m) });
      const user = pick(at(m, "additional_media_info", "source_user"));
      if (user !== undefined && num(user, "id") > 0) {
        result.attribution = parseUser(user);
      } else {
        result.attribution = parseGraphUser(user);
      }
      const expanded = str(m, "expanded_url");
      if (expanded.length > 0) {
        result.attributionLink = videoPath(expanded);
      }
    } else if (kind === "animated_gif") {
      addMedia(result, {
        kind: MediaKind.gifMedia,
        gif: {
          url: imageStr(each(at(m, "video_info", "variants"))[0], "url"),
          thumb: imageStr(m, "media_url_https"),
          altText: str(m, "ext_alt_text"),
        },
      });
    }
  }
}

/** `/video/1` suffix strip (attribution links). */
function videoPath(url: string): string {
  try {
    return new URL(url).pathname.replaceAll("/video/1", "");
  } catch {
    return "";
  }
}

/** Port of `parseMediaEntities` (the V2 `media_entities` shape). */
function parseMediaEntities(js: Json, result: Tweet): void {
  const mediaEntities = each(js, "media_entities");
  if (mediaEntities.length === 0) return;

  const parsedMedia: Media[] = [];
  for (const mediaEntity of mediaEntities) {
    const mediaInfo = at(mediaEntity, "media_results", "result", "media_info");
    if (mediaInfo === undefined) continue;

    const kind = str(mediaInfo, "__typename") || str(mediaInfo, "type");
    if (kind === "ApiImage") {
      parsedMedia.push({
        kind: MediaKind.photoMedia,
        photo: {
          url: imageStr(mediaInfo, "original_img_url"),
          altText: str(mediaInfo, "alt_text"),
        },
      });
    } else if (kind === "ApiVideo") {
      const status = str(mediaEntity, "media_results", "result", "media_availability_v2", "status");
      parsedMedia.push({
        kind: MediaKind.videoMedia,
        video: {
          available: status === "Available",
          thumb: imageStr(mediaInfo, "preview_image", "original_img_url"),
          title: str(mediaInfo, "alt_text"),
          description: "",
          durationMs: num(mediaInfo, "duration_millis"),
          url: "",
          reason: "",
          playbackType: VideoType.mp4,
          variants: parseVideoVariants(at(mediaInfo, "variants")),
        },
      });

      const sourceUser = at(mediaEntity, "source_user_results", "result");
      if (sourceUser !== undefined && result.attribution === undefined) {
        const expanded = str(mediaEntity, "expanded_url");
        if (expanded.length > 0) {
          result.attributionLink = videoPath(expanded);
        }
        result.attribution = {
          ...newUser(),
          id: str(sourceUser, "rest_id"),
          fullname: str(sourceUser, "core", "name"),
          userPic: imageStr(sourceUser, "avatar", "image_url").replace("_normal", ""),
        };
      }
    } else if (kind === "ApiGif") {
      parsedMedia.push({
        kind: MediaKind.gifMedia,
        gif: {
          url: imageStr(each(at(mediaInfo, "variants"))[0], "url"),
          thumb: imageStr(mediaInfo, "preview_image", "original_img_url"),
          altText: str(mediaInfo, "alt_text"),
        },
      });
    }
  }

  if (parsedMedia.length === mediaEntities.length) {
    result.media = parsedMedia;
  }
}

/** Port of `parseTweet` (a legacy tweet object). */
export function parseTweet(
  js: Json,
  jsCard: Json = undefined,
  replyId = "",
  hasArticle = false,
): Tweet {
  if (isNull(js)) return newTweet();

  const time =
    at(js, "created_at") !== undefined
      ? parseTwitterDate(str(js, "created_at"))
      : fromUnixMilliseconds(num(js, "created_at_ms"));

  const result: Tweet = newTweet();
  result.id = idFromEntry(str(js, "id_str"));
  result.threadId = idFromEntry(str(js, "conversation_id_str"));
  result.replyId = idFromEntry(str(js, "in_reply_to_status_id_str"));
  result.text = str(js, "full_text");
  result.time = time;
  result.hasThread = at(js, "self_thread") !== undefined;
  result.available = true;
  result.user = emptyUserStub(str(js, "user_id_str"));
  result.stats = {
    replies: num(js, "reply_count"),
    retweets: num(js, "retweet_count"),
    likes: num(js, "favorite_count"),
    views: num(js, "views_count"),
  };

  if (result.replyId.length === 0) result.replyId = replyId;

  if (result.hasThread && result.threadId.length === 0) {
    result.threadId = idFromEntry(str(js, "self_thread", "id_str"));
  }

  if (at(js, "retweeted_status") !== undefined) {
    result.retweet = newTweet();
  } else if (boolDef(js, false, "is_quote_status")) {
    result.quote = { ...newTweet(), id: idFromEntry(str(js, "quoted_status_id_str")) };
  }

  // legacy
  const legacyRt = at(js, "retweeted_status_id_str");
  if (legacyRt !== undefined) {
    result.retweet = {
      ...newTweet(),
      id: idFromEntry(typeof legacyRt === "string" ? legacyRt : ""),
    };
    return result;
  }

  // graphql
  const rt = pick(at(js, "retweeted_status_result", "result"));
  if (rt !== undefined && (at(rt, "legacy") !== undefined || at(rt, "rest_id") !== undefined)) {
    result.retweet = parseGraphTweet(rt);
    return result;
  }

  const reposts = pick(at(js, "repostedStatusResults"));
  if (reposts !== undefined) {
    const repostRt = at(reposts, "result");
    if (
      repostRt !== undefined &&
      (at(repostRt, "legacy") !== undefined || at(repostRt, "rest_id") !== undefined)
    ) {
      result.retweet = parseGraphTweet(repostRt);
      return result;
    }
  }

  if (!isNull(jsCard)) {
    const name = str(jsCard, "name");
    if (name.includes("poll")) {
      if (name.includes("image")) {
        addMedia(result, {
          kind: MediaKind.photoMedia,
          photo: { url: imageValAt(jsCard, "binding_values", "image_large"), altText: "" },
        });
      }
      result.poll = parsePoll(jsCard);
    } else if (name === "amplify") {
      addMedia(result, {
        kind: MediaKind.videoMedia,
        video: parsePromoVideo(at(jsCard, "binding_values")),
      });
    } else if (name.length > 0 && at(jsCard, "binding_values") !== undefined) {
      result.card = parseCard(jsCard, at(js, "entities", "urls"));
    }
  }

  expandTweetEntities(result, js, hasArticle);
  parseLegacyMediaEntities(js, result);

  const withheldInCountries = each(js, "withheld_in_countries").map((c) =>
    typeof c === "string" ? c : "",
  );
  if (
    boolDef(js, false, "withheld_copyright") ||
    (withheldInCountries.length > 0 &&
      (withheldInCountries.includes("XX") ||
        withheldInCountries.includes("XY") ||
        result.text.includes("withheld")))
  ) {
    result.text = result.text.replace(/ Learn more\.$/, "");
    result.available = false;
  }

  return result;
}

function imageValAt(node: Json, ...keys: string[]): string {
  return imageStr(at(node, ...keys), "image_value", "url");
}

/** Port of `getTombstone`. */
function getTombstone(js: Json): string {
  return str(js, "text").replace(/ Learn more$/, "");
}

/** Port of `parseGraphTweet` — the GraphQL tweet result, both shapes. */
export function parseGraphTweet(js: Json): Tweet {
  if (isNull(js)) return newTweet();

  const typ = str(js, "__typename") || str(js, "type");
  if (typ === "TweetUnavailable") return newTweet();
  if (typ === "TweetTombstone") {
    const text = pick(at(js, "tombstone", "richText"), at(js, "tombstone", "text"));
    return { ...newTweet(), text: getTombstone(text) };
  }
  if (typ === "TweetPreviewDisplay") {
    return {
      ...newTweet(),
      text: "You're unable to view this Tweet because it's only available to the Subscribers of the account owner.",
    };
  }
  if (typ === "TweetWithVisibilityResults") {
    return parseGraphTweet(at(js, "tweet"));
  }

  if (at(js, "legacy") === undefined && at(js, "rest_id") === undefined) return newTweet();

  let jsCard = pick(at(js, "card"), at(js, "tweet_card"), at(js, "legacy", "tweet_card"));
  if (!isNull(jsCard)) {
    const legacyCard = at(jsCard, "legacy");
    if (!isNull(legacyCard)) {
      const bindingArray = at(legacyCard, "binding_values");
      if (Array.isArray(bindingArray)) {
        const bindingObj: Record<string, Json> = {};
        for (const item of bindingArray) {
          bindingObj[str(item, "key")] = at(item, "value");
        }
        jsCard = {
          name: at(legacyCard, "name"),
          url: at(legacyCard, "url"),
          binding_values: bindingObj,
        };
      }
    }
  }

  let replyId = "";
  const restId = at(js, "reply_to_results", "rest_id");
  if (restId !== undefined) {
    replyId = idFromEntry(typeof restId === "string" ? restId : str(restId));
  }

  const hasArticle = str(js, "article", "article_results", "result", "title").length > 0;

  let result: Tweet;
  if (at(js, "details") !== undefined) {
    result = newTweet();
    result.id = idFromEntry(str(js, "rest_id"));
    result.available = true;
    result.text = str(js, "details", "full_text");
    result.time = fromUnixMilliseconds(num(js, "details", "created_at_ms"));
    result.replyId = replyId;
    result.isAd = boolDef(
      js,
      false,
      "content_disclosure",
      "advertising_disclosure",
      "is_paid_promotion",
    );
    result.isAI = boolDef(
      js,
      false,
      "content_disclosure",
      "ai_generated_disclosure",
      "has_ai_generated_media",
    );
    result.stats = {
      replies: num(js, "counts", "reply_count"),
      retweets: num(js, "counts", "retweet_count"),
      likes: num(js, "counts", "favorite_count"),
      views: 0,
    };

    if (!isNull(jsCard)) {
      const name = str(jsCard, "name");
      if (name.includes("poll")) {
        if (name.includes("image")) {
          addMedia(result, {
            kind: MediaKind.photoMedia,
            photo: { url: imageValAt(jsCard, "binding_values", "image_large"), altText: "" },
          });
        }
        result.poll = parsePoll(jsCard);
      } else if (name === "amplify") {
        addMedia(result, {
          kind: MediaKind.videoMedia,
          video: parsePromoVideo(at(jsCard, "binding_values")),
        });
      } else if (name.length > 0 && at(jsCard, "binding_values") !== undefined) {
        result.card = parseCard(jsCard, at(js, "url_entities"));
      }
    }

    parseMediaEntities(js, result);
    if (result.attribution === undefined) {
      parseLegacyMediaEntities(at(js, "legacy"), result);
    }

    expandTweetEntitiesV2(result, js, hasArticle);

    for (const m of each(js, "media_entities")) {
      if (at(m, "source_status_id_str") !== undefined) {
        const mediaUrl = str(m, "url");
        if (mediaUrl.length > 0) {
          const idx = result.text.lastIndexOf(mediaUrl);
          if (idx >= 0) {
            result.text = result.text.slice(0, idx).trim();
          }
        }
        break;
      }
    }
  } else {
    result = parseTweet(at(js, "legacy"), jsCard, replyId, hasArticle);
    result.id = idFromEntry(str(js, "rest_id"));
  }

  const artNode = pick(at(js, "article", "article_results", "result"));
  if (artNode !== undefined) {
    const artTitle = str(artNode, "title");
    if (artTitle.length > 0) {
      const cover = pick(
        at(artNode, "cover_media_results", "result", "media_info", "original_img_url"),
        at(artNode, "cover_media", "media_info", "original_img_url"),
      );
      result.articlePreview = {
        title: artTitle,
        previewText: str(artNode, "preview_text"),
        coverImage: imageStr(cover, "original_img_url"),
        tweetId: result.id,
      };
    }
  }

  result.user = parseGraphUser(at(js, "core"));

  if (result.reply.length === 0) {
    const replyTo = at(js, "reply_to_user_results", "result", "core", "screen_name");
    if (replyTo !== undefined) {
      result.reply = [typeof replyTo === "string" ? replyTo : ""];
    }
  }

  const views = at(js, "views", "count");
  if (views !== undefined) {
    const parsed = Number.parseInt(strDef(views, "0"), 10);
    if (!Number.isNaN(parsed)) result.stats.views = parsed;
  }

  const noteTweet = pick(at(js, "note_tweet", "note_tweet_results", "result"));
  if (noteTweet !== undefined) {
    expandNoteTweetEntities(result, noteTweet);
  }

  parseMediaEntities(js, result);

  if (result.attribution !== undefined && result.card !== undefined) {
    try {
      const cardUri = new URL(result.card.url);
      if (isTwitterUrl(result.card.url)) {
        const cardPath = cardUri.pathname.replaceAll("/video/1", "");
        if (cardPath.length > 0 && cardPath === result.attributionLink) {
          result.card.kind = CardKind.hidden;
        }
      }
    } catch {
      // not a parseable URL; no card hiding (Nim's parseUri never throws)
    }
  }

  const reposts = pick(at(js, "legacy", "repostedStatusResults"));
  if (reposts !== undefined) {
    const rt = at(reposts, "result");
    if (rt !== undefined && (at(rt, "legacy") !== undefined || at(rt, "rest_id") !== undefined)) {
      result.retweet = parseGraphTweet(rt);
    }
  }

  const quoted = pick(at(js, "quoted_status_result", "result"));
  if (quoted !== undefined) {
    result.quote = parseGraphTweet(quoted);
  }

  const quotedPost = at(js, "quotedPostResults");
  if (quotedPost !== undefined) {
    const quotedResult = at(quotedPost, "result");
    if (quotedResult !== undefined) {
      result.quote = parseGraphTweet(quotedResult);
    } else {
      result.quote = {
        ...newTweet(),
        id: idFromEntry(str(js, "legacy", "quoted_status_id_str")),
      };
    }
  }

  for (const id of each(js, "edit_control", "edit_control_initial", "edit_tweet_ids")) {
    result.history.push(idString(typeof id === "string" ? id : ""));
  }

  const birdwatch = at(js, "birdwatch_pivot");
  if (birdwatch !== undefined) {
    result.note = parseCommunityNote(birdwatch);
  }

  return result;
}

/** Port of `parseGraphTweetResult` (`data.tweet_result.result`). */
export function parseGraphTweetResult(js: Json): Tweet {
  const tweet = pick(at(js, "data", "tweet_result", "result"));
  return tweet !== undefined ? parseGraphTweet(tweet) : newTweet();
}

/** Port of `parseTweetByRestId` (`data.tweetResult.result`). */
export function parseTweetByRestId(js: Json): Tweet {
  const tweet = pick(at(js, "data", "tweetResult", "result"));
  return tweet !== undefined ? parseGraphTweet(tweet) : newTweet();
}

/** Port of `parseGraphTweetResults` (the article batch). */
export function parseGraphTweetResults(js: Json): Tweet[] {
  const results = at(js, "data", "tweetResult");
  if (!Array.isArray(results)) return [];
  const result: Tweet[] = [];
  for (const item of results) {
    const tweet = at(item, "result");
    if (isNull(tweet)) continue;
    const t = parseGraphTweet(tweet);
    result.push(t);
  }
  return result;
}
