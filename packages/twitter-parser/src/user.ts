/**
 * User parsers — the port of `parser.nim`'s `parseUser`, `parseGraphUser`,
 * `parseVerifiedType`, and `parseAboutAccount`, plus `parserutils.nim`'s
 * `getBanner`/`expandUserEntities` and the experimental
 * `parseUserResult` (both the legacy `legacy` shape and the modern typed
 * `core`/`avatar`/`relationship_counts` shape feed the same domain `User`).
 *
 * Divergence: the empty id/`DateTime` is `""` (see `dates.ts`); the "unset"
 * counters default to `0`.
 */
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

/** A default-constructed `User` (Nim's `User()`). */
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

/** Port of `parseVerifiedType`: keep the current value when the string is unknown. */
export function parseVerifiedType(s: string, current: VerifiedType): VerifiedType {
  const value = Object.values(VerifiedType).find((v) => v === s);
  return value ?? current;
}

/** Port of `getBanner` (parserutils.nim). */
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

/**
 * Port of `expandUserEntities` (parserutils.nim): rewrite the bio's
 * description URLs into anchors and pull the website out of the profile URL
 * entity. `textLen` is `orig.high` (the last codepoint index), as in Nim.
 */
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

/** Port of `parseUser`: a legacy user object (`legacy` payload) to the domain type. */
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

/** Port of `parseGraphUser` (parser.nim): `user_result.result`, with the typed-shape fallback. */
export function parseGraphUser(js: Json): User {
  let user = pick(at(js, "user_result", "result"), at(js, "user_results", "result"));

  if (user === undefined) {
    if (at(js, "core") !== undefined) {
      user = js;
    } else {
      return newUser();
    }
  }

  const result = parseUser(at(user, "legacy"), str(user, "rest_id"));

  // Port of the experimental `parseGraphUser`'s suspended check: parser.nim's
  // JsonNode path has no suspension handling, but nitter's cache sentinel
  // (`getCachedUsername` returning "suspended") depends on it, so the
  // experimental logic is ported into both users paths.
  if (str(user, "unavailable_reason") === "Suspended" || str(user, "reason") === "Suspended") {
    return { ...newUser(), suspended: true };
  }

  if (result.verifiedType === VerifiedType.None && boolDef(user, false, "is_blue_verified")) {
    result.verifiedType = VerifiedType.Blue;
  }

  // fallback to support UserMedia/recent GraphQL updates
  if (result.username.length === 0) {
    result.id = str(user, "rest_id");
    result.username = str(user, "core", "screen_name");
    result.fullname = str(user, "core", "name");
    result.userPic = imageStr(user, "avatar", "image_url").replace("_normal", "");

    if (
      boolDef(user, boolDef(user, false, "verification", "is_blue_verified"), "is_blue_verified")
    ) {
      result.verifiedType = VerifiedType.Blue;
    }

    const verifiedType = at(user, "verification", "verified_type");
    if (verifiedType !== undefined) {
      result.verifiedType = parseVerifiedType(
        typeof verifiedType === "string" ? verifiedType : "",
        result.verifiedType,
      );
    }
  }

  return result;
}

/**
 * Port of the experimental `parseUserResult` (graphql.nim): a `UserResult`
 * object from the list-members/followers timelines. Handles both shapes —
 * legacy-first, then the modern typed sub-objects.
 */
export function parseUserResult(userResult: Json): User {
  // experimental `parseUserResult`: suspended users have neither legacy nor
  // typed data, only the marker field.
  if (
    str(userResult, "unavailable_reason") === "Suspended" ||
    str(userResult, "reason") === "Suspended"
  ) {
    return { ...newUser(), suspended: true };
  }

  const result = parseUser(at(userResult, "legacy"));

  // experimental `toUser`: first pinned tweet id (lives on `legacy`)
  const pinned = each(at(userResult, "legacy"), "pinned_tweet_ids_str")[0];
  if (typeof pinned === "string") result.pinnedTweet = idString(pinned);

  if (result.verifiedType === VerifiedType.None && boolDef(userResult, false, "is_blue_verified")) {
    result.verifiedType = VerifiedType.Blue;
  }

  if (result.username.length === 0 && str(userResult, "core", "screen_name").length > 0) {
    result.id = str(userResult, "rest_id");
    result.username = str(userResult, "core", "screen_name");
    result.fullname = str(userResult, "core", "name");
    result.userPic = imageStr(userResult, "avatar", "image_url").replace("_normal", "");

    if (str(userResult, "banner", "image_url").length > 0) {
      result.banner = str(userResult, "banner", "image_url") + "/1500x500";
    }

    if (at(userResult, "privacy") !== undefined) {
      result.protected = boolDef(userResult, false, "privacy", "protected");
    }

    if (at(userResult, "location") !== undefined) {
      result.location = str(userResult, "location", "location");
    }

    if (str(userResult, "core", "created_at").length > 0) {
      result.joinDate = parseTwitterDate(str(userResult, "core", "created_at"));
    }

    const verification = at(userResult, "verification");
    if (verification !== undefined) {
      const verified = parseVerifiedType(str(verification, "verified_type"), VerifiedType.None);
      if (verified !== VerifiedType.None) result.verifiedType = verified;
    }

    if (at(userResult, "relationship_counts") !== undefined) {
      result.followers = num(userResult, "relationship_counts", "followers");
      result.following = num(userResult, "relationship_counts", "following");
    }

    if (at(userResult, "tweet_counts") !== undefined) {
      result.tweets = num(userResult, "tweet_counts", "tweets");
      result.media = num(userResult, "tweet_counts", "media_tweets");
    }

    if (at(userResult, "action_counts") !== undefined) {
      result.likes = num(userResult, "action_counts", "favorites_count");
    }

    const bio = at(userResult, "profile_bio");
    if (bio !== undefined) {
      result.bio = str(bio, "description");
      expandUserEntities(result, bio);
    }
  }

  return result;
}

/** A default-constructed `AccountInfo`. */
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

/** Port of `parseAboutAccount` (the about-account GraphQL payload). */
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
