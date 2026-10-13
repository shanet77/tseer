import { type AccountInfo, type User, VerifiedType } from "@tseer/types";
import { fromUnixMilliseconds, parseTwitterDate } from "./dates.ts";
import {
  at,
  boolDef,
  each,
  expandedUrl,
  idString,
  imageStr,
  type Json,
  num,
  pick,
  str,
  strDef,
} from "./json.ts";
import {
  cmpSlice,
  deduplicate,
  extractUrls,
  type ReplaceSlice,
  replacedWith,
  replaceHashtags,
  replaceMentions,
} from "./slices.ts";

export function newUser(): User {
  return {
    id: "",
    username: "",
    fullname: "",
    location: "",
    website: "",
    bio: "",
    userPic: "",
    banner: "",
    pinnedTweet: "",
    following: 0,
    followers: 0,
    tweets: 0,
    likes: 0,
    media: 0,
    verifiedType: VerifiedType.None,
    protected: false,
    suspended: false,
    joinDate: "",
  };
}

export function parseVerifiedType(s: string, current: VerifiedType): VerifiedType {
  const value = Object.values(VerifiedType).find((v) => v === s);
  return value ?? current;
}

export function getBanner(js: Json): string {
  const url = imageStr(js, "profile_banner_url");
  if (url.length > 0) return url + "/1500x500";

  const color = str(js, "profile_link_color");
  if (color.length > 0) return "#" + color;

  const palette = each(js, "profile_image_extensions", "mediaColor", "r", "ok", "palette");
  const first = palette[0];
  if (first !== undefined) {
    const toHex = (n: number): string => (n & 0xff).toString(16).padStart(2, "0");
    return `#${toHex(num(first, "rgb", "red"))}${toHex(num(first, "rgb", "green"))}${toHex(
      num(first, "rgb", "blue"),
    )}`;
  }
  return "";
}

export function expandUserEntities(user: User, js: Json): void {
  const orig = [...user.bio];
  const ent = at(js, "entities");

  const urls = each(ent, "url", "urls");
  const firstUrl = urls[0];
  if (firstUrl !== undefined) user.website = expandedUrl(firstUrl);

  const replacements: ReplaceSlice[] = [];
  for (const u of each(ent, "description", "urls")) {
    extractUrls(replacements, u, Math.max(0, orig.length - 1));
  }

  deduplicate(replacements);
  replacements.sort(cmpSlice);

  user.bio = replaceHashtags(
    replaceMentions(replacedWith(orig, replacements, { a: 0, b: orig.length })),
  );
}

export function parseUser(js: Json, id = ""): User {
  const result = newUser();
  if (js === undefined || js === null) return result;

  result.id = id.length > 0 ? id : str(js, "id_str");
  result.username = str(js, "screen_name");
  result.fullname = str(js, "name");
  result.location = str(js, "location");
  result.bio = str(js, "description");
  result.userPic = imageStr(js, "profile_image_url_https").replace("_normal", "");
  result.banner = getBanner(js);
  result.following = num(js, "friends_count");
  result.followers = num(js, "followers_count");
  result.tweets = num(js, "statuses_count");
  result.likes = num(js, "favourites_count");
  result.media = num(js, "media_count");
  result.protected = boolDef(js, boolDef(js, false, "privacy", "protected"), "protected");
  result.joinDate = parseTwitterDate(str(js, "created_at"));

  if (boolDef(js, false, "is_blue_verified")) {
    result.verifiedType = VerifiedType.Blue;
  }
  const verifiedType = at(js, "verified_type");
  if (verifiedType !== undefined) {
    result.verifiedType = parseVerifiedType(
      typeof verifiedType === "string" ? verifiedType : "",
      result.verifiedType,
    );
  }

  expandUserEntities(result, js);
  return result;
}

// The modern UserByRestId/UserByScreenName shape: `legacy` is empty and the
// data lives in typed sub-objects (core/relationship_counts/tweet_counts/etc.).
// nitter master serves users through the experimental parser, so this fill is
// that parser's parity surface, not parser.nim's minimal five-field fallback.
function applyTypedUserShape(user: User, r: Json): void {
  user.id = str(r, "rest_id");
  user.username = str(r, "core", "screen_name");
  user.fullname = str(r, "core", "name");
  user.userPic = imageStr(r, "avatar", "image_url").replace("_normal", "");

  if (str(r, "banner", "image_url").length > 0) {
    user.banner = str(r, "banner", "image_url") + "/1500x500";
  }

  if (at(r, "privacy") !== undefined) {
    user.protected = boolDef(r, false, "privacy", "protected");
  }

  if (at(r, "location") !== undefined) {
    user.location = str(r, "location", "location");
  }

  if (str(r, "core", "created_at").length > 0) {
    user.joinDate = parseTwitterDate(str(r, "core", "created_at"));
  }

  const verifiedType = at(r, "verification", "verified_type");
  if (verifiedType !== undefined) {
    user.verifiedType = parseVerifiedType(
      typeof verifiedType === "string" ? verifiedType : "",
      user.verifiedType,
    );
  }

  if (at(r, "relationship_counts") !== undefined) {
    user.followers = num(r, "relationship_counts", "followers");
    user.following = num(r, "relationship_counts", "following");
  }

  if (at(r, "tweet_counts") !== undefined) {
    user.tweets = num(r, "tweet_counts", "tweets");
    user.media = num(r, "tweet_counts", "media_tweets");
  }

  if (at(r, "action_counts") !== undefined) {
    user.likes = num(r, "action_counts", "favorites_count");
  }

  const bio = at(r, "profile_bio");
  if (bio !== undefined) {
    user.bio = str(bio, "description");
    expandUserEntities(user, bio);
  }
}

export function parseGraphUser(js: Json): User {
  let user = pick(
    at(js, "data", "user_result", "result"),
    at(js, "data", "user", "result"),
    at(js, "user_result", "result"),
    at(js, "user_results", "result"),
  );

  if (user === undefined) {
    if (at(js, "core") !== undefined) {
      user = js;
    } else {
      return newUser();
    }
  }

  const result = parseUser(at(user, "legacy"), str(user, "rest_id"));

  if (str(user, "unavailable_reason") === "Suspended" || str(user, "reason") === "Suspended") {
    return { ...newUser(), suspended: true };
  }

  if (result.verifiedType === VerifiedType.None && boolDef(user, false, "is_blue_verified")) {
    result.verifiedType = VerifiedType.Blue;
  }

  if (result.username.length === 0) {
    if (
      boolDef(user, boolDef(user, false, "verification", "is_blue_verified"), "is_blue_verified")
    ) {
      result.verifiedType = VerifiedType.Blue;
    }

    applyTypedUserShape(result, user);
  }

  return result;
}

export function parseUserResult(userResult: Json): User {
  if (
    str(userResult, "unavailable_reason") === "Suspended" ||
    str(userResult, "reason") === "Suspended"
  ) {
    return { ...newUser(), suspended: true };
  }

  const result = parseUser(at(userResult, "legacy"));

  const pinned = each(at(userResult, "legacy"), "pinned_tweet_ids_str")[0];
  if (typeof pinned === "string") result.pinnedTweet = idString(pinned);

  if (result.verifiedType === VerifiedType.None && boolDef(userResult, false, "is_blue_verified")) {
    result.verifiedType = VerifiedType.Blue;
  }

  if (result.username.length === 0 && str(userResult, "core", "screen_name").length > 0) {
    applyTypedUserShape(result, userResult);
  }

  return result;
}

function newAccountInfo(): AccountInfo {
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

export function parseAboutAccount(js: Json): AccountInfo {
  const result = newAccountInfo();
  if (js === undefined || js === null) return result;

  const user = pick(at(js, "data", "user_result_by_screen_name", "result"));
  if (user === undefined) return result;

  if (str(user, "unavailable_reason") === "Suspended") {
    result.suspended = true;
    return result;
  }

  result.username = str(user, "core", "screen_name");
  result.fullname = str(user, "core", "name");
  result.joinDate = parseTwitterDate(str(user, "core", "created_at"));
  result.userPic = imageStr(user, "avatar", "image_url").replace("_normal", "");
  result.affiliateLabel = str(
    user,
    "identity_profile_labels_highlighted_label",
    "label",
    "description",
  );

  if (boolDef(user, false, "is_blue_verified")) {
    result.verifiedType = VerifiedType.Blue;
  }
  const verifiedType = at(user, "verification", "verified_type");
  if (verifiedType !== undefined) {
    result.verifiedType = parseVerifiedType(
      typeof verifiedType === "string" ? verifiedType : "",
      result.verifiedType,
    );
  }

  const about = pick(at(user, "about_profile"));
  if (about !== undefined) {
    result.basedIn = str(about, "account_based_in");
    result.source = str(about, "source");
    result.affiliateUsername = str(about, "affiliate_username");

    const changes = Number.parseInt(strDef(about, "0", "username_changes", "count"), 10);
    if (!Number.isNaN(changes)) result.usernameChanges = changes;

    const lastChange = at(about, "username_changes", "last_changed_at_msec");
    if (lastChange !== undefined) {
      const ms = Number(str(lastChange));
      if (!Number.isNaN(ms)) result.lastUsernameChange = fromUnixMilliseconds(ms);
    }
  }

  const info = pick(at(user, "verification_info"));
  if (info !== undefined) {
    result.isIdentityVerified = boolDef(info, false, "is_identity_verified");
    const reason = pick(at(info, "reason"));
    if (reason !== undefined) {
      result.overrideVerifiedYear = num(reason, "override_verified_year");
      const since = pick(at(reason, "verified_since_msec"));
      if (since !== undefined) {
        const ms = Number(str(since));
        if (!Number.isNaN(ms)) result.verifiedSince = fromUnixMilliseconds(ms);
      }
    }
  }

  return result;
}
