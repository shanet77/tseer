/**
 * Domain model ported 1:1 from nitter's `src/types.nim` (domain part), plus
 * the error shapes from `src/experimental/types/common.nim`.
 *
 * Pure types + enums — no framework imports (docs/TS_PORT_PLAN.md §1–§2).
 * Provider-owned types deliberately live elsewhere per the seam map:
 *   - `Config`                        → kernel config service
 *   - `Session`, `ApiReq`, `ApiUrl`   → twitter-sessions / twitter-api
 *   - raw GraphQL response shapes under `experimental/types/**` (everything
 *     except the error shapes below) → twitter-parser, ported alongside its
 *     golden fixtures in Phase 3 — upstream JSON is X's churn surface
 *
 * Translation decisions vs the Nim original (plan §0/§4):
 *   - `int64` ids → `string` (ids travel through URLs and JSON).
 *   - Nim `DateTime` → ISO 8601 UTC string (see `DateTime`) so domain objects
 *     survive `JSON.stringify` for the cache seam.
 *   - Nim `Option[T]` → optional property typed `T | undefined` (explicit
 *     `undefined` stays assignable under `exactOptionalPropertyTypes`).
 *   - Nim case objects → discriminated unions (`Media`).
 *   - Nim `Error` → `ApiErrorCode` (the bare name would shadow the global).
 */

/** ISO 8601 UTC timestamp string; port of Nim's `DateTime` (JSON/cache-safe). */
export type DateTime = string;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Port of `types.nim` `TimelineKind` — which of a user's timelines to fetch. */
export enum TimelineKind {
  tweets = "tweets",
  replies = "replies",
  media = "media",
  articles = "articles",
}

/** Port of `types.nim` `VerifiedType` — X's legacy verification tiers. */
export enum VerifiedType {
  None = "None",
  Blue = "Blue",
  Business = "Business",
  Government = "Government",
}

/**
 * Port of `types.nim` `Error` — numeric codes X returns in GraphQL error
 * payloads. Renamed to avoid shadowing the global `Error`.
 */
export enum ApiErrorCode {
  /** nitter: `null = 0` (no error). */
  none = 0,
  noUserMatches = 17,
  protectedUser = 22,
  missingParams = 25,
  timeout = 29,
  couldntAuth = 32,
  doesntExist = 34,
  unauthorized = 37,
  invalidParam = 47,
  userNotFound = 50,
  suspended = 63,
  rateLimited = 88,
  expiredToken = 89,
  listIdOrSlug = 112,
  timelineUnavailable = 131,
  tweetNotFound = 144,
  tweetNotAuthorized = 179,
  forbidden = 200,
  badRequest = 214,
  badToken = 239,
  locked = 326,
  noCsrf = 353,
  tweetUnavailable = 421,
  tweetCensored = 422,
}

/** Port of `types.nim` `SessionKind` — `Session` itself lives in twitter-sessions. */
export enum SessionKind {
  oauth = "oauth",
  cookie = "cookie",
}

/** Port of `types.nim` `RankingMode` — reply sort order on a status page. */
export enum RankingMode {
  Relevance = "Relevance",
  Recency = "Recency",
  Likes = "Likes",
}

/** Port of `types.nim` `QueryKind` — search / list tab discriminator. */
export enum QueryKind {
  posts = "posts",
  replies = "replies",
  media = "media",
  users = "users",
  tweets = "tweets",
  userList = "userList",
  followers = "followers",
  following = "following",
  lists = "lists",
  top = "top",
  articles = "articles",
}

/** Port of `types.nim` `Query` — parsed search text + filter state. */
export interface Query {
  kind: QueryKind;
  view: string;
  text: string;
  filters: string[];
  includes: string[];
  excludes: string[];
  fromUser: string[];
  since: string;
  until: string;
  minLikes: string;
  sep: string;
}

// ---------------------------------------------------------------------------
// Rate limits (the `Session` object lives in twitter-sessions; this is the
// shared vocabulary between http-client, twitter-sessions, and twitter-api)
// ---------------------------------------------------------------------------

/** Port of `types.nim` `RateLimit` — parsed per-API limit state. */
export interface RateLimit {
  limit: number;
  remaining: number;
  reset: number;
}

/**
 * Raw rate-limit headers passed to `Accounts.release()` (plan §4). Same shape
 * as the parsed `RateLimit`.
 */
export type RateLimitHeaders = RateLimit;

// ---------------------------------------------------------------------------
// Errors — raised by provider packages (api/http/sessions), caught by the
// server boot's error handlers (nitter.nim `error` blocks) → status codes
// ---------------------------------------------------------------------------

/** Port of `types.nim` `RateLimitError`. */
export class RateLimitError extends Error {
  constructor(message = "rate limited") {
    super(message);
    this.name = "RateLimitError";
  }
}

/** Port of `types.nim` `NoSessionsError`. */
export class NoSessionsError extends Error {
  constructor(message = "no sessions available") {
    super(message);
    this.name = "NoSessionsError";
  }
}

/** Port of `types.nim` `InternalError`. */
export class InternalError extends Error {
  constructor(message = "internal error") {
    super(message);
    this.name = "InternalError";
  }
}

/** Port of `types.nim` `BadClientError`. */
export class BadClientError extends Error {
  constructor(message = "bad client") {
    super(message);
    this.name = "BadClientError";
  }
}

/** Port of `experimental/types/common.nim` `ErrorObj`. */
export interface ErrorObj {
  /** Numeric X error code; parsers cast raw JSON numbers at the boundary. */
  code: ApiErrorCode;
  message: string;
}

/** Port of `experimental/types/common.nim` `Errors` — a GraphQL error payload. */
export interface Errors {
  errors: ErrorObj[];
}

/**
 * Port of `experimental/types/common.nim` `contains(codes, errors)` — true
 * when any returned error code is one of `codes`.
 */
export function containsErrorCode(codes: readonly ApiErrorCode[], errors: Errors): boolean {
  return errors.errors.some((error) => codes.includes(error.code));
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/** Port of `types.nim` `User` — a profile. */
export interface User {
  id: string;
  username: string;
  fullname: string;
  location: string;
  website: string;
  bio: string;
  userPic: string;
  banner: string;
  pinnedTweet: string;
  following: number;
  followers: number;
  tweets: number;
  likes: number;
  media: number;
  verifiedType: VerifiedType;
  protected: boolean;
  suspended: boolean;
  joinDate: DateTime;
}

/** Port of `types.nim` `AccountInfo` — the "About this account" data. */
export interface AccountInfo {
  username: string;
  fullname: string;
  userPic: string;
  joinDate: DateTime;
  verifiedType: VerifiedType;
  suspended: boolean;
  basedIn: string;
  source: string;
  usernameChanges: number;
  lastUsernameChange: DateTime;
  affiliateUsername: string;
  affiliateLabel: string;
  isIdentityVerified: boolean;
  verifiedSince: DateTime;
  overrideVerifiedYear: number;
}

// ---------------------------------------------------------------------------
// Broadcasts & audio spaces
// ---------------------------------------------------------------------------

/** Port of `types.nim` `Broadcast`. */
export interface Broadcast {
  id: string;
  title: string;
  state: string;
  thumb: string;
  mediaKey: string;
  m3u8Url: string;
  totalWatched: number;
  startTime: DateTime;
  endTime: DateTime;
  replayStart: number;
  availableForReplay: boolean;
  user: User;
}

/** Port of `types.nim` `SpaceParticipant`. */
export interface SpaceParticipant {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  isVerified: boolean;
}

/** Port of `types.nim` `AudioSpace`. */
export interface AudioSpace {
  id: string;
  title: string;
  state: string;
  mediaKey: string;
  m3u8Url: string;
  totalLiveListeners: number;
  totalReplayWatched: number;
  startTime: DateTime;
  endTime: DateTime;
  availableForReplay: boolean;
  creator: User;
  admins: SpaceParticipant[];
  speakers: SpaceParticipant[];
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/** Port of `types.nim` `VideoType` — MIME types used by HLS/MP4 playback. */
export enum VideoType {
  m3u8 = "application/x-mpegURL",
  mp4 = "video/mp4",
  vmap = "video/vmap",
}

/** Port of `types.nim` `VideoVariant`. */
export interface VideoVariant {
  contentType: VideoType;
  url: string;
  bitrate: number;
  resolution: number;
}

/** Port of `types.nim` `Video`. */
export interface Video {
  durationMs: number;
  url: string;
  thumb: string;
  available: boolean;
  reason: string;
  title: string;
  description: string;
  playbackType: VideoType;
  variants: VideoVariant[];
}

/** Port of `types.nim` `Gif`. */
export interface Gif {
  url: string;
  thumb: string;
  altText: string;
}

/** Port of `types.nim` `Photo`. */
export interface Photo {
  url: string;
  altText: string;
}

/** Port of `types.nim` `MediaKind` — discriminant of the `Media` union. */
export enum MediaKind {
  photoMedia = "photoMedia",
  videoMedia = "videoMedia",
  gifMedia = "gifMedia",
}

/** Port of `types.nim`'s `Media` case object as a discriminated union. */
export type Media =
  | { kind: MediaKind.photoMedia; photo: Photo }
  | { kind: MediaKind.videoMedia; video: Video }
  | { kind: MediaKind.gifMedia; gif: Gif };

/** Port of `types.nim` `MediaEntities`. */
export type MediaEntities = Media[];

/** Port of `types.nim` `GalleryPhoto` — a profile photo-rail entry. */
export interface GalleryPhoto {
  url: string;
  tweetId: string;
  color: string;
}

/** Port of `types.nim` `PhotoRail`. */
export type PhotoRail = GalleryPhoto[];

// ---------------------------------------------------------------------------
// Cards, polls, tweet stats
// ---------------------------------------------------------------------------

/** Port of `types.nim` `CardKind` — binding values kept verbatim. */
export enum CardKind {
  amplify = "amplify",
  app = "app",
  appPlayer = "appplayer",
  player = "player",
  summary = "summary",
  summaryLarge = "summary_large_image",
  promoWebsite = "promo_website",
  promoVideo = "promo_video_website",
  promoVideoConvo = "promo_video_convo",
  promoImageConvo = "promo_image_convo",
  promoImageApp = "promo_image_app",
  storeLink = "direct_store_link_app",
  liveEvent = "live_event",
  broadcast = "broadcast",
  periscope = "periscope_broadcast",
  unified = "unified_card",
  moment = "moment",
  messageMe = "message_me",
  videoDirectMessage = "video_direct_message",
  imageDirectMessage = "image_direct_message",
  audiospace = "audiospace",
  newsletterPublication = "newsletter_publication",
  jobDetails = "job_details",
  hidden = "hidden",
  unknown = "unknown",
}

/** Port of `types.nim` `Card` — link/summary preview attached to a tweet. */
export interface Card {
  kind: CardKind;
  url: string;
  title: string;
  dest: string;
  text: string;
  image: string;
  video?: Video | undefined;
}

/** Port of `types.nim` `TweetStats`. */
export interface TweetStats {
  replies: number;
  retweets: number;
  likes: number;
  views: number;
}

/** Port of `types.nim` `Poll`. */
export interface Poll {
  options: string[];
  values: number[];
  votes: number;
  leader: number;
  status: string;
}

/** Port of `types.nim` `ArticlePreview` — link-card preview of a long tweet. */
export interface ArticlePreview {
  title: string;
  previewText: string;
  coverImage: string;
  tweetId: string;
}

// ---------------------------------------------------------------------------
// Tweets
// ---------------------------------------------------------------------------

/** Port of `types.nim` `Tweet` — the central domain object. */
export interface Tweet {
  id: string;
  threadId: string;
  replyId: string;
  user: User;
  text: string;
  time: DateTime;
  /** Usernames being replied to ("Replying to @a @b"); nitter: `reply`. */
  reply: string[];
  pinned: boolean;
  hasThread: boolean;
  available: boolean;
  tombstone: string;
  location: string;
  /** Unused, needed for backwards compat (kept verbatim from nitter). */
  source: string;
  stats: TweetStats;
  retweet?: Tweet | undefined;
  attribution?: User | undefined;
  attributionLink: string;
  mediaTags: User[];
  quote?: Tweet | undefined;
  card?: Card | undefined;
  poll?: Poll | undefined;
  media: MediaEntities;
  /** Edit-history tweet ids (nitter: `history`). */
  history: string[];
  note: string;
  isAd: boolean;
  isAI: boolean;
  articlePreview?: ArticlePreview | undefined;
}

/** Port of `types.nim` `Tweets`. */
export type Tweets = Tweet[];

/** Port of `types.nim` `EditHistory`. */
export interface EditHistory {
  latest: Tweet;
  history: Tweets;
}

// ---------------------------------------------------------------------------
// Pagination envelopes & conversations
// ---------------------------------------------------------------------------

/**
 * Port of `types.nim`'s generic `Result[T]` — nitter's pagination envelope.
 * Kept as `top`/`bottom`/`beginning` cursors (both directions) rather than
 * plan §4's sketched single `cursor?`, because status/profile/search pages
 * paginate in both directions. `TimelineResult`/`ChainResult` are the
 * concrete instantiations §4 names.
 */
export interface Result<T> {
  content: T[];
  /** Cursor for loading older items. */
  top: string;
  /** Cursor for loading newer items. */
  bottom: string;
  /** True at the start of the list. */
  beginning: boolean;
  query: Query;
}

/** Port of `types.nim` `Timeline` = `Result[Tweets]` (plan §4 `TimelineResult`). */
export type TimelineResult = Result<Tweet>;

/** Alias of `TimelineResult` matching the Nim name. */
export type Timeline = TimelineResult;

/** Port of `types.nim` `Result[Chain]` — a conversation's reply pages. */
export type ChainResult = Result<Chain>;

/** Port of `types.nim` `Chain` — a thread segment. */
export interface Chain {
  content: Tweets;
  hasMore: boolean;
  cursor: string;
  related: boolean;
}

/** Port of `types.nim` `Conversation` — a status page's data. */
export interface Conversation {
  tweet: Tweet;
  before: Chain;
  after: Chain;
  replies: ChainResult;
}

// ---------------------------------------------------------------------------
// Profiles, lists, communities
// ---------------------------------------------------------------------------

/** Port of `types.nim` `Profile` — a profile page's data. */
export interface Profile {
  user: User;
  photoRail: PhotoRail;
  pinned?: Tweet | undefined;
  tweets: TimelineResult;
  accountInfo: AccountInfo;
}

/** Port of `types.nim` `List`. */
export interface List {
  id: string;
  name: string;
  userId: string;
  username: string;
  description: string;
  members: number;
  banner: string;
}

/** Port of `types.nim` `ListSearchResult`. */
export interface ListSearchResult {
  list: List;
  owner: User;
  followersContext: string;
  facepiles: string[];
}

/** Port of `types.nim` `CommunityRule`. */
export interface CommunityRule {
  name: string;
  description: string;
}

/** Port of `types.nim` `Community`. */
export interface Community {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  banner: string;
  creator: User;
  category: string;
  joinPolicy: string;
  createdAt: DateTime;
  rules: CommunityRule[];
  hashtags: string[];
}

// ---------------------------------------------------------------------------
// Articles (long-form)
// ---------------------------------------------------------------------------

/** Port of `types.nim` `ArticleStyle` — an inline style range. */
export interface ArticleStyle {
  offset: number;
  length: number;
  style: string;
}

/** Port of `types.nim` `ArticleEntityRange` — links an entity to text. */
export interface ArticleEntityRange {
  offset: number;
  length: number;
  key: number;
}

/** Port of `types.nim` `ArticleEntity`. */
export interface ArticleEntity {
  kind: string;
  url: string;
  mediaIds: string[];
  tweetId: string;
  markdown: string;
  caption: string;
}

/** Port of `types.nim` `ArticleMedia`. */
export interface ArticleMedia {
  kind: string;
  url: string;
}

/** Port of `types.nim` `ArticleParagraph`. */
export interface ArticleParagraph {
  text: string;
  kind: string;
  inlineStyles: ArticleStyle[];
  entityRanges: ArticleEntityRange[];
}

/** Port of `types.nim` `Article` — a parsed long-form post. */
export interface Article {
  title: string;
  coverImage: string;
  user: User;
  time: DateTime;
  stats: TweetStats;
  paragraphs: ArticleParagraph[];
  entities: Record<number, ArticleEntity>;
  media: Record<string, ArticleMedia>;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/**
 * Port of `types.nim` `GlobalObjects` — the per-response dedup tables parsers
 * build before assembling domain objects.
 */
export interface GlobalObjects {
  tweets: Record<string, Tweet>;
  users: Record<string, User>;
}

/** Port of `types.nim` `Rss` — a feed plus its pagination cursor. */
export interface Rss {
  feed: string;
  cursor: string;
}
