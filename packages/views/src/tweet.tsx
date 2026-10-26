import type { TseerPreferences } from "@tseer/prefs";
import {
  type ArticlePreview,
  type Card,
  CardKind,
  type Gif,
  type Media,
  MediaKind,
  type Photo,
  type Poll,
  type Tweet,
  type TweetStats,
  type User,
  type Video,
  VideoType,
} from "@tseer/types";
import type { VNode } from "preact";
import {
  getDuration,
  getLink,
  getShortTime,
  getTime,
  getTweetLink,
  getUserPic,
  insertSep,
  replaceUrls,
} from "./formatters.ts";
import { getOrigPicUrl, getPicUrl, getVidUrl } from "./media.ts";
import {
  buttonReferer,
  genImg,
  getAvatarClass,
  getMediumPic,
  getSmallPic,
  icon,
  linkUser,
  mediumWebp,
  smallWebp,
  verifiedIcon,
} from "./renderutils.tsx";

function renderMiniAvatar(user: User, prefs: TseerPreferences): VNode {
  return genImg(getUserPic(user.userPic, "_mini"), `${getAvatarClass(prefs)} mini`);
}

function renderArticleCard(preview: ArticlePreview, _prefs: TseerPreferences): VNode {
  const url = `/i/article/${preview.tweetId}`;
  return (
    <div class="article-card card large">
      <a class="card-container" href={url}>
        {preview.coverImage.length > 0 && (
          <div class="card-image-container">
            <div class="card-image">{genImg(preview.coverImage)}</div>
            <span class="article-card-badge">Article</span>
          </div>
        )}
        <div class="card-content-container">
          <div class="card-content">
            <h2 class="card-title">{preview.title}</h2>
            {preview.previewText.length > 0 && (
              <p class="card-description">{preview.previewText}</p>
            )}
          </div>
        </div>
      </a>
    </div>
  );
}

function renderHeader(
  tweet: Tweet,
  retweet: string,
  pinned: boolean,
  prefs: TseerPreferences,
  path = "",
): VNode {
  return (
    <div>
      {pinned ? (
        <div class="pinned">
          <span>
            {icon(
              "pin",
              path.includes("/i/communities/") ? "Pinned by Community mods" : "Pinned Tweet",
            )}
          </span>
        </div>
      ) : (
        retweet.length > 0 && (
          <div class="retweet-header">
            <span>{icon("retweet", `${retweet} retweeted`)}</span>
          </div>
        )
      )}
      <div class="tweet-header">
        <a class="tweet-avatar" href={`/${tweet.user.username}`}>
          {genImg(
            getUserPic(
              tweet.user.userPic,
              !prefs.autoplayGifs && tweet.user.userPic.endsWith("gif") ? "_400x400" : "_bigger",
            ),
            getAvatarClass(prefs),
          )}
        </a>
        <div class="tweet-name-row">
          <div class="fullname-and-username">
            {linkUser(tweet.user, "fullname")}
            {verifiedIcon(tweet.user)}
            {linkUser(tweet.user, "username")}
          </div>
          <span class="tweet-date">
            <a href={getTweetLink(tweet)} title={getTime(tweet.time)}>
              {getShortTime(tweet.time)}
            </a>
          </span>
        </div>
      </div>
    </div>
  );
}

function renderAltText(altText: string): VNode {
  return <p class="alt-text">ALT&nbsp;&nbsp;{altText}</p>;
}

function renderPhotoAttachment(photo: Photo, bigThumb = false): VNode {
  const named = photo.url.includes("name=");
  const thumb = named
    ? photo.url
    : bigThumb
      ? `${photo.url}${mediumWebp}`
      : `${photo.url}${smallWebp}`;
  return (
    <div class="attachment">
      <a href={getOrigPicUrl(photo.url)} class="still-image" target="_blank" rel="noopener">
        {genImg(thumb, "", photo.altText)}
      </a>
      {photo.altText.length > 0 && renderAltText(photo.altText)}
    </div>
  );
}

function isPlaybackEnabled(prefs: TseerPreferences, playbackType: VideoType): boolean {
  return playbackType === VideoType.mp4 ? prefs.mp4Playback : prefs.hlsPlayback;
}

function hasMp4Url(video: Video): boolean {
  return video.variants.some((variant) => variant.contentType === VideoType.mp4);
}

function renderVideoDisabled(playbackType: VideoType, path = ""): VNode {
  return (
    <div class="video-overlay">
      {playbackType === VideoType.mp4
        ? buttonReferer("/enablemp4", "Enable mp4 playback", path)
        : buttonReferer("/enablehls", "Enable hls playback", path)}
    </div>
  );
}

function renderVideoUnavailable(video: Video): VNode {
  return (
    <div class="video-overlay">
      <p>
        {video.reason === "dmcaed"
          ? "This media has been disabled in response to a report by the copyright owner"
          : "This media is unavailable"}
      </p>
    </div>
  );
}

function getVideoDownloadUrl(videoData: Video): string {
  const mp4Vars = videoData.variants.filter((variant) => variant.contentType === VideoType.mp4);
  if (mp4Vars.length === 0) return "";
  const best = mp4Vars.sort((a, b) => a.bitrate - b.bitrate)[mp4Vars.length - 1]!.url;
  return best.startsWith("http") ? getVidUrl(best) : best;
}

function renderVideoAttachment(
  videoData: Video,
  prefs: TseerPreferences,
  path = "",
  bigThumb = false,
): VNode {
  const playbackType =
    !prefs.proxyVideos && hasMp4Url(videoData) ? VideoType.mp4 : videoData.playbackType;
  const thumb = bigThumb ? getMediumPic(videoData.thumb) : getSmallPic(videoData.thumb);

  return (
    <div class="attachment">
      {!videoData.available ? (
        <>
          {genImg(thumb)}
          {renderVideoUnavailable(videoData)}
        </>
      ) : !isPlaybackEnabled(prefs, playbackType) ? (
        <>
          {genImg(thumb)}
          {renderVideoDisabled(playbackType, path)}
        </>
      ) : (
        (() => {
          const vars = videoData.variants.filter((variant) => variant.contentType === playbackType);
          const vidUrl = vars.sort((a, b) => a.resolution - b.resolution)[vars.length - 1]!.url;
          const source =
            prefs.proxyVideos && vidUrl.startsWith("http") ? getVidUrl(vidUrl) : vidUrl;
          return playbackType === VideoType.mp4 ? (
            <video poster={thumb} controls muted={prefs.muteVideos} playsinline preload="metadata">
              <source src={source} type="video/mp4" />
            </video>
          ) : (
            <>
              <video
                poster={thumb}
                data-url={source}
                data-autoload="false"
                muted={prefs.muteVideos}
                playsinline
                preload="none"
              />
              <div
                dangerouslySetInnerHTML={{
                  __html:
                    '<div class="video-overlay" onclick="playVideo(this)">' +
                    '<div class="overlay-circle"><span class="overlay-triangle"></span></div>' +
                    (videoData.durationMs > 0
                      ? `<div class="overlay-duration">${getDuration(videoData.durationMs)}</div>`
                      : "") +
                    "</div>",
                }}
              />
            </>
          );
        })()
      )}
      {videoData.available && getVideoDownloadUrl(videoData).length > 0 && (
        <a
          class="video-download"
          href={getVideoDownloadUrl(videoData)}
          download
          title="Download video"
        >
          {icon("download-alt")}
        </a>
      )}
    </div>
  );
}

export function renderVideo(
  video: Video,
  prefs: TseerPreferences,
  path: string,
  bigThumb = false,
): VNode {
  const hasCardContent = video.description.length > 0 || video.title.length > 0;
  return (
    <div class="attachments card">
      <div class={`gallery-video${hasCardContent ? " card-container" : ""}`}>
        {renderVideoAttachment(video, prefs, path, bigThumb)}
        {hasCardContent && (
          <div class="card-content">
            <h2 class="card-title">{video.title}</h2>
            {video.description.length > 0 && <p class="card-description">{video.description}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function renderGifAttachment(gif: Gif, prefs: TseerPreferences, path = ""): VNode {
  const thumb = getSmallPic(gif.thumb);
  return (
    <div class="attachment">
      {!prefs.mp4Playback ? (
        <>
          {genImg(thumb)}
          {renderVideoDisabled(VideoType.mp4, path)}
        </>
      ) : (
        <video
          class="gif"
          poster={thumb}
          autoplay={prefs.autoplayGifs}
          controls={!prefs.autoplayGifs}
          muted
          loop
          playsinline
        >
          <source src={getPicUrl(gif.url)} type="video/mp4" />
        </video>
      )}
      {gif.altText.length > 0 && renderAltText(gif.altText)}
    </div>
  );
}

function renderGif(gif: Gif, prefs: TseerPreferences, path = ""): VNode {
  return <div class="attachments media-gif">{renderGifAttachment(gif, prefs, path)}</div>;
}

function renderMedia(
  media: Media[],
  prefs: TseerPreferences,
  path: string,
  bigThumb = false,
): VNode | undefined {
  if (media.length === 0) return undefined;

  if (media.length === 1) {
    const item = media[0]!;
    if (item.kind === MediaKind.videoMedia) return renderVideo(item.video, prefs, path, bigThumb);
    if (item.kind === MediaKind.gifMedia) return renderGif(item.gif, prefs, path);
  }

  const groups =
    media.length < 3
      ? [media]
      : [media.slice(0, Math.ceil(media.length / 2)), media.slice(Math.ceil(media.length / 2))];

  return (
    <div class="attachments">
      {groups.map((mediaGroup, i) => {
        const allPhotos = mediaGroup.every((item) => item.kind === MediaKind.photoMedia);
        const rowClass = `gallery-row${allPhotos ? "" : " mixed-row"}`;
        return (
          <div class={rowClass} style={i > 0 ? "margin-top: .25em" : undefined}>
            {mediaGroup.map((item) => {
              switch (item.kind) {
                case MediaKind.photoMedia: {
                  return renderPhotoAttachment(item.photo, bigThumb);
                }
                case MediaKind.videoMedia: {
                  return renderVideoAttachment(item.video, prefs, path, bigThumb);
                }
                case MediaKind.gifMedia: {
                  return renderGifAttachment(item.gif, prefs, path);
                }
              }
              return undefined;
            })}
          </div>
        );
      })}
    </div>
  );
}

function renderPoll(poll: Poll): VNode {
  return (
    <div class="poll">
      {poll.options.map((option, i) => {
        const leader = poll.leader === i ? " leader" : "";
        const val = poll.values[i] ?? 0;
        const percStr = `${val > 0 && poll.votes > 0 ? Math.round((val / poll.votes) * 100) : 0}%`;
        return (
          <div class={`poll-meter${leader}`}>
            <span class="poll-choice-bar" style={`width: ${percStr}`} />
            <span class="poll-choice-value">{percStr}</span>
            <span class="poll-choice-option">{option}</span>
          </div>
        );
      })}
      <span class="poll-info">
        {insertSep(String(poll.votes))} votes • {poll.status}
      </span>
    </div>
  );
}

function renderCardImage(card: Card): VNode {
  return (
    <div class="card-image-container">
      <div class="card-image">
        {genImg(card.image)}
        {card.kind === CardKind.player && (
          <div class="card-overlay">
            <div class="overlay-circle">
              <span class="overlay-triangle" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function renderCardContent(card: Card): VNode {
  return (
    <div class="card-content">
      <h2 class="card-title">{card.title}</h2>
      {card.text.length > 0 && <p class="card-description">{card.text}</p>}
      {card.dest.length > 0 && <span class="card-destination">{card.dest}</span>}
    </div>
  );
}

function renderCard(card: Card, prefs: TseerPreferences, path: string): VNode {
  const smallCards = new Set([CardKind.app, CardKind.player, CardKind.summary, CardKind.storeLink]);
  const large = smallCards.has(card.kind) ? "" : " large";
  const url = replaceUrls(card.url, prefs);

  if (card.video !== undefined) {
    return (
      <div class={`card${large}`}>
        <div class="card-container">
          {renderVideo(card.video, prefs, path)}
          <a class="card-content-container" href={url}>
            {renderCardContent(card)}
          </a>
        </div>
      </div>
    );
  }
  return (
    <div class={`card${large}`}>
      <a class="card-container" href={url}>
        {card.image.length > 0 && renderCardImage(card)}
        <div class="card-content-container">{renderCardContent(card)}</div>
      </a>
    </div>
  );
}

function formatStat(stat: number): string {
  return stat > 0 ? insertSep(String(stat)) : "";
}

export function renderStats(stats: TweetStats): VNode {
  return (
    <div class="tweet-stats">
      <span class="tweet-stat">{icon("comment", formatStat(stats.replies))}</span>
      <span class="tweet-stat">{icon("retweet", formatStat(stats.retweets))}</span>
      <span class="tweet-stat">{icon("heart", formatStat(stats.likes))}</span>
      <span class="tweet-stat">{icon("views", formatStat(stats.views))}</span>
    </div>
  );
}

function renderReply(tweet: Tweet): VNode {
  return (
    <div class="replying-to">
      {"Replying to "}
      {tweet.reply.map((u, i) => (
        <>
          {i > 0 ? " " : ""}
          <a href={`/${u}`}>@{u}</a>
        </>
      ))}
    </div>
  );
}

function renderAttribution(user: User, prefs: TseerPreferences, link = ""): VNode {
  const href = link.length > 0 ? link : `/${user.username}`;
  return (
    <a class="attribution" href={href}>
      {renderMiniAvatar(user, prefs)}
      <strong>{user.fullname}</strong>
      {verifiedIcon(user)}
    </a>
  );
}

function renderMediaTags(tags: User[]): VNode {
  return (
    <div class="media-tag-block">
      {icon("user")}
      {tags.map((p, i) => (
        <>
          <a class="media-tag" href={`/${p.username}`} title={p.username}>
            {p.fullname}
          </a>
          {i < tags.length - 1 ? ", " : ""}
        </>
      ))}
    </div>
  );
}

function renderLatestPost(username: string, id: string): VNode {
  return (
    <div class="latest-post-version">
      {"There's a new version of this post. "}
      <a href={getLink(id, username)}>{"See the latest post"}</a>
    </div>
  );
}

function renderCommunityNote(note: string, prefs: TseerPreferences): VNode {
  return (
    <div class="community-note">
      <div class="community-note-header">
        {icon("group")}
        <span>Community note</span>
      </div>
      <div
        class="community-note-text"
        dir="auto"
        dangerouslySetInnerHTML={{ __html: replaceUrls(note, prefs) }}
      />
    </div>
  );
}

function renderQuoteMedia(quote: Tweet, prefs: TseerPreferences, path: string): VNode {
  return <div class="quote-media-container">{renderMedia(quote.media, prefs, path)}</div>;
}

function renderQuote(quote: Tweet, prefs: TseerPreferences, path: string): VNode {
  if (!quote.available) {
    return (
      <div class="quote unavailable">
        <a class="unavailable-quote" href={getTweetLink(quote, false)}>
          {quote.tombstone.length > 0
            ? quote.tombstone
            : quote.text.length > 0
              ? quote.text
              : "This tweet is unavailable"}
        </a>
      </div>
    );
  }

  return (
    <div class="quote quote-big">
      {/* biome-ignore lint/a11y/useAnchorContent: nitter's invisible quote-link overlay */}
      {/* biome-ignore lint/a11y/useValidAnchor: overlay anchor, ported verbatim */}
      <a class="quote-link" href={getTweetLink(quote)} />
      <div class="tweet-name-row">
        <div class="fullname-and-username">
          {renderMiniAvatar(quote.user, prefs)}
          {linkUser(quote.user, "fullname")}
          {verifiedIcon(quote.user)}
          {linkUser(quote.user, "username")}
        </div>
        <span class="tweet-date">
          <a href={getTweetLink(quote)} title={getTime(quote.time)}>
            {getShortTime(quote.time)}
          </a>
        </span>
      </div>
      {quote.reply.length > 0 && renderReply(quote)}
      {quote.text.length > 0 && (
        <div
          class="quote-text"
          dir="auto"
          dangerouslySetInnerHTML={{ __html: replaceUrls(quote.text, prefs) }}
        />
      )}
      {quote.media.length > 0 && renderQuoteMedia(quote, prefs, path)}
      {quote.articlePreview !== undefined && renderArticleCard(quote.articlePreview, prefs)}
      {quote.note.length > 0 && !prefs.hideCommunityNotes && renderCommunityNote(quote.note, prefs)}
      {quote.hasThread && (
        <a class="show-thread" href={getTweetLink(quote)}>
          Show this thread
        </a>
      )}
      {quote.history.length > 0 &&
        quote.history[quote.history.length - 1] !== maxHistoryId(quote.history) && (
          <div class="quote-latest">There's a new version of this post</div>
        )}
    </div>
  );
}

function maxHistoryId(history: string[]): string {
  return history.reduce((a, b) => (BigInt(b) > BigInt(a) ? b : a), history[0] ?? "");
}

function renderDisclosures(tweet: Tweet): VNode {
  return (
    <div class="disclosures">
      {tweet.isAI && <span data-disclosure="ai">{icon("attention-circled", "Made with AI")}</span>}
      {tweet.isAd && (
        <span data-disclosure="ad">{icon("attention-circled", "Paid partnership (ad)")}</span>
      )}
    </div>
  );
}

function renderLocation(tweet: Tweet): VNode | undefined {
  const parts = tweet.location.split(":");
  const place = tweet.location.includes("://") ? tweet.location : (parts[0] ?? "");
  const url =
    !tweet.location.includes("://") && parts.length > 1
      ? `/search?f=tweets&q=place:${parts[1]}`
      : "";
  if (place.length === 0) return undefined;
  return (
    <span class="tweet-geo">
      {" – at "}
      {url.length > 1 ? <a href={url}>{place}</a> : place}
    </span>
  );
}

export interface RenderTweetOptions {
  className?: string | undefined;
  index?: number | undefined;
  last?: boolean | undefined;
  mainTweet?: boolean | undefined;
  afterTweet?: boolean | undefined;
  bigThumb?: boolean | undefined;
}

export function renderTweet(
  tweet: Tweet,
  prefs: TseerPreferences,
  path: string,
  options: RenderTweetOptions = {},
): VNode {
  const {
    className = "",
    index = 0,
    last = false,
    mainTweet = false,
    afterTweet = false,
    bigThumb = false,
  } = options;
  let divClass = className;
  if (index === -1 || last) divClass = `thread-last ${className}`;

  if (!tweet.available) {
    return (
      <div class={`${divClass}unavailable timeline-item`} data-username={tweet.user.username}>
        <a class="unavailable-box" href={getTweetLink(tweet)}>
          {tweet.tombstone.length > 0
            ? tweet.tombstone
            : tweet.text.length > 0
              ? tweet.text
              : "This tweet is unavailable"}
        </a>
        {tweet.quote !== undefined && renderQuote(tweet.quote, prefs, path)}
      </div>
    );
  }

  const fullTweet = tweet;
  const pinned = tweet.pinned;

  let retweet = "";
  let shown = fullTweet;
  if (fullTweet.retweet !== undefined) {
    shown = fullTweet.retweet;
    retweet = fullTweet.user.fullname;
  }

  const showReply =
    !afterTweet &&
    index === 0 &&
    shown.reply.length > 0 &&
    (shown.reply.length > 1 || shown.reply[0] !== shown.user.username || pinned);

  const tweetClass = `tweet-content media-body${prefs.bidiSupport ? " tweet-bidi" : ""}`;
  const hasEdits = shown.history.length > 1;
  const isLatest = hasEdits && shown.id === maxHistoryId(shown.history);

  return (
    <div class={`timeline-item ${divClass}`} data-username={shown.user.username}>
      {!mainTweet && (
        /* biome-ignore lint/a11y/useAnchorContent: nitter's invisible tweet-link overlay */
        /* biome-ignore lint/a11y/useValidAnchor: overlay anchor, ported verbatim */
        <a class="tweet-link" href={getTweetLink(shown)} />
      )}
      <div class="tweet-body">
        {renderHeader(shown, retweet, pinned, prefs, path)}
        {showReply && renderReply(shown)}
        <div class={tweetClass} dir="auto">
          <span dangerouslySetInnerHTML={{ __html: replaceUrls(shown.text, prefs) }} />
          {renderLocation(shown)}
        </div>
        {shown.attribution !== undefined &&
          renderAttribution(shown.attribution, prefs, shown.attributionLink)}
        {shown.card !== undefined &&
          shown.card.kind !== CardKind.hidden &&
          renderCard(shown.card, prefs, path)}
        {shown.articlePreview !== undefined && renderArticleCard(shown.articlePreview, prefs)}
        {shown.media.length > 0 && renderMedia(shown.media, prefs, path, bigThumb)}
        {shown.poll !== undefined && renderPoll(shown.poll)}
        {shown.quote !== undefined && renderQuote(shown.quote, prefs, path)}
        {shown.note.length > 0 &&
          !prefs.hideCommunityNotes &&
          renderCommunityNote(shown.note, prefs)}
        {(shown.isAI || shown.isAd) && renderDisclosures(shown)}
        {mainTweet && (
          <p class="tweet-published">
            {hasEdits && isLatest ? (
              <a href={`${getTweetLink(shown, false)}/history`}>
                {`Last edited ${getTime(shown.time)}`}
              </a>
            ) : (
              getTime(shown.time)
            )}
          </p>
        )}
        {mainTweet &&
          hasEdits &&
          !isLatest &&
          renderLatestPost(shown.user.username, maxHistoryId(shown.history))}
        {shown.mediaTags.length > 0 && renderMediaTags(shown.mediaTags)}
        {!prefs.hideTweetStats && renderStats(shown.stats)}
      </div>
    </div>
  );
}
