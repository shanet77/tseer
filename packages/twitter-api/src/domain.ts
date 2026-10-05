/**
 * The plan §3 provider seam: `ctx.twitter` with domain return types. This
 * composes the raw fetchers (`fetchers.ts`, ports of `api.nim`'s request
 * construction) with the `ctx.parsers` registry — nitter's `getGraph*` procs
 * are exactly `fetch → parse`, and this module is that composition.
 *
 * `search`'s repeat-page clearing (nitter #1372) and `tweet`'s two-request
 * replies composition live here because they need *parsed* content, not raw
 * bodies.
 */

import type { ParserKind, Parsers } from "@tseer/twitter-parser";
import {
  type AccountInfo,
  type Article,
  type AudioSpace,
  type Broadcast,
  type Community,
  type Conversation,
  type EditHistory,
  type List,
  type ListSearchResult,
  type PhotoRail,
  type Profile,
  type Query,
  QueryKind,
  RankingMode,
  type Result,
  type TimelineResult,
  type Tweet,
  type User,
} from "@tseer/types";
import { type CachedApiOptions, type CachedMethods, createCachedMethods } from "./cached.ts";
import type { Json } from "./fetch.ts";
import type { RawSearch, RawTwitterApi } from "./fetchers.ts";

/** `getGraphUserTweets`' return: a Profile without its route-filled halves. */
export type ProfileTweets = Pick<Profile, "pinned" | "tweets">;

/**
 * Plan §3 provider seam — domain-flavoured. Method docs name the `api.nim`
 * proc each one completes.
 */
export interface TwitterApi {
  /** Port of `getGraphUser` (`fetchRaw`): parsed user or `undefined`. */
  user(username: string): Promise<User | undefined>;
  /** Port of `getGraphUserById` (`fetchRaw`). */
  userById(id: string): Promise<User | undefined>;
  /** Port of `getAboutAccount`. */
  aboutAccount(username: string): Promise<AccountInfo | undefined>;
  /** Port of `getGraphUserTweets` with `TimelineKind.tweets`. */
  tweets(userId: string, cursor?: string): Promise<ProfileTweets | undefined>;
  /** Port of `getGraphUserTweets` with `TimelineKind.replies`. */
  tweetsAndReplies(userId: string, cursor?: string): Promise<ProfileTweets | undefined>;
  /** Port of `getGraphUserTweets` with `TimelineKind.media`. */
  media(userId: string, cursor?: string): Promise<ProfileTweets | undefined>;
  /** Port of `getGraphUserTweets` with `TimelineKind.articles`. */
  articles(userId: string, cursor?: string): Promise<ProfileTweets | undefined>;
  /** Port of `getPhotoRail`. */
  photoRail(userId: string): Promise<PhotoRail | undefined>;
  /**
   * Port of `getTweet`: the conversation request, then (when `cursor` is
   * given) a second request whose replies replace the first page's.
   */
  tweet(id: string, cursor?: string, mode?: RankingMode): Promise<Conversation | undefined>;
  /** Port of `getGraphTweetResult`. */
  tweetResult(id: string): Promise<Tweet | undefined>;
  /** Port of `getTweetByRestId`. */
  tweetByRestId(id: string): Promise<Tweet | undefined>;
  /** Port of `getGraphTweetResults` (article batch). */
  tweetResults(ids: readonly string[]): Promise<Tweet[] | undefined>;
  /** Port of `getGraphEditHistory`. */
  editHistory(id: string): Promise<EditHistory | undefined>;
  /**
   * Port of `getGraphTweetSearch`: incl. the `maxid:` workaround and the
   * #1372 repeat-page clearing.
   */
  search(query: Query, cursor?: string): Promise<TimelineResult | undefined>;
  /** Port of `getGraphUserSearch` (`product=People`). */
  userSearch(query: Query, cursor?: string): Promise<Result<User> | undefined>;
  /** Port of `getGraphListSearch` (`product=Lists`). */
  listSearch(query: Query, cursor?: string): Promise<Result<ListSearchResult> | undefined>;
  /** Port of `getGraphListTweets` (plan §3 `list`): the timeline only. */
  list(id: string, cursor?: string): Promise<TimelineResult | undefined>;
  /** Port of `getGraphList` (list metadata, not its timeline). */
  listInfo(id: string): Promise<List | undefined>;
  /** Port of `getGraphListBySlug`. */
  listBySlug(name: string, slug: string): Promise<List | undefined>;
  /** Port of `getGraphListMembers` (`fetchRaw`). */
  listMembers(id: string, cursor?: string): Promise<Result<User> | undefined>;
  /** Port of `getGraphFollowers` (`fetchRaw`). */
  followers(userId: string, cursor?: string): Promise<Result<User> | undefined>;
  /** Port of `getGraphFollowing` (`fetchRaw`). */
  following(userId: string, cursor?: string): Promise<Result<User> | undefined>;
  /** Port of `getGraphCommunityTweets` (plan §3 `community`). */
  community(
    id: string,
    cursor?: string,
    rankingMode?: RankingMode,
  ): Promise<TimelineResult | undefined>;
  /** Port of `getGraphCommunity` (community metadata). */
  communityInfo(id: string): Promise<Community | undefined>;
  /** Port of `getGraphCommunityMedia`. */
  communityMedia(id: string, cursor?: string): Promise<TimelineResult | undefined>;
  /** Port of `getGraphCommunityMembers`. */
  communityMembers(id: string, cursor?: string): Promise<Result<User> | undefined>;
  /** Port of `getGraphCommunityModerators`. */
  communityModerators(id: string): Promise<Result<User> | undefined>;
  /** Port of `getGraphCommunityHashtags`. */
  communityHashtags(
    id: string,
    hashtag: string,
    cursor?: string,
  ): Promise<TimelineResult | undefined>;
  /** Port of `getGraphArticle` (`fetchRaw`). */
  article(id: string): Promise<Article | undefined>;
  /** Port of `getAudioSpace`. */
  space(id: string): Promise<AudioSpace | undefined>;
  /** Port of `getBroadcastInfo`. */
  broadcast(id: string): Promise<Broadcast | undefined>;
  /** Port of `fetchBroadcastStream` (no parsing; raw playback URL). */
  broadcastStream(mediaKey: string): Promise<string | undefined>;

  // The redis_cache.nim wrappers (`getCached*`) — outside plan §3's sketch,
  // but the seam the route plugins consume (Phase 4/5), exactly like nitter's
  // routes call `getCachedUser` & co. directly.

  /** Port of `getCachedUser`. */
  cachedUser(username: string, fetch?: boolean): Promise<User | undefined>;
  /** Port of `getCachedUsername` (the `i:` reverse lookup). */
  cachedUsername(userId: string): Promise<string>;
  /** Port of `getCachedAccountInfo`. */
  cachedAccountInfo(username: string, fetch?: boolean): Promise<AccountInfo | undefined>;
  /** Port of `getCachedPhotoRail`. */
  cachedPhotoRail(id: string): Promise<PhotoRail | undefined>;
  /** Port of `getCachedBroadcast`. */
  cachedBroadcast(id: string): Promise<Broadcast | undefined>;
  /** Port of `getCachedAudioSpace`. */
  cachedSpace(id: string): Promise<AudioSpace | undefined>;
  /** Port of `getCachedCommunity`. */
  cachedCommunity(id: string): Promise<Community | undefined>;
  /** Port of `getCachedCommunityModerators`. */
  cachedCommunityModerators(id: string): Promise<User[] | undefined>;
  /** Port of `getCachedList`. */
  cachedList(username?: string, slug?: string, id?: string): Promise<List | undefined>;
}

/**
 * `fetchRaw` bodies are only parsed when they look like JSON objects
 * (nitter's `json[0] != '{'` guard); anything else — empty body, CF
 * interstitial — is a miss.
 */
function parseBody(
  parsers: Parsers,
  body: string | undefined,
  kind: ParserKind,
  options = {},
): unknown {
  if (body === undefined) return undefined;
  const trimmed = body.trimStart();
  if (!trimmed.startsWith("{")) return undefined;
  let json: Json;
  try {
    json = JSON.parse(trimmed) as Json;
  } catch {
    return undefined;
  }
  return parsers.parse(kind, json, options);
}

function parseJson(
  parsers: Parsers,
  json: Json | undefined,
  kind: ParserKind,
  options = {},
): unknown {
  if (json === undefined) return undefined;
  return parsers.parse(kind, json, options);
}

/** Port of `getGraphTweetSearch`'s tail: nitter #1372. */
function clearRepeatedPage(after: string, bottom: string, result: TimelineResult): void {
  const prefix = Math.min(64, Math.min(after.length, bottom.length));
  if (prefix > 0 && after.slice(0, prefix) === bottom.slice(0, prefix)) {
    result.content.length = 0;
  }
}

function emptyEnvelope(query: Query): {
  content: never[];
  top: string;
  bottom: string;
  beginning: boolean;
  query: Query;
} {
  return { content: [], top: "", bottom: "", beginning: true, query };
}

export function createDomainTwitterApi(
  raw: RawTwitterApi,
  parsers: Parsers,
  cachedOptions: CachedApiOptions = {},
): TwitterApi {
  const timeline = async (
    kind: "tweets" | "tweetsAndReplies" | "media" | "articles",
    userId: string,
    cursor: string,
  ): Promise<ProfileTweets | undefined> => {
    const body = await raw[kind](userId, cursor);
    if (body === undefined) return undefined;
    return parseJson(parsers, body, "timeline", { after: cursor }) as ProfileTweets | undefined;
  };

  const searchLike = async <T>(
    fetcher: (query: Query, cursor: string) => Promise<RawSearch>,
    kind: ParserKind,
    query: Query,
    cursor: string,
  ): Promise<T | undefined> => {
    const rawSearch = await fetcher(query, cursor);
    if (rawSearch.json === undefined) return emptyEnvelope(query) as T;
    const parsed = parseJson(parsers, rawSearch.json, kind, { after: cursor }) as T & {
      bottom: string;
      query: Query;
      content: unknown[];
    };
    if (parsed === undefined) return undefined;
    parsed.query = query;
    if (kind === "searchTweets" && !cursor.startsWith("maxid:")) {
      clearRepeatedPage(cursor, parsed.bottom, parsed as unknown as TimelineResult);
    }
    return parsed;
  };

  type CoreApi = Omit<TwitterApi, keyof CachedMethods>;
  const core: CoreApi = {
    async user(username) {
      return parseBody(parsers, await raw.user(username), "user") as User | undefined;
    },

    async userById(id) {
      return parseBody(parsers, await raw.userById(id), "user") as User | undefined;
    },

    async aboutAccount(username) {
      return parseJson(parsers, await raw.aboutAccount(username), "aboutAccount") as
        | AccountInfo
        | undefined;
    },

    tweets: (userId, cursor = "") => timeline("tweets", userId, cursor),
    tweetsAndReplies: (userId, cursor = "") => timeline("tweetsAndReplies", userId, cursor),
    media: (userId, cursor = "") => timeline("media", userId, cursor),
    articles: (userId, cursor = "") => timeline("articles", userId, cursor),

    async photoRail(userId) {
      return parseJson(parsers, await raw.photoRail(userId), "photoRail") as PhotoRail | undefined;
    },

    async tweet(id, cursor = "", mode = RankingMode.Relevance) {
      const first = parseJson(parsers, await raw.tweet(id, "", mode), "conversation", {
        tweetId: id,
      }) as Conversation | undefined;
      if (first === undefined) return undefined;
      if (cursor.length > 0) {
        const second = parseJson(parsers, await raw.tweet(id, cursor, mode), "conversation", {
          tweetId: id,
        }) as Conversation | undefined;
        if (second !== undefined) {
          first.replies = second.replies;
          first.replies.beginning = false;
        }
      }
      return first;
    },

    async tweetResult(id) {
      return parseJson(parsers, await raw.tweetResult(id), "tweetResult") as Tweet | undefined;
    },

    async tweetByRestId(id) {
      return parseJson(parsers, await raw.tweetByRestId(id), "tweetByRestId") as Tweet | undefined;
    },

    async tweetResults(ids) {
      return parseJson(parsers, await raw.tweetResults(ids), "tweetResults") as Tweet[] | undefined;
    },

    async editHistory(id) {
      return parseJson(parsers, await raw.editHistory(id), "editHistory", {
        tweetId: id,
      }) as EditHistory | undefined;
    },

    search: (query, cursor = "") =>
      searchLike<TimelineResult>(raw.search, "searchTweets", query, cursor),

    userSearch: (query, cursor = "") =>
      searchLike<Result<User>>(raw.userSearch, "searchUsers", query, cursor),

    listSearch: (query, cursor = "") =>
      searchLike<Result<ListSearchResult>>(raw.listSearch, "searchLists", query, cursor),

    async list(id, cursor = "") {
      const body = await raw.list(id, cursor);
      if (body === undefined) return undefined;
      const parsed = parseJson(parsers, body, "timeline", { after: cursor }) as
        | Pick<Profile, "tweets">
        | undefined;
      return parsed?.tweets;
    },

    async listInfo(id) {
      return parseJson(parsers, await raw.listInfo(id), "list") as List | undefined;
    },

    async listBySlug(name, slug) {
      return parseJson(parsers, await raw.listBySlug(name, slug), "list") as List | undefined;
    },

    async listMembers(id, cursor = "") {
      return parseBody(parsers, await raw.listMembers(id, cursor), "listMembers", {
        after: cursor,
      }) as Result<User> | undefined;
    },

    async followers(userId, cursor = "") {
      return parseBody(parsers, await raw.followers(userId, cursor), "followers", {
        after: cursor,
        kind: QueryKind.followers,
      }) as Result<User> | undefined;
    },

    async following(userId, cursor = "") {
      return parseBody(parsers, await raw.following(userId, cursor), "followers", {
        after: cursor,
        kind: QueryKind.following,
      }) as Result<User> | undefined;
    },

    async community(id, cursor = "", rankingMode = RankingMode.Relevance) {
      return parseJson(parsers, await raw.community(id, cursor, rankingMode), "communityTimeline", {
        after: cursor,
      }) as TimelineResult | undefined;
    },

    async communityInfo(id) {
      return parseJson(parsers, await raw.communityInfo(id), "community") as Community | undefined;
    },

    async communityMedia(id, cursor = "") {
      return parseJson(parsers, await raw.communityMedia(id, cursor), "communityTimeline", {
        after: cursor,
      }) as TimelineResult | undefined;
    },

    async communityMembers(id, cursor = "") {
      return parseJson(parsers, await raw.communityMembers(id, cursor), "communityMembers", {
        after: cursor,
      }) as Result<User> | undefined;
    },

    async communityModerators(id) {
      return parseJson(parsers, await raw.communityModerators(id), "communityMembers") as
        | Result<User>
        | undefined;
    },

    async communityHashtags(id, hashtag, cursor = "") {
      return parseJson(
        parsers,
        await raw.communityHashtags(id, hashtag, cursor),
        "communityTimeline",
        { after: cursor },
      ) as TimelineResult | undefined;
    },

    async article(id) {
      return parseBody(parsers, await raw.article(id), "article") as Article | undefined;
    },

    async space(id) {
      return parseJson(parsers, await raw.space(id), "space") as AudioSpace | undefined;
    },

    async broadcast(id) {
      return parseJson(parsers, await raw.broadcast(id), "broadcast") as Broadcast | undefined;
    },

    broadcastStream: (mediaKey) => raw.broadcastStream(mediaKey),
  };

  const cached = createCachedMethods(
    {
      user: (username) => core.user(username),
      userById: (id) => core.userById(id),
      aboutAccount: (username) => core.aboutAccount(username),
      photoRail: (id) => core.photoRail(id),
      broadcast: (id) => core.broadcast(id),
      space: (id) => core.space(id),
      broadcastStream: (mediaKey) => core.broadcastStream(mediaKey),
      communityInfo: (id) => core.communityInfo(id),
      communityModerators: (id) => core.communityModerators(id),
      listInfo: (id) => core.listInfo(id),
      listBySlug: (name, slug) => core.listBySlug(name, slug),
    },
    cachedOptions,
  );
  return { ...core, ...cached };
}
