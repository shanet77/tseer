import { preferencesSchema, type TseerPreferences } from "@tseer/prefs";
import type { AudioSpace, SpaceParticipant, User } from "@tseer/types";
import { VerifiedType } from "@tseer/types";
import { renderToString } from "preact-render-to-string";
import { beforeEach, describe, expect, it } from "vitest";
import { renderParticipant, renderSpace, setMediaSigners } from "../src/index.ts";

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

function makeParticipant(overrides: Partial<SpaceParticipant> = {}): SpaceParticipant {
  return {
    userId: "1234",
    username: "nasa",
    displayName: "NASA",
    avatarUrl: "https://pbs.twimg.com/profile_images/nasa_normal.jpg",
    isVerified: false,
    ...overrides,
  };
}

function makeSpace(overrides: Partial<AudioSpace> = {}): AudioSpace {
  return {
    id: "1yNGaLwepgeJB",
    title: "Starship update",
    state: "NotRunning",
    mediaKey: "media-key",
    m3u8Url: "",
    totalLiveListeners: 100,
    totalReplayWatched: 0,
    startTime: "",
    endTime: "",
    availableForReplay: false,
    creator: makeUser(),
    admins: [],
    speakers: [],
    ...overrides,
  };
}

const M3U8 = "https://video.twimg.com/spaces/main.m3u8";

beforeEach(() => {
  setMediaSigners({
    picUrl: (url) => `/pic/${url}`,
    origPicUrl: (url) => `/pic/orig/${url}`,
    vidUrl: (url) => `/video/sig/${url}`,
  });
});

describe("renderSpace", () => {
  it("renders the LIVE badge and signed player when live", () => {
    const html = renderToString(
      renderSpace(
        makeSpace({ state: "RUNNING", m3u8Url: M3U8 }),
        { ...defaults, hlsPlayback: true },
        "/i/spaces/1yNGaLwepgeJB",
      ),
    );
    expect(html).toContain('onclick="playAudio(this)"');
    expect(html).toContain('<div class="space-live">LIVE</div>');
    expect(html).toContain("overlay-circle");
    expect(html).toContain(`data-url="/video/sig/${M3U8}"`);
    expect(html).toContain('data-autoload="false"');
    expect(html).toContain('<span class="space-live">LIVE</span>');
  });

  it("renders the ended date from endTime, then the state, then Ended", () => {
    const html = renderToString(
      renderSpace(makeSpace({ endTime: "2024-01-05T12:00:00Z" }), defaults, "/"),
    );
    expect(html).toContain('<span class="space-state">Ended Jan 5, 2024</span>');

    const state = renderToString(renderSpace(makeSpace({ state: "NotRunning" }), defaults, "/"));
    expect(state).toContain('<span class="space-state">NotRunning</span>');

    const bare = renderToString(renderSpace(makeSpace({ state: "" }), defaults, "/"));
    expect(bare).toContain('<span class="space-state">Ended</span>');
  });

  it("renders the replay duration in the overlay and skips it when unset", () => {
    const html = renderToString(
      renderSpace(
        makeSpace({
          m3u8Url: M3U8,
          startTime: "2024-01-05T11:00:00Z",
          endTime: "2024-01-05T12:01:30Z",
        }),
        { ...defaults, hlsPlayback: true },
        "/",
      ),
    );
    expect(html).toContain('<div class="overlay-duration">1:01:30</div>');

    const none = renderToString(
      renderSpace(makeSpace({ m3u8Url: M3U8 }), { ...defaults, hlsPlayback: true }, "/"),
    );
    expect(none).not.toContain("overlay-duration");
  });

  it("renders listener counts with a thousands separator (replay wins)", () => {
    const replay = renderToString(
      renderSpace(makeSpace({ totalReplayWatched: 12345, totalLiveListeners: 4 }), defaults, "/"),
    );
    expect(replay).toContain('<span class="listener-count">12,345 listeners</span>');

    const live = renderToString(
      renderSpace(makeSpace({ totalLiveListeners: 4321 }), defaults, "/"),
    );
    expect(live).toContain('<span class="listener-count">4,321 listeners</span>');

    const silent = renderToString(
      renderSpace(makeSpace({ totalLiveListeners: 0, totalReplayWatched: 0 }), defaults, "/"),
    );
    expect(silent).not.toContain("listener-count");
  });

  it("signs the source only when proxyVideos is on and the url is absolute", () => {
    const proxied = renderToString(
      renderSpace(makeSpace({ m3u8Url: M3U8 }), { ...defaults, hlsPlayback: true }, "/"),
    );
    expect(proxied).toContain(`data-url="/video/sig/${M3U8}"`);

    const raw = renderToString(
      renderSpace(
        makeSpace({ m3u8Url: M3U8 }),
        { ...defaults, hlsPlayback: true, proxyVideos: false },
        "/",
      ),
    );
    expect(raw).toContain(`data-url="${M3U8}"`);
    expect(raw).not.toContain("/video/sig");
  });

  it("falls back to the enablehls button when hls is off", () => {
    const html = renderToString(
      renderSpace(makeSpace({ m3u8Url: M3U8, state: "RUNNING" }), defaults, "/i/spaces/abc"),
    );
    expect(html).not.toContain("<audio");
    expect(html).toContain('action="/enablehls"');
    expect(html).toContain('name="referer"');
    expect(html).toContain("Enable hls playback");
    expect(html).toContain('<div class="space-live">LIVE</div>');
  });

  it("renders the unavailable-audio and unavailable-replay panels", () => {
    const audio = renderToString(
      renderSpace(makeSpace({ availableForReplay: true }), defaults, "/"),
    );
    expect(audio).toContain("<p>Audio stream unavailable</p>");

    const replay = renderToString(renderSpace(makeSpace(), defaults, "/"));
    expect(replay).toContain("<p>Replay is not available</p>");
  });

  it("renders Host and Co-host badges over participants", () => {
    const html = renderToString(
      renderSpace(
        makeSpace({
          admins: [
            makeParticipant({ username: "nasa", displayName: "NASA" }),
            makeParticipant({ username: "cohost", displayName: "Co-host", userId: "2" }),
          ],
          speakers: [makeParticipant({ username: "guest", displayName: "Guest", userId: "3" })],
        }),
        defaults,
        "/",
      ),
    );
    expect(html.match(/host-badge/g)).toHaveLength(2);
    expect(html).toContain('<span class="host-badge">Host</span>');
    expect(html).toContain('<span class="host-badge">Co-host</span>');
    expect(html).toContain("/pic/https://pbs.twimg.com/profile_images/nasa_bigger.jpg");
    expect(html).toContain('<span class="participant-username">@guest</span>');
  });

  it("renders the blue verified icon for verified participants", () => {
    const html = renderToString(renderParticipant(makeParticipant({ isVerified: true }), ""));
    expect(html).toContain('class="verified-icon blue"');
    expect(html).toContain("verified-icon-circle");
    expect(html).toContain("verified-icon-check");
    expect(html).not.toContain("host-badge");
  });
});
