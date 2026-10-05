/**
 * Tweet entity expansion — the port of `parserutils.nim`'s
 * `expandTweetEntities`/`expandTextEntities`/`expandTweetEntitiesV2`/
 * `expandTextEntitiesV2`/`expandNoteTweetEntities`/`expandBirdwatchEntities`
 * and `extractGalleryPhoto`.
 *
 * `textSlice.b` is the raw Twitter index (half-open); Nim folded the
 * exclusivity into its slice at construction, the port translates each
 * expression instead (see `slices.ts`).
 */
import { CardKind, type Media, MediaKind, type Photo, type Tweet } from "@tseer/types";
import { at, boolDef, each, expandedUrl, type Json, num, str } from "./json.ts";
import {
  cmpSlice,
  deduplicate,
  extractHashtags,
  extractSlice,
  extractUrls,
  type ReplaceSlice,
  replacedWith,
} from "./slices.ts";

/** Port of `expandTweetEntities` (legacy shape). */
export function expandTweetEntities(tweet: Tweet, js: Json, hasArticle = false): void {
  const entities = at(js, "entities");
  if (entities === undefined) return;

  const range = at(js, "display_text_range");
  const start = numAt(range, 0);
  const end = numAt(range, 1);
  const textSlice = { a: start, b: end };

  const hasQuote = boolDef(js, false, "is_quote_status");
  const hasJobCard = tweet.card?.kind === CardKind.jobDetails;

  let replyTo = "";
  if (tweet.replyId.length > 0) {
    replyTo = str(js, "in_reply_to_screen_name");
    if (replyTo.length > 0) tweet.reply.push(replyTo);
  }

  expandTextEntities(
    tweet,
    entities,
    tweet.text,
    textSlice,
    replyTo,
    hasQuote || hasJobCard,
    hasArticle,
  );
}

/** Port of `expandTweetEntitiesV2` (the "details" ad-tweet shape). */
export function expandTweetEntitiesV2(tweet: Tweet, js: Json, hasArticle = false): void {
  const range = at(js, "details", "display_text_range");
  const textSlice = { a: numAt(range, 0), b: numAt(range, 1) };
  const hasQuote = at(js, "quoted_tweet_results") !== undefined;
  const hasJobCard = tweet.card?.kind === CardKind.jobDetails;
  const hasAttribution = tweet.attribution !== undefined;

  expandTextEntitiesV2(
    tweet,
    js,
    tweet.text,
    textSlice,
    hasQuote || hasJobCard || hasAttribution,
    hasArticle,
  );
}

/** Port of `expandTextEntities` — the shared splicing body (urls/media/tags/mentions). */
function expandTextEntities(
  tweet: Tweet,
  entities: Json,
  text: string,
  textSlice: { a: number; b: number },
  replyTo = "",
  hasRedundantLink = false,
  hasArticle = false,
): void {
  const hasCard = tweet.card !== undefined;
  const replacements: ReplaceSlice[] = [];

  for (const u of each(entities, "urls")) {
    const urlStr = str(u, "url");
    if (urlStr.length === 0 || !text.includes(urlStr)) continue;

    extractUrls(replacements, u, textSlice.b, hasRedundantLink, hasArticle);

    if (hasCard && urlStr === tweet.card?.url) {
      tweet.card.url = expandedUrl(u);
    }
  }

  for (const m of each(entities, "media")) {
    extractUrls(replacements, m, textSlice.b, true);
  }

  if (each(entities, "hashtags").length > 0) {
    for (const hashtag of each(entities, "hashtags")) {
      extractHashtags(replacements, hashtag as { indices?: unknown });
    }
  }

  if (each(entities, "symbols").length > 0) {
    for (const symbol of each(entities, "symbols")) {
      extractHashtags(replacements, symbol as { indices?: unknown });
    }
  }

  for (const mention of each(entities, "user_mentions")) {
    const name = str(mention, "screen_name");
    const slice = extractSlice(mention as { indices?: unknown });
    const idx = tweet.reply.indexOf(name);

    if (slice.a >= textSlice.a) {
      replacements.push({
        kind: "mention",
        a: slice.a,
        b: slice.b,
        url: `/${name}`,
        display: str(mention, "name"),
      });
      if (idx > -1 && name !== replyTo) tweet.reply.splice(idx, 1);
    } else if (idx === -1 && tweet.replyId.length > 0) {
      tweet.reply.push(name);
    }
  }

  deduplicate(replacements);
  replacements.sort(cmpSlice);

  tweet.text = trimEnd(replacedWith([...text], replacements, textSlice));
}

/** Port of `expandTextEntitiesV2` — the "details" variant (url_entities/hashtag_entities/cashtags). */
function expandTextEntitiesV2(
  tweet: Tweet,
  js: Json,
  text: string,
  textSlice: { a: number; b: number },
  hasRedundantLink = false,
  hasArticle = false,
): void {
  const hasCard = tweet.card !== undefined;
  const replacements: ReplaceSlice[] = [];

  for (const u of each(js, "url_entities")) {
    const urlStr = str(u, "url");
    if (urlStr.length === 0 || !text.includes(urlStr)) continue;

    extractUrls(replacements, u, textSlice.b, hasRedundantLink, hasArticle);

    if (hasCard && urlStr === tweet.card?.url) {
      tweet.card.url = expandedUrl(u);
    }
  }

  for (const hashtag of each(js, "details", "hashtag_entities")) {
    extractHashtags(replacements, hashtag as { indices?: unknown });
  }

  for (const cashtag of each(js, "details", "cashtag_entities")) {
    extractHashtags(replacements, cashtag as { indices?: unknown });
  }

  for (const mention of each(js, "mention_entities")) {
    const name = str(mention, "screen_name");
    const slice = extractSlice(mention as { indices?: unknown });
    const idx = tweet.reply.indexOf(name);

    if (slice.a >= textSlice.a) {
      replacements.push({
        kind: "mention",
        a: slice.a,
        b: slice.b,
        url: `/${name}`,
        display: str(mention, "name"),
      });
    } else if (idx === -1 && tweet.replyId.length > 0) {
      tweet.reply.push(name);
    }
  }

  deduplicate(replacements);
  replacements.sort(cmpSlice);

  tweet.text = trimEnd(replacedWith([...text], replacements, textSlice));
}

const UNICODE_OPEN = "\uFFFA";
const UNICODE_CLOSE = "\uFFFB";
const XML_OPEN = "&lt;";
const XML_CLOSE = "&gt;";

/** Port of `expandNoteTweetEntities` (long notes; `<`/`>` are shielded from the splicer). */
export function expandNoteTweetEntities(tweet: Tweet, js: Json): void {
  const entities = at(js, "entity_set");
  if (entities === undefined) return;

  const text = str(js, "text").replaceAll("<", UNICODE_OPEN).replaceAll(">", UNICODE_CLOSE);
  const textSlice = { a: 0, b: [...text].length };
  const hasAttribution = tweet.attribution !== undefined;

  expandTextEntities(tweet, entities, text, textSlice, "", hasAttribution);

  tweet.text = tweet.text.replaceAll(UNICODE_OPEN, XML_OPEN).replaceAll(UNICODE_CLOSE, XML_CLOSE);
}

/** Port of `expandBirdwatchEntities` (community notes). */
export function expandBirdwatchEntities(text: string, entities: Json): string {
  const runes = [...text];
  const replacements: ReplaceSlice[] = [];

  for (const entity of each(entities)) {
    const fromIdx = num(entity, "from_index");
    const toIdx = num(entity, "to_index");
    const url = str(entity, "ref", "url");
    if (url.length > 0) {
      replacements.push({
        kind: "url",
        a: fromIdx,
        b: toIdx,
        url,
        display: runes.slice(fromIdx, Math.min(toIdx, runes.length)).join(""),
      });
    }
  }

  replacements.sort(cmpSlice);
  // Nim passes `0 ..< runes.len`, which folds to `len - 1` — the final
  // codepoint is dropped there; kept verbatim.
  return replacedWith(runes, replacements, { a: 0, b: Math.max(0, runes.length - 1) });
}

/** Port of `extractGalleryPhoto`. */
export function extractGalleryPhoto(t: Tweet): { url: string; tweetId: string; color: string } {
  const first = t.media[0];
  let url = "";
  if (first !== undefined) {
    url = first.kind === MediaKind.photoMedia ? first.photo.url : thumbOf(first);
  } else if (t.card !== undefined) {
    url = t.card.image;
  }
  return { url, tweetId: t.id, color: "" };
}

function thumbOf(media: Media): string {
  if (media.kind === MediaKind.videoMedia) return media.video.thumb;
  if (media.kind === MediaKind.gifMedia) return media.gif.thumb;
  return (media as { photo: Photo }).photo.url;
}

/** `.strip(leading=false)` — trailing whitespace only. */
function trimEnd(text: string): string {
  return text.replace(/\s+$/, "");
}

function numAt(node: Json, index: number): number {
  const value = Array.isArray(node) ? node[index] : undefined;
  return typeof value === "number" ? value : 0;
}
