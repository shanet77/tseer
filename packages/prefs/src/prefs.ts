import { gallerySizeOptions, mediaViewOptions, themeOptions } from "./schema.ts";

export type PrefKind = "checkbox" | "select" | "input";

export interface PrefMeta {
  name: string;
  label: string;
  kind: PrefKind;
  default: boolean | string;
  options?: readonly string[];
  placeholder?: string;
}

export interface PrefCategory {
  category: string;
  prefs: PrefMeta[];
}

export const prefList: PrefCategory[] = [
  {
    category: "Display",
    prefs: [
      { name: "theme", label: "Theme", kind: "select", default: "Nitter", options: themeOptions },
      {
        name: "infiniteScroll",
        label: "Infinite scrolling (experimental, requires JavaScript)",
        kind: "checkbox",
        default: false,
      },
      {
        name: "stickyProfile",
        label: "Make profile sidebar stick to top",
        kind: "checkbox",
        default: true,
      },
      { name: "stickyNav", label: "Keep navbar fixed to top", kind: "checkbox", default: true },
      {
        name: "bidiSupport",
        label: "Support bidirectional text (makes clicking on tweets harder)",
        kind: "checkbox",
        default: false,
      },
      {
        name: "hideTweetStats",
        label: "Hide tweet stats (replies, retweets, likes)",
        kind: "checkbox",
        default: false,
      },
      { name: "hideBanner", label: "Hide profile banner", kind: "checkbox", default: false },
      { name: "hidePins", label: "Hide pinned tweets", kind: "checkbox", default: false },
      { name: "hideReplies", label: "Hide tweet replies", kind: "checkbox", default: false },
      {
        name: "hideRelated",
        label: "Hide related tweets under replies",
        kind: "checkbox",
        default: true,
      },
      {
        name: "hideCommunityNotes",
        label: "Hide community notes",
        kind: "checkbox",
        default: false,
      },
      {
        name: "squareAvatars",
        label: "Square profile pictures",
        kind: "checkbox",
        default: false,
      },
    ],
  },
  {
    category: "Media",
    prefs: [
      {
        name: "mp4Playback",
        label: "Enable mp4 video playback (only for gifs)",
        kind: "checkbox",
        default: true,
      },
      {
        name: "hlsPlayback",
        label: "Enable HLS video streaming (requires JavaScript)",
        kind: "checkbox",
        default: false,
      },
      {
        name: "proxyVideos",
        label: "Proxy video streaming through the server (might be slow)",
        kind: "checkbox",
        default: true,
      },
      { name: "muteVideos", label: "Mute videos by default", kind: "checkbox", default: false },
      { name: "autoplayGifs", label: "Autoplay gifs", kind: "checkbox", default: true },
      {
        name: "compactGallery",
        label: "Compact media gallery (no profile info or text)",
        kind: "checkbox",
        default: false,
      },
      {
        name: "gallerySize",
        label: "Gallery column size",
        kind: "select",
        default: "Medium",
        options: gallerySizeOptions,
      },
      {
        name: "mediaView",
        label: "Default media view",
        kind: "select",
        default: "Timeline",
        options: mediaViewOptions,
      },
    ],
  },
  {
    category: "Link replacements (blank to disable)",
    prefs: [
      {
        name: "replaceTwitter",
        label: "Twitter -> Nitter",
        kind: "input",
        default: "",
        placeholder: "Nitter hostname",
      },
      {
        name: "replaceYouTube",
        label: "YouTube -> Piped/Invidious",
        kind: "input",
        default: "",
        placeholder: "Piped hostname",
      },
      {
        name: "replaceReddit",
        label: "Reddit -> Teddit/Libreddit",
        kind: "input",
        default: "",
        placeholder: "Teddit hostname",
      },
    ],
  },
];

export const allPrefs: PrefMeta[] = prefList.flatMap((c) => c.prefs);
