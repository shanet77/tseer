/**
 * Ports of the helper procs at the bottom of nitter's `src/types.nim`.
 * Pure functions over the domain model — no framework imports.
 */
import { type Chain, type Media, MediaKind, type Photo, type Tweet, type Video } from "./types.ts";

/** Port of `types.nim` `contains(thread, tweet)`. */
export function chainContains(thread: Chain, tweet: Tweet): boolean {
  return thread.content.some((item) => item.id === tweet.id);
}

/** Port of `types.nim` `getPhotos(tweet)`. */
export function getPhotos(tweet: Tweet): Photo[] {
  return tweet.media.flatMap((m) => (m.kind === MediaKind.photoMedia ? [m.photo] : []));
}

/** Port of `types.nim` `getVideos(tweet)`. */
export function getVideos(tweet: Tweet): Video[] {
  return tweet.media.flatMap((m) => (m.kind === MediaKind.videoMedia ? [m.video] : []));
}

/** Port of `types.nim` `hasPhotos(tweet)`. */
export function hasPhotos(tweet: Tweet): boolean {
  return tweet.media.some((m) => m.kind === MediaKind.photoMedia);
}

/** Port of `types.nim` `hasVideos(tweet)`. */
export function hasVideos(tweet: Tweet): boolean {
  return tweet.media.some((m) => m.kind === MediaKind.videoMedia);
}

/** Port of `types.nim` `hasGifs(tweet)`. */
export function hasGifs(tweet: Tweet): boolean {
  return tweet.media.some((m) => m.kind === MediaKind.gifMedia);
}

/** Port of `types.nim` `getThumb(media)` — thumbnail URL for any media kind. */
export function getThumb(media: Media): string {
  switch (media.kind) {
    case MediaKind.photoMedia:
      return media.photo.url;
    case MediaKind.videoMedia:
      return media.video.thumb;
    case MediaKind.gifMedia:
      return media.gif.thumb;
  }
}
