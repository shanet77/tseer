/** Port of nitter's `src/views/broadcast.nim` (`renderBroadcast`).
 *
 * Deliberate divergences from the Nim original (documented at the call sites):
 * - The HLS play overlay's inline `onclick="playVideo(this)"` is emitted as raw
 *   HTML (preact would treat the string as a function handler) — the same rule
 *   as the video overlay in `tweet.tsx` and the audio overlay in `space.tsx`.
 * - `bc.endTime.year > 1` / `year > 1` "date is set" guards map to empty-string
 *   guards (domain dates are ISO strings with `""` = not set); `format("MMM d,
 *   YYYY")` is the shared `endedDate` helper from `space.tsx` (no Intl).
 * - `insertSep`/`getDuration`/`getUserPic` live in `formatters.ts`, so no local
 *   helpers are needed.
 */

import type { TseerPreferences } from "@tseer/prefs";
import type { Broadcast } from "@tseer/types";
import type { VNode } from "preact";
import { getDuration, getUserPic, insertSep } from "./formatters.ts";
import { getPicUrl, getVidUrl } from "./media.ts";
import { buttonReferer, genImg, verifiedIcon } from "./renderutils.tsx";
import { endedDate } from "./space.tsx";

/** `views/broadcast.nim` `renderBroadcast`. */
export function renderBroadcast(bc: Broadcast, prefs: TseerPreferences, path: string): VNode {
  const isLive = bc.state === "RUNNING";
  const thumb = getPicUrl(bc.thumb);
  const source =
    prefs.proxyVideos && bc.m3u8Url.startsWith("http") ? getVidUrl(bc.m3u8Url) : bc.m3u8Url;
  const ended = endedDate(bc.endTime);
  const stateText = isLive
    ? "LIVE"
    : ended.length > 0
      ? `Ended ${ended}`
      : bc.state.length > 0
        ? bc.state
        : "Ended";

  // Nim: `(bc.endTime - bc.startTime).inMilliseconds - bc.replayStart * 1000`
  // when both dates are set, else 0 (`replayStart` is seconds; replays begin
  // partway through the recording, so the badge shows the replay length).
  const start = bc.startTime === "" ? undefined : new Date(bc.startTime);
  const end = bc.endTime === "" ? undefined : new Date(bc.endTime);
  const durationMs =
    start !== undefined &&
    end !== undefined &&
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime())
      ? end.getTime() - start.getTime() - bc.replayStart * 1000
      : 0;
  const duration = durationMs > 0 ? getDuration(durationMs) : "";

  const badge = isLive ? (
    <div class="broadcast-live">LIVE</div>
  ) : duration.length > 0 ? (
    <div class="overlay-duration">{duration}</div>
  ) : null;

  const player: VNode =
    bc.m3u8Url.length > 0 && prefs.hlsPlayback ? (
      <>
        <video
          poster={thumb}
          data-url={source}
          data-autoload="false"
          data-start={String(bc.replayStart)}
          muted={prefs.muteVideos}
        />
        {/* The verbatim overlay: static markup + the signed duration string,
            both safe for a raw-HTML sink. */}
        <div
          dangerouslySetInnerHTML={{
            __html:
              '<div class="video-overlay" onclick="playVideo(this)">' +
              '<div class="overlay-circle"><span class="overlay-triangle"></span></div>' +
              (isLive
                ? '<div class="broadcast-live">LIVE</div>'
                : duration.length > 0
                  ? `<div class="overlay-duration">${duration}</div>`
                  : "") +
              "</div>",
          }}
        />
      </>
    ) : bc.m3u8Url.length > 0 ? (
      <>
        <img src={thumb} alt={bc.title} />
        <div class="video-overlay">
          {buttonReferer("/enablehls", "Enable hls playback", path)}
          {badge}
        </div>
      </>
    ) : bc.thumb.length > 0 ? (
      <>
        <img src={thumb} alt={bc.title} />
        <div class="video-overlay">
          {bc.availableForReplay ? <p>Stream unavailable</p> : <p>Replay is not available</p>}
        </div>
      </>
    ) : (
      <div class="video-overlay">
        <p>Broadcast not found</p>
      </div>
    );

  return (
    <div class="broadcast-page">
      <div class="broadcast-panel">
        <div class="broadcast-player">{player}</div>
        <div class="broadcast-info">
          <h2 class="broadcast-title">{bc.title}</h2>
          <div class="broadcast-user-row">
            <a class="broadcast-user" href={`/${bc.user.username}`}>
              {genImg(getUserPic(bc.user.userPic, "_bigger"))}
              <div>
                <div>
                  <strong>{bc.user.fullname}</strong>
                  {verifiedIcon(bc.user)}
                </div>
                <span class="broadcast-username">@{bc.user.username}</span>
              </div>
            </a>
            <div class="broadcast-meta">
              {bc.totalWatched > 0 && <span>{`${insertSep(String(bc.totalWatched))} views`}</span>}
              {isLive ? <span class="broadcast-live">{stateText}</span> : <span>{stateText}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
