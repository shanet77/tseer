/** Port of nitter's `src/formatters.nim` (minus `getM3u8Url`/`proxifyVideo`,
 * which live in `@tseer/media`, and `getTwitterLink`/`getVideoEmbed`, which
 * defer to the search route / embed route contracts). Dates in the domain
 * model are ISO strings with `""` meaning "not set" — the Nim `year == 0`
 * guards map to empty-string guards here. Nim's date templates are rendered
 * in UTC by hand (no locale dependency, deterministic output). */

import type { TseerPreferences } from "@tseer/prefs";
import type { Tweet, User } from "@tseer/types";

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
const monthsShort = [
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
const daysShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const cards = "cards.twitter.com/cards";
const tco = "https://t.co";

const twRegex = /(?<=(?<!\S)https:\/\/|(?<=\s))(www\.|mobile\.)?twitter\.com/g;
const twLinkRegex = /<a href="https:\/\/twitter\.com([^"]+)">twitter\.com(\S+)<\/a>/g;
const xRegex = /(?<=(?<!\S)https:\/\/|(?<=\s))(www\.|mobile\.)?x\.com/g;
const xLinkRegex = /<a href="https:\/\/x\.com([^"]+)">x\.com(\S+)<\/a>/g;
const ytRegex = /([A-z.]+\.)?youtu(be\.com|\.be)/gi;
const rdRegex = /(?<![.b])((www|np|new|amp|old)\.)?reddit\.com/g;
const rdShortRegex = /(?<![.b])redd\.it\//g;
const wwwRegex = /https?:\/\/(www[0-9]?\.)?/g;
const userPicRegex = /_(normal|bigger|mini|200x200|400x400)(\.[A-z]+)$/;
const extRegex = /(\.[A-z]+)$/;
const illegalXmlRegex = /[^\t\n\r\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

const entities: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": "\u00a0",
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:[a-z]+|#\d+|#x[0-9a-f]+);/gi, (entity) => {
    if (entity in entities) return entities[entity] ?? entity;
    const numeric = /^&#(\d+);|^&#x([0-9a-f]+);/i.exec(entity);
    if (!numeric) return entity;
    const code = numeric[1] ? Number(numeric[1]) : Number.parseInt(numeric[2] ?? "", 16);
    return Number.isNaN(code) ? entity : String.fromCodePoint(code);
  });
}

function utcDate(iso: string): Date | undefined {
  if (iso === "") return undefined;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function time12(date: Date): string {
  let hour = date.getUTCHours() % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${String(date.getUTCMinutes()).padStart(2, "0")} ${date.getUTCHours() < 12 ? "AM" : "PM"}`;
}

export interface UrlPrefixConfig {
  useHttps: boolean;
  hostname: string;
}

export function getUrlPrefix(cfg: UrlPrefixConfig): string {
  return cfg.useHttps ? `https://${cfg.hostname}` : `http://${cfg.hostname}`;
}

/** Codepoint slice (Nim slices bytes; mid-codepoint cuts are garbage either
 * way, this is the strictly-correct version). */
export function shorten(text: string, length = 28): string {
  const runes = [...text];
  if (runes.length > length) return `${runes.slice(0, length).join("")}…`;
  return text;
}

export function shortLink(text: string, length = 28): string {
  return shorten(text.replace(wwwRegex, ""), length);
}

/**
 * Plain text of an HTML fragment, with `<a href="http…">` links replaced by
 * their href (shortened when asked) — the port of `stripHtml`.
 *
 * ponytail: regex-based, not a real HTML parser like Nim's `parseHtml`; fine
 * for well-formed fragments (tweet text, bios). Swap in a parser if a
 * malformed fragment ever renders wrong.
 */
export function stripHtml(text: string, shorten = false): string {
  const replaced = text.replace(
    /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href: string, inner: string) => {
      if (!href.includes("http") || inner === "") return inner;
      return shorten ? shortLink(decodeEntities(href)) : decodeEntities(href);
    },
  );
  return decodeEntities(replaced.replace(/<[^>]*>/g, ""));
}

export function sanitizeXml(text: string): string {
  return text.replace(illegalXmlRegex, "");
}

function trimHost(host: string): string {
  let trimmed = host;
  while (trimmed.startsWith("/")) trimmed = trimmed.slice(1);
  while (trimmed.endsWith("/")) trimmed = trimmed.slice(0, -1);
  return trimmed;
}

/** Port of `replaceUrls`: rewrites X/YouTube/Reddit links in rendered HTML to
 * the instance's configured replacement hosts. */
export function replaceUrls(body: string, prefs: TseerPreferences, absolute = ""): string {
  let result = body;

  if (prefs.replaceYouTube.length > 0 && result.includes("youtu")) {
    const youtubeHost = trimHost(prefs.replaceYouTube);
    result = result.replace(ytRegex, youtubeHost);
  }

  if (prefs.replaceTwitter.length > 0) {
    const twitterHost = trimHost(prefs.replaceTwitter);
    if (result.includes(tco)) {
      result = result.replaceAll(tco, `https://${twitterHost}/t.co`);
    }
    if (result.includes("x.com")) {
      result = result.replace(xRegex, twitterHost);
      result = result.replaceAll(
        xLinkRegex,
        `<a href="https://${twitterHost}$1">${twitterHost}$2</a>`,
      );
    }
    if (result.includes("twitter.com")) {
      result = result.replaceAll(cards, `${twitterHost}/cards`);
      result = result.replace(twRegex, twitterHost);
      result = result.replaceAll(
        twLinkRegex,
        `<a href="https://${twitterHost}$1">${twitterHost}$2</a>`,
      );
    }
  }

  if (
    prefs.replaceReddit.length > 0 &&
    (result.includes("reddit.com") || result.includes("redd.it"))
  ) {
    const redditHost = trimHost(prefs.replaceReddit);
    result = result.replace(rdShortRegex, `${redditHost}/comments/`);
    result = result.replace(rdRegex, redditHost);
    if (result.includes(redditHost) && result.includes("/gallery/")) {
      result = result.replaceAll("/gallery/", "/comments/");
    }
  }

  if (absolute.length > 0 && result.includes("href")) {
    result = result.replaceAll('href="/', `href="${absolute}/`);
  }

  return result;
}

/** `_(normal|bigger|…)` variants stripped, then the extension prefixed with
 * the requested style (e.g. `style="_bigger"`). */
export function getUserPic(userPic: string, style = ""): string {
  return userPic.replace(userPicRegex, "$2").replace(extRegex, `${style}$1`);
}

export function pageTitle(user: Pick<User, "fullname" | "username">): string {
  return `${user.fullname} (@${user.username})`;
}

export function pageTitleOfTweet(tweet: Pick<Tweet, "user" | "text">): string {
  return `${pageTitle(tweet.user)}: "${stripHtml(tweet.text)}"`;
}

export function pageDesc(user: Pick<User, "bio" | "fullname">): string {
  if (user.bio.length > 0) return stripHtml(user.bio);
  return `The latest tweets from ${user.fullname}`;
}

export function getJoinDate(joinDate: string): string {
  const date = utcDate(joinDate);
  if (!date) return "";
  return `Joined ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function getJoinDateFull(joinDate: string): string {
  const date = utcDate(joinDate);
  if (!date) return "";
  return `${time12(date)} - ${date.getUTCDate()} ${monthsShort[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function getTime(time: string): string {
  const date = utcDate(time);
  if (!date) return "";
  return `${monthsShort[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()} · ${time12(date)} UTC`;
}

export function getRfc822Time(time: string): string {
  const date = utcDate(time);
  if (!date) return "";
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${daysShort[date.getUTCDay()]}, ${p2(date.getUTCDate())} ${monthsShort[date.getUTCMonth()]} ${date.getUTCFullYear()} ${p2(date.getUTCHours())}:${p2(date.getUTCMinutes())}:${p2(date.getUTCSeconds())} GMT`;
}

export function getShortTime(time: string, now = Date.now()): string {
  const date = utcDate(time);
  if (!date) return "";
  const since = now - date.getTime();

  if (new Date(now).getUTCFullYear() !== date.getUTCFullYear()) {
    return `${date.getUTCDate()} ${monthsShort[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  }
  const days = Math.floor(since / 86_400_000);
  if (days >= 1) return `${monthsShort[date.getUTCMonth()]} ${date.getUTCDate()}`;
  const hours = Math.floor(since / 3_600_000);
  if (hours >= 1) return `${hours}h`;
  const minutes = Math.floor(since / 60_000);
  if (minutes >= 1) return `${minutes}m`;
  const seconds = Math.floor(since / 1000);
  if (seconds > 1) return `${seconds}s`;
  return "now";
}

export function getDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  const min = Math.floor(sec / 60);
  const hour = Math.floor(min / 60);
  const p2 = (n: number) => String(n).padStart(2, "0");
  if (hour > 0) return `${hour}:${p2(min % 60)}:${p2(sec % 60)}`;
  return `${min}:${p2(sec % 60)}`;
}

/** `/{username}/status/{id}` (+`#m` to focus the tweet). `username` falls
 * back to "i" like the Nim default. */
export function getLink(id: string, username = "i", focus = true): string {
  const name = username.length > 0 ? username : "i";
  let link = `/${name}/status/${id}`;
  if (focus) link += "#m";
  return link;
}

export function getTweetLink(tweet: Pick<Tweet, "id" | "user">, focus = true): string {
  if (tweet.id === "") return "";
  return getLink(tweet.id, tweet.user.username, focus);
}

/** Location and (when it's a `name:place` geo tag) its search URL. */
export function getLocation(location: string): [string, string] {
  if (location.includes("://")) return [location, ""];
  const parts = location.split(":");
  const url = parts.length > 1 ? `/search?f=tweets&q=place:${parts[1]}` : "";
  return [parts[0] ?? "", url];
}

export function getSuspended(username: string): string {
  return `User "${username}" has been suspended`;
}

export function titleize(str: string): string {
  const delims = new Set([" ", "("]);
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const char = str[i]!;
    const isLower = char >= "a" && char <= "z";
    if (isLower && (i === 0 || delims.has(str[i - 1] ?? ""))) {
      result += char.toUpperCase();
    } else {
      result += char;
    }
  }
  return result;
}
