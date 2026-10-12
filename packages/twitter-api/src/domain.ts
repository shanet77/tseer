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
  type Rss,
  type TimelineResult,
  type Tweet,
  type User,
} from "@tseer/types";
import { type CachedApiOptions, type CachedMethods, createCachedMethods } from "./cached.ts";
import type { Json } from "./fetch.ts";
import type { RawSearch, RawTwitterApi } from "./fetchers.ts";

export type ProfileTweets = Pick<Profile, "pinned" | "tweets">;

export interface TwitterApi {
  user(username: string): Promise<User | undefined>;
  userById(id: string): Promise<User | undefined>;
  aboutAccount(username: string): Promise<AccountInfo | undefined>;
  tweets(userId: string, cursor?: string): Promise<ProfileTweets | undefined>;
  tweetsAndReplies(userId: string, cursor?: string): Promise<ProfileTweets | undefined>;
  media(userId: string, cursor?: string): Promise<ProfileTweets | undefined>;
  articles(userId: string, cursor?: string): Promise<ProfileTweets | undefined>;
  photoRail(userId: string): Promise<PhotoRail | undefined>;
  tweet(id: string, cursor?: string, mode?: RankingMode): Promise<Conversation | undefined>;
  tweetResult(id: string): Promise<Tweet | undefined>;
  tweetByRestId(id: string): Promise<Tweet | undefined>;
  tweetResults(ids: readonly string[]): Promise<Tweet[] | undefined>;
  editHistory(id: string): Promise<EditHistory | undefined>;
  search(query: Query, cursor?: string): Promise<TimelineResult | undefined>;
  userSearch(query: Query, cursor?: string): Promise<Result<User> | undefined>;
  listSearch(query: Query, cursor?: string): Promise<Result<ListSearchResult> | undefined>;
  list(id: string, cursor?: string): Promise<TimelineResult | undefined>;
  listInfo(id: string): Promise<List | undefined>;
  listBySlug(name: string, slug: string): Promise<List | undefined>;
  listMembers(id: string, cursor?: string): Promise<Result<User> | undefined>;
  followers(userId: string, cursor?: string): Promise<Result<User> | undefined>;
  following(userId: string, cursor?: string): Promise<Result<User> | undefined>;
  community(
    id: string,
    cursor?: string,
    rankingMode?: RankingMode,
  ): Promise<TimelineResult | undefined>;
  communityInfo(id: string): Promise<Community | undefined>;
  communityMedia(id: string, cursor?: string): Promise<TimelineResult | undefined>;
  communityMembers(id: string, cursor?: string): Promise<Result<User> | undefined>;
  communityModerators(id: string): Promise<Result<User> | undefined>;
  communityHashtags(
    id: string,
    hashtag: string,
    cursor?: string,
  ): Promise<TimelineResult | undefined>;
  article(id: string): Promise<Article | undefined>;
  space(id: string): Promise<AudioSpace | undefined>;
  broadcast(id: string): Promise<Broadcast | undefined>;
  broadcastStream(mediaKey: string): Promise<string | undefined>;
  resolve(url: string): Promise<string>;

  cachedUser(username: string, fetch?: boolean): Promise<User | undefined>;
  cachedUsername(userId: string): Promise<string>;
  cachedAccountInfo(username: string, fetch?: boolean): Promise<AccountInfo | undefined>;
  cachedPhotoRail(id: string): Promise<PhotoRail | undefined>;
  cachedBroadcast(id: string): Promise<Broadcast | undefined>;
  cachedSpace(id: string): Promise<AudioSpace | undefined>;
  cachedCommunity(id: string): Promise<Community | undefined>;
  cachedCommunityModerators(id: string): Promise<User[] | undefined>;
  cachedList(username?: string, slug?: string, id?: string): Promise<List | undefined>;
  cachedRss(key: string, factory: () => Promise<Rss>): Promise<Rss>;
}

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

    resolve: (url) => raw.resolve(url),
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
