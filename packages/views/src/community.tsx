import type { Community, Query, User } from "@tseer/types";
import { QueryKind } from "@tseer/types";
import type { VNode } from "preact";
import { getUserPic, insertSep } from "./formatters.ts";
import { getPicUrl } from "./media.ts";
import { genImg, getTabClass, icon, verifiedIcon } from "./renderutils.tsx";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function createdDate(iso: string): string {
  const date = new Date(iso);
  if (iso === "" || Number.isNaN(date.getTime())) return "";
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function tabQuery(kind: QueryKind): Query {
  return {
    kind,
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

export function renderCommunityTabs(kind: QueryKind, community: Community): VNode {
  const path = `/i/communities/${community.id}`;
  const query = tabQuery(kind);
  return (
    <div>
      <ul class="tab">
        <li class={getTabClass(query, QueryKind.posts)}>
          <a href={path}>Top</a>
        </li>
        <li class={getTabClass(query, QueryKind.replies)}>
          <a href={`${path}/latest`}>Latest</a>
        </li>
        <li class={getTabClass(query, QueryKind.media)}>
          <a href={`${path}/media`}>Media</a>
        </li>
        <li class={getTabClass(query, QueryKind.userList)}>
          <a href={`${path}/about`}>About</a>
        </li>
      </ul>
      {community.hashtags.length > 0 && (
        <div class="community-tags">
          {community.hashtags.map((tag) => {
            const bare = tag.replace(/^#+/, "").replace(/#+$/, "");
            return (
              <a class="community-tag" href={`/i/communities/${community.id}/hashtag/${bare}`}>
                {tag}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function renderMemberTabs(community: Community, isModerators: boolean): VNode {
  const path = `/i/communities/${community.id}`;
  return (
    <ul class="tab">
      <li class={isModerators ? "tab-item" : "tab-item active"}>
        <a href={`${path}/members`}>All</a>
      </li>
      <li class={isModerators ? "tab-item active" : "tab-item"}>
        <a href={`${path}/moderators`}>Moderators</a>
      </li>
    </ul>
  );
}

export function renderHashtagHeader(_community: Community, tag: string): VNode {
  return (
    <div class="community-hashtag-header">
      <h2 class="community-hashtag-title">{`#${tag}`}</h2>
    </div>
  );
}

export function renderCommunityAbout(community: Community, moderators: User[]): VNode {
  const created = createdDate(community.createdAt);
  return (
    <div class="community-about">
      <div class="community-info">
        <h2>Community Info</h2>
        <div class="community-info-item">
          {icon("group")}
          {community.joinPolicy === "Open"
            ? "Anyone can join this Community."
            : "Membership is by approval only."}
        </div>
        <div class="community-info-item">
          {icon("info")}
          All Communities are publicly visible.
        </div>
        <div class="community-info-item">
          {icon("calendar")}
          <span>
            {created.length > 0 ? `Created ${created} by ` : "Created by "}
            <a href={`/${community.creator.username}`}>@{community.creator.username}</a>
            {verifiedIcon(community.creator)}
          </span>
        </div>
      </div>
      {community.rules.length > 0 && (
        <div class="community-rules">
          <h2>Rules</h2>
          <p class="community-rules-intro">
            These are set and enforced by Community admins and are in addition to{" "}
            <a href="https://help.x.com/rules-and-policies/x-rules">X's rules</a>.
          </p>
          {community.rules.map((rule, i) => (
            <div class="community-rule">
              <span class="community-rule-number">{i + 1}</span>
              <div class="community-rule-content">
                <strong>{rule.name}</strong>
                {rule.description.length > 0 && <p>{rule.description}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
      {moderators.length > 0 && (
        <div class="community-moderators">
          <h2>
            Moderators
            <a class="community-mods-link" href={`/i/communities/${community.id}/moderators`}>
              See all
            </a>
          </h2>
          {moderators.map((user) => (
            <div class="community-moderator">
              <a href={`/${user.username}`}>
                {genImg(getUserPic(user.userPic, "_bigger"), "community-mod-avatar")}
              </a>
              <div class="community-mod-info">
                <a href={`/${user.username}`} class="community-mod-name">
                  {user.fullname}
                  {verifiedIcon(user)}
                </a>
                <a href={`/${user.username}`} class="community-mod-username">
                  {`@${user.username}`}
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function renderCommunity(body: VNode, nav: VNode, community: Community): VNode {
  return (
    <div class="timeline-container">
      {community.banner.length > 0 && (
        <div class="timeline-banner">
          <a href={getPicUrl(community.banner)} target="_blank" rel="noopener">
            {genImg(community.banner)}
          </a>
        </div>
      )}
      <div class="community-header">
        <h1 class="community-name">
          <a href={`/i/communities/${community.id}`}>{community.name}</a>
        </h1>
        {community.category.length > 0 && (
          <span class="community-category">{community.category}</span>
        )}
        {community.description.length > 0 && (
          <div class="community-description">{community.description}</div>
        )}
        <div class="community-stats">
          <a class="community-member-count" href={`/i/communities/${community.id}/members`}>
            {`${insertSep(String(community.memberCount), ",")} Members`}
          </a>
        </div>
      </div>
      {nav}
      {body}
    </div>
  );
}
