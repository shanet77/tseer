import type { TseerPreferences } from "@tseer/prefs";
import type { AudioSpace, SpaceParticipant } from "@tseer/types";
import type { VNode } from "preact";
import { getDuration, insertSep } from "./formatters.ts";
import { getVidUrl } from "./media.ts";
import { buttonReferer, genImg, icon } from "./renderutils.tsx";

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function endedDate(iso: string): string {
  const date = new Date(iso);
  if (iso === "" || Number.isNaN(date.getTime())) return "";
  return `${MONTHS_SHORT[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

export function renderParticipant(p: SpaceParticipant, role: string): VNode {
  return (
    <div class="space-participant">
      <a href={`/${p.username}`}>
        {genImg(p.avatarUrl.replaceAll("_normal", "_bigger"))}
        <div class="participant-info">
          <div class="participant-name">
            <strong>{p.displayName}</strong>
            {p.isVerified && (
              <div class="verified-icon blue">
                {icon("circle", "", "Verified account", "verified-icon-circle")}
                {icon("ok", "", "Verified account", "verified-icon-check")}
              </div>
            )}
            {role.length > 0 && <span class="host-badge">{role}</span>}
          </div>
          <span class="participant-username">@{p.username}</span>
        </div>
      </a>
    </div>
  );
}

export function renderSpace(sp: AudioSpace, prefs: TseerPreferences, path: string): VNode {
  const isLive = sp.state === "RUNNING";
  const source =
    prefs.proxyVideos && sp.m3u8Url.startsWith("http") ? getVidUrl(sp.m3u8Url) : sp.m3u8Url;
  const ended = endedDate(sp.endTime);
  const stateText = isLive
    ? "LIVE"
    : ended.length > 0
      ? `Ended ${ended}`
      : sp.state.length > 0
        ? sp.state
        : "Ended";
  const start = sp.startTime === "" ? undefined : new Date(sp.startTime);
  const end = sp.endTime === "" ? undefined : new Date(sp.endTime);
  const durationMs =
    start !== undefined &&
    end !== undefined &&
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime())
      ? end.getTime() - start.getTime()
      : 0;
  const duration = durationMs > 0 ? getDuration(durationMs) : "";
  const totalListeners = sp.totalReplayWatched > 0 ? sp.totalReplayWatched : sp.totalLiveListeners;

  const badge = isLive ? (
    <div class="space-live">LIVE</div>
  ) : duration.length > 0 ? (
    <div class="overlay-duration">{duration}</div>
  ) : null;

  const player: VNode =
    sp.m3u8Url.length > 0 && prefs.hlsPlayback ? (
      <>
        {/* biome-ignore lint/a11y/useMediaCaption: ported verbatim from the Nim view; the overlay player loads via data-url and has no caption track upstream */}
        <audio data-url={source} data-autoload="false" />
        <div
          dangerouslySetInnerHTML={{
            __html:
              '<div class="video-overlay" onclick="playAudio(this)">' +
              '<div class="overlay-circle"><span class="overlay-triangle"></span></div>' +
              (isLive
                ? '<div class="space-live">LIVE</div>'
                : duration.length > 0
                  ? `<div class="overlay-duration">${duration}</div>`
                  : "") +
              "</div>",
          }}
        />
      </>
    ) : sp.m3u8Url.length > 0 ? (
      <div class="video-overlay">
        {buttonReferer("/enablehls", "Enable hls playback", path)}
        {badge}
      </div>
    ) : sp.availableForReplay ? (
      <div class="video-overlay">
        <p>Audio stream unavailable</p>
      </div>
    ) : (
      <div class="video-overlay">
        <p>Replay is not available</p>
      </div>
    );

  return (
    <div class="space-page">
      <div class="space-panel">
        <div class="space-player">{player}</div>
        <div class="space-info">
          <div class="space-header">
            <h2 class="space-title">{sp.title}</h2>
            <div class="space-meta">
              {totalListeners > 0 && (
                <span class="listener-count">
                  {`${insertSep(String(totalListeners))} listeners`}
                </span>
              )}
              {isLive ? (
                <span class="space-live">{stateText}</span>
              ) : (
                <span class="space-state">{stateText}</span>
              )}
            </div>
          </div>
          {(sp.admins.length > 0 || sp.speakers.length > 0) && (
            <div class="space-participants">
              {sp.admins.map((admin) =>
                renderParticipant(
                  admin,
                  admin.username === sp.creator.username ? "Host" : "Co-host",
                ),
              )}
              {sp.speakers.map((speaker) => renderParticipant(speaker, ""))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
