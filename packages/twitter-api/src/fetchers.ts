/**
 * The `getGraph*` fetchers — a port of nitter's `api.nim`, split the way
 * nitter splits it: this module does *request construction + fetch only* and
 * returns raw upstream bodies; the `parse*` half lands in `twitter-parser`
 * (plan §2 `ctx.parsers`) and will wrap these into plan §3's domain types.
 *
 * Naming: the plan §3 `TwitterApi` seam names are used where they map
 * (`user`, `tweets`, `tweet`, `search`, `list`, `community`, `space`, …);
 * the nitter proc each one ports is named in its doc comment. Extra nitter
 * fetchers outside plan §3 (followers, list metadata, edit history, …) keep
 * shortened nitter names so Phase 5 routes can find them.
 *
 * Guards mirror nitter's early returns (`if id.len == 0: return`): a skipped
 * fetch yields `undefined` (nitter yields a default-constructed object), and
 * `fetch`'s non-JSON `null` is preserved as-is, so callers can still tell
 * "not fetched" from "fetched junk".
 */
import { type Query, QueryKind, RankingMode, TimelineKind } from "@tseer/types";
import {
  apiReq,
  communitySliceReq,
  cursorParam,
  mediaUrl,
  restReq,
  subst,
  tweetDetailUrl,
  userArticlesUrl,
  userTweetsAndRepliesUrl,
  userTweetsUrl,
  userUrl,
} from "./client.ts";
import {
  ARTICLE_BATCH_VARS,
  ARTICLE_FIELD_TOGGLES,
  ARTICLE_VARS,
  COMMUNITY_HASHTAGS_VARS,
  COMMUNITY_MEDIA_VARS,
  COMMUNITY_MEMBERS_VARS,
  COMMUNITY_TWEETS_VARS,
  GRAPH_ABOUT_ACCOUNT,
  GRAPH_AUDIO_SPACE,
  GRAPH_BROADCAST,
  GRAPH_COMMUNITY,
  GRAPH_COMMUNITY_HASHTAGS,
  GRAPH_COMMUNITY_MEDIA,
  GRAPH_COMMUNITY_MEMBERS,
  GRAPH_COMMUNITY_MODERATORS,
  GRAPH_COMMUNITY_TWEETS,
  GRAPH_FOLLOWERS,
  GRAPH_FOLLOWING,
  GRAPH_LIST_BY_ID,
  GRAPH_LIST_BY_SLUG,
  GRAPH_LIST_MEMBERS,
  GRAPH_LIST_TWEETS,
  GRAPH_SEARCH_TIMELINE,
  GRAPH_TWEET_EDIT_HISTORY,
  GRAPH_TWEET_RESULT,
  GRAPH_TWEET_RESULT_BY_REST_ID,
  GRAPH_TWEET_RESULTS_BY_REST_IDS,
  GRAPH_USER_BY_ID,
  REST_ID_VARS,
  REST_LIVE_STREAM,
  TWEET_BY_REST_ID_VARS,
  TWEET_EDIT_HISTORY_VARS,
  USER_BY_REST_ID_VARS,
} from "./endpoints.ts";
import type { Fetcher, Json } from "./fetch.ts";
import { EMPTY_QUERY, genQueryParam, validateNumber } from "./search-query.ts";

/**
 * Raw search payload. `beginning` is nitter's composed value: `true` when the
 * query compiled to nothing (no request was made) or when `cursor` is empty
 * (parsers set it from `after.len == 0`). The repeat-page workaround (#1372)
 * compares the extracted bottom cursor with `after` *after* parsing, so it
 * lands with `twitter-parser`.
 */
export interface RawSearch {
  json: Json | undefined;
  beginning: boolean;
}

export interface TwitterApiFetchers {
  fetch: Fetcher["fetch"];
  fetchRaw: Fetcher["fetchRaw"];
}

/**
 * The raw half of the provider seam: methods return the upstream body (JSON
 * for nitter's `fetch` procs, text for `fetchRaw`). The domain-flavoured
 * `TwitterApi` (plan §3) composes these with `ctx.parsers` in `domain.ts`.
 */
export interface RawTwitterApi {
  /** Port of `api.nim` `getGraphUser` (`fetchRaw`). */
  user(username: string): Promise<string | undefined>;
  /** Port of `api.nim` `getGraphUserById` (`fetchRaw`). */
  userById(id: string): Promise<string | undefined>;
  /** Port of `api.nim` `getAboutAccount`. */
  aboutAccount(username: string): Promise<Json | undefined>;
  /** Port of `api.nim` `getGraphUserTweets` with `TimelineKind.tweets`. */
  tweets(userId: string, cursor?: string): Promise<Json | undefined>;
  /** Port of `api.nim` `getGraphUserTweets` with `TimelineKind.replies`. */
  tweetsAndReplies(userId: string, cursor?: string): Promise<Json | undefined>;
  /** Port of `api.nim` `getGraphUserTweets` with `TimelineKind.media`. */
  media(userId: string, cursor?: string): Promise<Json | undefined>;
  /** Port of `api.nim` `getGraphUserTweets` with `TimelineKind.articles`. */
  articles(userId: string, cursor?: string): Promise<Json | undefined>;
  /** Port of `api.nim` `getPhotoRail`. */
  photoRail(userId: string): Promise<Json | undefined>;
  /**
   * Port of `api.nim` `getGraphTweet`: one ConversationTimeline request.
   * nitter's `getTweet` composes a second cursor request into
   * `Conversation.replies` — that composition needs the parse layer.
   */
  tweet(id: string, cursor?: string, mode?: RankingMode): Promise<Json | undefined>;
  /** Port of `api.nim` `getGraphTweetResult`. */
  tweetResult(id: string): Promise<Json | undefined>;
  /** Port of `api.nim` `getTweetByRestId`. */
  tweetByRestId(id: string): Promise<Json | undefined>;
  /** Port of `api.nim` `getGraphTweetResults` (article batch). */
  tweetResults(ids: readonly string[]): Promise<Json | undefined>;
  /** Port of `api.nim` `getGraphEditHistory`. */
  editHistory(id: string): Promise<Json | undefined>;
  /** Port of `api.nim` `getGraphTweetSearch` (incl. the `maxid:` workaround). */
  search(query: Query, cursor?: string): Promise<RawSearch>;
  /** Port of `api.nim` `getGraphUserSearch` (`product=People`). */
  userSearch(query: Query, cursor?: string): Promise<RawSearch>;
  /** Port of `api.nim` `getGraphListSearch` (`product=Lists`). */
  listSearch(query: Query, cursor?: string): Promise<RawSearch>;
  /** Port of `api.nim` `getGraphListTweets` (plan §3 `list`). */
  list(id: string, cursor?: string): Promise<Json | undefined>;
  /** Port of `api.nim` `getGraphList` (list metadata, not its timeline). */
  listInfo(id: string): Promise<Json | undefined>;
  /** Port of `api.nim` `getGraphListBySlug`. */
  listBySlug(name: string, slug: string): Promise<Json | undefined>;
  /** Port of `api.nim` `getGraphListMembers` (`fetchRaw`). */
  listMembers(id: string, cursor?: string): Promise<string | undefined>;
  /** Port of `api.nim` `getGraphFollowers` (`fetchRaw`). */
  followers(userId: string, cursor?: string): Promise<string | undefined>;
  /** Port of `api.nim` `getGraphFollowing` (`fetchRaw`). */
  following(userId: string, cursor?: string): Promise<string | undefined>;
  /** Port of `api.nim` `getGraphCommunityTweets` (plan §3 `community`). */
  community(id: string, cursor?: string, rankingMode?: RankingMode): Promise<Json | undefined>;
  /** Port of `api.nim` `getGraphCommunity` (community metadata). */
  communityInfo(id: string): Promise<Json | undefined>;
  /** Port of `api.nim` `getGraphCommunityMedia`. */
  communityMedia(id: string, cursor?: string): Promise<Json | undefined>;
  /** Port of `api.nim` `getGraphCommunityMembers`. */
  communityMembers(id: string, cursor?: string): Promise<Json | undefined>;
  /** Port of `api.nim` `getGraphCommunityModerators`. */
  communityModerators(id: string): Promise<Json | undefined>;
  /** Port of `api.nim` `getGraphCommunityHashtags`. */
  communityHashtags(id: string, hashtag: string, cursor?: string): Promise<Json | undefined>;
  /** Port of `api.nim` `getGraphArticle` (`fetchRaw`). */
  article(id: string): Promise<string | undefined>;
  /** Port of `api.nim` `getAudioSpace`. */
  space(id: string): Promise<Json | undefined>;
  /** Port of `api.nim` `getBroadcastInfo`. */
  broadcast(id: string): Promise<Json | undefined>;
  /**
   * Port of `api.nim` `fetchBroadcastStream`: dig `source.noRedirectPlaybackUrl`
   * (fallback `source.location`) out of the REST response. nitter returns `""`
   * when absent; `undefined` is this layer's empty.
   */
  broadcastStream(mediaKey: string): Promise<string | undefined>;
}

/** Port of `api.nim`'s inline `%*{...}` variable objects (key order included). */
function vars(value: Record<string, Json>): string {
  return JSON.stringify(value);
}

function searchVariables(rawQuery: string, product: string): Record<string, Json> {
  return {
    rawQuery,
    count: 20,
    querySource: "typed_query",
    product,
    withGrokTranslatedBio: true,
    withQuickPromoteEligibilityTweetFields: false,
  };
}

/** Port of `api.nim` `getGraphProductSearch`: `query.text`, no compilation. */
function productSearch(
  fetcher: TwitterApiFetchers,
  query: Query,
  product: string,
  cursor: string,
): Promise<RawSearch> {
  return (async (): Promise<RawSearch> => {
    if (query.text.length === 0) return { json: undefined, beginning: true };
    const variables = searchVariables(query.text, product);
    if (cursor.length > 0) variables.cursor = cursor;
    const json = await fetcher.fetch(apiReq(GRAPH_SEARCH_TIMELINE, vars(variables)));
    return { json, beginning: cursor.length === 0 };
  })();
}

export function createTwitterApi(fetcher: TwitterApiFetchers): RawTwitterApi {
  const timeline = (kind: TimelineKind, id: string, cursor: string): Promise<Json | undefined> => {
    if (id.length === 0) return Promise.resolve(undefined);
    const fragment = cursorParam(cursor);
    const req =
      kind === TimelineKind.tweets
        ? userTweetsUrl(id, fragment)
        : kind === TimelineKind.replies
          ? userTweetsAndRepliesUrl(id, fragment)
          : kind === TimelineKind.media
            ? mediaUrl(id, fragment)
            : userArticlesUrl(id, fragment);
    return fetcher.fetch(req);
  };

  const connections = (
    endpoint: string,
    userId: string,
    cursor: string,
  ): Promise<string | undefined> => {
    if (userId.length === 0) return Promise.resolve(undefined);
    const variables: Record<string, Json> = {
      userId,
      count: 20,
      includePromotedContent: false,
      withGrokTranslatedBio: true,
    };
    if (cursor.length > 0) variables.cursor = cursor;
    return fetcher.fetchRaw(apiReq(endpoint, vars(variables)));
  };

  return {
    async user(username) {
      if (username.length === 0) return undefined;
      return fetcher.fetchRaw(userUrl(username));
    },

    async userById(id) {
      if (id.length === 0 || !/^[0-9]+$/.test(id)) return undefined;
      return fetcher.fetchRaw(apiReq(GRAPH_USER_BY_ID, subst(USER_BY_REST_ID_VARS, [id])));
    },

    async aboutAccount(username) {
      if (username.length === 0) return undefined;
      return fetcher.fetch(apiReq(GRAPH_ABOUT_ACCOUNT, vars({ screenName: username })));
    },

    tweets: (userId, cursor = "") => timeline(TimelineKind.tweets, userId, cursor),
    tweetsAndReplies: (userId, cursor = "") => timeline(TimelineKind.replies, userId, cursor),
    media: (userId, cursor = "") => timeline(TimelineKind.media, userId, cursor),
    articles: (userId, cursor = "") => timeline(TimelineKind.articles, userId, cursor),

    async photoRail(userId) {
      if (userId.length === 0) return undefined;
      return fetcher.fetch(mediaUrl(userId, ""));
    },

    async tweet(id, cursor = "", mode = RankingMode.Relevance) {
      if (id.length === 0) return undefined;
      return fetcher.fetch(tweetDetailUrl(id, cursorParam(cursor), mode));
    },

    async tweetResult(id) {
      if (id.length === 0) return undefined;
      return fetcher.fetch(apiReq(GRAPH_TWEET_RESULT, vars({ rest_id: id })));
    },

    async tweetByRestId(id) {
      if (id.length === 0) return undefined;
      return fetcher.fetch(
        apiReq(
          GRAPH_TWEET_RESULT_BY_REST_ID,
          subst(TWEET_BY_REST_ID_VARS, [id]),
          ARTICLE_FIELD_TOGGLES,
        ),
      );
    },

    async tweetResults(ids) {
      if (ids.length === 0) return undefined;
      return fetcher.fetch(
        apiReq(
          GRAPH_TWEET_RESULTS_BY_REST_IDS,
          subst(ARTICLE_BATCH_VARS, [JSON.stringify(ids)]),
          ARTICLE_FIELD_TOGGLES,
        ),
      );
    },

    async editHistory(id) {
      if (id.length === 0) return undefined;
      return fetcher.fetch(apiReq(GRAPH_TWEET_EDIT_HISTORY, subst(TWEET_EDIT_HISTORY_VARS, [id])));
    },

    async search(query, cursor = "") {
      // Port of `getGraphTweetSearch`: the `maxid:` cursor workaround (#1372)
      // replaces pagination with `max_id` inside the compiled query.
      const after = cursor;
      const maxId = after.startsWith("maxid:") ? validateNumber(after.slice(6)) : "";
      const rawQuery = genQueryParam(query, maxId);
      if (rawQuery.length === 0 || rawQuery === EMPTY_QUERY) {
        return { json: undefined, beginning: true };
      }
      const product =
        query.kind === QueryKind.top
          ? "Top"
          : query.kind === QueryKind.media && query.fromUser.length === 0
            ? "Media"
            : "Latest";
      const variables = searchVariables(rawQuery, product);
      if (after.length > 0 && maxId.length === 0) variables.cursor = after;
      const json = await fetcher.fetch(apiReq(GRAPH_SEARCH_TIMELINE, vars(variables)));
      return { json, beginning: after.length === 0 };
    },

    userSearch: (query, cursor = "") => productSearch(fetcher, query, "People", cursor),
    listSearch: (query, cursor = "") => productSearch(fetcher, query, "Lists", cursor),

    async list(id, cursor = "") {
      if (id.length === 0) return undefined;
      return fetcher.fetch(
        apiReq(GRAPH_LIST_TWEETS, subst(REST_ID_VARS, [id, cursorParam(cursor), "20"])),
      );
    },

    async listInfo(id) {
      return fetcher.fetch(apiReq(GRAPH_LIST_BY_ID, vars({ listId: id })));
    },

    async listBySlug(name, slug) {
      return fetcher.fetch(apiReq(GRAPH_LIST_BY_SLUG, vars({ screenName: name, listSlug: slug })));
    },

    async listMembers(id, cursor = "") {
      if (id.length === 0) return undefined;
      const variables: Record<string, Json> = {
        listId: id,
        withBirdwatchPivots: false,
        withDownvotePerspective: false,
        withReactionsMetadata: false,
        withReactionsPerspective: false,
      };
      if (cursor.length > 0) variables.cursor = cursor;
      return fetcher.fetchRaw(apiReq(GRAPH_LIST_MEMBERS, vars(variables)));
    },

    followers: (userId, cursor = "") => connections(GRAPH_FOLLOWERS, userId, cursor),
    following: (userId, cursor = "") => connections(GRAPH_FOLLOWING, userId, cursor),

    async community(id, cursor = "", rankingMode = RankingMode.Relevance) {
      if (id.length === 0) return undefined;
      return fetcher.fetch(
        apiReq(
          GRAPH_COMMUNITY_TWEETS,
          subst(COMMUNITY_TWEETS_VARS, [id, cursorParam(cursor), rankingMode]),
        ),
      );
    },

    async communityInfo(id) {
      if (id.length === 0) return undefined;
      return fetcher.fetch(apiReq(GRAPH_COMMUNITY, vars({ communityId: id })));
    },

    async communityMedia(id, cursor = "") {
      if (id.length === 0) return undefined;
      return fetcher.fetch(
        apiReq(GRAPH_COMMUNITY_MEDIA, subst(COMMUNITY_MEDIA_VARS, [id, cursorParam(cursor)])),
      );
    },

    async communityMembers(id, cursor = "") {
      if (id.length === 0) return undefined;
      const cursorValue = cursor.length > 0 ? JSON.stringify(cursor) : "null";
      return fetcher.fetch(
        communitySliceReq(
          GRAPH_COMMUNITY_MEMBERS,
          subst(COMMUNITY_MEMBERS_VARS, [id, cursorValue]),
        ),
      );
    },

    async communityModerators(id) {
      if (id.length === 0) return undefined;
      return fetcher.fetch(
        communitySliceReq(GRAPH_COMMUNITY_MODERATORS, subst(COMMUNITY_MEMBERS_VARS, [id, "null"])),
      );
    },

    async communityHashtags(id, hashtag, cursor = "") {
      if (id.length === 0 || hashtag.length === 0) return undefined;
      const safeTag = hashtag.replaceAll('"', "").replaceAll("\\", "");
      return fetcher.fetch(
        apiReq(
          GRAPH_COMMUNITY_HASHTAGS,
          subst(COMMUNITY_HASHTAGS_VARS, [id, cursorParam(cursor), safeTag]),
        ),
      );
    },

    async article(id) {
      if (id.length === 0) return undefined;
      return fetcher.fetchRaw(
        apiReq(GRAPH_TWEET_RESULT_BY_REST_ID, subst(ARTICLE_VARS, [id]), ARTICLE_FIELD_TOGGLES),
      );
    },

    async space(id) {
      if (id.length === 0) return undefined;
      return fetcher.fetch(
        apiReq(
          GRAPH_AUDIO_SPACE,
          vars({
            id,
            isMetatagsQuery: false,
            withReplays: true,
            withListeners: true,
          }),
        ),
      );
    },

    async broadcast(id) {
      if (id.length === 0) return undefined;
      return fetcher.fetch(apiReq(GRAPH_BROADCAST, vars({ id })));
    },

    async broadcastStream(mediaKey) {
      if (mediaKey.length === 0) return undefined;
      const json = await fetcher.fetch(restReq(REST_LIVE_STREAM + mediaKey));
      const source =
        typeof json === "object" && json !== null && !Array.isArray(json)
          ? (json as { source?: unknown }).source
          : undefined;
      if (typeof source !== "object" || source === null || Array.isArray(source)) {
        return undefined;
      }
      const { noRedirectPlaybackUrl, location } = source as Record<string, unknown>;
      if (typeof noRedirectPlaybackUrl === "string") return noRedirectPlaybackUrl;
      if (typeof location === "string") return location;
      return undefined;
    },
  };
}
