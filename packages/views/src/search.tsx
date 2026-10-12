import type { TseerPreferences } from "@tseer/prefs";
import { genQueryUrl } from "@tseer/twitter-api";
import {
  type ListSearchResult,
  type Query,
  QueryKind,
  type Result,
  type TimelineResult,
  type Tweet,
  type User,
} from "@tseer/types";
import { Fragment, type VNode } from "preact";
import { titleize } from "./formatters.ts";
import {
  genCheckbox,
  genDate,
  genInput,
  genNumberInput,
  getTabClass,
  hiddenField,
  icon,
} from "./renderutils.tsx";
import { renderTimelineLists, renderTimelineTweets, renderTimelineUsers } from "./timeline.tsx";

const toggles: ReadonlyArray<readonly [key: string, label: string]> = [
  ["nativeretweets", "Retweets"],
  ["media", "Media"],
  ["videos", "Videos"],
  ["news", "News"],
  ["native_video", "Native videos"],
  ["replies", "Replies"],
  ["links", "Links"],
  ["images", "Images"],
  ["quote", "Quotes"],
  ["spaces", "Spaces"],
];

export function renderSearch(): VNode {
  return (
    <div class="panel-container">
      <div class="search-bar">
        <form method="get" action="/search" autocomplete="off">
          {hiddenField("f", "tweets")}
          <input type="text" name="q" autofocus placeholder="Search..." dir="auto" />
          <button type="submit">{icon("search")}</button>
        </form>
      </div>
    </div>
  );
}

export function renderProfileTabs(query: Query, username: string): VNode {
  const link = `/${username}`;
  return (
    <ul class="tab">
      <li class={getTabClass(query, QueryKind.posts)}>
        <a href={link}>Tweets</a>
      </li>
      <li class={`${getTabClass(query, QueryKind.replies)} wide`}>
        <a href={`${link}/with_replies`}>Tweets &amp; Replies</a>
      </li>
      <li class={getTabClass(query, QueryKind.media)}>
        <a href={`${link}/media`}>Media</a>
      </li>
      {query.fromUser.length === 1 && (
        <li class={getTabClass(query, QueryKind.articles)}>
          <a href={`${link}/articles`}>Articles</a>
        </li>
      )}
      <li class={getTabClass(query, QueryKind.tweets)}>
        <a href={`${link}/search`}>Search</a>
      </li>
    </ul>
  );
}

function mediaViewUrl(query: Query, view: string): string {
  return `?${genQueryUrl({ ...query, view })}`;
}

export function renderMediaViewTabs(query: Query): VNode {
  const currentView = query.view.length > 0 ? query.view : "timeline";
  const cls = (view: string) => (currentView === view ? "tab-item active" : "tab-item");
  return (
    <ul class="tab media-view-tabs">
      <li class={cls("timeline")}>
        <a href={mediaViewUrl(query, "timeline")}>Timeline</a>
      </li>
      <li class={cls("grid")}>
        <a href={mediaViewUrl(query, "grid")}>Grid</a>
      </li>
      <li class={cls("gallery")}>
        <a href={mediaViewUrl(query, "gallery")}>Gallery</a>
      </li>
    </ul>
  );
}

export function renderSearchTabs(query: Query): VNode {
  const q: Query = { ...query, view: "" };
  return (
    <ul class="tab">
      <li class={getTabClass(q, QueryKind.top)}>
        <a href={`?${genQueryUrl({ ...q, kind: QueryKind.top })}`}>Top</a>
      </li>
      <li class={getTabClass(q, QueryKind.tweets)}>
        <a href={`?${genQueryUrl({ ...q, kind: QueryKind.tweets })}`}>Latest</a>
      </li>
      <li class={getTabClass(q, QueryKind.media)}>
        <a href={`?${genQueryUrl({ ...q, kind: QueryKind.media, view: query.view })}`}>Media</a>
      </li>
      <li class={getTabClass(q, QueryKind.users)}>
        <a href={`?${genQueryUrl({ ...q, kind: QueryKind.users })}`}>Users</a>
      </li>
      <li class={getTabClass(q, QueryKind.lists)}>
        <a href={`?${genQueryUrl({ ...q, kind: QueryKind.lists })}`}>Lists</a>
      </li>
    </ul>
  );
}

function isPanelOpen(q: Query): boolean {
  return (
    q.fromUser.length === 0 &&
    (q.filters.length > 0 ||
      q.excludes.length > 0 ||
      [q.minLikes, q.until, q.since].some((part) => part.length > 0))
  );
}

export function renderSearchPanel(query: Query): VNode {
  const user = query.fromUser.join(",");
  const action = user.length > 0 ? `/${user}/search` : "/search";
  return (
    <form method="get" action={action} class="search-field" autocomplete="off">
      {hiddenField("f", query.kind)}
      {genInput("q", "", query.text, "Enter search...", "pref-inline")}
      <button type="submit">{icon("search")}</button>
      <input
        id="search-panel-toggle"
        type="checkbox"
        checked={isPanelOpen(query) ? true : undefined}
      />
      <label for="search-panel-toggle">{icon("down")}</label>
      <div class="search-panel">
        {(["filter", "exclude"] as const).map((filterKind) => (
          <>
            <span class="search-title">{titleize(filterKind)}</span>
            <div class="search-toggles">
              {toggles.map(([key, label]) => (
                <Fragment key={key}>
                  {genCheckbox(
                    `${filterKind[0]}-${key}`,
                    label,
                    filterKind === "filter"
                      ? query.filters.includes(key)
                      : query.excludes.includes(key),
                  )}
                </Fragment>
              ))}
            </div>
          </>
        ))}
        <div class="search-row">
          <div>
            <span class="search-title">Time range</span>
            <div class="date-range">
              {genDate("since", query.since)}
              <span class="search-title">-</span>
              {genDate("until", query.until)}
            </div>
          </div>
          <div>
            <span class="search-title">Minimum likes</span>
            {genNumberInput("min_faves", "", query.minLikes, "Number...", "pref-inline", false)}
          </div>
        </div>
      </div>
    </form>
  );
}

export function renderTweetSearch(
  results: TimelineResult,
  prefs: TseerPreferences,
  path: string,
  pinned?: Tweet | undefined,
): VNode {
  const query = results.query;
  const containerClass =
    query.fromUser.length === 0 && query.kind === QueryKind.media && query.view === "gallery"
      ? "timeline-container media-only"
      : "timeline-container";
  return (
    <div class={containerClass}>
      {query.fromUser.length > 1 && <div class="timeline-header">{query.fromUser.join(" | ")}</div>}
      {query.fromUser.length > 0 && (
        <>
          {(query.kind !== QueryKind.media || query.view !== "gallery") &&
            renderProfileTabs(query, query.fromUser.join(","))}
          {query.kind === QueryKind.media &&
            query.fromUser.length === 1 &&
            renderMediaViewTabs(query)}
        </>
      )}
      {(query.fromUser.length === 0 || query.kind === QueryKind.tweets) && (
        <div class="timeline-header">{renderSearchPanel(query)}</div>
      )}
      {query.fromUser.length === 0 && (
        <>
          {renderSearchTabs(query)}
          {query.kind === QueryKind.media && renderMediaViewTabs(query)}
        </>
      )}
      {renderTimelineTweets(results, prefs, path, pinned)}
    </div>
  );
}

export function renderSearchForm(kind: string, placeholder: string, value: string): VNode {
  return (
    <form method="get" action="/search" class="search-field" autocomplete="off">
      {hiddenField("f", kind)}
      {genInput("q", "", value, placeholder, "pref-inline")}
      <button type="submit">{icon("search")}</button>
    </form>
  );
}

export function renderUserSearch(results: Result<User>, prefs: TseerPreferences): VNode {
  return (
    <div class="timeline-container">
      <div class="timeline-header">
        {renderSearchForm("users", "Enter username...", results.query.text)}
      </div>
      {renderSearchTabs(results.query)}
      {renderTimelineUsers(results, prefs)}
    </div>
  );
}

export function renderListSearch(
  results: Result<ListSearchResult>,
  prefs: TseerPreferences,
  path: string,
): VNode {
  return (
    <div class="timeline-container">
      <div class="timeline-header">
        {renderSearchForm("lists", "Enter search...", results.query.text)}
      </div>
      {renderSearchTabs(results.query)}
      {renderTimelineLists(results, prefs, path)}
    </div>
  );
}
