/** `@tseer/views` — `ctx.render` seam (page shell), the tweet/timeline/
 * profile/search view components, and formatters. */

export { renderAboutAccount } from "./about-account.tsx";
export { renderBroadcast } from "./broadcast.tsx";
export { renderFeature } from "./feature.tsx";
export {
  getDuration,
  getJoinDate,
  getJoinDateFull,
  getLink,
  getLocation,
  getRfc822Time,
  getShortTime,
  getSuspended,
  getTime,
  getTweetLink,
  getUrlPrefix,
  getUserPic,
  insertSep,
  pageDesc,
  pageTitle,
  pageTitleOfTweet,
  replaceUrls,
  sanitizeXml,
  shorten,
  shortLink,
  stripHtml,
  titleize,
} from "./formatters.ts";
export {
  getOrigPicUrl,
  getPicUrl,
  getVidUrl,
  type MediaUrlSigners,
  setMediaSigners,
} from "./media.ts";
export type {
  PageConfig,
  TseerPreferencesLike,
} from "./page.tsx";
export { doctype, renderError, renderHead, renderMain, renderNavbar, toHtml } from "./page.tsx";
export type { RenderPluginOptions } from "./plugin.ts";
export { default as renderPlugin } from "./plugin.ts";
export { renderPreferences } from "./preferences.tsx";
export {
  emptyAccountInfo,
  renderBanner,
  renderFollowTabs,
  renderPhotoRail,
  renderProfile,
  renderProtected,
  renderStat,
  renderStatLink,
  renderUserCard,
  renderUserList,
} from "./profile.tsx";
export type {
  PageContext,
  PageOpts,
  Render,
  RenderEvents,
  RenderOptions,
} from "./render.ts";
export { RenderImpl } from "./render.ts";
export {
  buttonReferer,
  genCheckbox,
  genDate,
  genImg,
  genInput,
  genNumberInput,
  genSelect,
  getAvatarClass,
  getMediumPic,
  getSmallPic,
  getTabClass,
  hiddenField,
  icon,
  linkText,
  linkUser,
  refererField,
  verifiedIcon,
} from "./renderutils.tsx";
export {
  defaultProfilePic,
  escapeXml,
  isGlobalGuid,
  renderListRss,
  renderRssArticle,
  renderRssCard,
  renderRssMedia,
  renderRssPoll,
  renderRssTweet,
  renderRssTweets,
  renderSearchRss,
  renderTimelineRss,
  rssDescription,
  rssTitle,
  withPinned,
} from "./rss.ts";
export {
  renderListSearch,
  renderMediaViewTabs,
  renderProfileTabs,
  renderSearch,
  renderSearchForm,
  renderSearchPanel,
  renderSearchTabs,
  renderTweetSearch,
  renderUserSearch,
} from "./search.tsx";
export { renderParticipant, renderSpace } from "./space.tsx";
export { findThemes, viewsPublicDir } from "./static.ts";
export {
  getThreadLink,
  getUrlPrefix as getStatusUrlPrefix,
  getVideoEmbed,
  renderConversation,
  renderEarlier,
  renderEditHistory,
  renderMoreReplies,
  renderReplies,
  renderReplySort,
  renderReplyThread,
} from "./status.tsx";
export {
  getSearchMaxId,
  querySuffix,
  renderListCard,
  renderTimelineLists,
  renderTimelineTweets,
  renderTimelineUsers,
  timelineViewClass,
} from "./timeline.tsx";
export { renderTweet } from "./tweet.tsx";
