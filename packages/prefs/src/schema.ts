import { z } from "zod";

export const themeOptions = ["Classic", "Twitter", "Mastodon", "Auto"] as const;
export const gallerySizeOptions = ["Small", "Medium", "Large"] as const;
export const mediaViewOptions = ["Timeline", "Grid", "Gallery"] as const;

export const preferencesSchema = z.object({
  theme: z.string().default("Classic"),
  infiniteScroll: z.boolean().default(false),
  stickyProfile: z.boolean().default(true),
  stickyNav: z.boolean().default(true),
  bidiSupport: z.boolean().default(false),
  hideTweetStats: z.boolean().default(false),
  hideBanner: z.boolean().default(false),
  hidePins: z.boolean().default(false),
  hideReplies: z.boolean().default(false),
  hideRelated: z.boolean().default(true),
  hideCommunityNotes: z.boolean().default(false),
  squareAvatars: z.boolean().default(false),
  mp4Playback: z.boolean().default(true),
  hlsPlayback: z.boolean().default(false),
  proxyVideos: z.boolean().default(true),
  muteVideos: z.boolean().default(false),
  autoplayGifs: z.boolean().default(true),
  compactGallery: z.boolean().default(false),
  gallerySize: z.enum(gallerySizeOptions).default("Medium"),
  mediaView: z.enum(mediaViewOptions).default("Timeline"),
  replaceTwitter: z.string().default(""),
  replaceYouTube: z.string().default(""),
  replaceReddit: z.string().default(""),
});

export type TseerPreferences = z.infer<typeof preferencesSchema>;
