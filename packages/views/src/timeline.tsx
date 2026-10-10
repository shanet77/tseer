/** Port of nitter's `src/views/timeline.nim` — pagination chrome, user
 * results, and `renderTimelineTweets`.
 *
 * The parser port flattens threads (`TimelineResult.content` is `Tweet[]`,
 * not `Tweets[]`), so `renderThread` and the multi-tweet-thread branch of
 * `renderTimelineTweets` have no counterpart here — every content item is a
 * single tweet, exactly like the Nim `thread.len == 1` path. `renderThread`
 * comes back with the status/conversation route, which renders chains.
 */

import { encodeUrl } from "@tseer/media";
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
import type { VNode } from "preact";
import { getUserPic, insertSep, replaceUrls } from "./formatters.ts";
import { genImg, getAvatarClass, icon, linkUser, verifiedIcon } from "./renderutils.tsx";
import { renderTweet } from "./tweet.tsx";

/** timeline.nim `timelineViewClass`. */
export function timelineViewClass(query: Query): string {
  if (query.kind !== QueryKind.media) return "timeline";
  switch (query.view) {
    case "grid":
      return "timeline media-grid-view";
    case "gallery":
      return "timeline media-gallery-view";
    default:
      return "timeline";
  }
}

/** timeline.nim `getQuery`: the query string prefix for cursor links. */
export function querySuffix(query: Query): string {
  let result = query.kind !== QueryKind.posts ? genQueryUrl(query) : "";
  if (result.length > 0) result += "&";
  return result;
}

/** timeline.nim `getSearchMaxId`: a `maxid:` cursor derived from the last
 * tweet, guaranteeing no overlap (2_000_000 minimum decrement). */
export function getSearchMaxId(results: TimelineResult): string {
  if (
    results.query.kind !== QueryKind.tweets ||
    results.content.length === 0 ||
    results.query.until.length === 0
  ) {
    return "";
  }
  const last = results.content[results.content.length - 1];
  if (last === undefined || last.id === "") return "";
  let maxId = BigInt(last.id) - 2_000_000n;
  if (maxId <= 0n) maxId = BigInt(last.id) - 1n;
  return maxId > 0n ? `maxid:${maxId}` : "";
}

function renderToTop(focus = "#"): VNode {
  return <div class="top-ref">{icon("down", "", "", "", focus)}</div>;
}

function renderNewer(query: Query, path: string, focus = ""): VNode {
  const q = genQueryUrl(query);
  const url = q.length > 0 ? `?${q}` : "";
  const p = focus.length > 0 ? path.replace("#m", focus) : path;
  return (
    <div class="timeline-item show-more">
      <a href={`${p}${url}`}>Load newest</a>
    </div>
  );
}

function renderMore(query: Query, cursor: string, focus = "", extra = ""): VNode {
  return (
    <div class="show-more">
      <a href={`?${extra}${querySuffix(query)}cursor=${encodeUrl(cursor)}${focus}`}>Load more</a>
    </div>
  );
}

function renderNoMore(): VNode {
  return (
    <div class="timeline-footer">
      <h2 class="timeline-end">No more items</h2>
    </div>
  );
}

function renderNoneFound(): VNode {
  return (
    <div class="timeline-header">
      <h2 class="timeline-none">No items found</h2>
    </div>
  );
}

function renderUser(user: User, prefs: TseerPreferences): VNode {
  return (
    <div class="timeline-item" data-username={user.username}>
      {/* biome-ignore lint/a11y/useAnchorContent: nitter's invisible tweet-link overlay */}
      {/* biome-ignore lint/a11y/useValidAnchor: overlay anchor, ported verbatim */}
      <a class="tweet-link" href={`/${user.username}`} />
      <div class="tweet-body profile-result">
        <div class="tweet-header">
          <a class="tweet-avatar" href={`/${user.username}`}>
            {genImg(getUserPic(user.userPic, "_bigger"), getAvatarClass(prefs))}
          </a>
          <div class="tweet-name-row">
            <div class="fullname-and-username">
              {linkUser(user, "fullname")}
              {verifiedIcon(user)}
            </div>
            {linkUser(user, "username")}
          </div>
        </div>
        <div class="tweet-content media-body" dir="auto">
          <span dangerouslySetInnerHTML={{ __html: replaceUrls(user.bio, prefs) }} />
        </div>
      </div>
    </div>
  );
}

export function renderTimelineUsers(
  results: Result<User>,
  prefs: TseerPreferences,
  path = "",
): VNode {
  return (
    <div class="timeline">
      {!results.beginning && renderNewer(results.query, path)}
      {results.content.length > 0 ? (
        <>
          {results.content.map((user) => renderUser(user, prefs))}
          {results.bottom.length > 0 && renderMore(results.query, results.bottom)}
          {renderToTop()}
        </>
      ) : results.beginning ? (
        renderNoneFound()
      ) : (
        renderNoMore()
      )}
    </div>
  );
}

/** timeline.nim `mentionUsername`: "@user" → "user" for well-formed mentions. */
function mentionUsername(word: string): string {
  if (word.length > 1 && word[0] === "@" && /^[A-Za-z0-9_]+$/.test(word.slice(1))) {
    return word.slice(1);
  }
  return "";
}

/** timeline.nim `mentionedUser`: the last @mention in "65 followers including @user". */
function mentionedUser(s: string): string {
  const words = s.split(" ");
  for (let i = words.length - 1; i >= 0; i--) {
    const result = mentionUsername(words[i] ?? "");
    if (result.length > 0) return result;
  }
  return "";
}

/** timeline.nim `renderMentionedText`: linkify @mentions in plain API strings. */
function renderMentionedText(s: string): VNode {
  const words = s.split(" ");
  return (
    <span>
      {words.map((word, i) => {
        const username = mentionUsername(word);
        return (
          <>
            {i > 0 && " "}
            {username.length > 0 ? <a href={`/${username}`}>{word}</a> : word}
          </>
        );
      })}
    </span>
  );
}

/** timeline.nim `renderListCard`: a list-search result card. */
export function renderListCard(r: ListSearchResult): VNode {
  const listUrl = `/i/lists/${r.list.id}`;
  return (
    <div class="timeline-item list-result">
      {/* biome-ignore lint/a11y/useAnchorContent: nitter's invisible tweet-link overlay */}
      {/* biome-ignore lint/a11y/useValidAnchor: overlay anchor, ported verbatim */}
      <a class="tweet-link" href={listUrl} />
      <a class="list-result-banner" href={listUrl}>
        {r.list.banner.length > 0 && genImg(r.list.banner)}
      </a>
      <div class="list-result-body">
        <div class="list-result-title fullname-and-username">
          <a class="list-name fullname" href={listUrl}>
            {r.list.name}
          </a>
          <span class="list-members">{`· ${insertSep(String(r.list.members), ",")} members`}</span>
        </div>
        <div class="list-result-context">
          {r.followersContext.length > 0 ? (
            <>
              {/* the first facepile belongs to the "including @user" account */}
              {r.facepiles.map((facepile, i) => {
                const mentioned = i === 0 ? mentionedUser(r.followersContext) : "";
                return mentioned.length > 0 ? (
                  <a class="facepile-link" href={`/${mentioned}`}>
                    {genImg(facepile, "list-facepile")}
                  </a>
                ) : (
                  genImg(facepile, "list-facepile")
                );
              })}
              {renderMentionedText(r.followersContext)}
            </>
          ) : (
            <>
              {r.owner.username.length > 0 ? (
                <a class="facepile-link" href={`/${r.owner.username}`}>
                  {genImg(getUserPic(r.owner.userPic, "_mini"), "list-facepile")}
                </a>
              ) : (
                genImg(getUserPic(r.owner.userPic, "_mini"), "list-facepile")
              )}
              {linkUser(r.owner, "fullname")}
              {linkUser(r.owner, "username")}
            </>
          )}
        </div>
        {r.list.description.length > 0 && (
          <div class="list-result-description">{r.list.description}</div>
        )}
      </div>
    </div>
  );
}

/** timeline.nim `renderTimelineLists`: paginated list-search results. */
export function renderTimelineLists(
  results: Result<ListSearchResult>,
  _prefs: TseerPreferences,
  path = "",
): VNode {
  return (
    <div class="timeline">
      {!results.beginning && renderNewer(results.query, path)}
      {results.content.length > 0 ? (
        <>
          {results.content.map((list) => renderListCard(list))}
          {results.bottom.length > 0 && renderMore(results.query, results.bottom)}
          {renderToTop()}
        </>
      ) : results.beginning ? (
        renderNoneFound()
      ) : (
        renderNoMore()
      )}
    </div>
  );
}

/** timeline.nim `filterThreads`, applied to the flattened content: skip
 * tweets whose retweet target (or id) was already shown, and pinned tweets
 * when hidden. */
function filterThreads(content: Tweet[], prefs: TseerPreferences): Tweet[] {
  const retweets = new Set<string>();
  const result: Tweet[] = [];
  for (const tweet of content) {
    const retweetId = tweet.retweet?.id ?? "";
    if (retweets.has(retweetId) || retweets.has(tweet.id) || (tweet.pinned && prefs.hidePins)) {
      continue;
    }
    if (retweetId.length > 0) retweets.add(retweetId);
    result.push(tweet);
  }
  return result;
}

export function renderTimelineTweets(
  results: TimelineResult,
  prefs: TseerPreferences,
  path: string,
  pinned?: Tweet | undefined,
): VNode {
  // parseUri(path).path: the newest-link never carries the query string.
  const barePath = path.split("?")[0] ?? path;

  return (
    <div class={timelineViewClass(results.query)}>
      {!results.beginning && renderNewer(results.query, barePath)}
      {!prefs.hidePins && pinned !== undefined && renderTweet(pinned, prefs, path)}
      {results.content.length === 0 ? (
        !results.beginning ? (
          renderNoMore()
        ) : (
          renderNoneFound()
        )
      ) : (
        <>
          {results.query.view === "gallery"
            ? (() => {
                const bigThumb = prefs.gallerySize === "Large";
                const galClass = prefs.compactGallery
                  ? "gallery-masonry compact"
                  : "gallery-masonry";
                return (
                  <div class={galClass} data-col-size={prefs.gallerySize.toLowerCase()}>
                    {filterThreads(results.content, prefs).map((tweet) =>
                      renderTweet(tweet, prefs, path, { bigThumb }),
                    )}
                  </div>
                );
              })()
            : filterThreads(results.content, prefs).map((tweet) => renderTweet(tweet, prefs, path))}
          {(() => {
            const cursor = getSearchMaxId(results);
            if (cursor.length > 0) return renderMore(results.query, cursor);
            if (results.bottom.length > 0) return renderMore(results.query, results.bottom);
            return undefined;
          })()}
          {renderToTop()}
        </>
      )}
    </div>
  );
}
