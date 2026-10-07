/** Port of nitter's `src/views/profile.nim` — the profile card, photo rail,
 * banner, protected panel, and `renderProfile`/`renderUserList`. */

import type { TseerPreferences } from "@tseer/prefs";
import { type AccountInfo, type Profile, type Result, type User, VerifiedType } from "@tseer/types";
import type { VNode } from "preact";
import {
  getJoinDate,
  getJoinDateFull,
  getLocation,
  getUserPic,
  insertSep,
  replaceUrls,
  shortLink,
  titleize,
} from "./formatters.ts";
import { getPicUrl } from "./media.ts";
import { genImg, icon, linkUser, verifiedIcon } from "./renderutils.tsx";
import { renderTweetSearch } from "./search.tsx";
import { renderTimelineUsers } from "./timeline.tsx";

/** Nim's zero-default `AccountInfo()`. */
export function emptyAccountInfo(): AccountInfo {
  return {
    username: "",
    fullname: "",
    userPic: "",
    joinDate: "",
    verifiedType: VerifiedType.None,
    suspended: false,
    basedIn: "",
    source: "",
    usernameChanges: 0,
    lastUsernameChange: "",
    affiliateUsername: "",
    affiliateLabel: "",
    isIdentityVerified: false,
    verifiedSince: "",
    overrideVerifiedYear: 0,
  };
}

export function renderStat(num: number, className: string, text = ""): VNode {
  const label = text.length > 0 ? text : className;
  return (
    <li class={className}>
      <span class="profile-stat-header">{titleize(label)}</span>
      <span class="profile-stat-num">{insertSep(String(num))}</span>
    </li>
  );
}

export function renderStatLink(num: number, className: string, href: string): VNode {
  return (
    <li class={className}>
      <a href={href}>
        <span class="profile-stat-header">{titleize(className)}</span>
        <span class="profile-stat-num">{insertSep(String(num))}</span>
      </a>
    </li>
  );
}

export function renderUserCard(user: User, prefs: TseerPreferences, info: AccountInfo): VNode {
  const avatarUrl = getPicUrl(getUserPic(user.userPic));
  const size = prefs.autoplayGifs && user.userPic.endsWith("gif") ? "" : "_400x400";

  return (
    <div class="profile-card">
      <div class="profile-card-info">
        <a class="profile-card-avatar" href={avatarUrl} target="_blank" rel="noopener">
          {genImg(getUserPic(user.userPic, size))}
        </a>
        <div class="profile-card-tabs-name">
          {linkUser(user, "profile-card-fullname")}
          {verifiedIcon(user)}
          {linkUser(user, "profile-card-username")}
        </div>
      </div>
      <div class="profile-card-extra">
        {user.bio.length > 0 && (
          <div class="profile-bio">
            <p dir="auto">
              <span dangerouslySetInnerHTML={{ __html: replaceUrls(user.bio, prefs) }} />
            </p>
          </div>
        )}
        {user.location.length > 0 && (
          <div class="profile-location">
            <span>{icon("location")}</span>
            {(() => {
              const [place, url] = getLocation(user.location);
              if (url.length > 1) return <a href={url}>{place}</a>;
              if (place.includes("://")) return <a href={place}>{place}</a>;
              return <span>{place}</span>;
            })()}
          </div>
        )}
        {info.basedIn.length > 0 && (
          <div class="profile-location">
            <span>{icon("location")}</span>
            <span>{`Based in ${info.basedIn}`}</span>
          </div>
        )}
        {user.website.length > 0 && (
          <div class="profile-website">
            <span>
              {icon("link")}
              <a href={replaceUrls(user.website, prefs)}>{shortLink(user.website)}</a>
            </span>
          </div>
        )}
        <div class="profile-joindate">
          <a href={`/${user.username}/about`} title={getJoinDateFull(user.joinDate)}>
            {icon("calendar", getJoinDate(user.joinDate))}
          </a>
        </div>
        <div class="profile-card-extra-links">
          <ul class="profile-statlist">
            {renderStat(user.tweets, "posts", "Tweets")}
            {renderStatLink(user.following, "following", `/${user.username}/following`)}
            {renderStatLink(user.followers, "followers", `/${user.username}/followers`)}
            {renderStat(user.likes, "likes")}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function renderPhotoRail(profile: Profile): VNode {
  const count = insertSep(String(profile.user.media));
  return (
    <div class="photo-rail-card">
      <div class="photo-rail-header">
        <a href={`/${profile.user.username}/media`}>
          {icon("picture", `${count} Photos and videos`)}
        </a>
      </div>
      <input id="photo-rail-grid-toggle" type="checkbox" />
      <label for="photo-rail-grid-toggle" class="photo-rail-header-mobile">
        {icon("picture", `${count} Photos and videos`)}
        {icon("down")}
      </label>
      <div class="photo-rail-grid">
        {profile.photoRail.slice(0, 16).map((photo) => {
          const photoSuffix =
            photo.url.includes("format") || photo.url.includes("placeholder") ? "" : ":thumb";
          return (
            <a href={`/${profile.user.username}/status/${photo.tweetId}#m`}>
              {genImg(`${photo.url}${photoSuffix}`)}
            </a>
          );
        })}
      </div>
    </div>
  );
}

export function renderBanner(banner: string): VNode {
  // biome-ignore lint/a11y/useAnchorContent: nitter renders a bare anchor as a banner spacer
  // biome-ignore lint/a11y/useValidAnchor: spacer anchor, ported verbatim
  if (banner.length === 0) return <a />;
  // biome-ignore lint/a11y/useAnchorContent: color-swatch banner, ported verbatim
  // biome-ignore lint/a11y/useValidAnchor: spacer anchor, ported verbatim
  if (banner.startsWith("#")) return <a style={`background-color: ${banner}`} />;
  return (
    <a href={getPicUrl(banner)} target="_blank" rel="noopener">
      {genImg(banner)}
    </a>
  );
}

export function renderProtected(username: string): VNode {
  return (
    <div class="timeline-container">
      <div class="timeline-header timeline-protected">
        <h2>This account's tweets are protected.</h2>
        <p>{`Only confirmed followers have access to @${username}'s tweets.`}</p>
      </div>
    </div>
  );
}

export function renderProfile(profile: Profile, prefs: TseerPreferences, path: string): VNode {
  profile.tweets.query.fromUser = [profile.user.username];
  const isGalleryView =
    profile.tweets.query.kind === "media" && profile.tweets.query.view === "gallery";
  const viewClass = isGalleryView ? " media-only" : "";

  return (
    <div class={`profile-tabs${viewClass}`}>
      {!isGalleryView && !prefs.hideBanner && (
        <div class="profile-banner">{renderBanner(profile.user.banner)}</div>
      )}
      {!isGalleryView && (
        <div class={`profile-tab${prefs.stickyProfile ? " sticky" : ""}`}>
          {renderUserCard(profile.user, prefs, profile.accountInfo)}
          {profile.photoRail.length > 0 && renderPhotoRail(profile)}
        </div>
      )}
      {profile.user.protected
        ? renderProtected(profile.user.username)
        : renderTweetSearch(profile.tweets, prefs, path, profile.pinned)}
    </div>
  );
}

export function renderFollowTabs(user: User, activeTab: string): VNode {
  return (
    <ul class="tab">
      {["Following", "Followers"].map((tab) => (
        <li class={activeTab === tab ? "tab-item active" : "tab-item"}>
          <a href={`/${user.username}/${tab.toLowerCase()}`}>{tab}</a>
        </li>
      ))}
    </ul>
  );
}

export function renderUserList(
  user: User,
  results: Result<User>,
  prefs: TseerPreferences,
  path: string,
  activeTab: string,
): VNode {
  // Check if we've loaded all results (for page 1)
  let displayResults = results;
  if (results.beginning) {
    const expectedCount = activeTab === "Followers" ? user.followers : user.following;
    if (results.content.length >= expectedCount) {
      displayResults = { ...results, bottom: "" };
    }
  }

  return (
    <div class="profile-tabs">
      {!prefs.hideBanner && <div class="profile-banner">{renderBanner(user.banner)}</div>}
      <div class={`profile-tab${prefs.stickyProfile ? " sticky" : ""}`}>
        {renderUserCard(user, prefs, emptyAccountInfo())}
      </div>
      <div class="timeline-container">
        {renderFollowTabs(user, activeTab)}
        {renderTimelineUsers(displayResults, prefs, path)}
      </div>
    </div>
  );
}
