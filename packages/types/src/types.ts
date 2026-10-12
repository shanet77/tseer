export type DateTime = string;

export enum TimelineKind {
  tweets = "tweets",
  replies = "replies",
  media = "media",
  articles = "articles",
}

export enum VerifiedType {
  None = "None",
  Blue = "Blue",
  Business = "Business",
  Government = "Government",
}

export enum ApiErrorCode {
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

export enum SessionKind {
  oauth = "oauth",
  cookie = "cookie",
}

export enum RankingMode {
  Relevance = "Relevance",
  Recency = "Recency",
  Likes = "Likes",
}

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

export interface RateLimit {
  limit: number;
  remaining: number;
  reset: number;
}

export type RateLimitHeaders = RateLimit;

export class RateLimitError extends Error {
  constructor(message = "rate limited") {
    super(message);
    this.name = "RateLimitError";
  }
}

export class NoSessionsError extends Error {
  constructor(message = "no sessions available") {
    super(message);
    this.name = "NoSessionsError";
  }
}

export class InternalError extends Error {
  constructor(message = "internal error") {
    super(message);
    this.name = "InternalError";
  }
}

export class BadClientError extends Error {
  constructor(message = "bad client") {
    super(message);
    this.name = "BadClientError";
  }
}

export interface ErrorObj {
  code: ApiErrorCode;
  message: string;
}

export interface Errors {
  errors: ErrorObj[];
}

export function containsErrorCode(codes: readonly ApiErrorCode[], errors: Errors): boolean {
  return errors.errors.some((error) => codes.includes(error.code));
}

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

export interface SpaceParticipant {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  isVerified: boolean;
}

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

export enum VideoType {
  m3u8 = "application/x-mpegURL",
  mp4 = "video/mp4",
  vmap = "video/vmap",
}

export interface VideoVariant {
  contentType: VideoType;
  url: string;
  bitrate: number;
  resolution: number;
}

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

export interface Gif {
  url: string;
  thumb: string;
  altText: string;
}

export interface Photo {
  url: string;
  altText: string;
}

export enum MediaKind {
  photoMedia = "photoMedia",
  videoMedia = "videoMedia",
  gifMedia = "gifMedia",
}

export type Media =
  | { kind: MediaKind.photoMedia; photo: Photo }
  | { kind: MediaKind.videoMedia; video: Video }
  | { kind: MediaKind.gifMedia; gif: Gif };

export type MediaEntities = Media[];

export interface GalleryPhoto {
  url: string;
  tweetId: string;
  color: string;
}

export type PhotoRail = GalleryPhoto[];

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

export interface Card {
  kind: CardKind;
  url: string;
  title: string;
  dest: string;
  text: string;
  image: string;
  video?: Video | undefined;
}

export interface TweetStats {
  replies: number;
  retweets: number;
  likes: number;
  views: number;
}

export interface Poll {
  options: string[];
  values: number[];
  votes: number;
  leader: number;
  status: string;
}

export interface ArticlePreview {
  title: string;
  previewText: string;
  coverImage: string;
  tweetId: string;
}

export interface Tweet {
  id: string;
  threadId: string;
  replyId: string;
  user: User;
  text: string;
  time: DateTime;
  reply: string[];
  pinned: boolean;
  hasThread: boolean;
  available: boolean;
  tombstone: string;
  location: string;
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
  history: string[];
  note: string;
  isAd: boolean;
  isAI: boolean;
  articlePreview?: ArticlePreview | undefined;
}

export type Tweets = Tweet[];

export interface EditHistory {
  latest: Tweet;
  history: Tweets;
}

export interface Result<T> {
  content: T[];
  top: string;
  bottom: string;
  beginning: boolean;
  query: Query;
}

export type TimelineResult = Result<Tweet>;

export type Timeline = TimelineResult;

export type ChainResult = Result<Chain>;

export interface Chain {
  content: Tweets;
  hasMore: boolean;
  cursor: string;
  related: boolean;
}

export interface Conversation {
  tweet: Tweet;
  before: Chain;
  after: Chain;
  replies: ChainResult;
}

export interface Profile {
  user: User;
  photoRail: PhotoRail;
  pinned?: Tweet | undefined;
  tweets: TimelineResult;
  accountInfo: AccountInfo;
}

export interface List {
  id: string;
  name: string;
  userId: string;
  username: string;
  description: string;
  members: number;
  banner: string;
}

export interface ListSearchResult {
  list: List;
  owner: User;
  followersContext: string;
  facepiles: string[];
}

export interface CommunityRule {
  name: string;
  description: string;
}

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

export interface ArticleStyle {
  offset: number;
  length: number;
  style: string;
}

export interface ArticleEntityRange {
  offset: number;
  length: number;
  key: number;
}

export interface ArticleEntity {
  kind: string;
  url: string;
  mediaIds: string[];
  tweetId: string;
  markdown: string;
  caption: string;
}

export interface ArticleMedia {
  kind: string;
  url: string;
}

export interface ArticleParagraph {
  text: string;
  kind: string;
  inlineStyles: ArticleStyle[];
  entityRanges: ArticleEntityRange[];
}

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

export interface GlobalObjects {
  tweets: Record<string, Tweet>;
  users: Record<string, User>;
}

export interface Rss {
  feed: string;
  cursor: string;
}
