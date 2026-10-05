# Golden generator for packages/twitter-api tests/fixtures/oauth1_golden.json.
#
# Provenance: uses nitter's real OAuth1 dependency (nimble `oauth == 0.11`,
# CORDEA/oauth, src/oauth1.nim) via the nimble pkgcache, so the Authorization
# header vectors are produced by the original code, not a re-implementation.
# The wrapping `getOauthHeader` is a verbatim copy of the private proc in
# nitter's `apiutils.nim` (not exported there, so it cannot be imported), with
# a pinned timestamp injected — the only change. `sha1` resolves to
# onionhammer/sha1 (raw 20-byte digest), which is what nitter builds against.
#
# Regenerate (writes oauth1_golden.json next to this file, CWD-independent):
#   nim r --hints:off -d:ssl \
#     --path:"$HOME/.nimble/pkgcache/githubcom_CORDEAoauth_#b8c163b/src" \
#     --path:"$HOME/.nimble/pkgcache/githubcom_onionhammersha1" \
#     generate_oauth_golden.nim
#
# CI never runs this: fixtures are committed (plan §6, "fixtures, not live
# calls").

import std/[httpclient, json, os, strutils]
import oauth1

const
  consumerKey = "3nVuSoBZnx6U4vzUxf5w"
  consumerSecret = "Bcs59EFbbsdF6Sl9Ng71smgStWEGwXXKSjYvPVt7qys"

# Verbatim copy of apiutils.nim's getOauthHeader, minus the live clock: the
# timestamp is a parameter so the output is deterministic.
proc getOauthHeader(url, oauthToken, oauthTokenSecret, timestamp: string): string =
  let
    encodedUrl = url.replace(",", "%2C").replace("+", "%20")
    params = OAuth1Parameters(
      consumerKey: consumerKey,
      signatureMethod: "HMAC-SHA1",
      timestamp: timestamp,
      nonce: "0",
      isIncludeVersionToHeader: true,
      token: oauthToken
    )
    signature = getSignature(HttpGet, encodedUrl, "", params, consumerSecret, oauthTokenSecret)

  params.signature = percentEncode(signature)

  return getOauth1RequestHeader(params)["authorization"]

let cases = %*[
  %*{
    "label": "cookie graphql simple",
    "url": "https://x.com/i/api/graphql/Gb-d6r0vxPOADdG62OEBpQ/UserByScreenName?variables=%7B%22screen_name%22%3A%22nasa%22%7D&features=abc",
    "token": "oauth-token-1",
    "tokenSecret": "oauth-secret-1",
    "timestamp": "1700000000",
    "header": ""
  },
  %*{
    "label": "oauth graphql with commas and spaces",
    "url": "https://api.x.com/graphql/LE3eTyeqhBh2g-fX85O2eQ/UserWithProfileTweetsQueryV2?variables=%7B%22rest_id%22%3A%2212345%22%2C+%22count%22%3A20%7D&features=abc",
    "token": "oauth-token-2",
    "tokenSecret": "oauth-secret-2",
    "timestamp": "1712345678",
    "header": ""
  },
  %*{
    "label": "empty query params",
    "url": "https://api.x.com/1.1/help/configuration.json",
    "token": "",
    "tokenSecret": "",
    "timestamp": "1600000000",
    "header": ""
  }
]

for i in 0 ..< cases.len:
  let c = cases[i]
  c["header"] = %getOauthHeader(c["url"].getStr, c["token"].getStr,
                                c["tokenSecret"].getStr, c["timestamp"].getStr)

let dest = currentSourcePath().parentDir / "oauth1_golden.json"
dest.writeFile($cases & "\n")
echo "wrote ", dest
