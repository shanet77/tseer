/** List renderer tests — port fidelity for `views/list` (the
 * `views/list.nim` port: `renderListTabs` + `renderList`). */

import type { List } from "@tseer/types";
import { type Query, QueryKind } from "@tseer/types";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { beforeEach, describe, expect, it } from "vitest";
import { renderList, renderListTabs, setMediaSigners } from "../src/index.ts";

function makeList(overrides: Partial<List> = {}): List {
  return {
    id: "7",
    name: "Space",
    userId: "1234",
    username: "nasa",
    description: "orbital updates",
    members: 3,
    banner: "",
    ...overrides,
  };
}

function makeQuery(kind: QueryKind = QueryKind.posts): Query {
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

beforeEach(() => {
  setMediaSigners({
    picUrl: (url) => `/pic/${url}`,
    origPicUrl: (url) => `/pic/orig/${url}`,
    vidUrl: (url) => `/video/sig/${url}`,
  });
});

describe("renderListTabs", () => {
  it("links Tweets and Members with the active tab keyed on the query kind", () => {
    const tweets = renderToString(renderListTabs(makeQuery(), "/i/lists/7"));
    expect(tweets).toContain('<a href="/i/lists/7">Tweets</a>');
    expect(tweets).toContain('<a href="/i/lists/7/members">Members</a>');
    expect(tweets).toContain('class="tab-item active"');

    const members = renderToString(renderListTabs(makeQuery(QueryKind.userList), "/i/lists/7"));
    expect(members).toContain("Members");
    // exactly one active tab in each render
    expect(members.match(/tab-item active/g)).toHaveLength(1);
    expect(tweets.match(/tab-item active/g)).toHaveLength(1);
  });
});

/** The list page body, built with preact's `h` (the DOM-specific VNode
 * overload is not assignable to plain `VNode` under
 * `exactOptionalPropertyTypes`, so the parameter accepts what `h` returns). */
type AnyVNode = ReturnType<typeof h>;

describe("renderList", () => {
  it("renders the header, description, tabs, and body", () => {
    const html = renderToString(
      renderList(h("p", null, "tweets here") as AnyVNode, makeQuery(), makeList()),
    );
    expect(html).toContain("&quot;Space&quot; by @nasa");
    expect(html).toContain('<div class="timeline-description">orbital updates</div>');
    expect(html).toContain("tweets here");
    expect(html).toContain('href="/i/lists/7"');
    expect(html).toContain('href="/i/lists/7/members"');
    expect(html).not.toContain("timeline-banner");
  });

  it("signs the banner link and image", () => {
    const banner = "https://pbs.twimg.com/profile_banners/list/1500.jpg";
    const html = renderToString(
      renderList(h("div", null) as AnyVNode, makeQuery(), makeList({ banner })),
    );
    expect(html).toContain('<div class="timeline-banner">');
    expect(html).toContain(`href="/pic/${banner}"`);
    expect(html).toContain(`src="/pic/${banner}"`);
  });

  it("escapes markup in list names and descriptions", () => {
    const html = renderToString(
      renderList(
        h("div", null) as AnyVNode,
        makeQuery(),
        makeList({ name: "<b>evil</b>", description: "<script>alert(1)</script>" }),
      ),
    );
    expect(html).not.toContain("<b>evil</b>");
    expect(html).not.toContain("<script>");
    // preact escapes `<` (and quotes) but passes `>` through
    expect(html).toContain("&lt;b>evil&lt;/b>");
    expect(html).toContain("&lt;script>alert(1)&lt;/script>");
  });
});
