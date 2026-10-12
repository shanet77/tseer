import { RankingMode } from "@tseer/types";
import {
  GQL_FEATURES,
  GRAPH_TWEET,
  GRAPH_USER,
  GRAPH_USER_ARTICLES,
  GRAPH_USER_ARTICLES_V2,
  GRAPH_USER_MEDIA,
  GRAPH_USER_MEDIA_V2,
  GRAPH_USER_TWEETS_AND_REPLIES,
  GRAPH_USER_TWEETS_AND_REPLIES_V2,
  GRAPH_USER_TWEETS_V2,
  GRAPH_USER_V2,
  REST_ID_VARS,
  TWEET_DETAIL_FIELD_TOGGLES,
  TWEET_VARS,
  USER_ARTICLES_VARS,
  USER_MEDIA_VARS,
  USER_TWEETS_AND_REPLIES_VARS,
  USER_TWEETS_FIELD_TOGGLES,
} from "./endpoints.ts";
import type { ApiReq, ApiUrl } from "./urls.ts";

export function subst(template: string, args: readonly string[]): string {
  let out = "";
  let i = 0;
  let sequential = 0;
  const invalid = (): never => {
    throw new Error(`invalid format string: ${template}`);
  };
  while (i < template.length) {
    const char = template.charAt(i);
    if (char !== "$" || i + 1 >= template.length) {
      out += char;
      i++;
      continue;
    }
    const next = template.charAt(i + 1);
    if (next === "$") {
      out += "$";
      i += 2;
      continue;
    }
    if (next === "#") {
      if (sequential > args.length - 1) invalid();
      out += args[sequential];
      sequential++;
      i += 2;
      continue;
    }
    if ((next >= "1" && next <= "9") || next === "-") {
      let j = i + 1;
      const negative = template.charAt(j) === "-";
      if (negative) j++;
      let num = 0;
      while (j < template.length && template.charAt(j) >= "0" && template.charAt(j) <= "9") {
        num = num * 10 + (template.charCodeAt(j) - 0x30);
        j++;
      }
      const index = negative ? args.length - num : num - 1;
      if (index < 0 || index > args.length - 1) invalid();
      out += args[index];
      i = j;
      continue;
    }
    invalid();
  }
  return out;
}

export function genParams(variables: string, fieldToggles = ""): [string, string][] {
  const params: [string, string][] = [
    ["variables", variables],
    ["features", GQL_FEATURES],
  ];
  if (fieldToggles.length > 0) params.push(["fieldToggles", fieldToggles]);
  return params;
}

export function apiUrl(
  endpoint: string,
  variables: string,
  fieldToggles = "",
  skipTid = false,
): ApiUrl {
  return { endpoint, params: genParams(variables, fieldToggles), skipTid };
}

export function apiReq(
  endpoint: string,
  variables: string,
  fieldToggles = "",
  skipTid = false,
): ApiReq {
  const url = apiUrl(endpoint, variables, fieldToggles, skipTid);
  return { cookie: url, oauth: url };
}

export function cursorParam(after: string): string {
  return after.length > 0 ? `"cursor":${JSON.stringify(after)},` : "";
}

export function restReq(endpoint: string, params: [string, string][] = []): ApiReq {
  const url: ApiUrl = { endpoint, params, skipTid: false };
  return { cookie: url, oauth: url };
}

export function mediaUrl(id: string, cursor: string): ApiReq {
  return {
    cookie: apiUrl(GRAPH_USER_MEDIA, subst(USER_MEDIA_VARS, [id, cursor, "100"])),
    oauth: apiUrl(GRAPH_USER_MEDIA_V2, subst(REST_ID_VARS, [id, cursor, "100"])),
  };
}

export function userTweetsUrl(id: string, cursor: string): ApiReq {
  return apiReq(
    GRAPH_USER_TWEETS_V2,
    subst(REST_ID_VARS, [id, cursor, "20"]),
    USER_TWEETS_FIELD_TOGGLES,
  );
}

export function userTweetsAndRepliesUrl(id: string, cursor: string): ApiReq {
  return {
    cookie: apiUrl(
      GRAPH_USER_TWEETS_AND_REPLIES,
      subst(USER_TWEETS_AND_REPLIES_VARS, [id, cursor]),
      USER_TWEETS_FIELD_TOGGLES,
    ),
    oauth: apiUrl(
      GRAPH_USER_TWEETS_AND_REPLIES_V2,
      subst(REST_ID_VARS, [id, cursor, "20"]),
      USER_TWEETS_FIELD_TOGGLES,
      true,
    ),
  };
}

export function userArticlesUrl(id: string, cursor: string): ApiReq {
  return {
    cookie: apiUrl(
      GRAPH_USER_ARTICLES,
      subst(USER_ARTICLES_VARS, [id, cursor]),
      USER_TWEETS_FIELD_TOGGLES,
    ),
    oauth: apiUrl(
      GRAPH_USER_ARTICLES_V2,
      subst(REST_ID_VARS, [id, cursor, "20"]),
      USER_TWEETS_FIELD_TOGGLES,
    ),
  };
}

export function tweetDetailUrl(
  id: string,
  cursor: string,
  mode: RankingMode = RankingMode.Relevance,
): ApiReq {
  return apiReq(GRAPH_TWEET, subst(TWEET_VARS, [id, cursor, mode]));
}

export function userUrl(username: string): ApiReq {
  const cookieVars = JSON.stringify({
    screen_name: username,
    withGrokTranslatedBio: false,
  });
  return {
    cookie: apiUrl(GRAPH_USER, cookieVars, TWEET_DETAIL_FIELD_TOGGLES),
    oauth: apiUrl(GRAPH_USER_V2, JSON.stringify({ screen_name: username })),
  };
}

export function communitySliceReq(endpoint: string, variables: string): ApiReq {
  const url: ApiUrl = { endpoint, params: [["variables", variables]], skipTid: false };
  return { cookie: url, oauth: url };
}
