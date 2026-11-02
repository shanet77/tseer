import { decodeUrl } from "@tseer/media";
import type { TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest } from "@tseer/server";
import {
  genQueryUrl,
  getArticlesQuery,
  getMediaQuery,
  getReplyQuery,
  initQuery,
  type ProfileTweets,
  type TwitterApi,
} from "@tseer/twitter-api";
import {
  type Profile,
  type Query,
  QueryKind,
  type QueryKind as QueryKindT,
  type Result,
  type TimelineResult,
  type Tweet,
  type User,
  VerifiedType,
} from "@tseer/types";
import type { Render } from "@tseer/views";
import {
  emptyAccountInfo,
  getSuspended,
  getUserPic,
  pageDesc,
  pageTitle,
  renderAboutAccount,
  renderProfile,
  renderProtected,
  renderTimelineTweets,
  renderTweetSearch,
  renderUserList,
  toHtml,
} from "@tseer/views";
import type { Context } from "cordis";
import { NAME_PARAM, TAB_PARAM } from "./params.ts";
import { mountRoutes, type RouteShell } from "./shell.ts";

interface TimelineConfig {
  enableRSSUserTweets?: boolean | undefined;
  enableRSSUserReplies?: boolean | undefined;
  enableRSSUserMedia?: boolean | undefined;
  enableRSSUserArticles?: boolean | undefined;
  enableRSSSearch?: boolean | undefined;
}

const NITTER_PARAMS = ["name", "tab", "id", "list", "referer", "scroll", "prefs"];

const RESERVED_NAMES = new Set([
  "pic",
  "gif",
  "video",
  "search",
  "settings",
  "login",
  "intent",
  "i",
]);
const NAME_CHARS = /^[A-Za-z0-9_,]+$/;
const SINGLE_NAME_CHARS = /^[A-Za-z0-9_]+$/;
const TABS = new Set(["with_replies", "media", "search", "articles"]);

export function getPath(req: AppRequest): string {
  const query = Object.entries(req.query)
    .filter(([key, value]) => value.length > 0 && !NITTER_PARAMS.includes(key))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return query.length > 0 ? `${req.path}?${query}` : req.path;
}

export function getCursor(req: AppRequest): string {
  const cursor = req.query["cursor"] ?? req.query["max_position"] ?? "";
  return decodeUrl(cursor);
}

export function getNames(name: string): string[] {
  return name
    .replace(/^\/+|\/+$/g, "")
    .split(",")
    .filter((part) => part.length > 0);
}

export function postsQuery(name: string): Query {
  return {
    kind: QueryKind.posts,
    view: "",
    text: "",
    filters: [],
    includes: [],
    excludes: [],
    fromUser: [name],
    since: "",
    until: "",
    minLikes: "",
    sep: "",
  };
}

export function timelineQuery(
  tab: string,
  name: string,
  prefs: TseerPreferences,
  params: Record<string, string>,
): Query {
  switch (tab) {
    case "with_replies":
      return getReplyQuery(name);
    case "articles":
      return getArticlesQuery(name);
    case "media": {
      const query = getMediaQuery(name);
      query.view = ["timeline", "grid", "gallery"].includes(params["view"] ?? "")
        ? (params["view"] ?? "")
        : prefs.mediaView.toLowerCase();
      return query;
    }
    case "search":
      return initQuery(params, name);
    default:
      return postsQuery(name);
  }
}

export function tabRssUrl(config: TimelineConfig, tab: string, name: string, query: Query): string {
  const enabled =
    tab === ""
      ? (config.enableRSSUserTweets ?? true)
      : tab === "with_replies"
        ? (config.enableRSSUserReplies ?? true)
        : tab === "media"
          ? (config.enableRSSUserMedia ?? true)
          : tab === "articles"
            ? (config.enableRSSUserArticles ?? true)
            : tab === "search"
              ? (config.enableRSSSearch ?? true)
              : false;
  if (!enabled) return "";
  if (tab === "") return `/${name}/rss`;
  if (tab === "search") return `/${name}/search/rss?${genQueryUrl(query)}`;
  return `/${name}/${tab}/rss`;
}

export function emptyUser(name: string): User {
  return {
    id: "",
    username: name,
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

export function emptyTimeline(query: Query = postsQuery("")): TimelineResult {
  return { content: [], top: "", bottom: "", beginning: true, query };
}

function emptyUsers(kind: QueryKindT, name: string): Result<User> {
  return {
    content: [],
    top: "",
    bottom: "",
    beginning: true,
    query: { ...postsQuery(name), kind },
  };
}

export interface TimelineRouteDeps {
  twitter: TwitterApi;
  render: Render;
  shell: RouteShell;
  config: TimelineConfig | undefined;
}

export function registerTimelineRoutes(deps: TimelineRouteDeps): () => void {
  const { twitter, render, shell } = deps;
  const { route, showError } = shell;

  async function fetchProfile(
    query: Query,
    after: string,
    options: { skipRail?: boolean | undefined } = {},
  ): Promise<Profile> {
    const name = query.fromUser[0] ?? "";
    const user = (await twitter.cachedUser(name)) ?? emptyUser(name);

    let cursor = after;
    if (
      (query.kind === QueryKind.posts || query.kind === QueryKind.replies) &&
      cursor.startsWith("scroll")
    ) {
      cursor = "";
    }

    const rail =
      options.skipRail === true || query.kind === QueryKind.media
        ? []
        : ((await twitter.cachedPhotoRail(user.id)) ?? []);

    let pinned: Tweet | undefined;
    let tweets: TimelineResult;
    if (user.id === "") {
      tweets = emptyTimeline(query);
    } else {
      const byKind = await (async (): Promise<ProfileTweets | undefined> => {
        switch (query.kind) {
          case QueryKind.posts:
            return twitter.tweets(user.id, cursor);
          case QueryKind.replies:
            return twitter.tweetsAndReplies(user.id, cursor);
          case QueryKind.media:
            return twitter.media(user.id, cursor);
          case QueryKind.articles:
            return twitter.articles(user.id, cursor);
          default: {
            const searched = await twitter.search(query, cursor);
            return searched === undefined ? undefined : { pinned: undefined, tweets: searched };
          }
        }
      })();
      pinned = byKind?.pinned;
      tweets = byKind?.tweets ?? emptyTimeline(query);
    }

    const profile: Profile = {
      user,
      photoRail: rail,
      ...(pinned !== undefined ? { pinned } : {}),
      tweets,
      accountInfo: (await twitter.cachedAccountInfo(name, false)) ?? emptyAccountInfo(),
    };
    profile.tweets.query = query;
    return profile;
  }

  async function showTimeline(
    reply: AppReply,
    query: Query,
    requestPrefs: TseerPreferences,
    path: string,
    rss: string,
    after: string,
    name: string,
  ): Promise<boolean> {
    if (query.fromUser.length !== 1) {
      const timeline = (await twitter.search(query, after)) ?? emptyTimeline(query);
      await reply.html(
        await render.page({
          body: renderTweetSearch(timeline, requestPrefs, path),
          title: "Multi",
          rss,
          path,
          prefs: requestPrefs,
        }),
      );
      return true;
    }

    const profile = await fetchProfile(query, after);
    const user = profile.user;
    if (user.suspended) {
      showError(reply, getSuspended(user.username), 200, requestPrefs);
      return true;
    }
    if (user.id.length === 0) {
      showError(reply, `User "${name}" not found`, 404, requestPrefs);
      return true;
    }

    await reply.html(
      await render.page({
        body: renderProfile(profile, requestPrefs, path),
        title: pageTitle(user),
        desc: pageDesc(user),
        rss,
        images: [getUserPic(user.userPic, "_400x400")],
        banner: user.banner,
        path,
        prefs: requestPrefs,
      }),
    );
    return true;
  }

  async function respUserId(
    req: AppRequest,
    reply: AppReply,
    requestPrefs: TseerPreferences,
  ): Promise<void> {
    const userId = req.params["user_id"] ?? req.query["user_id"] ?? "";
    if (userId.length === 0) {
      showError(reply, "Page not found", 404, requestPrefs);
      return;
    }
    const username = await twitter.cachedUsername(userId);
    if (username.length > 0) {
      await reply.redirect(`/${username}`);
    } else {
      showError(reply, "User not found", 404, requestPrefs);
    }
  }

  route({
    method: "GET",
    path: "/i/user/:user_id",
    handler: respUserId,
  });
  route({
    method: "GET",
    path: "/intent/user",
    handler: respUserId,
  });

  route({
    method: "GET",
    path: "/intent/follow",
    handler: async (req, reply, requestPrefs) => {
      const username = req.query["screen_name"] ?? "";
      if (username.length === 0) {
        showError(reply, "Missing screen_name parameter", 400, requestPrefs);
        return;
      }
      await reply.redirect(`/${username}`);
    },
  });

  route({
    method: "GET",
    path: `/${NAME_PARAM}/about`,
    handler: async (req, reply, requestPrefs) => {
      const name = req.params["name"] ?? "";
      if (!SINGLE_NAME_CHARS.test(name)) {
        showError(reply, "Page not found", 404, requestPrefs);
        return;
      }
      const info = (await twitter.cachedAccountInfo(name)) ?? emptyAccountInfo();
      if (info.suspended) {
        showError(reply, getSuspended(name), 200, requestPrefs);
        return;
      }
      if (info.username.length === 0) {
        showError(reply, `User "${name}" not found`, 404, requestPrefs);
        return;
      }
      await reply.html(
        await render.page({
          body: renderAboutAccount(info),
          title: `About @${info.username}`,
          path: getPath(req),
          prefs: requestPrefs,
        }),
      );
    },
  });

  async function showConnections(
    req: AppRequest,
    reply: AppReply,
    kind: "followers" | "following",
    requestPrefs: TseerPreferences,
  ): Promise<void> {
    const name = req.params["name"] ?? "";
    if (!SINGLE_NAME_CHARS.test(name)) {
      showError(reply, "Page not found", 404, requestPrefs);
      return;
    }
    const user = (await twitter.cachedUser(name)) ?? emptyUser(name);
    if (user.id.length === 0) {
      showError(reply, `User "${name}" not found`, 404, requestPrefs);
      return;
    }
    if (user.suspended) {
      showError(reply, getSuspended(name), 200, requestPrefs);
      return;
    }
    const cursor = getCursor(req);
    const results =
      kind === "followers"
        ? ((await twitter.followers(user.id, cursor)) ?? emptyUsers(QueryKind.followers, name))
        : ((await twitter.following(user.id, cursor)) ?? emptyUsers(QueryKind.following, name));

    if (user.protected) {
      await reply.html(
        await render.page({
          body: renderProtected(user.username),
          title: `Protected account @${name}`,
          path: getPath(req),
          prefs: requestPrefs,
        }),
      );
      return;
    }

    const tab = kind === "followers" ? "Followers" : "Following";
    const title = (kind === "followers" ? "People following @" : "People followed by @") + name;
    await reply.html(
      await render.page({
        body: renderUserList(user, results, requestPrefs, getPath(req), tab),
        title,
        images: [getUserPic(user.userPic, "_400x400")],
        path: getPath(req),
        prefs: requestPrefs,
      }),
    );
  }

  route({
    method: "GET",
    path: `/${NAME_PARAM}/followers`,
    handler: (req, reply, requestPrefs) => showConnections(req, reply, "followers", requestPrefs),
  });
  route({
    method: "GET",
    path: `/${NAME_PARAM}/following`,
    handler: (req, reply, requestPrefs) => showConnections(req, reply, "following", requestPrefs),
  });

  async function showIndex(
    req: AppRequest,
    reply: AppReply,
    tab: string,
    requestPrefs: TseerPreferences,
  ): Promise<void> {
    const name = req.params["name"] ?? "";
    const validName = !name.includes(".") && NAME_CHARS.test(name) && !RESERVED_NAMES.has(name);
    if (
      !validName ||
      (tab.length > 0 && !TABS.has(tab)) ||
      (tab === "articles" && name.includes(","))
    ) {
      showError(reply, "Page not found", 404, requestPrefs);
      return;
    }

    const after = getCursor(req);
    const names = getNames(name);
    const query = timelineQuery(tab, name, requestPrefs, req.query);
    if (names.length !== 1) query.fromUser = names;

    const path = getPath(req);

    if (req.query["scroll"] !== undefined) {
      if (names.length !== 1) {
        const timeline = (await twitter.search(query, after)) ?? emptyTimeline(query);
        if (timeline.content.length === 0) {
          void reply.text("", { status: 204 });
          return;
        }
        timeline.beginning = true;
        void reply.html(toHtml(renderTweetSearch(timeline, requestPrefs, path)));
        return;
      }
      const profile = await fetchProfile(query, after, { skipRail: true });
      if (profile.tweets.content.length === 0) {
        void reply.text("", { status: 404 });
        return;
      }
      profile.tweets.beginning = true;
      void reply.html(toHtml(renderTimelineTweets(profile.tweets, requestPrefs, path)));
      return;
    }

    const rss = tabRssUrl(deps.config ?? {}, tab, name, query);
    await showTimeline(reply, query, requestPrefs, path, rss, after, name);
  }

  route({
    method: "GET",
    path: `/${NAME_PARAM}`,
    handler: (req, reply, requestPrefs) => showIndex(req, reply, "", requestPrefs),
  });
  route({
    method: "GET",
    path: `/${NAME_PARAM}/${TAB_PARAM}`,
    handler: (req, reply, requestPrefs) =>
      showIndex(req, reply, req.params["tab"] ?? "", requestPrefs),
  });

  return shell.dispose;
}

export default function timelinePlugin(ctx: Context): () => void {
  return mountRoutes(ctx, "timeline", ["twitter"], (resolve, shell) =>
    registerTimelineRoutes({
      twitter: resolve<TwitterApi>("twitter"),
      render: resolve<Render>("render"),
      config: resolve<TimelineConfig | undefined>("config"),
      shell,
    }),
  );
}

timelinePlugin.inject = ["server", "twitter", "render", "prefs"];
