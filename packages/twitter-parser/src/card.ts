/**
 * Card parsing — the port of `parser.nim`'s `parsePoll`, `parseVideoVariants`,
 * `parseVideo`, `parsePromoVideo`, `parseBroadcast`, `parseCard` and the
 * `getCard*` helpers from `parserutils.nim`, plus
 * `experimental/parser/unifiedcard.nim`.
 *
 * Divergence: upstream garbage that would raise in Nim (`parseInt` of a
 * non-number) yields the 0/`""` default instead — a malformed card must not
 * take down a timeline.
 */
import {
  type Card,
  CardKind,
  type Poll,
  type Video,
  VideoType,
  type VideoVariant,
} from "@tseer/types";
import { parseIsoDate } from "./dates.ts";
import {
  at,
  each,
  entries,
  expandedUrl,
  imageStr,
  imageVal,
  type Json,
  num,
  orNull,
  str,
  strDef,
  strVal,
} from "./json.ts";
import { getPicUrl } from "./media.ts";
import { shorten } from "./slices.ts";

/** Port of `getImageStr`-prefixed access over a raw string (utils.nim `getImageUrl`). */
function stripImageStr(url: string): string {
  let result = url;
  if (result.startsWith("https://")) result = result.slice("https://".length);
  if (result.startsWith("pbs.twimg.com/")) result = result.slice("pbs.twimg.com/".length);
  return result;
}

/** Port of `getMp4Resolution`: the height out of `/vid/<w>x<h>/`. */
export function getMp4Resolution(url: string): number {
  const vidSep = "/vid/";
  const vidIdx = url.indexOf(vidSep);
  if (vidIdx < 0) return 0;
  const resIdx = url.indexOf("x", vidIdx + vidSep.length) + 1;
  const nextSlash = url.indexOf("/", resIdx);
  const res = url.slice(resIdx, nextSlash < 0 ? undefined : nextSlash);
  const parsed = Number.parseInt(res, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** `v{"bit_rate"}.getInt(v{"bitrate"}.getInt(0))` — alternate keys, not a path. */
function numAlt(node: Json, first: string, second: string): number {
  const a = at(node, first);
  return typeof a === "number" ? a : num(node, second);
}

function videoContentType(s: string): VideoType {
  const found = Object.values(VideoType).find((v) => v === s);
  return found ?? VideoType.mp4;
}

/** Port of `parseVideoVariants`. */
export function parseVideoVariants(variants: Json): VideoVariant[] {
  const result: VideoVariant[] = [];
  for (const v of each(variants)) {
    const contentType = videoContentType(strDef(v, "video/mp4", "content_type"));
    result.push({
      contentType,
      url: str(v, "url"),
      bitrate: numAlt(v, "bit_rate", "bitrate"),
      resolution: contentType === VideoType.mp4 ? getMp4Resolution(str(v, "url")) : 0,
    });
  }
  return result;
}

/** Port of `parseVideo` (a legacy `extended_entities` video). */
export function parseVideo(js: Json): Video {
  const result: Video = {
    durationMs: num(js, "video_info", "duration_millis"),
    url: "",
    thumb: imageStr(js, "media_url_https"),
    available: true,
    reason: "",
    title: str(js, "ext_alt_text"),
    description: "",
    playbackType: VideoType.mp4,
    variants: [],
  };

  const status = str(js, "ext_media_availability", "status");
  if (status.length > 0 && status.toLowerCase() !== "available") {
    result.available = false;
  }

  if (at(js, "additional_media_info", "title") !== undefined) {
    result.title = str(js, "additional_media_info", "title");
  }
  if (at(js, "additional_media_info", "description") !== undefined) {
    result.description = str(js, "additional_media_info", "description");
  }

  result.variants = parseVideoVariants(at(js, "video_info", "variants"));
  return result;
}

/** Port of `parsePromoVideo` (amplify/player cards). */
export function parsePromoVideo(js: Json): Video {
  const url =
    strVal(js, "", "player_hls_url") ||
    strVal(js, "", "player_stream_url") ||
    strVal(js, "", "amplify_url_vmap");

  const variant: VideoVariant = { contentType: VideoType.vmap, url, bitrate: 0, resolution: 0 };
  const playbackType = url.includes("m3u8") ? VideoType.m3u8 : VideoType.vmap;
  if (url.includes("m3u8")) variant.contentType = VideoType.m3u8;

  const duration = Number.parseInt(strVal(js, "0", "content_duration_seconds"), 10);

  return {
    thumb: imageVal(js, "player_image_large"),
    available: true,
    durationMs: (Number.isNaN(duration) ? 0 : duration) * 1000,
    url: "",
    reason: "",
    title: "",
    description: "",
    playbackType,
    variants: [variant],
  };
}

/** Port of `parsePoll` (the `pollNchoice_*` card family). */
export function parsePoll(js: Json): Poll {
  const result: Poll = { options: [], values: [], votes: 0, leader: 0, status: "" };
  const vals = at(js, "binding_values");
  const name = str(js, "name");

  // name format is pollNchoice_*: the choice count is the digit at index 4
  const choices = Number.parseInt(name[4] ?? "", 10);
  for (let i = 1; Number.isFinite(choices) && i <= choices; i += 1) {
    const count = Number.parseInt(strVal(vals, "0", `choice${i}_count`), 10);
    result.values.push(Number.isNaN(count) ? 0 : count);
    result.options.push(strVal(vals, "", `choice${i}_label`));
  }

  const time = parseIsoDate(strVal(vals, "", "end_datetime_utc"));
  const now = Date.now();
  const endTime = time.length > 0 ? Date.parse(time) : Number.NaN;

  if (!Number.isNaN(endTime) && endTime > now) {
    result.status = formatDurationLeft(endTime - now);
  } else {
    result.status = "Final results";
  }

  const max = Math.max(...result.values, 0);
  result.leader = result.values.indexOf(max);
  result.votes = result.values.reduce((a, b) => a + b, 0);
  return result;
}

/**
 * Nim's `$` of a `Duration` prints only its non-zero components, largest
 * first, comma-separated; nitter keeps the first segment (`[0 ..< find(",")]`).
 */
function formatDurationLeft(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)} days`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} hours`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)} minutes`;
  return `${seconds} seconds`;
}

/** Port of `parseBroadcast` (the broadcast *card*, not `parseBroadcastInfo`). */
export function parseBroadcastCard(js: Json): Card {
  const image = imageVal(js, "broadcast_thumbnail_large");
  const broadcastUrl = strVal(js, "", "broadcast_url");
  const broadcastId = broadcastUrl.split("/").pop() ?? "";
  const streamUrl = `/i/broadcasts/${broadcastId}/stream`;
  return {
    kind: CardKind.broadcast,
    url: `/i/broadcasts/${broadcastId}`,
    title: strVal(js, "", "broadcaster_display_name"),
    dest: "",
    text: strVal(js, "", "broadcast_title"),
    image,
    video: {
      thumb: image,
      available: true,
      durationMs: 0,
      url: "",
      reason: "",
      title: "",
      description: "",
      playbackType: VideoType.m3u8,
      variants: [{ contentType: VideoType.m3u8, url: streamUrl, bitrate: 0, resolution: 0 }],
    },
  };
}

/** `getCardUrl` (parserutils.nim). */
function getCardUrl(vals: Json, kind: CardKind): string {
  let result = strVal(vals, "", "website_url");
  if (kind === CardKind.promoVideoConvo) {
    result = strVal(vals, result, "thank_you_url");
  }
  if (result.startsWith("card://")) result = "";
  return result;
}

/** `getCardDomain`. */
function getCardDomain(vals: Json, kind: CardKind): string {
  let result = strVal(vals, str(vals, "domain"), "vanity_url");
  if (kind === CardKind.promoVideoConvo) {
    result = strVal(vals, result, "thank_you_vanity_url");
  }
  return result;
}

/** `getCardTitle`. */
function getCardTitle(vals: Json, kind: CardKind): string {
  if (kind === CardKind.promoVideoConvo) return strVal(vals, "", "thank_you_text");
  if (kind === CardKind.liveEvent) return strVal(vals, "", "event_category");
  if (kind === CardKind.videoDirectMessage || kind === CardKind.imageDirectMessage) {
    return strVal(vals, "", "cta1");
  }
  return strVal(vals, "", "title");
}

function emptyCard(kind: CardKind): Card {
  return { kind, url: "", title: "", dest: "", text: "", image: "" };
}

/** Port of `parseCard`. `urls` is the tweet's `entities.urls` for the t.co rewrite. */
export function parseCard(js: Json, urls: Json): Card | undefined {
  const IMAGE_TYPES = [
    "summary_photo_image",
    "player_image",
    "promo_image",
    "photo_image_full_size",
    "thumbnail_image",
    "thumbnail",
    "event_thumbnail",
    "image",
  ];

  const vals = orNull(at(js, "binding_values"));
  if (vals === undefined) return undefined;

  const name = str(js, "name");
  const colon = name.indexOf(":");
  const kindName = name.slice(colon + 1);
  const kind = (Object.values(CardKind) as string[]).includes(kindName)
    ? (kindName as CardKind)
    : CardKind.unknown;

  if (kind === CardKind.unified) {
    return parseUnifiedCard(str(vals, "unified_card", "string_value"));
  }

  const result = emptyCard(kind);
  result.url = getCardUrl(vals, kind);
  result.dest = getCardDomain(vals, kind);
  result.title = getCardTitle(vals, kind);
  result.text = strVal(vals, "", "description");

  if (result.url.length === 0) result.url = str(js, "url");

  switch (kind) {
    case CardKind.promoVideo:
    case CardKind.promoVideoConvo:
    case CardKind.appPlayer:
    case CardKind.videoDirectMessage: {
      result.video = parsePromoVideo(vals);
      if (kind === CardKind.appPlayer) {
        result.text = strDef(vals, result.text, "app_category");
      }
      break;
    }
    case CardKind.broadcast: {
      return parseBroadcastCard(vals);
    }
    case CardKind.liveEvent: {
      result.text = strVal(vals, "", "event_title");
      break;
    }
    case CardKind.player: {
      result.url = strVal(vals, "", "player_url");
      if (result.url.includes("youtube.com")) {
        result.url = result.url.replace("/embed/", "/watch?v=");
      }
      break;
    }
    case CardKind.audiospace: {
      const spaceId = strVal(vals, "", "id");
      if (spaceId.length > 0) {
        result.url = `/i/spaces/${spaceId}`;
        result.title = "Twitter Space";
        result.text = "Click to view Space";
      }
      break;
    }
    case CardKind.unknown: {
      result.title = "This card type is not supported.";
      break;
    }
    default: {
      break;
    }
  }

  for (const typ of IMAGE_TYPES) {
    const img = at(vals, `${typ}_large`);
    if (img !== undefined) {
      result.image = imageVal(at(vals, `${typ}_large`));
      break;
    }
  }

  for (const u of each(urls)) {
    if (str(u, "url") === result.url) {
      result.url = expandedUrl(u, result.url);
      break;
    }
  }

  if (kind === CardKind.videoDirectMessage || kind === CardKind.imageDirectMessage) {
    result.url = "";
  }

  const needsPic =
    (kind === CardKind.promoImageConvo ||
      kind === CardKind.promoImageApp ||
      kind === CardKind.imageDirectMessage) &&
    result.url.length === 0;
  if (needsPic || result.url.startsWith("card://")) {
    result.url = getPicUrl(result.image);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Unified cards (experimental/parser/unifiedcard.nim)
// ---------------------------------------------------------------------------

interface VideoInfo {
  durationMillis: number;
  variants: Json[];
}

const COMPONENT_KINDS: Record<string, string> = {
  details: "details",
  media: "media",
  swipeable_media: "swipeableMedia",
  button_group: "buttonGroup",
  job_details: "jobDetails",
  app_store_details: "appStoreDetails",
  twitter_list_details: "twitterListDetails",
  community_details: "communityDetails",
  media_with_details_horizontal: "mediaWithDetailsHorizontal",
  commerce_drop_details: "hidden",
  grok_share: "grokShare",
};

/** Port of `parseUnifiedCard`. Returns `undefined` on an empty payload (Nim returns a default card). */
export function parseUnifiedCard(json: string): Card | undefined {
  let card: Json;
  try {
    card = JSON.parse(json) as Json;
  } catch {
    return undefined;
  }
  if (typeof card !== "object" || card === null) return undefined;

  const result = emptyCard(CardKind.summary);
  const componentObjects = entries(card, "component_objects");
  const mediaEntities = entries(card, "media_entities");

  for (const [, component] of componentObjects) {
    const rawKind = str(component, "kind") || str(component, "type");
    const componentKind = COMPONENT_KINDS[rawKind] ?? "unknown";

    switch (componentKind) {
      case "details":
      case "twitterListDetails":
      case "communityDetails": {
        parseDetails(data(component), card, result);
        break;
      }
      case "appStoreDetails": {
        parseAppDetails(data(component), card, result);
        break;
      }
      case "mediaWithDetailsHorizontal": {
        parseMediaDetails(data(component), card, result);
        break;
      }
      case "media":
      case "swipeableMedia": {
        parseMedia(component, card, result);
        break;
      }
      case "buttonGroup": {
        break;
      }
      case "grokShare": {
        parseGrokShare(data(component), card, result);
        break;
      }
      case "jobDetails": {
        parseJobDetails(data(component), card, result);
        break;
      }
      case "hidden": {
        result.kind = CardKind.hidden;
        break;
      }
      default: {
        break;
      }
    }

    if (componentKind === "twitterListDetails") {
      result.dest = `List · ${num(data(component), "member_count")} Members`;
    } else if (componentKind === "communityDetails") {
      result.dest = `Community · ${num(data(component), "member_count")} Members`;
    }
  }
  void mediaEntities;
  return result;
}

function data(component: Json): Json {
  return at(component, "data");
}

function parseDestination(id: string, card: Json, result: Card): void {
  const destination = at(card, "destination_objects", id, "data");
  result.dest = str(destination, "url_data", "vanity");
  result.url = str(destination, "url_data", "url");
}

function parseDetails(d: Json, card: Json, result: Card): void {
  parseDestination(str(d, "destination"), card, result);
  result.text = str(d, "title");
  if (result.text.length === 0) result.text = str(d, "name");
}

function parseMediaDetails(d: Json, card: Json, result: Card): void {
  parseDestination(str(d, "destination"), card, result);
  result.kind = CardKind.summary;
  // Nim reads `data.mediaId` (jsony's exact-name match); upstream also sends
  // the snake_case `media_id`, so both are accepted.
  const media = at(card, "media_entities", str(d, "mediaId") || str(d, "media_id"));
  result.image = stripImageStr(str(media, "media_url_https"));
  result.text = str(d, "topic_detail", "title");
  result.dest = "Topic";
}

function parseJobDetails(d: Json, card: Json, result: Card): void {
  parseDestination(str(d, "destination"), card, result);
  result.kind = CardKind.jobDetails;
  result.title = str(d, "title");
  result.text = str(d, "short_description_text");
  result.dest = `@${str(d, "profile_user", "username")} · ${str(d, "location")}`;
}

function parseAppDetails(d: Json, card: Json, result: Card): void {
  const store = at(card, "app_store_data", str(d, "app_id"));
  const app = Array.isArray(store) ? store[0] : undefined;

  const appKind = str(app, "kind");
  if (appKind === "android_app") {
    result.url = `http://play.google.com/store/apps/details?id=${str(app, "id")}`;
  } else if (appKind === "iphone_app" || appKind === "ipad_app") {
    result.url = `https://itunes.apple.com/app/id${str(app, "id")}`;
  }

  result.text = str(app, "title");
  result.dest = str(app, "category");
}

function parseMedia(component: Json, card: Json, result: Card): void {
  const d = data(component);
  const mediaId =
    str(component, "kind") === "swipeable_media"
      ? str(each(d, "media_list")[0], "id")
      : str(d, "id");

  const rMedia = at(card, "media_entities", mediaId);
  const mediaKind = str(rMedia, "kind");
  if (mediaKind === "photo") {
    result.kind = CardKind.summaryLarge;
    result.image = stripImageStr(str(rMedia, "media_url_https"));
  } else if (mediaKind === "video") {
    const videoInfo = orNull(at(rMedia, "video_info")) as VideoInfo | undefined;
    result.kind = CardKind.promoVideo;
    result.video = {
      available: true,
      thumb: stripImageStr(str(rMedia, "media_url_https")),
      durationMs: videoInfo?.durationMillis ?? 0,
      url: "",
      reason: "",
      title: "",
      description: "",
      playbackType: VideoType.mp4,
      variants: (videoInfo?.variants ?? []).map((v) => ({
        contentType: videoContentType(strDef(v, "video/mp4", "content_type")),
        url: str(v, "url"),
        bitrate: num(v, "bit_rate", "bitrate"),
        resolution: 0,
      })),
    };
  } else if (mediaKind === "model3d") {
    result.title = "Unsupported 3D model ad";
  }
}

function parseGrokShare(d: Json, card: Json, result: Card): void {
  result.kind = CardKind.summaryLarge;
  parseDestination(str(d, "destination"), card, result);
  result.dest = "Answer by Grok";

  for (const msg of each(d, "conversation_preview")) {
    const sender = str(msg, "sender");
    const message = str(msg, "message");
    if (sender === "USER") result.title = shorten(message, 70);
    else if (sender === "AGENT") result.text = shorten(message, 500);
  }
}
