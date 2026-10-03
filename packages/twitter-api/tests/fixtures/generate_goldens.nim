# Golden-fixture generator for packages/twitter-api.
#
# Provenance: imports nitter's real `consts.nim`, `query.nim`, and `types.nim`
# (nitter @ 376f149), so query/initQuery/consts fixtures are produced by the
# original code, not by a re-implementation. encodeUrl/encodeQuery come from
# Nim's std/uri. The ApiReq builders and `toUrl` are verbatim copies of the
# *private* procs in nitter's `api.nim`/`apiutils.nim` (not exported there, so
# they cannot be imported) — keep them in sync when bumping the nitter ref.
#
# Requirements: Nim 2.x + `nimble install nimcrypto` (pulled in transitively by
# query.nim -> utils.nim).
#
# Regenerate (writes golden.json next to this file, CWD-independent):
#   nim r --hints:off --path:/path/to/nitter/src generate_goldens.nim
#
# CI never runs this: fixtures are committed (plan §6, "fixtures, not live
# calls").

import std/[json, os, strutils, tables, uri]
import query, types, consts

# ---------------------------------------------------------------------------
# Verbatim copies from apiutils.nim (toUrl) and api.nim (builders)
# ---------------------------------------------------------------------------

proc toUrl(req: ApiReq; sessionKind: SessionKind): Uri =
  let url = case sessionKind
    of oauth:  req.oauth
    of cookie: req.cookie
  let base = case sessionKind
    of oauth:  "https://api.x.com"
    of cookie: "https://x.com/i/api"
  let prefix = if url.endpoint.startsWith("1.1/"): "" else: "graphql/"
  parseUri(base) / (prefix & url.endpoint) ? url.params

proc genParams(variables: string; fieldToggles = ""): seq[(string, string)] =
  result.add ("variables", variables)
  result.add ("features", gqlFeatures)
  if fieldToggles.len > 0:
    result.add ("fieldToggles", fieldToggles)

proc apiUrl(endpoint, variables: string; fieldToggles = ""; skipTid = false): ApiUrl =
  return ApiUrl(endpoint: endpoint, params: genParams(variables, fieldToggles), skipTid: skipTid)

proc apiReq(endpoint, variables: string; fieldToggles = ""; skipTid = false): ApiReq =
  let url = apiUrl(endpoint, variables, fieldToggles, skipTid)
  return ApiReq(cookie: url, oauth: url)

proc cursorParam(after: string): string =
  if after.len > 0: "\"cursor\":" & $(%after) & "," else: ""

proc restReq(endpoint: string; params: seq[(string, string)] = @[]): ApiReq =
  let url = ApiUrl(endpoint: endpoint, params: params)
  ApiReq(cookie: url, oauth: url)

proc mediaUrl(id, cursor: string): ApiReq =
  result = ApiReq(
    cookie: apiUrl(graphUserMedia, userMediaVars % [id, cursor, "100"]),
    oauth: apiUrl(graphUserMediaV2, restIdVars % [id, cursor, "100"])
  )

proc userTweetsUrl(id: string; cursor: string): ApiReq =
  return apiReq(graphUserTweetsV2, restIdVars % [id, cursor, "20"], userTweetsFieldToggles)

proc userTweetsAndRepliesUrl(id: string; cursor: string): ApiReq =
  result = ApiReq(
    cookie: apiUrl(graphUserTweetsAndReplies, userTweetsAndRepliesVars % [id, cursor], userTweetsFieldToggles),
    oauth: apiUrl(graphUserTweetsAndRepliesV2, restIdVars % [id, cursor, "20"], userTweetsFieldToggles, skipTid=true)
  )

proc userArticlesUrl(id: string; cursor: string): ApiReq =
  result = ApiReq(
    cookie: apiUrl(graphUserArticles, userArticlesVars % [id, cursor], userTweetsFieldToggles),
    oauth: apiUrl(graphUserArticlesV2, restIdVars % [id, cursor, "20"], userTweetsFieldToggles)
  )

proc tweetDetailUrl(id, cursor: string; mode = Relevance): ApiReq =
  return apiReq(graphTweet, tweetVars % [id, cursor, $mode])

proc userUrl(username: string): ApiReq =
  let cookieVars = $(%*{"screen_name": username, "withGrokTranslatedBio": false})
  result = ApiReq(
    cookie: apiUrl(graphUser, cookieVars, tweetDetailFieldToggles),
    oauth: apiUrl(graphUserV2, $(%*{"screen_name": username}))
  )

proc communitySliceReq(endpoint, variables: string): ApiReq =
  let url = ApiUrl(endpoint: endpoint, params: @[("variables", variables)])
  ApiReq(cookie: url, oauth: url)

# ---------------------------------------------------------------------------
# Emission helpers
# ---------------------------------------------------------------------------

proc sa(s: seq[string]): JsonNode =
  result = newJArray()
  for e in s: result.add %e

proc qToJson(q: Query): JsonNode =
  %*{
    "kind": $q.kind,
    "view": q.view,
    "text": q.text,
    "filters": sa(q.filters),
    "includes": sa(q.includes),
    "excludes": sa(q.excludes),
    "fromUser": sa(q.fromUser),
    "since": q.since,
    "until": q.until,
    "minLikes": q.minLikes,
    "sep": q.sep
  }

var
  constants = newJObject()
  encodeUrlCases = newJArray()
  encodeQueryCases = newJArray()
  substCases = newJArray()
  urlCases = newJArray()
  queryCases = newJArray()
  initCases = newJArray()

# ---------------------------------------------------------------------------
# constants: every exported const in src/endpoints.ts, keyed by TS export name
# ---------------------------------------------------------------------------

constants["CONSUMER_KEY"] = %consumerKey
constants["CONSUMER_SECRET"] = %consumerSecret
constants["BEARER_TOKEN"] = %bearerToken
constants["BEARER_TOKEN_2"] = %bearerToken2
constants["GRAPH_USER"] = %graphUser
constants["GRAPH_USER_V2"] = %graphUserV2
constants["GRAPH_USER_BY_ID"] = %graphUserById
constants["GRAPH_USER_TWEETS_V2"] = %graphUserTweetsV2
constants["GRAPH_USER_TWEETS_AND_REPLIES_V2"] = %graphUserTweetsAndRepliesV2
constants["GRAPH_USER_TWEETS"] = %graphUserTweets
constants["GRAPH_USER_TWEETS_AND_REPLIES"] = %graphUserTweetsAndReplies
constants["GRAPH_USER_MEDIA"] = %graphUserMedia
constants["GRAPH_USER_MEDIA_V2"] = %graphUserMediaV2
constants["GRAPH_USER_ARTICLES"] = %graphUserArticles
constants["GRAPH_USER_ARTICLES_V2"] = %graphUserArticlesV2
constants["GRAPH_TWEET"] = %graphTweet
constants["GRAPH_TWEET_DETAIL"] = %graphTweetDetail
constants["GRAPH_TWEET_RESULT"] = %graphTweetResult
constants["GRAPH_TWEET_EDIT_HISTORY"] = %graphTweetEditHistory
constants["GRAPH_SEARCH_TIMELINE"] = %graphSearchTimeline
constants["GRAPH_LIST_BY_ID"] = %graphListById
constants["GRAPH_LIST_BY_SLUG"] = %graphListBySlug
constants["GRAPH_LIST_MEMBERS"] = %graphListMembers
constants["GRAPH_LIST_TWEETS"] = %graphListTweets
constants["GRAPH_ABOUT_ACCOUNT"] = %graphAboutAccount
constants["GRAPH_COMMUNITY"] = %graphCommunity
constants["GRAPH_COMMUNITY_TWEETS"] = %graphCommunityTweets
constants["GRAPH_COMMUNITY_MEDIA"] = %graphCommunityMedia
constants["GRAPH_COMMUNITY_MEMBERS"] = %graphCommunityMembers
constants["GRAPH_COMMUNITY_MODERATORS"] = %graphCommunityModerators
constants["GRAPH_COMMUNITY_HASHTAGS"] = %graphCommunityHashtags
constants["GRAPH_TWEET_RESULT_BY_REST_ID"] = %graphTweetResultByRestId
constants["GRAPH_TWEET_RESULTS_BY_REST_IDS"] = %graphTweetResultsByRestIds
constants["GRAPH_BROADCAST"] = %graphBroadcast
constants["GRAPH_AUDIO_SPACE"] = %graphAudioSpace
constants["GRAPH_FOLLOWERS"] = %graphFollowers
constants["GRAPH_FOLLOWING"] = %graphFollowing
constants["REST_LIVE_STREAM"] = %restLiveStream
constants["GQL_FEATURES"] = %gqlFeatures
constants["TWEET_VARS"] = %tweetVars
constants["TWEET_DETAIL_VARS"] = %tweetDetailVars
constants["TWEET_EDIT_HISTORY_VARS"] = %tweetEditHistoryVars
constants["REST_ID_VARS"] = %restIdVars
constants["USER_MEDIA_VARS"] = %userMediaVars
constants["USER_TWEETS_VARS"] = %userTweetsVars
constants["USER_TWEETS_AND_REPLIES_VARS"] = %userTweetsAndRepliesVars
constants["USER_ARTICLES_VARS"] = %userArticlesVars
constants["ARTICLE_VARS"] = %articleVars
constants["ARTICLE_BATCH_VARS"] = %articleBatchVars
constants["TWEET_BY_REST_ID_VARS"] = %tweetByRestIdVars
constants["USER_BY_REST_ID_VARS"] = %userByRestIdVars
constants["COMMUNITY_TWEETS_VARS"] = %communityTweetsVars
constants["COMMUNITY_MEDIA_VARS"] = %communityMediaVars
constants["COMMUNITY_MEMBERS_VARS"] = %communityMembersVars
constants["COMMUNITY_HASHTAGS_VARS"] = %communityHashtagsVars
constants["ARTICLE_FIELD_TOGGLES"] = %articleFieldToggles
constants["USER_TWEETS_FIELD_TOGGLES"] = %userTweetsFieldToggles
constants["TWEET_DETAIL_FIELD_TOGGLES"] = %tweetDetailFieldToggles
constants["EMPTY_QUERY"] = %emptyQuery

# ---------------------------------------------------------------------------
# encodeUrl / encodeQuery (std/uri)
# ---------------------------------------------------------------------------

for input in ["", "plain", "a b", "a+b", "a&b=c", "héllo wörld", "\"quoted\"", "~/-._", "%20", "100%", "$1", "a\nb"]:
  for usePlus in [true, false]:
    encodeUrlCases.add %*{"input": input, "usePlus": usePlus, "output": encodeUrl(input, usePlus)}

proc addEncodeQuery(params: seq[(string, string)]; usePlus, omitEq: bool; sep: char) =
  var arr = newJArray()
  for (k, v) in params: arr.add %[%k, %v]
  encodeQueryCases.add %*{
    "params": arr, "usePlus": usePlus, "omitEq": omitEq, "sep": $sep,
    "output": encodeQuery(params, usePlus, omitEq, sep)
  }

addEncodeQuery(@[("variables", "{\"a\":1}"), ("features", "{")], true, true, '&')
addEncodeQuery(@[("rawQuery", "nasa from:alice"), ("empty", ""), ("arr", "a+b")], true, true, '&')
addEncodeQuery(@[("k", "a b")], false, false, '&')
addEncodeQuery(@[("k", "a b"), ("j", "c d")], true, true, ';')
addEncodeQuery(newSeq[(string, string)](), true, true, '&')

# ---------------------------------------------------------------------------
# subst (strutils `%`) edge cases — pinned to real stdlib behavior
# ---------------------------------------------------------------------------

proc addSubst(label, tmpl: string; args: seq[string]) =
  try:
    substCases.add %*{"label": label, "template": tmpl, "args": sa(args), "output": tmpl % args}
  except CatchableError as e:
    substCases.add %*{"label": label, "template": tmpl, "args": sa(args), "error": e.msg}

addSubst("single", "$1-$2-$3", @["a", "b", "c"])
addSubst("reuse arg", "$1 again $1", @["x"])
addSubst("empty arg", "[$1]", @[""])
addSubst("dollar escape", "price: $$ and $1", @["v"])
addSubst("value not rescanned", "{$1}", @["$2"])
addSubst("stray dollar", "keep $foo bar", @["x"])
addSubst("trailing dollar", "abc$", @["x"])
addSubst("missing arg", "$1 $2", @["only"])
addSubst("zero index", "$0", @["x"])
addSubst("out of range", "$12", @["x"])

# ---------------------------------------------------------------------------
# urls: every ApiReq builder x both session kinds
# ---------------------------------------------------------------------------

proc addUrl(label: string, req: ApiReq) =
  urlCases.add %*{
    "label": label,
    "cookie": $toUrl(req, SessionKind.cookie),
    "oauth": $toUrl(req, SessionKind.oauth)
  }

addUrl("userUrl simple", userUrl("nasa"))
addUrl("userUrl underscore", userUrl("foo_bar"))
addUrl("userUrl json chars", userUrl("a\"b\\c"))
addUrl("mediaUrl no cursor", mediaUrl("12345", ""))
addUrl("mediaUrl cursor", mediaUrl("12345", cursorParam("scroll:abc")))
addUrl("mediaUrl cursor json chars", mediaUrl("12345", cursorParam("cur:\"x\"\\y")))
addUrl("userTweetsUrl no cursor", userTweetsUrl("12345", ""))
addUrl("userTweetsUrl cursor", userTweetsUrl("12345", cursorParam("scroll:abc")))
addUrl("userTweetsAndRepliesUrl no cursor", userTweetsAndRepliesUrl("12345", ""))
addUrl("userTweetsAndRepliesUrl cursor", userTweetsAndRepliesUrl("12345", cursorParam("scroll:abc")))
addUrl("userArticlesUrl no cursor", userArticlesUrl("12345", ""))
addUrl("userArticlesUrl cursor", userArticlesUrl("12345", cursorParam("scroll:abc")))
addUrl("tweetDetailUrl default", tweetDetailUrl("12345", ""))
addUrl("tweetDetailUrl recency cursor", tweetDetailUrl("12345", cursorParam("scroll:abc"), Recency))
addUrl("tweetDetailUrl likes", tweetDetailUrl("12345", "", Likes))
addUrl("restReq no params", restReq(restLiveStream & "abc123"))
addUrl("restReq with params", restReq("1.1/foo.json", @[("a", "b c")]))
addUrl("apiReq search variables", apiReq(graphSearchTimeline, "{\"rawQuery\":\"nasa from:alice\",\"count\":20}"))
addUrl("communitySliceReq", communitySliceReq(graphCommunityMembers, communityMembersVars % ["777", "null"]))

# ---------------------------------------------------------------------------
# query / initQuery (real query.nim)
# ---------------------------------------------------------------------------

proc addQuery(label: string; q: Query; maxId = "") =
  queryCases.add %*{
    "label": label, "query": qToJson(q), "maxId": maxId,
    "param": genQueryParam(q, maxId), "url": genQueryUrl(q)
  }

addQuery("empty tweets", Query(kind: tweets))
addQuery("text only", Query(kind: tweets, text: "nasa"))
addQuery("users passthrough", Query(kind: users, text: "nasa"))
addQuery("fromUser single", Query(kind: tweets, fromUser: @["alice"]))
addQuery("fromUser multi posts", Query(kind: posts, fromUser: @["alice", "bob"]))
addQuery("fromUser media", Query(kind: QueryKind.media, fromUser: @["alice"]))
addQuery("filters sep AND", Query(kind: tweets, filters: @["media", "links"], sep: "AND"))
addQuery("filters default sep double space", Query(kind: tweets, filters: @["images", "videos"], excludes: @["replies"]))
addQuery("excludes nativeretweets", Query(kind: tweets, excludes: @["nativeretweets", "replies"]))
addQuery("since until", Query(kind: tweets, since: "2024-01-01", until: "2024-02-01"))
addQuery("since until maxId drops until", Query(kind: tweets, since: "2024-01-01", until: "2024-02-01"), "123")
addQuery("minLikes", Query(kind: tweets, minLikes: "5"))
addQuery("minLikes maxId", Query(kind: tweets, minLikes: "7"), "999")
addQuery("full combo", Query(kind: tweets, text: "hello world", fromUser: @["alice"],
  filters: @["images"], excludes: @["replies"], since: "2024-01-01", minLikes: "10", sep: "OR"))
addQuery("kind posts no fromUser", Query(kind: posts, text: "hi"))
addQuery("kind media profile tab", Query(kind: QueryKind.media, text: "x"))
addQuery("kind top", Query(kind: top, text: "x"))
addQuery("kind lists", Query(kind: lists, text: "x"))
addQuery("includes nativeretweets explicit", Query(kind: tweets, includes: @["nativeretweets"]))
addQuery("includes spaces", Query(kind: tweets, includes: @["spaces"]))
addQuery("fromUser replies kind", Query(kind: replies, fromUser: @["alice"]))
addQuery("fromUser userList kind", Query(kind: userList, fromUser: @["alice"], text: "z"))
addQuery("text with quotes", Query(kind: tweets, text: "say \"hi\" & bye"))
addQuery("view only outside kind block", Query(kind: replies, view: "grid"))
addQuery("emptyQuery equal excludes", Query(kind: tweets, excludes: @["nativeretweets", "retweets", "replies"]))
addQuery("getMediaQuery", getMediaQuery("alice"))
addQuery("getArticlesQuery", getArticlesQuery("alice"))
addQuery("getReplyQuery", getReplyQuery("alice"))

proc addInit(label: string; pairs: openArray[(string, string)]; name = "") =
  var
    tbl = initTable[string, string]()
    pj = newJObject()
  for (k, v) in pairs:
    tbl[k] = v
    pj[k] = %v
  let q = initQuery(tbl, name)
  initCases.add %*{
    "label": label, "params": pj, "name": name, "query": qToJson(q),
    "param": genQueryParam(q), "url": genQueryUrl(q)
  }

addInit("f tweets q nasa", {"f": "tweets", "q": "nasa"})
addInit("f garbage falls back", {"f": "garbage", "q": "x"})
addInit("f live falls back", {"f": "live", "q": "nasa"})
addInit("f Media first char case", {"f": "Media"})
addInit("f mEDIA style insensitive", {"f": "mEDIA"})
addInit("f USERLIST first char case", {"f": "USERLIST"})
addInit("f user_list underscore", {"f": "user_list"})
addInit("f articles coerced to tweets", {"f": "articles"})
addInit("missing f defaults tweets", {"q": "x"})
addInit("filters presence not value", {"f": "media", "q": "x", "f-images": "off", "e-videos": "on", "since": "2024-01-01", "min_faves": "3"})
addInit("min_faves garbage", {"min_faves": "abc"})
addInit("min_faves empty", {"min_faves": ""})
addInit("fromUser name csv", {"f": "tweets"}, "alice,bob")
addInit("empty name", {"f": "tweets"}, "")
addInit("view param", {"f": "top", "q": "x", "view": "videos"})
addInit("until and q", {"f": "tweets", "q": "hello world", "until": "2024-02-01"})

# ---------------------------------------------------------------------------
# write golden.json next to this file
# ---------------------------------------------------------------------------

let root = %*{
  "meta": %*{"nitterCommit": "376f149", "generator": "generate_goldens.nim"},
  "constants": constants,
  "encodeUrl": encodeUrlCases,
  "encodeQuery": encodeQueryCases,
  "subst": substCases,
  "urls": urlCases,
  "query": queryCases,
  "initQuery": initCases
}

let outPath = parentDir(currentSourcePath) / "golden.json"
writeFile(outPath, pretty(root) & "\n")
echo "wrote ", outPath

