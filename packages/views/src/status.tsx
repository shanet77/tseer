import { encodeUrl } from "@tseer/media";
import type { TseerPreferences } from "@tseer/prefs";
import { genQueryUrl } from "@tseer/twitter-api";
import {
  type Chain,
  type ChainResult,
  type Conversation,
  type EditHistory,
  type Query,
  QueryKind,
  RankingMode,
  type Tweet,
} from "@tseer/types";
import type { VNode } from "preact";
import { getLink, getTweetLink } from "./formatters.ts";
import { icon } from "./renderutils.tsx";
import { renderTweet } from "./tweet.tsx";

function emptyQuery(): Query {
  return {
    kind: QueryKind.posts,
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
  let suffix = query.kind !== QueryKind.posts ? genQueryUrl(query) : "";
  if (suffix.length > 0) suffix += "&";
  return (
    <div class="show-more">
      <a href={`?${extra}${suffix}cursor=${encodeUrl(cursor)}${focus}`}>Load more</a>
    </div>
  );
}

export function renderEarlier(thread: Chain): VNode {
  const first = thread.content[0];
  const href = first !== undefined ? getTweetLink(first) : "";
  return (
    <div class="timeline-item more-replies earlier-replies">
      <a class="more-replies-text" href={href}>
        earlier replies
      </a>
    </div>
  );
}

export function renderMoreReplies(thread: Chain): VNode {
  const last = thread.content[thread.content.length - 1];
  const link = last === undefined ? "" : getTweetLink(last);
  return (
    <div class="timeline-item more-replies">
      {last?.available === true ? (
        <a class="more-replies-text" href={link}>
          more replies
        </a>
      ) : (
        // biome-ignore lint/a11y/useValidAnchor: nitter renders a href-less "more replies" anchor for unavailable tweets
        <a class="more-replies-text">more replies</a>
      )}
    </div>
  );
}

export function renderReplyThread(thread: Chain, prefs: TseerPreferences, path: string): VNode {
  return (
    <div class="reply thread thread-line">
      {thread.content.map((tweet, i) => {
        const last = i === thread.content.length - 1 && !thread.hasMore;
        return renderTweet(tweet, prefs, path, { index: i, last });
      })}
      {thread.hasMore && renderMoreReplies(thread)}
    </div>
  );
}

export function renderReplySort(sort: RankingMode): VNode {
  const modes: ReadonlyArray<readonly [RankingMode, string]> = [
    [RankingMode.Relevance, "Relevant"],
    [RankingMode.Recency, "Recent"],
    [RankingMode.Likes, "Liked"],
  ];
  return (
    <div class="reply-sort">
      <span class="reply-sort-label">Sort replies:</span>
      {modes.map(([mode, label]) => {
        const cls = mode === sort ? "reply-sort-option active" : "reply-sort-option";
        return (
          <a class={cls} href={`?sort=${mode}#r`}>
            {label}
          </a>
        );
      })}
    </div>
  );
}

export function renderReplies(
  replies: ChainResult,
  prefs: TseerPreferences,
  path: string,
  tweet?: Tweet | undefined,
  sort: RankingMode = RankingMode.Relevance,
): VNode {
  let hasReplies = false;
  let replyCount = 0;
  const threads = replies.content.filter((thread) => {
    if (thread.content.length === 0 || thread.related) return false;
    hasReplies = true;
    replyCount += thread.content.length;
    return true;
  });

  return (
    <div class="replies" id="r">
      {threads.map((thread, i) => (
        <div key={i}>{renderReplyThread(thread, prefs, path)}</div>
      ))}
      {hasReplies &&
        replies.bottom.length > 0 &&
        (tweet === undefined || !replies.beginning || replyCount < tweet.stats.replies) &&
        renderMore(
          emptyQuery(),
          replies.bottom,
          "#r",
          sort === RankingMode.Relevance ? "" : `sort=${sort}&`,
        )}
    </div>
  );
}

function renderRelated(replies: ChainResult, prefs: TseerPreferences, path: string): VNode {
  return (
    <div class="related-tweets">
      <div class="related-header">Related tweets</div>
      {replies.content
        .filter((thread) => thread.content.length > 0 && thread.related)
        .map((thread, i) => (
          <div key={i}>{renderReplyThread(thread, prefs, path)}</div>
        ))}
    </div>
  );
}

export function renderConversation(
  conv: Conversation,
  prefs: TseerPreferences,
  path: string,
  sort: RankingMode = RankingMode.Relevance,
): VNode {
  const hasAfter = conv.after.content.length > 0;
  const threadId = conv.tweet.threadId;

  return (
    <div class="conversation">
      <div class="main-thread">
        {conv.before.content.length > 0 && (
          <div class="before-tweet thread-line">
            {(() => {
              const first = conv.before.content[0];
              if (
                first !== undefined &&
                threadId !== first.id &&
                (first.replyId !== "" || !first.available)
              ) {
                return renderEarlier(conv.before);
              }
              return undefined;
            })()}
            {conv.before.content.map((tweet, i) => renderTweet(tweet, prefs, path, { index: i }))}
          </div>
        )}

        <div class="main-tweet" id="m">
          {renderTweet(conv.tweet, prefs, path, {
            className: hasAfter ? "thread thread-line" : "",
            mainTweet: true,
          })}
        </div>

        {hasAfter && (
          <div class="after-tweet thread-line">
            {conv.after.content.map((tweet, i) => (
              <div key={tweet.id}>
                {renderTweet(tweet, prefs, path, {
                  index: i,
                  last: i === conv.after.content.length - 1 && !conv.after.hasMore,
                  afterTweet: true,
                })}
              </div>
            ))}
            {conv.after.hasMore && renderMoreReplies(conv.after)}
          </div>
        )}
      </div>

      {!prefs.hideReplies && (
        <>
          {!conv.replies.beginning && renderNewer(emptyQuery(), getTweetLink(conv.tweet), "#r")}
          {(conv.replies.content.length > 0 || conv.replies.bottom.length > 0) && (
            <>
              {renderReplySort(sort)}
              {renderReplies(conv.replies, prefs, path, conv.tweet, sort)}
            </>
          )}
        </>
      )}

      {!prefs.hideRelated &&
        conv.replies.content.some((thread) => thread.related && thread.content.length > 0) &&
        renderRelated(conv.replies, prefs, path)}

      {renderToTop("#m")}
    </div>
  );
}

export function renderEditHistory(
  edits: EditHistory,
  prefs: TseerPreferences,
  path: string,
): VNode {
  return (
    <div class="edit-history">
      <div class="latest-edit">
        <div class="edit-history-header">Latest post</div>
        {renderTweet(edits.latest, prefs, path)}
      </div>
      <div class="previous-edits">
        <div class="edit-history-header">Version history</div>
        {edits.history.map((tweet) => (
          <div class="tweet-edit" key={tweet.id}>
            {renderTweet(tweet, prefs, path)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function getVideoEmbed(urlPrefix: string, id: string): string {
  return `${urlPrefix}/i/videos/${id}`;
}

export function getUrlPrefix(cfg: {
  useHttps?: boolean | undefined;
  hostname?: string | undefined;
}): string {
  const scheme = cfg.useHttps === false ? "http://" : "https://";
  return `${scheme}${cfg.hostname ?? ""}`;
}

export function getThreadLink(tweet: Tweet): string {
  return getLink(tweet.id, tweet.user.username);
}
