export const CONSUMER_KEY = "3nVuSoBZnx6U4vzUxf5w";
export const CONSUMER_SECRET = "Bcs59EFbbsdF6Sl9Ng71smgStWEGwXXKSjYvPVt7qys";
export const BEARER_TOKEN =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
export const BEARER_TOKEN_2 =
  "Bearer AAAAAAAAAAAAAAAAAAAAAFXzAwAAAAAAMHCxpeSDG1gLNLghVe8d74hl6k4%3DRUMF4xAQLsbeBhTSRrCiQpJtxoGWeyHrDb5te2jpGskWDFW82F";

export const GRAPH_USER = "Gb-d6r0vxPOADdG62OEBpQ/UserByScreenName";
export const GRAPH_USER_V2 = "-ZzAG_Bckx16LMbEvHC3lg/UserResultByScreenNameQuery";
export const GRAPH_USER_BY_ID = "xvmVfRLmnr1alc5f2dib0Q/UserByRestId";
export const GRAPH_USER_TWEETS_V2 = "LE3eTyeqhBh2g-fX85O2eQ/UserWithProfileTweetsQueryV2";
export const GRAPH_USER_TWEETS_AND_REPLIES_V2 =
  "AcYHjc_YAx-9_rKWdMsKvA/UserWithProfileTweetsAndRepliesQueryV2";
export const GRAPH_USER_TWEETS = "SXVCYB8XHSS25nzIljNtZA/UserTweets";
export const GRAPH_USER_TWEETS_AND_REPLIES = "qUpkZU6eN8MbtQb7rC_pYg/UserTweetsAndReplies";
export const GRAPH_USER_MEDIA = "VyudDWQnr9vJNw7GasFz2g/UserMedia";
export const GRAPH_USER_MEDIA_V2 = "WK111rbR0vM0ZX4lyZCYjw/MediaTimelineV2";
export const GRAPH_USER_ARTICLES = "ZmMjUyrTpwYfTGAdylEyMw/UserArticlesTweets";
export const GRAPH_USER_ARTICLES_V2 = "PsGixN38UZz2RheyayNB5Q/UserProfileArticlesTimelineQuery";
export const GRAPH_TWEET = "OZMbEnEa96AN8Pq6HyTWdw/ConversationTimeline";
export const GRAPH_TWEET_DETAIL = "XMOz5h24KAZ86qKffKTLdQ/TweetDetail";
export const GRAPH_TWEET_RESULT = "xYOrBQoTlfKJJPsX76MZEw/TweetResultByIdQuery";
export const GRAPH_TWEET_EDIT_HISTORY = "1izbuOcH_QpuMcyCxOXkAg/TweetEditHistory";
export const GRAPH_SEARCH_TIMELINE = "hyPfJYJ_XAtDYoslQc-Rgg/SearchTimeline";
export const GRAPH_LIST_BY_ID = "niz0TtOxL2zIcbq6_NQiNw/ListByRestId";
export const GRAPH_LIST_BY_SLUG = "RqkWNDQpOntlxNtJa4RIoQ/ListBySlug";
export const GRAPH_LIST_MEMBERS = "8rYmkvWQe9jRRZdy_-vkGA/ListMembers";
export const GRAPH_LIST_TWEETS = "0QJtcuMzVywHGAWD6Dtjlw/ListTimeline";
export const GRAPH_ABOUT_ACCOUNT = "TzOG2twZEfhr9KmClvVVqA/AboutAccountQuery";
export const GRAPH_COMMUNITY = "-ElI1vg3dYbttVMhBhGdLw/CommunityQuery";
export const GRAPH_COMMUNITY_TWEETS = "EwftYyqQemkckQ0wzGM6uw/CommunityTweetsTimeline";
export const GRAPH_COMMUNITY_MEDIA = "ESJtwnI_apuGesbJncpc0Q/CommunityMediaTimeline";
export const GRAPH_COMMUNITY_MEMBERS = "woAp_YdzAdqnWDrqLTNpAw/membersSliceTimeline_Query";
export const GRAPH_COMMUNITY_MODERATORS = "0oYT9GRiWUhrz5xoqFE9uw/moderatorsSliceTimeline_Query";
export const GRAPH_COMMUNITY_HASHTAGS = "D5EqomOIWeJnSkMhL-FLew/CommunityHashtagsTimeline";
export const GRAPH_TWEET_RESULT_BY_REST_ID = "GZsN2Pc4knAoit6pXa4HSA/TweetResultByRestId";
export const GRAPH_TWEET_RESULTS_BY_REST_IDS = "Pho4sg8jLcrVlMeclMayrg/TweetResultsByRestIds";
export const GRAPH_BROADCAST = "RG6wSogandh6WPIzxW9aag/BroadcastQuery";
export const GRAPH_AUDIO_SPACE = "Bh0L6azTQoMs9rJKeCF4wQ/AudioSpaceById";
export const GRAPH_FOLLOWERS = "JNyQdTISpzCkj_1fqxDvFg/Followers";
export const GRAPH_FOLLOWING = "qGZZDF3mp91q7X22s3HxpA/Following";
export const REST_LIVE_STREAM = "1.1/live_video_stream/status/";

function stripWs(value: string): string {
  return value.replaceAll(" ", "").replaceAll("\n", "");
}

export const GQL_FEATURES = stripWs(`{
  "rweb_video_screen_enabled": false,
  "rweb_cashtags_enabled": true,
  "profile_label_improvements_pcf_label_in_post_enabled": true,
  "responsive_web_profile_redirect_enabled": false,
  "rweb_tipjar_consumption_enabled": false,
  "verified_phone_label_enabled": false,
  "creator_subscriptions_tweet_preview_api_enabled": true,
  "responsive_web_graphql_timeline_navigation_enabled": true,
  "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
  "premium_content_api_read_enabled": false,
  "communities_web_enable_tweet_community_results_fetch": true,
  "c9s_tweet_anatomy_moderator_badge_enabled": true,
  "c9s_list_members_action_api_enabled": false,
  "c9s_superc9s_indication_enabled": false,
  "responsive_web_grok_analyze_button_fetch_trends_enabled": false,
  "responsive_web_grok_analyze_post_followups_enabled": true,
  "rweb_cashtags_composer_attachment_enabled": true,
  "responsive_web_jetfuel_frame": true,
  "responsive_web_grok_share_attachment_enabled": true,
  "responsive_web_grok_annotations_enabled": true,
  "articles_preview_enabled": true,
  "responsive_web_edit_tweet_api_enabled": true,
  "rweb_conversational_replies_downvote_enabled": false,
  "graphql_is_translatable_rweb_tweet_is_translatable_enabled": true,
  "view_counts_everywhere_api_enabled": true,
  "longform_notetweets_consumption_enabled": true,
  "responsive_web_twitter_article_tweet_consumption_enabled": true,
  "content_disclosure_indicator_enabled": true,
  "content_disclosure_ai_generated_indicator_enabled": true,
  "responsive_web_grok_show_grok_translated_post": true,
  "responsive_web_grok_analysis_button_from_backend": true,
  "post_ctas_fetch_enabled": true,
  "freedom_of_speech_not_reach_fetch_enabled": true,
  "standardized_nudges_misinfo": true,
  "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": true,
  "longform_notetweets_rich_text_read_enabled": true,
  "longform_notetweets_inline_media_enabled": false,
  "responsive_web_grok_image_annotation_enabled": true,
  "responsive_web_grok_imagine_annotation_enabled": true,
  "responsive_web_grok_community_note_auto_translation_is_enabled": true,
  "responsive_web_enhance_cards_enabled": false
}`);

export const TWEET_VARS = stripWs(`{
  "postId": "$1",
  $2
  "ranking_mode": "$3",
  "includeHasBirdwatchNotes": false,
  "includePromotedContent": false,
  "withBirdwatchNotes": true,
  "withVoice": false,
  "withV2Timeline": true
}`);

export const TWEET_DETAIL_VARS = stripWs(`{
  "focalTweetId": "$1",
  $2
  "referrer": "profile",
  "with_rux_injections": false,
  "rankingMode": "Relevance",
  "includePromotedContent": true,
  "withCommunity": true,
  "withQuickPromoteEligibilityTweetFields": true,
  "withBirdwatchNotes": true,
  "withVoice": true
}`);

export const TWEET_EDIT_HISTORY_VARS = stripWs(`{
  "tweetId": "$1",
  "withQuickPromoteEligibilityTweetFields": true
}`);

export const REST_ID_VARS = stripWs(`{
  "rest_id": "$1", $2
  "count": $3
}`);

export const USER_MEDIA_VARS = stripWs(`{
  "userId": "$1", $2
  "count": $3,
  "includePromotedContent": false,
  "withClientEventToken": false,
  "withBirdwatchNotes": false,
  "withVoice": true
}`);

export const USER_TWEETS_VARS = stripWs(`{
  "userId": "$1", $2
  "count": 20,
  "includePromotedContent": false,
  "withQuickPromoteEligibilityTweetFields": true,
  "withVoice": true
}`);

export const USER_TWEETS_AND_REPLIES_VARS = stripWs(`{
  "userId": "$1", $2
  "count": 20,
  "includePromotedContent": false,
  "withCommunity": true,
  "withVoice": true
}`);

export const USER_ARTICLES_VARS = stripWs(`{
  "userId": "$1", $2
  "count": 20,
  "includePromotedContent": false,
  "withVoice": true
}`);

export const ARTICLE_VARS = stripWs(`{
  "tweetId": "$1",
  "includePromotedContent": false,
  "withBirdwatchNotes": true,
  "withVoice": true,
  "withCommunity": true
}`);

export const ARTICLE_BATCH_VARS = stripWs(`{
  "tweetIds": $1,
  "includePromotedContent": false,
  "withBirdwatchNotes": true,
  "withVoice": true,
  "withCommunity": true
}`);

export const ARTICLE_FIELD_TOGGLES = `{"withArticleRichContentState":true,"withArticlePlainText":false,"withArticleSummaryText":true,"withArticleVoiceOver":true}`;

export const TWEET_BY_REST_ID_VARS = stripWs(`{
  "tweetId": "$1",
  "includePromotedContent": false,
  "withBirdwatchNotes": false,
  "withVoice": false,
  "withCommunity": false
}`);

export const USER_BY_REST_ID_VARS = stripWs(`{
  "userId": "$1",
  "withSafetyModeUserFields": true
}`);

export const COMMUNITY_TWEETS_VARS = stripWs(`{
  "communityId": "$1", $2
  "count": 20,
  "displayLocation": "Community",
  "rankingMode": "$3",
  "withCommunity": true
}`);

export const COMMUNITY_MEDIA_VARS = stripWs(`{
  "communityId": "$1", $2
  "count": 20,
  "withCommunity": true
}`);

export const COMMUNITY_MEMBERS_VARS = stripWs(`{
  "communityId": "$1",
  "cursor": $2
}`);

export const COMMUNITY_HASHTAGS_VARS = stripWs(`{
  "communityId": "$1", $2
  "count": 20,
  "hashtags": ["$3"],
  "withCommunity": true
}`);

export const USER_TWEETS_FIELD_TOGGLES = `{"withArticleRichContentState":true,"withArticlePlainText":false}`;

export const TWEET_DETAIL_FIELD_TOGGLES = `{"withArticleRichContentState":true,"withArticlePlainText":false,"withGrokAnalyze":false,"withDisallowedReplyControls":false}`;
