import { type Query, QueryKind } from "@tseer/types";
import { parseGraphArticle } from "./article.ts";
import type { Json } from "./json.ts";
import { type PicUrl, setPicUrl } from "./media.ts";
import {
  parseAudioSpace,
  parseBroadcastInfo,
  parseGraphCommunity,
  parseGraphList,
} from "./misc.ts";
import {
  parseGraphCommunityMembers,
  parseGraphCommunityTimeline,
  parseGraphConversation,
  parseGraphEditHistory,
  parseGraphFollowers,
  parseGraphListMembers,
  parseGraphPhotoRail,
  parseGraphSearchLists,
  parseGraphSearchTweets,
  parseGraphSearchUsers,
  parseGraphTimeline,
} from "./timeline.ts";
import {
  newTweet,
  parseGraphTweetResult,
  parseGraphTweetResults,
  parseTweetByRestId,
} from "./tweet.ts";
import { parseAboutAccount, parseGraphUser } from "./user.ts";

export type ParserKind =
  | "user"
  | "aboutAccount"
  | "timeline"
  | "photoRail"
  | "conversation"
  | "tweetResult"
  | "tweetByRestId"
  | "tweetResults"
  | "editHistory"
  | "searchTweets"
  | "searchUsers"
  | "searchLists"
  | "list"
  | "listMembers"
  | "followers"
  | "community"
  | "communityTimeline"
  | "communityMembers"
  | "article"
  | "space"
  | "broadcast";

export interface ParseOptions {
  after?: string | undefined;
  query?: Query | undefined;
  tweetId?: string | undefined;
  kind?: QueryKind | undefined;
}

export type ParseFn = (json: Json, options: ParseOptions) => unknown;

export class Parsers {
  private readonly kinds = new Map<ParserKind, ParseFn>();

  constructor() {
    this.kinds.set("user", (json) => parseGraphUser(json));
    this.kinds.set("aboutAccount", (json) => parseAboutAccount(json));
    this.kinds.set("timeline", (json, options) => {
      const { pinned, tweets } = parseGraphTimeline(json, options.after ?? "");
      return { user: undefined, photoRail: undefined, pinned, tweets, accountInfo: undefined };
    });
    this.kinds.set("photoRail", (json) => parseGraphPhotoRail(json));
    this.kinds.set("conversation", (json, options) =>
      parseGraphConversation(json, options.tweetId ?? ""),
    );
    this.kinds.set("tweetResult", (json) => parseGraphTweetResult(json));
    this.kinds.set("tweetByRestId", (json) => parseTweetByRestId(json));
    this.kinds.set("tweetResults", (json) => parseGraphTweetResults(json));
    this.kinds.set("editHistory", (json) => parseGraphEditHistory(json, ""));
    this.kinds.set("searchTweets", (json, options) =>
      parseGraphSearchTweets(json, options.after ?? ""),
    );
    this.kinds.set("searchUsers", (json, options) =>
      parseGraphSearchUsers(json, options.after ?? ""),
    );
    this.kinds.set("searchLists", (json, options) =>
      parseGraphSearchLists(json, options.after ?? ""),
    );
    this.kinds.set("list", (json) => parseGraphList(json));
    this.kinds.set("listMembers", (json, options) =>
      parseGraphListMembers(json, options.after ?? ""),
    );
    this.kinds.set("followers", (json, options) =>
      parseGraphFollowers(json, options.after ?? "", options.kind ?? QueryKind.followers),
    );
    this.kinds.set("community", (json) => parseGraphCommunity(json));
    this.kinds.set("communityTimeline", (json, options) =>
      parseGraphCommunityTimeline(json, options.after ?? ""),
    );
    this.kinds.set("communityMembers", (json, options) =>
      parseGraphCommunityMembers(json, options.after ?? ""),
    );
    this.kinds.set("article", (json) => parseGraphArticle(json));
    this.kinds.set("space", (json) => parseAudioSpace(json));
    this.kinds.set("broadcast", (json) => parseBroadcastInfo(json));
  }

  register(kind: ParserKind, parse: ParseFn): () => void {
    const previous = this.kinds.get(kind);
    this.kinds.set(kind, parse);
    return () => {
      if (previous === undefined) this.kinds.delete(kind);
      else this.kinds.set(kind, previous);
    };
  }

  has(kind: ParserKind): boolean {
    return this.kinds.has(kind);
  }

  parse<T = unknown>(kind: ParserKind, json: Json, options: ParseOptions = {}): T {
    const parse = this.kinds.get(kind);
    if (parse === undefined) return undefined as T;

    const out = parse(json, options);
    if (
      options.query !== undefined &&
      typeof out === "object" &&
      out !== null &&
      "query" in out &&
      !Array.isArray(out)
    ) {
      (out as { query: Query }).query = options.query;
    }
    return out as T;
  }
}

export function configureParserLinks(picUrl: PicUrl | undefined): () => void {
  const previous = setPicUrl(picUrl);
  return () => {
    setPicUrl(previous);
  };
}

export { newTweet };
