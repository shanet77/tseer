import { type Query, QueryKind } from "@tseer/types";
import { encodeUrl } from "./urls.ts";

export const VALID_FILTERS = [
  "media",
  "images",
  "twimg",
  "videos",
  "native_video",
  "consumer_video",
  "spaces",
  "links",
  "news",
  "quote",
  "mentions",
  "replies",
  "retweets",
  "nativeretweets",
] as const;

export const EMPTY_QUERY = "include:nativeretweets";

export function validateNumber(value: string): string {
  return /^[0-9]*$/.test(value) ? value : "";
}

function parseQueryKind(value: string, fallback: QueryKind): QueryKind {
  const normalize = (text: string): string =>
    text.length === 0 ? text : text[0] + text.slice(1).toLowerCase().replaceAll("_", "");
  const target = normalize(value);
  for (const kind of Object.values(QueryKind)) {
    if (normalize(kind) === target) return kind;
  }
  return fallback;
}

function strip(value: string): string {
  const whitespace = new Set([0x20, 0x09, 0x0b, 0x0d, 0x0a, 0x0c]);
  let start = 0;
  let end = value.length;
  while (start < end && whitespace.has(value.charCodeAt(start))) start++;
  while (end > start && whitespace.has(value.charCodeAt(end - 1))) end--;
  return value.slice(start, end);
}

export function initQuery(params: Readonly<Record<string, string>>, name = ""): Query {
  const kind = parseQueryKind(params.f ?? "", QueryKind.tweets);
  return {
    kind: kind === QueryKind.articles ? QueryKind.tweets : kind,
    view: params.view ?? "",
    text: params.q ?? "",
    filters: VALID_FILTERS.filter((filter) => `f-${filter}` in params),
    includes: [],
    excludes: VALID_FILTERS.filter((exclude) => `e-${exclude}` in params),
    fromUser: name.length > 0 ? name.split(",") : [],
    since: params.since ?? "",
    until: params.until ?? "",
    minLikes: validateNumber(params.min_faves ?? ""),
    sep: "",
  };
}

export function getMediaQuery(name: string): Query {
  return {
    kind: QueryKind.media,
    view: "",
    text: "",
    filters: ["twimg", "native_video"],
    includes: [],
    excludes: [],
    fromUser: [name],
    since: "",
    until: "",
    minLikes: "",
    sep: "OR",
  };
}

export function getArticlesQuery(name: string): Query {
  return {
    kind: QueryKind.articles,
    view: "",
    text: "",
    filters: [],
    includes: [],
    excludes: [],
    fromUser: [name],
    since: "",
    until: "",
    minLikes: "",
    sep: "",
  };
}

export function getReplyQuery(name: string): Query {
  return {
    kind: QueryKind.replies,
    view: "",
    text: "",
    filters: [],
    includes: [],
    excludes: [],
    fromUser: [name],
    since: "",
    until: "",
    minLikes: "",
    sep: "",
  };
}

export function genQueryParam(query: Query, maxId = ""): string {
  if (query.kind === QueryKind.users) return query.text;

  let param = "";
  query.fromUser.forEach((user, index) => {
    if (index === 0) param = "(";
    param += `from:${user}`;
    param += index < query.fromUser.length - 1 ? " OR " : ")";
  });

  if (
    query.fromUser.length > 0 &&
    (query.kind === QueryKind.posts || query.kind === QueryKind.media)
  ) {
    param += " (filter:self_threads OR -filter:replies)";
  }

  if (!query.excludes.includes("nativeretweets")) param += " include:nativeretweets";

  const tokens: string[] = [];
  for (const filter of query.filters) tokens.push(`filter:${filter}`);
  for (const exclude of query.excludes) {
    if (exclude === "nativeretweets") continue;
    tokens.push(`-filter:${exclude}`);
  }
  for (const include of query.includes) tokens.push(`include:${include}`);

  let result =
    tokens.length > 0 ? strip(`${param} (${tokens.join(` ${query.sep} `)})`) : strip(param);

  if (query.since.length > 0) result += ` since:${query.since}`;
  if (query.until.length > 0 && maxId.length === 0) result += ` until:${query.until}`;
  if (query.minLikes.length > 0) result += ` min_faves:${query.minLikes}`;
  if (query.text.length > 0) {
    result = result.length > 0 ? `${result} ${query.text}` : query.text;
  }
  if (result.length > 0 && maxId.length > 0) result += ` max_id:${maxId}`;
  return result;
}

export function genQueryUrl(query: Query): string {
  const params: string[] = [];
  if (query.view.length > 0) params.push(`view=${encodeUrl(query.view)}`);

  const inTab =
    query.kind === QueryKind.tweets ||
    query.kind === QueryKind.users ||
    query.kind === QueryKind.lists ||
    query.kind === QueryKind.top ||
    (query.kind === QueryKind.media && query.fromUser.length === 0);

  if (inTab) {
    params.push(`f=${query.kind}`);
    if (query.text.length > 0) params.push(`q=${encodeUrl(query.text)}`);
    for (const filter of query.filters) params.push(`f-${filter}=on`);
    for (const exclude of query.excludes) params.push(`e-${exclude}=on`);
    for (const include of query.includes) {
      if (include !== "nativeretweets") params.push(`i-${include}=on`);
    }
    if (query.since.length > 0) params.push(`since=${query.since}`);
    if (query.until.length > 0) params.push(`until=${query.until}`);
    if (query.minLikes.length > 0) params.push(`min_faves=${query.minLikes}`);
  }

  return params.join("&");
}
