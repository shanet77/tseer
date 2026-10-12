import { preferencesSchema, type TseerPreferences } from "@tseer/prefs";
import { type Article, type Tweet, type User, VerifiedType } from "@tseer/types";
import { renderToString } from "preact-render-to-string";
import { beforeEach, describe, expect, it } from "vitest";
import { renderArticle, setMediaSigners } from "../src/index.ts";

const defaults: TseerPreferences = preferencesSchema.parse({});

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "1234",
    username: "nasa",
    fullname: "NASA",
    location: "",
    website: "",
    bio: "space posts",
    userPic: "https://pbs.twimg.com/profile_images/nasa_normal.jpg",
    banner: "",
    pinnedTweet: "",
    following: 10,
    followers: 1234,
    tweets: 5678,
    likes: 9,
    media: 0,
    verifiedType: VerifiedType.None,
    protected: false,
    suspended: false,
    joinDate: "",
    ...overrides,
  };
}

function makeTweet(overrides: Partial<Tweet> = {}): Tweet {
  return {
    id: "1001",
    threadId: "",
    replyId: "",
    user: makeUser(),
    text: "hello world",
    time: "2023-06-01T12:00:00Z",
    reply: [],
    pinned: false,
    hasThread: false,
    available: true,
    tombstone: "",
    location: "",
    source: "",
    stats: { replies: 1, retweets: 2, likes: 3, views: 4 },
    media: [],
    mediaTags: [],
    attributionLink: "",
    history: [],
    note: "",
    isAd: false,
    isAI: false,
    ...overrides,
  };
}

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    title: "Deep space",
    coverImage: "https://pbs.twimg.com/media/cover.jpg",
    user: makeUser(),
    time: "2023-06-01T12:00:00Z",
    stats: { replies: 1, retweets: 2, likes: 3, views: 4 },
    paragraphs: [],
    entities: {},
    media: {},
    ...overrides,
  };
}

const EMPTY_TWEETS = new Map<string, Tweet>();

function render(overrides: Partial<Article> = {}, tweetId = "1001"): string {
  return renderToString(
    renderArticle(makeArticle(overrides), EMPTY_TWEETS, "/path", defaults, tweetId),
  );
}

beforeEach(() => {
  setMediaSigners({
    picUrl: (url) => `/pic/${url}`,
    origPicUrl: (url) => `/pic/orig/${url}`,
    vidUrl: (url) => `/video/sig/${url}`,
  });
});

describe("renderArticle", () => {
  it("renders the shell: cover, title, author row, date link, to-top", () => {
    const html = render();
    expect(html).toContain('class="article-page"');
    expect(html).toContain('href="/pic/orig/https://pbs.twimg.com/media/cover.jpg"');
    expect(html).toContain(
      'src="/pic/https://pbs.twimg.com/media/cover.jpg?name=small&amp;format=webp"',
    );
    expect(html).toContain('class="article-cover"');
    expect(html).toContain('<h1 class="article-title">Deep space</h1>');
    expect(html).toContain('href="/nasa"');
    expect(html).toContain('class="article-avatar"');
    expect(html).toContain(">NASA</a>");
    expect(html).toContain(">@nasa</a>");
    expect(html).toContain('href="/nasa/status/1001"');
    expect(html).toContain(">1 Jun 2023</a>");
    expect(html).toContain('class="top-ref"');
  });

  it("omits the cover when unset", () => {
    expect(render({ coverImage: "" })).not.toContain("article-cover");
  });

  it("renders the stat row unless hideTweetStats is set", () => {
    const html = render();
    expect(html).toContain('class="tweet-stats"');
    expect(html).toContain("icon-views");
    const hidden = renderToString(
      renderArticle(
        makeArticle(),
        EMPTY_TWEETS,
        "/path",
        { ...defaults, hideTweetStats: true },
        "1001",
      ),
    );
    expect(hidden).not.toContain("tweet-stats");
  });

  it("auto-escapes the title", () => {
    expect(render({ title: "Big <script>alert(1)</script> read" })).toContain(
      "Big &lt;script>alert(1)&lt;/script> read",
    );
  });
});

describe("renderArticle paragraphs", () => {
  it("maps block kinds to header/list/blockquote/paragraph elements", () => {
    const html = render({
      paragraphs: [
        { text: "Head", kind: "header-one", inlineStyles: [], entityRanges: [] },
        { text: "Sub", kind: "header-two", inlineStyles: [], entityRanges: [] },
        { text: "Sub3", kind: "header-three", inlineStyles: [], entityRanges: [] },
        { text: "Body", kind: "unstructured", inlineStyles: [], entityRanges: [] },
        { text: "Quoted", kind: "blockquote", inlineStyles: [], entityRanges: [] },
      ],
    });
    expect(html).toContain("<h1>Head</h1>");
    expect(html).toContain("<h2>Sub</h2>");
    expect(html).toContain("<h3>Sub3</h3>");
    expect(html).toContain("<p>Body</p>");
    expect(html).toContain("<blockquote>Quoted</blockquote>");
  });

  it("wraps inline styles in the Nim nesting order (code outermost… u innermost)", () => {
    const html = renderToString(
      renderArticle(
        makeArticle({
          paragraphs: [
            {
              text: "abcdefgh",
              kind: "unstructured",
              inlineStyles: [
                { offset: 0, length: 1, style: "Code" },
                { offset: 1, length: 1, style: "Bold" },
                { offset: 2, length: 1, style: "Italic" },
                { offset: 3, length: 1, style: "Strikethrough" },
                { offset: 4, length: 1, style: "Underline" },
              ],
              entityRanges: [],
            },
          ],
        }),
        EMPTY_TWEETS,
        "/path",
        defaults,
      ),
    );
    expect(html).toContain("<code>a</code>");
    expect(html).toContain("<strong>b</strong>");
    expect(html).toContain("<em>c</em>");
    expect(html).toContain("<del>d</del>");
    expect(html).toContain("<u>e</u>");
    expect(html).toContain("fgh");
  });

  it("linkifies @mentions (up to 15 word chars, not preceded by a word char)", () => {
    const html = renderToString(
      renderArticle(
        makeArticle({
          paragraphs: [
            {
              text: "hi@notament and @bob_1 end",
              kind: "unstructured",
              inlineStyles: [],
              entityRanges: [],
            },
          ],
        }),
        EMPTY_TWEETS,
        "/path",
        defaults,
      ),
    );
    expect(html).toContain('<a href="/bob_1">@bob_1</a>');
    expect(html).toContain("hi@notament");
  });

  it("wraps LINK entities: twitter URLs unwrap to their path, others stay raw", () => {
    const html = renderToString(
      renderArticle(
        makeArticle({
          paragraphs: [
            {
              text: "see the source and the site",
              kind: "unstructured",
              inlineStyles: [],
              entityRanges: [
                { offset: 4, length: 3, key: 0 },
                { offset: 19, length: 3, key: 1 },
              ],
            },
          ],
          entities: {
            0: {
              kind: "LINK",
              url: "https://x.com/nasa/status/1001",
              mediaIds: [],
              tweetId: "",
              markdown: "",
              caption: "",
            },
            1: {
              kind: "LINK",
              url: "https://example.com/page",
              mediaIds: [],
              tweetId: "",
              markdown: "",
              caption: "",
            },
          },
        }),
        EMPTY_TWEETS,
        "/path",
        defaults,
      ),
    );
    expect(html).toContain('<a href="/nasa/status/1001">the</a>');
    expect(html).toContain('<a href="https://example.com/page">the</a>');
  });

  it("marks a trailing bold text child of a blockquote as the attribution", () => {
    const html = renderToString(
      renderArticle(
        makeArticle({
          paragraphs: [
            {
              text: "Some Author",
              kind: "blockquote",
              inlineStyles: [{ offset: 0, length: 11, style: "Bold" }],
              entityRanges: [],
            },
          ],
        }),
        EMPTY_TWEETS,
        "/path",
        defaults,
      ),
    );
    expect(html).toContain('class="blockquote-attribution"');
  });

  it("renders code blocks raw (no entity processing)", () => {
    const html = renderToString(
      renderArticle(
        makeArticle({
          paragraphs: [
            { text: "let x = 1", kind: "code-block", inlineStyles: [], entityRanges: [] },
          ],
        }),
        EMPTY_TWEETS,
        "/path",
        defaults,
      ),
    );
    expect(html).toContain("<pre><code>let x = 1</code></pre>");
  });

  it("groups list items into ul/ol and flushes on a non-list block", () => {
    const html = renderToString(
      renderArticle(
        makeArticle({
          paragraphs: [
            { text: "one", kind: "unordered-list-item", inlineStyles: [], entityRanges: [] },
            { text: "two", kind: "unordered-list-item", inlineStyles: [], entityRanges: [] },
            { text: "between", kind: "unstructured", inlineStyles: [], entityRanges: [] },
            { text: "first", kind: "ordered-list-item", inlineStyles: [], entityRanges: [] },
          ],
        }),
        EMPTY_TWEETS,
        "/path",
        defaults,
      ),
    );
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<p>between</p>");
    expect(html).toContain("<ol><li>first</li></ol>");
  });
});

describe("renderArticle atomic blocks", () => {
  it("renders MEDIA entities: images signed, gif/video through getVidUrl, caption", () => {
    const html = renderToString(
      renderArticle(
        makeArticle({
          paragraphs: [
            {
              text: "",
              kind: "atomic",
              inlineStyles: [],
              entityRanges: [{ offset: 0, length: 1, key: 0 }],
            },
          ],
          entities: {
            0: {
              kind: "MEDIA",
              url: "",
              mediaIds: ["img1", "gif1", "vid1", "missing"],
              tweetId: "",
              markdown: "",
              caption: "A caption",
            },
          },
          media: {
            img1: { kind: "ApiImage", url: "https://pbs.twimg.com/media/pic.jpg" },
            gif1: { kind: "ApiGif", url: "https://video.twimg.com/gif.mp4" },
            vid1: { kind: "ApiVideo", url: "https://video.twimg.com/vid.mp4" },
            skipped: { kind: "ApiImage", url: "" },
          },
        }),
        EMPTY_TWEETS,
        "/path",
        defaults,
      ),
    );
    expect(html).toContain('href="/pic/orig/https://pbs.twimg.com/media/pic.jpg"');
    expect(html).toContain(
      'src="/pic/https://pbs.twimg.com/media/pic.jpg?name=small&amp;format=webp"',
    );
    expect(html).toContain('src="/video/sig/https://video.twimg.com/gif.mp4"');
    expect(html).toContain('src="/video/sig/https://video.twimg.com/vid.mp4"');
    expect(html).not.toContain("skipped");
    expect(html).toContain('class="article-media-caption">A caption</p>');
  });

  it("renders TWEET entities through renderTweet, unknown ids as nothing", () => {
    const tweets = new Map<string, Tweet>([["1001", makeTweet()]]);
    const html = renderToString(
      renderArticle(
        makeArticle({
          paragraphs: [
            {
              text: "",
              kind: "atomic",
              inlineStyles: [],
              entityRanges: [
                { offset: 0, length: 1, key: 0 },
                { offset: 0, length: 1, key: 1 },
              ],
            },
          ],
          entities: {
            0: {
              kind: "TWEET",
              url: "",
              mediaIds: [],
              tweetId: "1001",
              markdown: "",
              caption: "",
            },
            1: {
              kind: "TWEET",
              url: "",
              mediaIds: [],
              tweetId: "9999",
              markdown: "",
              caption: "",
            },
          },
        }),
        tweets,
        "/path",
        defaults,
      ),
    );
    expect(html).toContain("hello world");
  });

  it("strips the MARKDOWN code fence", () => {
    const html = renderToString(
      renderArticle(
        makeArticle({
          paragraphs: [
            {
              text: "",
              kind: "atomic",
              inlineStyles: [],
              entityRanges: [{ offset: 0, length: 1, key: 0 }],
            },
          ],
          entities: {
            0: {
              kind: "MARKDOWN",
              url: "",
              mediaIds: [],
              tweetId: "",
              markdown: '```go\nfmt.Println("hi")\n```',
              caption: "",
            },
          },
        }),
        EMPTY_TWEETS,
        "/path",
        defaults,
      ),
    );
    expect(html).toContain("<pre><code>fmt.Println(&quot;hi&quot;)</code></pre>");
  });

  it("renders DIVIDER as an hr", () => {
    const html = renderToString(
      renderArticle(
        makeArticle({
          paragraphs: [
            {
              text: "",
              kind: "atomic",
              inlineStyles: [],
              entityRanges: [{ offset: 0, length: 1, key: 0 }],
            },
          ],
          entities: {
            0: {
              kind: "DIVIDER",
              url: "",
              mediaIds: [],
              tweetId: "",
              markdown: "",
              caption: "",
            },
          },
        }),
        EMPTY_TWEETS,
        "/path",
        defaults,
      ),
    );
    expect(html).toContain('<hr class="article-divider"');
  });
});
