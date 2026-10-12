import type { Community, User } from "@tseer/types";
import { QueryKind, VerifiedType } from "@tseer/types";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { beforeEach, describe, expect, it } from "vitest";
import {
  renderCommunity,
  renderCommunityAbout,
  renderCommunityTabs,
  renderHashtagHeader,
  renderMemberTabs,
  setMediaSigners,
} from "../src/index.ts";

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

function makeCommunity(overrides: Partial<Community> = {}): Community {
  return {
    id: "9",
    name: "Spaceflight",
    description: "rockets and orbit",
    memberCount: 12345,
    banner: "https://pbs.twimg.com/community_banner/1.jpg",
    creator: makeUser(),
    category: "Science",
    joinPolicy: "Open",
    createdAt: "2023-06-01T12:00:00Z",
    rules: [{ name: "Be nice", description: "no flames" }],
    hashtags: ["#space", "#rockets"],
    ...overrides,
  };
}

beforeEach(() => {
  setMediaSigners({
    picUrl: (url) => `/pic/${url}`,
    origPicUrl: (url) => `/pic/orig/${url}`,
    vidUrl: (url) => `/video/sig/${url}`,
  });
});

describe("renderCommunityTabs", () => {
  it("links Top/Latest/Media/About with the active tab keyed on the kind", () => {
    const top = renderToString(renderCommunityTabs(QueryKind.posts, makeCommunity()));
    expect(top).toContain('<a href="/i/communities/9">Top</a>');
    expect(top).toContain('<a href="/i/communities/9/latest">Latest</a>');
    expect(top).toContain('<a href="/i/communities/9/media">Media</a>');
    expect(top).toContain('<a href="/i/communities/9/about">About</a>');
    expect(top.match(/tab-item active/g)).toHaveLength(1);

    const latest = renderToString(renderCommunityTabs(QueryKind.replies, makeCommunity()));
    expect(latest).toContain(
      '<li class="tab-item active"><a href="/i/communities/9/latest">Latest</a>',
    );
    expect(latest.match(/tab-item active/g)).toHaveLength(1);
  });

  it("renders the trending hashtag links with the leading # stripped from the href", () => {
    const html = renderToString(renderCommunityTabs(QueryKind.posts, makeCommunity()));
    expect(html).toContain('<div class="community-tags">');
    expect(html).toContain('href="/i/communities/9/hashtag/space"');
    expect(html).toContain('href="/i/communities/9/hashtag/rockets"');
    expect(html).toContain(">#space</a>");

    const none = renderToString(
      renderCommunityTabs(QueryKind.posts, makeCommunity({ hashtags: [] })),
    );
    expect(none).not.toContain("community-tags");
  });
});

describe("renderMemberTabs", () => {
  it("keys the active tab on All vs Moderators", () => {
    const all = renderToString(renderMemberTabs(makeCommunity(), false));
    expect(all).toContain('<a href="/i/communities/9/members">All</a>');
    expect(all).toContain('<a href="/i/communities/9/moderators">Moderators</a>');
    expect(all).toContain('<li class="tab-item active"><a href="/i/communities/9/members">All</a>');
    expect(all.match(/tab-item active/g)).toHaveLength(1);

    const mods = renderToString(renderMemberTabs(makeCommunity(), true));
    expect(mods).toContain(
      '<li class="tab-item active"><a href="/i/communities/9/moderators">Moderators</a>',
    );
    expect(mods.match(/tab-item active/g)).toHaveLength(1);
  });
});

describe("renderHashtagHeader", () => {
  it("renders the #tag title", () => {
    const html = renderToString(renderHashtagHeader(makeCommunity(), "space"));
    expect(html).toContain('<h2 class="community-hashtag-title">#space</h2>');
  });
});

describe("renderCommunityAbout", () => {
  it("renders the join policy, visibility, and created-by lines", () => {
    const html = renderToString(
      renderCommunityAbout(makeCommunity({ createdAt: "2023-06-01T12:00:00Z" }), []),
    );
    expect(html).toContain("Anyone can join this Community.");
    expect(html).toContain("All Communities are publicly visible.");
    expect(html).toContain("Created June 1, 2023 by");
    expect(html).toContain('<a href="/nasa">@nasa</a>');
  });

  it("renders the approval-only text for non-open join policies and skips unset dates", () => {
    const html = renderToString(
      renderCommunityAbout(makeCommunity({ joinPolicy: "Restricted", createdAt: "" }), []),
    );
    expect(html).toContain("Membership is by approval only.");
    expect(html).toContain("Created by");
    expect(html).not.toContain("Created  by");
  });

  it("renders the rules list with numbering and descriptions", () => {
    const html = renderToString(
      renderCommunityAbout(
        makeCommunity({
          rules: [
            { name: "Be nice", description: "no flames" },
            { name: "Stay on topic", description: "" },
          ],
        }),
        [],
      ),
    );
    expect(html).toContain("<h2>Rules</h2>");
    expect(html).toContain('href="https://help.x.com/rules-and-policies/x-rules"');
    expect(html).toContain('<span class="community-rule-number">1</span>');
    expect(html).toContain('<span class="community-rule-number">2</span>');
    expect(html).toContain("<strong>Be nice</strong>");
    expect(html).toContain("<p>no flames</p>");
    expect(html).toContain("<strong>Stay on topic</strong>");
  });

  it("renders the moderator strip with _bigger avatars and links", () => {
    const html = renderToString(
      renderCommunityAbout(makeCommunity(), [
        makeUser({
          username: "mod",
          fullname: "Mod",
          id: "2",
          userPic: "https://pbs.twimg.com/profile_images/mod_normal.jpg",
        }),
      ]),
    );
    expect(html).toContain("<h2>Moderators<a");
    expect(html).toContain('class="community-mods-link"');
    expect(html).toContain('href="/i/communities/9/moderators"');
    expect(html).toContain('class="community-mod-avatar"');
    expect(html).toContain("/pic/https://pbs.twimg.com/profile_images/mod_bigger.jpg");
    expect(html).toContain('class="community-mod-name"');
    expect(html).toContain('class="community-mod-username"');
    expect(html).toContain(">@mod</a>");
  });

  it("escapes markup in rule names and descriptions", () => {
    const html = renderToString(
      renderCommunityAbout(
        makeCommunity({ rules: [{ name: "<b>evil</b>", description: "<script>x</script>" }] }),
        [],
      ),
    );
    expect(html).not.toContain("<b>evil</b>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;b>evil&lt;/b>");
    expect(html).toContain("&lt;script>x&lt;/script>");
  });
});

describe("renderCommunity", () => {
  it("renders the banner, name, category, description, and member count", () => {
    const html = renderToString(
      renderCommunity(
        h("p", null, "tweets here") as ReturnType<typeof h>,
        h("ul", null) as ReturnType<typeof h>,
        makeCommunity(),
      ),
    );
    expect(html).toContain('<div class="timeline-container">');
    expect(html).toContain('<h1 class="community-name">');
    expect(html).toContain('href="/i/communities/9"');
    expect(html).toContain(">Spaceflight</a>");
    expect(html).toContain('<span class="community-category">Science</span>');
    expect(html).toContain('<div class="community-description">rockets and orbit</div>');
    expect(html).toContain('href="/i/communities/9/members"');
    expect(html).toContain("12,345 Members");
    expect(html).toContain("tweets here");
  });

  it("signs the banner link and image, and omits empty category/description/banner", () => {
    const html = renderToString(
      renderCommunity(
        h("div", null) as ReturnType<typeof h>,
        h("div", null) as ReturnType<typeof h>,
        makeCommunity({ category: "", description: "" }),
      ),
    );
    expect(html).toContain('<div class="timeline-banner">');
    expect(html).toContain('href="/pic/https://pbs.twimg.com/community_banner/1.jpg"');
    expect(html).not.toContain("community-category");
    expect(html).not.toContain("community-description");

    const bare = renderToString(
      renderCommunity(
        h("div", null) as ReturnType<typeof h>,
        h("div", null) as ReturnType<typeof h>,
        makeCommunity({ banner: "" }),
      ),
    );
    expect(bare).not.toContain("timeline-banner");
  });

  it("escapes markup in the community name and description", () => {
    const html = renderToString(
      renderCommunity(
        h("div", null) as ReturnType<typeof h>,
        h("div", null) as ReturnType<typeof h>,
        makeCommunity({ name: "<b>evil</b>", description: "<script>alert(1)</script>" }),
      ),
    );
    expect(html).not.toContain("<b>evil</b>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;b>evil&lt;/b>");
    expect(html).toContain("&lt;script>alert(1)&lt;/script>");
  });
});
