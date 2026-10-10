/** Search route plugin tests — fastify `inject` against a context with a
 * stubbed `ctx.twitter`, proving the seams are real (plan §6). */

import { prefsPlugin } from "@tseer/prefs";
import { serverPlugin } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import { initQuery } from "@tseer/twitter-api";
import {
  InternalError,
  type ListSearchResult,
  QueryKind,
  RateLimitError,
  type Result,
  type User,
} from "@tseer/types";
import { renderPlugin } from "@tseer/views";
import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";
import {
  emptyListSearch,
  emptyTimelineSearch,
  emptyUserSearch,
  generateOpenSearchXml,
  remapSearchKind,
  default as searchPlugin,
  searchTitle,
} from "../src/search.ts";
import { emptyTimeline } from "../src/timeline.ts";
import { makeTweet, makeUser, stubTwitter } from "./timeline.spec.ts";

function makeUserResults(user: User): Result<User> {
  return {
    content: [user],
    top: "",
    bottom: "USERCURSOR",
    beginning: true,
    query: { ...emptyTimeline().query, kind: QueryKind.users, text: "bob" },
  };
}

function makeListResults(): Result<ListSearchResult> {
  return {
    content: [
      {
        list: {
          id: "1",
          name: "Space lists",
          userId: "1234",
          username: "nasa",
          description: "cool <b>lists</b>",
          members: 1234,
          banner: "",
        },
        owner: makeUser(),
        followersContext: "",
        facepiles: [],
      },
    ],
    top: "",
    bottom: "LISTCURSOR",
    beginning: true,
    query: { ...emptyTimeline().query, kind: QueryKind.lists, text: "space" },
  };
}

export function stubSearchTwitter(extra: Partial<TwitterApi> = {}): TwitterApi {
  const base = stubTwitter(makeUser(), {
    pinned: undefined,
    tweets: {
      content: [makeTweet()],
      top: "",
      bottom: "SEARCHCURSOR",
      beginning: true,
      query: { ...emptyTimeline().query, kind: QueryKind.tweets, text: "space" },
    },
  });
  return {
    ...base,
    userSearch: vi.fn(async () => makeUserResults(makeUser({ username: "bob" }))),
    listSearch: vi.fn(async () => makeListResults()),
    ...extra,
  } as unknown as TwitterApi;
}

async function boot(
  twitter: TwitterApi,
  config: Record<string, unknown> = {},
): Promise<{ ctx: Context; unload: () => Promise<void> }> {
  const ctx = new Context();
  await ctx.plugin(serverPlugin, { port: 0 });
  await ctx.plugin(prefsPlugin, {});
  await ctx.plugin(renderPlugin, {
    title: "nitter",
    hostname: "localhost",
    useHttps: false,
    picUrl: (url) => `/pic/${url}`,
    origPicUrl: (url) => `/pic/orig/${url}`,
    vidUrl: (url) => `/video/sig/${url}`,
  });
  ctx.provide("twitter", twitter);
  ctx.provide("config", { title: "nitter", hostname: "localhost", useHttps: false, ...config });
  const fiber = await ctx.plugin(searchPlugin);
  return { ctx, unload: () => fiber.dispose() };
}

describe("searchPlugin", () => {
  it("renders tweet search with tabs, panel, and rss link", async () => {
    const twitter = stubSearchTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/search?q=space" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<title>Search (space) | nitter</title>");
    expect(res.body).toContain("hello world");
    expect(res.body).toContain(">Top<");
    expect(res.body).toContain(">Latest<");
    expect(res.body).toContain(">Media<");
    expect(res.body).toContain(">Users<");
    expect(res.body).toContain(">Lists<");
    expect(res.body).toContain("search-field");
    expect(res.body).toContain("/search/rss?f=tweets");
    expect(res.body).toContain("cursor=SEARCHCURSOR");

    expect(twitter.search).toHaveBeenCalledTimes(1);
    const [query, cursor] = (twitter.search as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(query.kind).toBe(QueryKind.tweets);
    expect(query.text).toBe("space");
    expect(cursor).toBe("");
  });

  it("serves the top tab and passes the cursor through", async () => {
    const twitter = stubSearchTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/search?f=top&q=x&cursor=ABC" });
    expect(res.status).toBe(200);
    const [query, cursor] = (twitter.search as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(query.kind).toBe(QueryKind.top);
    expect(cursor).toBe("ABC");
    expect(res.body).toContain("<title>Search (x) | nitter</title>");
  });

  it("remaps f=user and f=list to the search kinds", async () => {
    const twitter = stubSearchTwitter();
    const { ctx } = await boot(twitter);

    const users = await ctx.server.inject({ url: "/search?f=user&q=bob" });
    expect(users.status).toBe(200);
    expect(twitter.userSearch).toHaveBeenCalledTimes(1);
    expect(users.body).toContain("Enter username...");
    expect(users.body).toContain('data-username="bob"');

    const lists = await ctx.server.inject({ url: "/search?f=list&q=space" });
    expect(lists.status).toBe(200);
    expect(twitter.listSearch).toHaveBeenCalledTimes(1);
    expect(lists.body).toContain("Space lists");
    expect(lists.body).toContain("1,234 members");
    // list descriptions are plain text: markup must be escaped
    // (preact escapes `<`/`&`, not `>`)
    expect(lists.body).toContain("cool &lt;b>lists&lt;/b>");
    expect(lists.body).not.toContain("<b>lists</b>");
    expect(lists.body).toContain("cursor=LISTCURSOR");
  });

  it("redirects multi-name people search to the combined timeline", async () => {
    const twitter = stubSearchTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/search?f=users&q=a,b" });
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/a,b");
    expect(twitter.userSearch).not.toHaveBeenCalled();
  });

  it("defaults the media view from prefs", async () => {
    const twitter = stubSearchTwitter();
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({
      url: "/search?f=media&q=x",
      headers: { cookie: "mediaView=Gallery" },
    });
    expect(res.status).toBe(200);
    expect(res.body).toContain("media-gallery-view");
    const [query] = (twitter.search as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(query.view).toBe("gallery");
  });

  it("redirects /hashtag/:hash to the tweet search", async () => {
    const { ctx } = await boot(stubSearchTwitter());
    const res = await ctx.server.inject({ url: "/hashtag/nitter" });
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/search?f=tweets&q=%23nitter");
  });

  it("serves the opensearch description document", async () => {
    const { ctx } = await boot(stubSearchTwitter());
    const res = await ctx.server.inject({ url: "/opensearch" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/opensearchdescription+xml");
    expect(res.body).toContain("<ShortName>nitter</ShortName>");
    expect(res.body).toContain("http://localhost/search?f=tweets&amp;q={searchTerms}");
  });

  it("rejects overlong queries and unknown kinds", async () => {
    const { ctx } = await boot(stubSearchTwitter());

    const long = await ctx.server.inject({ url: `/search?q=${"x".repeat(501)}` });
    expect(long.status).toBe(400);
    expect(long.body).toContain("Search input too long.");

    const invalid = await ctx.server.inject({ url: "/search?f=posts&q=x" });
    expect(invalid.status).toBe(404);
    expect(invalid.body).toContain("Invalid search");
  });

  it("renders an empty page when people search fails internally", async () => {
    const twitter = stubSearchTwitter({
      userSearch: vi.fn(async () => {
        throw new InternalError("boom");
      }),
    });
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/search?f=users&q=bob" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("No items found");
  });

  it("maps rate limits to a 429 page", async () => {
    const twitter = stubSearchTwitter({
      search: vi.fn(async () => {
        throw new RateLimitError("limited");
      }),
    });
    const { ctx } = await boot(twitter);

    const res = await ctx.server.inject({ url: "/search?q=x" });
    expect(res.status).toBe(429);
    expect(res.body).toContain("rate limited");
  });

  it("escapes the query in the page title", async () => {
    const { ctx } = await boot(stubSearchTwitter());
    const res = await ctx.server.inject({ url: "/search?q=%3Cscript%3E" });
    expect(res.status).toBe(200);
    // preact escapes `<`/`&` in text (not `>`)
    expect(res.body).toContain("Search (&lt;script>)");
    expect(res.body).not.toContain("Search (<script>)");
  });

  it("unloads cleanly: disposed routes answer 404", async () => {
    const { ctx, unload } = await boot(stubSearchTwitter());
    expect((await ctx.server.inject({ url: "/search?q=x" })).status).toBe(200);
    await unload();
    expect((await ctx.server.inject({ url: "/search?q=x" })).status).toBe(404);
  });
});

describe("search helpers", () => {
  it("builds titles", () => {
    expect(searchTitle("")).toBe("Search");
    expect(searchTitle("x")).toBe("Search (x)");
  });

  it("remaps x.com f= values", () => {
    expect(remapSearchKind(initQuery({ f: "tweets" }), "user").kind).toBe(QueryKind.users);
    expect(remapSearchKind(initQuery({ f: "tweets" }), "list").kind).toBe(QueryKind.lists);
    expect(remapSearchKind(initQuery({ f: "tweets" }), "tweets").kind).toBe(QueryKind.tweets);
  });

  it("generates the opensearch document", () => {
    const xml = generateOpenSearchXml("nitter", "localhost", "http://localhost/search?f=tweets&q=");
    expect(xml).toContain("<ShortName>nitter</ShortName>");
    expect(xml).toContain("{searchTerms}");
  });

  it("builds empty envelopes", () => {
    const query = initQuery({ q: "x" });
    expect(emptyTimelineSearch(query).content).toEqual([]);
    expect(emptyUserSearch(query).query).toBe(query);
    expect(emptyListSearch(query).beginning).toBe(true);
  });
});
