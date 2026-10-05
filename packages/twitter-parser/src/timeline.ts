/**
 * Timelines, conversations, search, and community timelines — the port of
 * `parser.nim`'s `parseGraphThread`, `parseGraphTimeline`, `parseGraphPhotoRail`,
 * `parseGraphSearch`, `parseGraphConversation`, `parseGraphEditHistory`,
 * `parseGraphCommunityTimeline`, `parseGraphCommunityMembers`, and the
 * experimental (string-bodied) `parseGraphListMembers`/`parseGraphFollowers`.
 *
 * Cursors: nitter extracts the `Bottom` cursor only (`bottom`); `top` stays
 * empty in the upstream parsers (pages paginate backwards), kept verbatim.
 * `query` is attached by the fetch layer after parsing (the search #1372
 * workaround needs the parsed bottom cursor first).
 */
import {
  type Chain,
  type ChainResult,
  type Conversation,
  type EditHistory,
  type ListSearchResult,
  type PhotoRail,
  type Profile,
  type Query,
  QueryKind,
  type Result,
  type TimelineResult,
  type Tweet,
  type User,
} from "@tseer/types";
import { extractGalleryPhoto } from "./entities.ts";
import { at, each, entryId, idFromEntry, isNull, type Json, pick, str, typeName } from "./json.ts";
import { parseGraphSearchList } from "./misc.ts";
import { newTweet, parseGraphTweet } from "./tweet.ts";
import { parseGraphUser, parseUserResult } from "./user.ts";

/** A default `Query` for timeline envelopes (the fetch layer overwrites it). */
export function emptyQuery(kind: QueryKind = QueryKind.tweets): Query {
  return {
    kind,
    view: "",
    text: "",
    filters: [],
    includes: [],
    excludes: [],
    fromUser: [],
    since: "",
    until: "",
    minLikes: "",
    sep: "",
  };
}

function getConvSection(js: Json): string {
  const details = pick(
    at(js, "item", "client_event_info", "details"),
    at(js, "item", "clientEventInfo", "details"),
  );
  return String(
    pick(
      at(details, "conversation_details", "conversation_section"),
      at(details, "conversationDetails", "conversation_section"),
    ) ?? "",
  );
}

/** Port of `getTweetResult` (parserutils.nim). */
function getTweetResult(js: Json, root = "content"): Json {
  return pick(
    at(js, root, "content", "tweet_results", "result"),
    at(js, root, "itemContent", "tweet_results", "result"),
    at(js, root, "content", "tweetResult", "result"),
  );
}

interface ThreadResult {
  thread: Chain;
  self: boolean;
}

function emptyThread(): Chain {
  return { content: [], hasMore: false, cursor: "", related: false };
}

/** Port of `parseGraphThread`. */
export function parseGraphThread(js: Json): ThreadResult {
  const result: ThreadResult = { thread: emptyThread(), self: false };
  let checkedSection = false;

  for (const t of each(js, "content", "items")) {
    const entry = entryId(t);
    if (entry.includes("tweet-") && !entry.includes("promoted")) {
      if (!checkedSection) {
        checkedSection = true;
        if (getConvSection(t) === "RelatedTweet") {
          result.thread.related = true;
        }
      }

      const tweet = getTweetResult(t, "item");
      if (tweet !== undefined) {
        result.thread.content.push(parseGraphTweet(tweet));

        const displayType = pick(
          at(t, "item", "content", "tweet_display_type"),
          at(t, "item", "itemContent", "tweetDisplayType"),
        );
        if (str(displayType) === "SelfThread") {
          result.self = true;
        }
      } else {
        result.thread.content.push({ ...newTweet(), id: idFromEntry(entry) });
      }
    } else if (entry.includes("cursor-showmore")) {
      result.thread.cursor = str(at(t, "item", "content", "value"));
      result.thread.hasMore = true;
    }
  }

  return result;
}

/** Port of the `extractTweetsFromModuleItems` iterator (moduleItems shape). */
function extractTweetsFromModuleItems(items: Json): Tweet[] {
  const result: Tweet[] = [];
  for (const item of each(items)) {
    const tweetResult = getTweetResult(item, "item");
    if (tweetResult === undefined) continue;
    const tweet = parseGraphTweet(tweetResult);
    if (!tweet.available) tweet.id = idFromEntry(entryId(item));
    result.push(tweet);
  }
  return result;
}

/** Port of `extractListsFromItems`. */
function extractListsFromItems(items: Json): ListSearchResult[] {
  const result: ListSearchResult[] = [];
  for (const item of each(items)) {
    const listJs = at(item, "item", "itemContent", "list");
    if (listJs === undefined) continue;
    const r = parseGraphSearchList(listJs);
    if (r.list.id.length > 0) result.push(r);
  }
  return result;
}

/** Port of `extractTweetsFromEntry`. */
export function extractTweetsFromEntry(e: Json): Tweet[] {
  const tweetResult = getTweetResult(e);
  if (tweetResult !== undefined) {
    const tweet = parseGraphTweet(tweetResult);
    if (!tweet.available) tweet.id = idFromEntry(entryId(e));
    return [tweet];
  }
  return extractTweetsFromModuleItems(each(e, "content", "items"));
}

/** Port of `parseGraphTimeline` → the `tweets` half of a `Profile`. */
export function parseGraphTimeline(js: Json, after = ""): Pick<Profile, "pinned" | "tweets"> {
  const tweets: TimelineResult = {
    content: [],
    top: "",
    bottom: "",
    beginning: after.length === 0,
    query: emptyQuery(),
  };
  const result: Pick<Profile, "pinned" | "tweets"> = { tweets };

  const instructions = pick(
    at(js, "data", "list", "timeline_response", "timeline", "instructions"),
    at(js, "data", "user", "result", "timeline", "timeline", "instructions"),
    at(js, "data", "user_result", "result", "timeline_response", "timeline", "instructions"),
  );
  if (instructions === undefined) return result;

  for (const i of each(instructions)) {
    if (at(i, "moduleItems") !== undefined) {
      tweets.content.push(...extractTweetsFromModuleItems(at(i, "moduleItems")));
      continue;
    }

    for (const e of each(i, "entries")) {
      const entry = entryId(e);
      if (entry.startsWith("tweet") || entry.startsWith("profile-grid")) {
        tweets.content.push(...extractTweetsFromEntry(e));
      } else if (entry.includes("-conversation-") || entry.startsWith("homeConversation")) {
        const { thread } = parseGraphThread(e);
        tweets.content.push(...thread.content);
      } else if (entry.startsWith("cursor-bottom")) {
        tweets.bottom = str(at(e, "content", "value"));
      }
    }

    if (after.length === 0 && typeName(i) === "TimelinePinEntry") {
      const pinned = extractTweetsFromEntry(at(i, "entry"));
      if (pinned.length > 0) {
        const tweet = pinned[0] as Tweet;
        tweet.pinned = true;
        result.pinned = tweet;
      }
    }
  }

  return result;
}

/** Port of `parseGraphPhotoRail` (max 16 gallery photos). */
export function parseGraphPhotoRail(js: Json): PhotoRail {
  const result: PhotoRail = [];

  const instructions = pick(
    at(js, "data", "user", "result", "timeline", "timeline", "instructions"),
    at(js, "data", "user_result", "result", "timeline_response", "timeline", "instructions"),
  );
  if (instructions === undefined) return result;

  const push = (tweet: Tweet): boolean => {
    const photo = extractGalleryPhoto(tweet);
    if (photo.url.length > 0) result.push(photo);
    return result.length !== 16;
  };

  for (const i of each(instructions)) {
    if (at(i, "moduleItems") !== undefined) {
      for (const t of extractTweetsFromModuleItems(at(i, "moduleItems"))) {
        if (!push(t)) return result;
      }
      continue;
    }
    if (typeName(i) !== "TimelineAddEntries") continue;

    for (const e of each(i, "entries")) {
      const entry = entryId(e);
      if (entry.startsWith("tweet") || entry.startsWith("profile-grid")) {
        for (const t of extractTweetsFromEntry(e)) {
          if (!push(t)) return result;
        }
      }
    }
  }
  return result;
}

/** Port of `parseGraphConversation`. */
export function parseGraphConversation(js: Json, tweetId: string): Conversation {
  const replies: ChainResult = {
    content: [],
    top: "",
    bottom: "",
    beginning: true,
    query: emptyQuery(),
  };
  const result: Conversation = {
    tweet: newTweet(),
    before: { content: [], hasMore: false, cursor: "", related: false },
    after: { content: [], hasMore: false, cursor: "", related: false },
    replies,
  };

  const instructions = pick(
    at(js, "data", "timelineResponse", "instructions"),
    at(js, "data", "timeline_response", "instructions"),
    at(js, "data", "threaded_conversation_with_injections_v2", "instructions"),
  );
  if (instructions === undefined || each(instructions).length === 0) return result;

  for (const i of each(instructions)) {
    if (typeName(i) !== "TimelineAddEntries") continue;

    for (const e of each(i, "entries")) {
      const entry = entryId(e);
      if (entry.startsWith("tweet-")) {
        const tweetResult = getTweetResult(e);
        if (tweetResult !== undefined) {
          const tweet = parseGraphTweet(tweetResult);
          if (!tweet.available) tweet.id = idFromEntry(entry);

          if (entry.endsWith(tweetId)) {
            result.tweet = tweet;
          } else {
            result.before.content.push(tweet);
          }
        } else if (!entry.endsWith(tweetId)) {
          result.before.content.push({ ...newTweet(), id: idFromEntry(entry) });
        }
      } else if (
        entry.startsWith("conversationthread") ||
        entry.startsWith("tweetdetailrelatedtweets")
      ) {
        const { thread, self } = parseGraphThread(e);
        if (self) {
          result.after = thread;
        } else if (thread.content.length > 0) {
          result.replies.content.push(thread);
        }
      } else if (entry.startsWith("tombstone")) {
        const content = pick(at(e, "content", "content"), at(e, "content", "itemContent"));
        const tweet = {
          ...newTweet(),
          id: idFromEntry(entry),
          text: str(content, "tombstoneInfo", "richText"),
        };
        if (tweet.id === tweetId) {
          result.tweet = tweet;
        } else {
          result.before.content.push(tweet);
        }
      } else if (entry.startsWith("cursor-bottom")) {
        const cursorValue = pick(
          at(e, "content", "value"),
          at(e, "content", "content", "value"),
          at(e, "content", "itemContent", "value"),
        );
        result.replies.bottom = str(cursorValue);
      }
    }
  }

  return result;
}

/** Port of `parseGraphEditHistory`. */
export function parseGraphEditHistory(js: Json, tweetId: string): EditHistory {
  const result: EditHistory = { latest: newTweet(), history: [] };
  void tweetId;

  const instructions = at(
    js,
    "data",
    "tweet_result_by_rest_id",
    "result",
    "edit_history_timeline",
    "timeline",
    "instructions",
  );
  if (instructions === undefined || each(instructions).length === 0) return result;

  for (const i of each(instructions)) {
    if (typeName(i) !== "TimelineAddEntries") continue;
    for (const e of each(i, "entries")) {
      const entry = entryId(e);
      if (entry === "latestTweet") {
        const item = each(e, "content", "items")[0];
        const tweetResult = item === undefined ? undefined : getTweetResult(item, "item");
        if (tweetResult !== undefined) result.latest = parseGraphTweet(tweetResult);
      } else if (entry === "staleTweets") {
        for (const item of each(e, "content", "items")) {
          const tweetResult = getTweetResult(item, "item");
          if (tweetResult !== undefined) result.history.push(parseGraphTweet(tweetResult));
        }
      }
    }
  }
  return result;
}

/** Port of `parseGraphSearch`, split by content kind. */
function parseGraphSearchBase(
  js: Json,
  after: string,
  addFromEntry: (e: Json, result: { push: (x: unknown) => void }) => void,
  addFromModule: (items: Json) => unknown[],
): { content: unknown[]; bottom: string } {
  let bottom = "";
  const content: unknown[] = [];

  const instructions = pick(
    at(js, "data", "search", "timeline_response", "timeline", "instructions"),
    at(js, "data", "search_by_raw_query", "search_timeline", "timeline", "instructions"),
  );
  if (instructions === undefined) return { content, bottom };

  for (const instruction of each(instructions)) {
    const typ = typeName(instruction);
    if (typ === "TimelineAddEntries") {
      for (const e of each(instruction, "entries")) {
        addFromEntry(e, { push: (x) => content.push(x) });
        if (entryId(e).startsWith("cursor-bottom")) {
          bottom = str(at(e, "content", "value"));
        }
      }
    } else if (typ === "TimelineAddToModule") {
      content.push(...addFromModule(at(instruction, "moduleItems")));
    } else if (typ === "TimelineReplaceEntry") {
      if (str(instruction, "entry_id_to_replace").startsWith("cursor-bottom")) {
        bottom = str(at(instruction, "entry", "content", "value"));
      }
    }
  }
  void after;
  return { content, bottom };
}

export function parseGraphSearchTweets(js: Json, after = ""): TimelineResult {
  const { content, bottom } = parseGraphSearchBase(
    js,
    after,
    (e, sink) => {
      const entry = entryId(e);
      if (entry.startsWith("tweet") || entry.startsWith("search-grid")) {
        for (const tweet of extractTweetsFromEntry(e)) sink.push(tweet);
      }
    },
    (items) => extractTweetsFromModuleItems(items),
  );
  return {
    content: content as Tweet[],
    top: "",
    bottom,
    beginning: after.length === 0,
    query: emptyQuery(),
  };
}

export function parseGraphSearchUsers(js: Json, after = ""): Result<User> {
  const { content, bottom } = parseGraphSearchBase(
    js,
    after,
    (e, sink) => {
      if (entryId(e).startsWith("user")) {
        const userRes = at(e, "content", "itemContent");
        if (userRes !== undefined) sink.push(parseGraphUser(userRes));
      }
    },
    () => [],
  );
  return {
    content: content as User[],
    top: "",
    bottom,
    beginning: after.length === 0,
    query: emptyQuery(QueryKind.users),
  };
}

export function parseGraphSearchLists(js: Json, after = ""): Result<ListSearchResult> {
  const { content, bottom } = parseGraphSearchBase(
    js,
    after,
    (e, sink) => {
      if (entryId(e).startsWith("list-search")) {
        for (const list of extractListsFromItems(each(e, "content", "items"))) sink.push(list);
      }
    },
    (items) => extractListsFromItems(items),
  );
  return {
    content: content as ListSearchResult[],
    top: "",
    bottom,
    beginning: after.length === 0,
    query: emptyQuery(QueryKind.lists),
  };
}

/** Port of `parseGraphCommunityTimeline`. */
export function parseGraphCommunityTimeline(js: Json, after = ""): TimelineResult {
  const result: TimelineResult = {
    content: [],
    top: "",
    bottom: "",
    beginning: after.length === 0,
    query: emptyQuery(),
  };

  const communityResult = at(js, "data", "communityResults", "result");
  const instructions = pick(
    at(communityResult, "ranked_community_timeline", "timeline", "instructions"),
    at(communityResult, "community_media_timeline", "timeline", "instructions"),
    at(communityResult, "community_filtered_timeline", "timeline", "instructions"),
  );
  if (instructions === undefined || each(instructions).length === 0) return result;

  for (const i of each(instructions)) {
    for (const e of each(i, "entries")) {
      const entry = entryId(e);
      if (
        entry.startsWith("tweet") ||
        entry.startsWith("profile-grid") ||
        entry.startsWith("communities-grid")
      ) {
        result.content.push(...extractTweetsFromEntry(e));
      } else if (entry.startsWith("cursor-bottom")) {
        result.bottom = str(at(e, "content", "value"));
      }
    }

    if (after.length === 0 && typeName(i) === "TimelinePinEntry") {
      const pinned = extractTweetsFromEntry(at(i, "entry"));
      for (const tweet of pinned) tweet.pinned = true;
      if (pinned.length > 0) result.content.unshift(...pinned);
    }
  }

  return result;
}

/** Port of `parseGraphCommunityMembers`. */
export function parseGraphCommunityMembers(js: Json, after = ""): Result<User> {
  const result: Result<User> = {
    content: [],
    top: "",
    bottom: "",
    beginning: after.length === 0,
    query: emptyQuery(QueryKind.userList),
  };

  const r = at(js, "data", "communityResults", "result");
  const slice =
    at(r, "members_slice") !== undefined ? at(r, "members_slice") : at(r, "moderators_slice");

  for (const item of each(slice, "items_results")) {
    const user = parseGraphUser(at(item, "result"));
    if (user.username.length > 0) result.content.push(user);
  }

  const cursor = str(slice, "slice_info", "next_cursor");
  if (cursor.length > 0) result.bottom = cursor;

  return result;
}

/** Port of the experimental `parseGraphListMembers` (jsony string body → `Json`). */
export function parseGraphListMembers(json: Json, cursor: string): Result<User> {
  const result: Result<User> = {
    content: [],
    top: "",
    bottom: "",
    beginning: cursor.length === 0,
    query: emptyQuery(QueryKind.userList),
  };

  const raw = typeof json === "string" ? safeParse(json) : json;
  for (const instruction of each(
    at(raw, "data", "list", "members_timeline", "timeline", "instructions"),
  )) {
    if (typeName(instruction) !== "TimelineAddEntries") continue;
    for (const entry of each(instruction, "entries")) {
      const itemContent = at(entry, "content");
      const entryType = str(itemContent, "entryType");
      if (entryType === "TimelineTimelineItem") {
        // upstream sends snake_case `user_results`; the experimental structs
        // rename it to `userResults`, so both are accepted
        const userResult = pick(
          at(itemContent, "itemContent", "user_results", "result"),
          at(itemContent, "itemContent", "userResults", "result"),
        );
        if (str(userResult, "rest_id").length > 0) {
          result.content.push(parseUserResult(userResult));
        }
      } else if (
        entryType === "TimelineTimelineCursor" &&
        str(itemContent, "cursorType") === "Bottom"
      ) {
        result.bottom = str(itemContent, "value");
      }
    }
  }
  return result;
}

/** Port of the experimental `parseGraphFollowers` (jsony string body → `Json`). */
export function parseGraphFollowers(json: Json, cursor: string, kind: QueryKind): Result<User> {
  const result: Result<User> = {
    content: [],
    top: "",
    bottom: "",
    beginning: cursor.length === 0,
    query: emptyQuery(kind),
  };

  const raw = typeof json === "string" ? safeParse(json) : json;
  if (isNull(raw)) return result;

  for (const instruction of each(
    at(raw, "data", "user", "result", "timeline", "timeline", "instructions"),
  )) {
    if (typeName(instruction) !== "TimelineAddEntries") continue;
    for (const entry of each(instruction, "entries")) {
      const itemContent = at(entry, "content");
      const entryType = str(itemContent, "entryType");
      if (entryType === "TimelineTimelineItem") {
        const userResult = pick(
          at(itemContent, "itemContent", "user_results", "result"),
          at(itemContent, "itemContent", "userResults", "result"),
        );
        if (str(userResult, "rest_id").length > 0) {
          result.content.push(parseUserResult(userResult));
        }
      } else if (
        entryType === "TimelineTimelineCursor" &&
        str(itemContent, "cursorType") === "Bottom"
      ) {
        result.bottom = str(itemContent, "value");
      }
    }
  }
  return result;
}

function safeParse(json: string): Json {
  try {
    return JSON.parse(json) as Json;
  } catch {
    return undefined;
  }
}
