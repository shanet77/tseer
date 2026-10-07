/** Port of nitter's `src/views/about_account.nim` — the `/:name/about` panel. */

import { type AccountInfo, VerifiedType } from "@tseer/types";
import type { VNode } from "preact";
import { getUserPic } from "./formatters.ts";
import { genImg, icon, linkUser, verifiedIcon } from "./renderutils.tsx";

const months = [
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

/** Nim `format("MMMM YYYY")` over an ISO UTC string. */
function monthYear(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || iso === "") return "";
  return `${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function renderAboutAccount(info: AccountInfo): VNode {
  const user = {
    username: info.username,
    fullname: info.fullname,
    userPic: info.userPic,
    verifiedType: info.verifiedType,
  };

  return (
    <div class="about-account">
      <div class="about-account-header">
        <a class="about-account-avatar" href={`/${info.username}`}>
          {genImg(getUserPic(info.userPic, "_200x200"))}
        </a>
        <div class="about-account-name">
          {linkUser(user, "profile-card-fullname")}
          {verifiedIcon(user)}
        </div>
        {linkUser(user, "profile-card-username")}
      </div>
      <div class="about-account-body">
        <div class="about-account-row">
          <span>{icon("calendar")}</span>
          <div>
            <span class="about-account-label">Date joined</span>
            <span class="about-account-value">{monthYear(info.joinDate)}</span>
          </div>
        </div>
        {info.basedIn.length > 0 && (
          <div class="about-account-row">
            <span>{icon("location")}</span>
            <div>
              <span class="about-account-label">Account based in</span>
              <span class="about-account-value">{info.basedIn}</span>
            </div>
          </div>
        )}
        {info.verifiedType !== VerifiedType.None && (
          <>
            {info.overrideVerifiedYear !== 0 ? (
              <div class="about-account-row">
                <span>{icon("ok")}</span>
                <div>
                  <span class="about-account-label">Verified</span>
                  <span class="about-account-value">
                    {`Since ${Math.abs(info.overrideVerifiedYear)}${info.overrideVerifiedYear < 0 ? " BCE" : ""}`}
                  </span>
                </div>
              </div>
            ) : (
              info.verifiedSince !== "" && (
                <div class="about-account-row">
                  <span>{icon("ok")}</span>
                  <div>
                    <span class="about-account-label">Verified</span>
                    <span class="about-account-value">{`Since ${monthYear(info.verifiedSince)}`}</span>
                  </div>
                </div>
              )
            )}
            {info.isIdentityVerified && (
              <div class="about-account-row">
                <span>{icon("ok")}</span>
                <div>
                  <span class="about-account-label">ID Verified</span>
                  <span class="about-account-value">Yes</span>
                </div>
              </div>
            )}
          </>
        )}
        {info.affiliateUsername.length > 0 && (
          <div class="about-account-row">
            <span>{icon("group")}</span>
            <div>
              <span class="about-account-label">An affiliate of</span>
              <span class="about-account-value">
                <a href={`/${info.affiliateUsername}`}>
                  {info.affiliateLabel.length > 0
                    ? `${info.affiliateLabel} (@${info.affiliateUsername})`
                    : `@${info.affiliateUsername}`}
                </a>
              </span>
            </div>
          </div>
        )}
        {info.usernameChanges > 0 && (
          <div class="about-account-row">
            <span class="about-account-at">@</span>
            <div>
              <span class="about-account-label">
                {`${info.usernameChanges} username change${info.usernameChanges > 1 ? "s" : ""}`}
              </span>
              {info.lastUsernameChange !== "" && (
                <span class="about-account-value">{`Last on ${monthYear(info.lastUsernameChange)}`}</span>
              )}
            </div>
          </div>
        )}
        {info.source.length > 0 && (
          <div class="about-account-row">
            <span>{icon("link")}</span>
            <div>
              <span class="about-account-label">Connected via</span>
              <span class="about-account-value">{info.source}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
