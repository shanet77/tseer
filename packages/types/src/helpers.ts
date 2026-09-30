/**
 * Ports of the helper procs at the bottom of nitter's `src/types.nim`.
 * Pure functions over the domain model — no framework imports.
 */
import { type Chain, type Media, MediaKind, type Photo, type Tweet, type Video } from "./types.ts";

/** True when `tweet` is already in the thread. */
export function chainContains(thread: Chain, tweet: Tweet): boolean {
  return thread.content.some((item) => item.id === tweet.id);
}

export function getPhotos(tweet: Tweet): Photo[] {
  return tweet.media.flatMap((m) => (m.kind === MediaKind.photoMedia ? [m.photo] : []));
}

export function getVideos(tweet: Tweet): Video[] {
  return tweet.media.flatMap((m) => (m.kind === MediaKind.videoMedia ? [m.video] : []));
}

export function hasPhotos(tweet: Tweet): boolean {
  return tweet.media.some((m) => m.kind === MediaKind.photoMedia);
}

export function hasVideos(tweet: Tweet): boolean {
  return tweet.media.some((m) => m.kind === MediaKind.videoMedia);
}

export function hasGifs(tweet: Tweet): boolean {
  return tweet.media.some((m) => m.kind === MediaKind.gifMedia);
}

/** Thumbnail URL for any media kind. */
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
