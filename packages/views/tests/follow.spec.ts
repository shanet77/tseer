import { preferencesSchema, type TseerPreferences } from "@tseer/prefs";
import type { User } from "@tseer/types";
import { VerifiedType } from "@tseer/types";
import { renderToString } from "preact-render-to-string";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyAccountInfo, renderUserCard, setMediaSigners } from "../src/index.ts";

const defaults: TseerPreferences = preferencesSchema.parse({});

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "1234",
    username: "nasa",
    fullname: "NASA",
    location: "",
    website: "",
    bio: "",
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

describe("profile follow button", () => {
  beforeEach(() => {
    setMediaSigners({
      picUrl: (url) => `/pic/${url}`,
      origPicUrl: (url) => `/pic/orig/${url}`,
      vidUrl: (url) => `/video/${url}`,
    });
  });

  it("offers Follow when the account isn't followed", () => {
    const html = renderToString(
      renderUserCard(makeUser(), defaults, emptyAccountInfo(), "/nasa/media"),
    );
    expect(html).toContain('action="/follow/nasa"');
    expect(html).toContain('value="/nasa/media"');
    expect(html).toContain(">Follow</button>");
  });

  it("offers Unfollow when followed (case-insensitive)", () => {
    const prefs = { ...defaults, follows: ["NASA"] };
    const html = renderToString(renderUserCard(makeUser(), prefs, emptyAccountInfo()));
    expect(html).toContain('action="/unfollow/nasa"');
    expect(html).toContain('class="profile-card-follow following"');
    expect(html).toContain('value="/nasa"');
    expect(html).toContain(">Unfollow</button>");
  });
});
