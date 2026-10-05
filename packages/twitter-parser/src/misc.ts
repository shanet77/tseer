/**
 * Entity-metadata parsers — the port of `parser.nim`'s `parseBroadcastInfo`,
 * `parseSpaceParticipant`, `parseAudioSpace`, `parseGraphCommunity`,
 * `parseListObject`, `parseGraphList`, and `parseGraphSearchList`.
 */
import type {
  AudioSpace,
  Broadcast,
  Community,
  List,
  ListSearchResult,
  SpaceParticipant,
  User,
} from "@tseer/types";
import { fromUnixMilliseconds } from "./dates.ts";
import { at, each, imageStr, type Json, num, numDef, pick, str } from "./json.ts";
import { parseGraphUser } from "./user.ts";

/** Port of `parseBroadcastInfo`. */
export function parseBroadcastInfo(js: Json): Broadcast {
  const empty: Broadcast = {
    id: "",
    title: "",
    state: "",
    thumb: "",
    mediaKey: "",
    m3u8Url: "",
    totalWatched: 0,
    startTime: "",
    endTime: "",
    replayStart: 0,
    availableForReplay: false,
    user: parseGraphUser(undefined),
  };
  const bc = at(js, "data", "broadcast");
  if (bc === undefined) return empty;

  return {
    id: str(bc, "broadcast_id"),
    title: str(bc, "status"),
    state: str(bc, "state").toUpperCase(),
    thumb: str(bc, "image_url"),
    mediaKey: str(bc, "media_key"),
    m3u8Url: "",
    totalWatched: num(bc, "total_watched"),
    startTime: fromUnixMilliseconds(num(bc, "start_time")),
    endTime: fromUnixMilliseconds(num(bc, "end_time")),
    replayStart: num(bc, "edited_replay", "start_time"),
    availableForReplay: bool(bc, "available_for_replay"),
    user: parseGraphUser(bc),
  };
}

function bool(js: Json, ...keys: string[]): boolean {
  const value = at(js, ...keys);
  return typeof value === "boolean" ? value : false;
}

/** Port of `parseSpaceParticipant`. */
export function parseSpaceParticipant(js: Json): SpaceParticipant {
  return {
    userId: str(js, "user_results", "rest_id"),
    username: str(js, "twitter_screen_name"),
    displayName: str(js, "display_name"),
    avatarUrl: str(js, "avatar_url"),
    isVerified: bool(js, "is_verified") || bool(js, "user_results", "result", "is_blue_verified"),
  };
}

/** Port of `parseAudioSpace`. */
export function parseAudioSpace(js: Json): AudioSpace {
  const empty: AudioSpace = {
    id: "",
    title: "",
    state: "",
    mediaKey: "",
    m3u8Url: "",
    totalLiveListeners: 0,
    totalReplayWatched: 0,
    startTime: "",
    endTime: "",
    availableForReplay: false,
    creator: parseGraphUser(undefined),
    admins: [],
    speakers: [],
  };

  const space = at(js, "data", "audioSpace");
  if (space === undefined) return empty;
  const meta = at(space, "metadata");

  const result: AudioSpace = {
    ...empty,
    id: str(meta, "rest_id"),
    title: str(meta, "title"),
    state: str(meta, "state").toUpperCase(),
    mediaKey: str(meta, "media_key"),
    totalLiveListeners: num(meta, "total_live_listeners"),
    totalReplayWatched: num(meta, "total_replay_watched"),
    availableForReplay: bool(meta, "is_space_available_for_replay"),
  };

  const startedAt = numDef(meta, 0, "started_at");
  if (startedAt > 0) result.startTime = fromUnixMilliseconds(startedAt);

  const endedAtStr = str(meta, "ended_at");
  if (endedAtStr.length > 0) {
    const endedAt = Number(endedAtStr);
    if (Number.isFinite(endedAt) && endedAt > 0) {
      result.endTime = fromUnixMilliseconds(endedAt);
    }
  }

  result.creator = parseGraphUser(at(meta, "creator_results", "result"));

  for (const admin of each(space, "participants", "admins")) {
    result.admins.push(parseSpaceParticipant(admin));
  }
  for (const speaker of each(space, "participants", "speakers")) {
    result.speakers.push(parseSpaceParticipant(speaker));
  }

  return result;
}

/** Port of `parseGraphCommunity`. */
export function parseGraphCommunity(js: Json): Community {
  const empty: Community = {
    id: "",
    name: "",
    description: "",
    memberCount: 0,
    banner: "",
    creator: parseGraphUser(undefined),
    category: "",
    joinPolicy: "",
    createdAt: "",
    rules: [],
    hashtags: [],
  };

  const c = at(js, "data", "communityResults", "result");
  if (c === undefined) return empty;

  const createdMs = numDef(c, 0, "created_at");
  const result: Community = {
    ...empty,
    id: str(c, "rest_id") || str(c, "id_str"),
    name: str(c, "name"),
    description: str(c, "description"),
    memberCount: num(c, "member_count"),
    joinPolicy: str(c, "join_policy"),
    category: str(c, "primary_community_topic", "topic_name"),
    banner: imageStr(c, "custom_banner_media", "media_info", "original_img_url"),
    createdAt: createdMs > 0 ? fromUnixMilliseconds(createdMs) : "",
  };

  result.creator = parseGraphUser(at(c, "creator_results", "result"));

  for (const rule of each(c, "rules")) {
    result.rules.push({ name: str(rule, "name"), description: str(rule, "description") });
  }

  for (const item of each(c, "trending_hashtags_slice", "items")) {
    const tag = str(item, "hashtag");
    if (tag.length > 0) result.hashtags.push(tag);
  }

  return result;
}

/** Port of `parseListObject`. */
export function parseListObject(js: Json, owner: User): List {
  const banner = pick(
    at(js, "custom_banner_media", "media_info", "original_img_url"),
    at(js, "default_banner_media", "media_info", "original_img_url"),
  );
  return {
    id: str(js, "id_str"),
    name: str(js, "name"),
    username: owner.username,
    userId: owner.id,
    description: str(js, "description"),
    members: num(js, "member_count"),
    banner: imageStr(banner),
  };
}

/** Port of `parseGraphList`. */
export function parseGraphList(js: Json): List {
  const list = pick(at(js, "data", "user_by_screen_name", "list"), at(js, "data", "list"));
  if (list === undefined) {
    return parseListObject({}, parseGraphUser(undefined));
  }
  return parseListObject(list, parseGraphUser(list));
}

/** Port of `parseGraphSearchList`. */
export function parseGraphSearchList(js: Json): ListSearchResult {
  const owner: User = parseGraphUser(js);
  const result: ListSearchResult = {
    list: parseListObject(js, owner),
    owner,
    followersContext: str(js, "followers_context"),
    facepiles: [],
  };
  for (const url of each(js, "facepile_urls")) {
    result.facepiles.push(typeof url === "string" ? url : "");
  }
  return result;
}
