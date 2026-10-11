# AGENTS.md

Guidance for coding agents (and humans) working in this repository.

## What this is

tseer is a greenfield TypeScript port of
[nitter](https://github.com/zedeus/nitter) with an everything-is-a-plugin
architecture on [cordis](https://www.npmjs.com/package/cordis). The authoritative
spec is [docs/TS_PORT_PLAN.md](docs/TS_PORT_PLAN.md) — read it (especially §0 ground
rules, §1 seam map, and the phase you are implementing) before making architectural
decisions. This file records what the plan cannot: repo conventions and
plan-vs-reality deltas discovered during implementation.

## Phase status

- [x] Phase 0 — scaffold: pnpm workspace, tsconfig, biome, vitest, CI, hello-cordis app
- [x] Phase 1 — `kernel/createApp(config)`, config service (zod + nitter.conf ini), `types`, `logger`, `tseer web` serving `/about`
- [x] Phase 2 — platform seams: `http-client`, `cache`, `twitter-sessions`, `server`, `media`
      — **done**; all five have landed.
- [x] Phase 3 — `twitter-api` + `twitter-parser` with golden fixtures
      — **done**; `twitter-api` (endpoints, request builders, URL builders,
      search-query compiler, golden fixtures from nitter @ 376f149, fetch layer,
      `ctx.twitter` flipped to plan §3 domain types, `getCached*` wrappers) and
      `twitter-parser` (full parser port + `ctx.parsers` registry, wired into
      `apps/tseer`) have landed. `tseer debug user/<name>` prints parsed user
      JSON (needs a sessions store; live smoke test still pending a real
      session — plan §6's optional job).
- [ ] Phase 4 — `views`, `prefs`, `ctx.render`, core route plugins
  - [x] `prefs` seam (`ctx.prefs`)
  - [x] `views` package (`ctx.render` + formatters; view components land with
        their route plugins)
  - [x] styles/static (`sass/**` + `public/**` port, §3 map) — see
        "styles/static notes" below
  - [x] `status` route plugin (`/:name/status/:id`, `/history`, legacy
        redirects) + `views/status.tsx` (`renderConversation`,
        `renderReplies`, `renderEditHistory`) — wired into `apps/tseer`
  - [x] `search` route plugin (`/search`, `/hashtag/:hash`, `/opensearch`) +
        `views/search.tsx` (`renderUserSearch`, `renderListSearch`,
        `renderSearchForm`) + `views/timeline.tsx` (`renderListCard`,
        `renderTimelineLists`) — wired into `apps/tseer`
  - [x] `rss` route plugin (`/search/rss`, `/:name/rss`, `/:name/:tab/rss`,
        `/:name/lists/:slug/rss`, `/i/lists/:id/rss`) + `views/rss.ts`
        (`renderTimelineRss`, `renderListRss`, `renderSearchRss`) +
        `cachedRss` on `ctx.twitter` — wired into `apps/tseer`
- [ ] Phase 5 — long-tail route plugins
  - [x] `web-routes` package + timeline route plugin (profile/followers/following/about, `/:name/:tab?`, `intent/*`, `i/user`) — first `prefs`+`render`+`twitter` consumer, inject-based fastify tests
  - [x] `preferences` route plugin (`/settings`, `/settings/:i`, `/saveprefs`,
        `/resetprefs`, `/enablehls`, `/enablemp4`, the `?prefs=` hook) +
        `views/preferences.tsx` (`renderPreferences`) + `prefs` `update.ts`
        (`genUpdatePrefs`/`genResetPrefs`/`genApplyPrefs` ports) — no `twitter`
        seam; wired into `apps/tseer`
  - [x] `resolver` route plugin (`/cards/:card/:id`, `/t.co/:url`) — the
        `api.nim` `resolve` port via `twitter.resolve` + `replaceUrls` rewrite;
        wired into `apps/tseer`
  - [x] `unsupported` route plugin (`/about/feature`, `/login`, `/:name/lists`,
        `/intent*`, `/i*`) + `views/feature.tsx` (`renderFeature`) — static
        panel, no `twitter` seam; wired into `apps/tseer`
  - [x] `space` route plugin (`/i/spaces/:id`, `/i/spaces/:id/stream`) +
        `views/space.tsx` (`renderSpace`, `renderParticipant`) — manifest
        fetch via `@tseer/media` `safeFetchText`; wired into `apps/tseer`
  - [x] `broadcast` route plugin (`/i/broadcasts/:id`, `/i/broadcasts/:id/stream`)
        + `views/broadcast.tsx` (`renderBroadcast`) — manifest fetch via
        `@tseer/media` `safeFetchText`; wired into `apps/tseer`
- [ ] Phase 6 — `profile-web` composition + out-of-tree example plugin

Update this checklist as phases land.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm install` | install workspace dependencies |
| `pnpm build` | build all workspace packages (tsdown) |
| `pnpm test` | run the vitest suite (root config, `*/tests/**/*.spec.ts`) |
| `pnpm typecheck` | `tsc --noEmit` for the root config + every package |
| `pnpm lint` / `pnpm lint:fix` | biome check (lint + format + import sort), `--write` to fix |
| `pnpm start` | run the built `apps/tseer` entry (`dist/cli.js`) |

## Conventions

- **Runtime/toolchain:** Node.js 26+, ESM-only (`"type": "module"`), TypeScript
  strict (see `tsconfig.base.json`), pnpm workspaces. Relative imports carry the
  `.ts` extension (rewritten at emit; matches deepseek-harness style).
- **License:** AGPL-3.0-only in every `package.json` and the README. **Do not add a
  LICENSE file** (plan §0) — the plan says to state the license, not write it.
- **Commits:** atomic, conventional prefixes (`chore:`, `feat:`, `fix:`, `docs:`,
  `ci:`, `test:`), one logical change per commit. Committing per plan phase is the
  minimum granularity.
- **Import boundaries are seams:** a package may consume another package's public
  entry only — never reach into its `src/` internals (plan §1).
- **Behavior lives in plugins:** app features are plugins mounted with
  `ctx.plugin(...)`; `apps/tseer` is only the composition root (the plugin list
  comes from config in Phase 1).
- **Tests:** vitest, one `tests/` directory per package, fixtures over live network
  calls — CI never talks to X (plan §6).
- **No speculative abstractions:** features explicitly deferred by plan §8
  (profiles/YAML patching, HMR, themes, i18n) must not be scaffolded early.

## Cordis notes (plan §0 snippet vs the published `cordis@4.0.0-rc.10`)

The plan's "Cordis in 30 seconds" sketch is directionally right, but the published
package differs in a few load-bearing ways. Verified against the actual types and
runtime:

- **There is no `define()` export.** Plugins are plain functions and get mounted
  with `ctx.plugin(fn, config?)`:

  ```ts
  import type { Context } from 'cordis'

  export default function hello(ctx: Context, options: HelloOptions = {}) {
    // ...
    return () => { /* returned function = disposer, runs on unload */ }
  }
  ```

- The reflection API from the plan exists as written: `ctx.set/get/provide`,
  `ctx.inject(deps, callback)`, `ctx.on(event, listener)`, `ctx.registry.has(fn)`.
  Typed services/events are added by augmenting cordis's `Context` / `Events`
  interfaces from the owning package.
- `ctx.logger` **already exists in cordis core** (its `LoggerService`) — do not
  redeclare the property. Its default exporter only buffers messages in a ring
  buffer; attach an exporter with `ctx.logger.exporter(...)` to make logs visible.
  Phase 1 wires **pino** in as this exporter (that is the `ctx.logger` seam).
- A root context is `new Context()`; core services (`logger`, `registry`,
  `reflect`, `events`) are available immediately. `await ctx.plugin(fn, cfg)`
  returns a `Fiber`; `await fiber.dispose()` unloads the plugin and unwinds every
  effect it registered (event listeners, disposers returned from the callback,
  provided values, …).

## Repo layout today (Phase 0)

```
apps/tseer/          # bin `tseer`; src/index.ts (createApp), src/cli.ts (boot),
                      # src/plugins/hello.ts (scaffold plugin), tests/
packages/             # kernel, types, server, http-client, twitter-sessions, cache,
                      # media, twitter-api — more seams per plan §2
docs/TS_PORT_PLAN.md  # the spec
```

## cache notes (plan §2/§4, `redis_cache.nim` port)

- **Two layers, not one.** `CacheStore` is the backend port (opaque JSON string
  in, TTL seconds out); `CacheService` implements the plan's §4 `Cache` contract
  over it. The seam consumers inject is `CacheService`; a store never interprets
  a value or a TTL. That split is what makes "memory; redis provider plugin"
  (plan §1) work without either backend knowing about the other.
- **Redis is an *optional* peer, not a dependency.** The memory provider must
  install with no redis, so `ioredis` is dynamically imported in
  `src/ioredis.ts` and declared ambiently in `src/ioredis-optional.d.ts`. Two
  gotchas, both hit here: tsdown needs `deps.neverBundle: ["ioredis"]` (the
  `external` key is deprecated), and the ambient file **must not** be named
  `ioredis.d.ts` — sharing a basename with `ioredis.ts` makes tsc treat it as
  that file's emit output and silently skip it. `createIoredisClient` is
  deliberately *not* re-exported from the barrel; exporting it would make the
  dynamic import static and defeat the code-split.
- **Keys are `<prefix>:<version>:<ns>:<key>`**, with namespaces ported verbatim
  from `redis_cache.nim` (`p`, `i`, `t`, `l`, `rss`, `pr2`, `ai`, `sp`, `bc`,
  `cm`, `cmm`, `pid`) so an existing nitter redis stays readable. The version
  segment replaces `redis_cache.nim`'s `migrate`/`SCAN`-and-delete: bump
  `CACHE_VERSION` and old keys are left to expire. `cacheKey` **rejects `:` in
  a namespace** so a glob built from it can never over-match.
- **`userIdBucketKey` uses FNV-1a, not Nim's `hash`.** `uidKey` was
  `"pid:" & $(hash(name) div 1_000_000)`; Nim's `hash` is not stable across
  builds, so buckets would reshuffle and orphan every cached id. FNV-1a is
  deterministic, which is what the bucket scheme needs.
- **`cached()` is the load-bearing part.** In-flight fills are tracked per
  qualified key so concurrent misses share one factory call (the stampede the
  plan calls out). The `finally` delete means a rejected factory neither caches
  the error nor poisons the slot for the next caller — a failing upstream stays
  retryable instead of wedging that key forever.
- **Deliberate divergences from the Nim original** (documented at the call site):
  - Values are **JSON, not flatty+supersnappy** (plan §3 says so). Bigger on the
    wire, debuggable, and it matches the TS domain objects.
  - Store read/write errors are **warned and swallowed** — a read degrades to a
    miss, so a redis outage costs latency, not availability. `redis_cache.nim`
    `quit 1`'d on a connect failure; a plugin must not kill the process (same
    reasoning as the sessions pool).
  - A `ttl <= 0` is a **no-op write**, not a delete-and-store: that is how
    `listMinutes = 0` disables list caching. An undecodable stored value is
    deleted and reported rather than echoed back as a miss forever.
  - No `migrate`/`hash-max-ziplist-entries` on boot. The version segment makes
    the flatty/snappy migration obsolete, and the ziplist tuning is a
    redis-internals concern that does not apply to the JSON layout.
- **Not implemented (deliberately):** the per-entity `cache*`/`getCached*`
  wrappers (`getCachedUser`, `getCachedRss`, `getCachedList`, …). Those are
  `twitter-api`'s job in Phase 3 — they call the GraphQL fetchers — and they
  become one-liners over `cached()` with the `resolveTtls` buckets. Only
  `userIdField`/`userIdBucketKey` are kept here, because the `pid:` bucket is a
  key-layout concern, not a fetch concern. The rss hash (`min` cursor + feed in
  one key) is likewise deferred to the RSS route plugin, since it needs the
  `Rss` domain type.

## twitter-sessions notes (plan §3, `auth.nim` port)
## media notes (plan §1/§2/§4, `utils.nim` + `routes/media.nim` port)

- **Two plugins, not one.** `mediaPlugin` provides `ctx.media` (pure signing,
  no I/O); `mediaRoutePlugin` registers `/pic*` and `/video*` and injects
  `ctx.server` + `ctx.media`. Splitting them is what lets `views` build links by
  depending on `ctx.media` alone, with no fetcher or listener involved.
- **`ctx.media` is just `utils.nim`.** 13 hex chars of HMAC-SHA256
  (`($hmac(sha256, key, data))[0 .. 12]` — Nim ranges are inclusive, so 13 not
  12), plus `picUrl`/`origPicUrl`/`vidUrl` in whichever encoding
  `config.base64Media` selects. Images are **unsigned**, as in nitter: those
  links are embedded in HTML, and verifying them would cost a lookup per image.
  Only `/video/` carries a signature, so a route can tell the two apart.
- **`MediaFetcher` is a separate port from `ctx.http`, deliberately.** The API
  client buffers whole bodies, retries 429/503, and treats Cloudflare HTML as
  retryable — none of which suits a 40 MB video segment (buffering defeats
  streaming; CF-detection would mangle binary). The media fetcher streams, sets
  only `headersTimeout`, and **never follows redirects**: `proxyMedia`
  re-validates every `Location` against the domain allowlist, and an
  auto-followed redirect would walk straight off the allowlisted host and
  re-open nitter #1411. It reuses `createDispatcher` from `http-client` so
  `config.proxy`/`proxyAuth` behave identically, but owns its own pool.
- **The allowlist is checked twice, and both checks matter.** `isTwitterUrl`
  runs on every fetch *after* decoding, because the decoded URL is
  attacker-supplied even though the link was generated by us. `.vmap` gets a
  third check: it is a second, independently-controlled fetch to a URL that was
  never signed.
- **ETag is FNV-1a over the *requested* URL.** Same substitution as `cache`:
  Nim's `hash` reshuffles across builds, and an ETag must instead stay identical
  across restarts for `If-None-Match` to ever hit. Hashing the request URL (not
  the redirect target) keeps the validator stable across a redirect.
- **Each encoding is its own registered route.** nitter writes one regex per
  route with an optional `(enc)?` group and re-derives the encoding by testing
  whether it matched; here `/pic/enc/:url` and `/pic/:url` are separate
  registrations, so a handler knows the encoding by construction.
- **Percent-encoding uses `%20`, not `+`.** Deliberate divergence from
  `encodeUrl(usePlus = true)`: the `server` seam hands handlers params fastify has
  *already* percent-decoded, so a `+` we emitted for a space would survive as a
  literal `+`, while a real `+` correctly arrives as `%2B`. `%20` keeps the round
  trip exact; only the literal-space case differs, and media URLs have none.
- **Never decode a route param twice.** `decodeSegment` used to run
  `decodeUrl` on the `percent` case, which is exactly the double decode the
  notes above warn about — so `urls.ts` claimed "the routes do not call it"
  while `routes.ts` called it through `decodeSegment`. Anything with a `%` in
  its path silently changed: `a%2Fb.jpg` → `a/b.jpg`, `a%20b.jpg` → `a b.jpg`.
  That corrupts the URL the **HMAC and the ETag were computed over**, so those
  links 403 and cache under the wrong validator. `decodeSegment` now returns
  `percent` params untouched and only undoes base64 for `enc`; `decodeUrl` is
  kept as the documented inverse of `encodeUrl` for raw (undecoded) segments.
  Two unit tests had encoded the buggy contract (`decodeSegment(encodeUrl(u))`),
  which is the tell that the unit boundary and the route boundary disagreed —
  `routes.spec.ts` now covers it end-to-end through a real `inject`.
- **`AppReply.stream()` needs `reply.hijack()`, and this is the load-bearing
  seam detail.** fastify's stream path is broken for `async` handlers: the
  wrapper treats the resolved value as a payload and calls `reply.send(undefined)`,
  ending the response before a lazily-pulled stream has produced anything —
  silently, as `200` with an empty body. `hijack()` says "this handler owns the
  raw response", which is also the shape nitter has (it writes to the socket).
  `packages/server/tests/server.spec.ts` asserts over both `inject` and a real
  socket so this cannot regress quietly.
- **Non-200 responses must be aborted.** `proxyMedia` calls `abort()` on every
  discarded response; without it each retry and every failed status leaks a
  pooled socket. `MediaFetcher` documents that a body must be consumed *or*
  aborted.
- **Not implemented:** range requests. nitter ignores `Range` too, so partial
  content is not a regression, but a resumable video download would need it —
  which is why `stream()` takes ownership of framing and can forward an upstream
  `content-length` as-is.

- **The `ctx.accounts` service is a `SessionPool` instance**, not a bare
  interface — `ctx.accounts.lease/release/reportError/health/debug` are methods
  on the class, so the composition root can read `size`/`all()` for diagnostics.
  `Accounts` in `src/types.ts` is the narrow contract `twitter-api` will
  consume in Phase 3.
- **`ApiSelector` is `string | { oauth, cookie }`** — the dual-URL mapping from
  `api.nim` `toUrl`. `resolveApi(selector, session.kind)` picks the endpoint for
  a given session, which is what makes the port's per-API rate-limit key correct
  for mixed oauth/cookie pools.
- **Deliberate divergences from the Nim original** (all documented at the call
  site):
  - `getSession` samples the whole pool from a random start and returns the
    first *ready* session; Nim's `for i in 0..<len` loop re-samples
    `len` times and effectively behaves the same, but reads as a bug.
  - A missing `sessions.jsonl` warns and boots an **empty pool** instead of
    `quit 1` — a plugin must not kill the process. `loadSessionsFile` still
    throws `SessionsFileError`; the plugin catches it.
  - Malformed JSONL lines become warnings instead of aborting the file
    (Nim would raise out of `initSessionPool`).
  - `snowflakeToEpoch` uses `BigInt` (`int64` ids exceed `Number.MAX_SAFE_INTEGER`).
  - `setRateLimit`'s race guard, the 1-hour `limited` window, the
    `remaining <= 10` threshold, and the `graphUserTweetsV2` exemption are
    ported verbatim — these are the load-bearing bits.
- **`/health` and `/sessions` take injected callbacks** (`sessionHealth`,
  `sessionDebug`) so `kernel` never imports `twitter-sessions`; the app wires
  them to `ctx.accounts.health()` / `.debug()`. `/.sessions` is gated on
  `enableDebug`, matching nitter's `routes/debug.nim`.
- **`pino-pretty` is a declared dependency of kernel.** The debug exporter asks
  pino for the `pino-pretty` transport (`enableDebug = true`), and pino resolves
  that target string against kernel's own `node_modules` at runtime — so the
  dependency must be listed even though nothing imports it (a bundler never sees
  it). Without it, boot throws `unable to determine transport target`
  synchronously; `kernel.spec.ts` mounts `loggerPlugin` with `debug: true` as a
  regression test.

## twitter-api notes (plan §3, `api.nim` + `apiutils.nim` + `tid.nim` port)

- **OAuth1 signing is a port, not a dependency** (`oauth1.ts`). nitter signs
  with the nimble package `oauth == 0.11` (CORDEA); a generic JS OAuth1 lib
  cannot reproduce its two wire details — the fixed `nonce: "0"` and the exact
  `Authorization` field order (signature before token, version last). HMAC-SHA1
  comes from `node:crypto`. `tests/fixtures/generate_oauth_golden.nim` imports
  the *real* CORDEA code from the nimble pkgcache (needs `-d:ssl` + two
  `--path`s, see its header) and `oauth1_golden.json` pins its output byte for
  byte — that is the fidelity oracle, run it again if the signing ever changes.
  The URL preprocessing (`+` → `%20`, `,` → `%2C`) before signing is what keeps
  the signature base string equal to RFC 5849 for `toUrl`'s output; do not drop it.
- **The fetch loop owns retries; `ctx.http` does one attempt per lease.**
  nitter's `retry` template re-leases a session per attempt — rotation is the
  point (the pool skips limited sessions) — so `fetch.ts` loops
  `maxRetries` times and calls `ctx.http` with `maxRetries: 1`. Config
  `maxRetries` therefore means *total attempts across sessions*, exactly like
  nitter (default 1 = no retry). Never "fix" this by letting the transport
  retry API calls with the same lease; that silently kills rotation.
- **Rate limits are recorded by `release(lease, resp.rateLimit)` immediately
  after the response**, before body triage. The `Accounts` seam has no
  standalone `setRateLimit`, and `release` is idempotent, so the triage paths
  can still call `release`/`reportError` afterwards (nitter recorded headers
  before triage too, then released in `finally`). Divergence: nitter leaks
  `pending` when `getAndValidateSession` fails (the raise sits outside
  `fetchImpl`'s `finally`); here the catch always releases.
- **Error triage is `fetchImpl`'s, keyed on pool semantics.** Object payloads
  starting `{"errors"` are parsed strictly (jsony-equivalent: `{errors:
  [{code, message}]}`, `code` numeric or an enum name — anything else raises and
  becomes retryable `RateLimitError`). Skippable codes
  (`0/34/144/29/37/214`) are ignored; `89/239/326` and `88` go through
  `accounts.reportError`, which is where the pool maps code → invalidate /
  setLimited. A 400 raises `InternalError` *after* parse and is **not** retried
  (http-client deliberately returns 400 so this mapping lives here).
- **`tid.ts` deliberately bypasses `ctx.http`.** nitter fetches the pair
  dictionary with a private `AsyncHttpClient` (no proxy, no retries); the
  default `fetchPairs` uses global `fetch` for the same reason, which also
  keeps it clear of `apiProxy` rewriting. The generator is lazy — no network
  happens at plugin mount, and only cookie + non-`skipTid` + non-`/1.1/` paths
  ever call it (`disableTid` → `BEARER_TOKEN_2` fallback, ported verbatim).
- **`ctx.twitter` is domain-typed now.** `fetchers.ts` keeps the raw bodies
  (`RawTwitterApi`); `domain.ts` composes them with `ctx.parsers` into the
  plan §3 `TwitterApi` (parsed domain objects, cursors, the #1372 repeat-page
  clearing, and `getTweet`'s two-request replies composition). The
  `getCached*` wrappers (`cached.ts`) cache parsed domain objects under
  nitter's key layout and ride the same service; `ctx.cache` is optional —
  without it the wrappers degrade to direct fetches.
- **The plugin uses `inject = ["accounts", "http"]`** (same pattern as
  `mediaRoutePlugin`), so mounting defers until both seams are provided;
  `apps/tseer` mounts it only when sessions are mounted (`withoutSessions`
  implies no `ctx.twitter`, and `withoutTwitter` opts out explicitly).

## prefs notes (plan §1/§4, `prefs.nim` + `prefs_impl.nim` port)

- **The pref model lives in `@tseer/prefs`, not kernel.** `preferencesSchema` +
  the option lists started in `kernel` during Phase 1 (config needed them for
  the INI reader); Phase 4 moved them to their owning package and kernel
  re-exports. The metadata table (`prefList` — kind/label/default/options per
  pref, port of the `genPrefs` DSL) is the single source of truth: kernel's
  INI coercion kinds are derived from it, and `prefs.spec.ts` asserts the
  schema's keys and defaults never drift from the metadata.
- **Checkbox presence semantics, ported verbatim:** `genParsePrefs` sets a
  checkbox to true for `"on"/"true"/"1"` — any other *present* value
  (including `"off"`) is false. Presence is what matters, not the value; a
  test pins the default-true `stickyNav: "off"` → false case.
- **`theme` is a select that parses as free text.** The Nim macro special-cases
  it (`input or name == "theme"` takes the raw string), so custom theme names
  and URL-param themes like `?theme=SomeCustom` survive — kept, and flagged in
  the kernel INI derivation too.
- **URL params beat cookies** (nitter runs `genParsePrefs` on cookies then
  params). `parsePrefs(defaults, cookies, params?)` mirrors that order; params
  are optional.
- **`encodePrefs` compares against the config-derived defaults**, like
  `genEncodePrefs` against `defaultPrefs` — so a `[Preferences] theme =
  Mastodon` config encodes a Mastodon-theme request as `""` (it *is* the
  default). Checkbox form: `name=on` / `name=`, non-defaults only, joined with
  `,`.
- **The cookie-write trio landed in `src/update.ts`** (Phase 5's preferences
  route): `updatePrefCookies`/`resetPrefCookies`/`applyPrefCookies` are pure
  ports of `genUpdatePrefs`/`genResetPrefs`/`genApplyPrefs` — they report the
  full `PrefCookieWrite` set (value + expire flag), and the route plugin owns
  the HTTP half: `Set-Cookie` serialization and `savePref`'s presence guard
  (only expire a cookie the request actually carried). `parsePrefsParam` is
  the `?prefs=` pair-splitting from `router_utils.nim`'s `applyUrlPrefs`.

## views notes (plan §1/§4, `general.nim` + `formatters.nim` port)

- **`render/post` is a cordis waterfall, not an emit.** The plan's
  `(html: string) => string | void` maps to cordis's Koa-style
  `ctx.waterfall("render/post", html, () => html)` — listeners return the
  transformed HTML or call `next()` to pass through. The event signature in
  the augmentation is `(html, next) => string` to match. `render/pre` fires
  before the shell is built with the mutable `PageContext`.
- **`picUrl` is injected, not imported.** `renderPlugin({ picUrl })` gets the
  media signer's `picUrl` from the composition root (same pattern as
  `parsersPlugin`), so `views` has no media dependency and works without it —
  `picUrl` then returns `""` and image links degrade to empty.
- **Deliberate divergences from the Nim original:**
  - The error panel escapes its message (nitter writes `verbatim error`);
    error strings interpolate usernames, so auto-escaping is the safe call.
  - `stripHtml` is regex-based, not a real HTML parser like Nim's
    `parseHtml` (fine for tweet/bio fragments; marked at the call site).
  - `shorten` slices codepoints, not bytes (Nim could split a UTF-8 sequence).
  - The liberapay donation icon is not ported (upstream's donate button).
  - `getTwitterLink` (navbar "Open in X" canonical) is deferred: it needs the
    search-query compiler (`genQueryParam`); routes pass `canonical`
    explicitly and the shell falls back to `https://x.com` + path.
  - `getM3u8Url`/`proxifyVideo` already live in `@tseer/media` (they are
    utils/hls concerns, not formatting).
- **Dates are rendered by hand in UTC** from the domain's ISO strings
  (`""` = not set, mirroring Nim's `year == 0` guards); no Intl/locale
  dependency, so output is deterministic for the golden tests.
- **Structural prefs subset** (`TseerPreferencesLike`: theme/stickyNav/
  hlsPlayback/infiniteScroll) keeps `views` importing only what the shell
  reads; the full `TseerPreferences` satisfies it.
- **View components land with the timeline plugin** (Phase 4):
  `renderutils.tsx` (renderutils.nim) + `tweet.tsx`/`timeline.tsx`/
  `search.tsx`/`profile.tsx`/`about-account.tsx`. The search route plugin
  adds `renderUserSearch`/`renderListSearch`/`renderSearchForm`
  (`views/search.nim`) and `renderListCard`/`renderTimelineLists`
  (`views/timeline.nim`, incl. the @mention linkification helpers). The media signer reaches
  the components through **process globals** (`media.ts` `setMediaSigners`,
  the port of nitter's `getPicUrl` process globals), wired reversibly by
  `renderPlugin({ picUrl, origPicUrl, vidUrl })` — the same shape
  `parsersPlugin({ picUrl })` uses.
- **`replaceUrls(...)` output is a raw-HTML sink** (`dangerouslySetInnerHTML`):
  tweet text, quote text, bio and note arrive pre-escaped from the parser
  (see the twitter-parser notes), and preact escapes everything else
  (usernames, titles, hrefs) automatically.
- **Threads are flat.** The parser port flattens `TimelineResult.content` to
  `Tweet[]`, so `renderThread` (multi-tweet thread + "more replies" gap) has
  no timeline counterpart — it returns with the status/conversation route.
  `filterThreads` (retweet dedup, hidden pins) runs per tweet instead of per
  thread. `renderListCard`/`renderTimelineLists`/`renderUserSearch`/
  `renderListSearch` landed with the search route plugin (their old
  "deferred" note lives on in git history).

## styles/static notes (plan §3, `sass/**` + `public/**` port)

- **Lives in `@tseer/views`, served via `staticDir`.** `sass/**` (24 files)
  and `public/**` (fonts, JS, icons, `fontello.css`, 9 theme files,
  `md/about.md`) are verbatim nitter @ `145ca9e` (master HEAD, Oct 2026)
  except one rename below. `viewsPublicDir()` (exported from the barrel)
  resolves to `dist/public/` after `pnpm build`, else the source `public/`
  (vitest path), keyed on the checked-in `css/fontello.css`.
- **`style.css` is generated, like upstream.** `scripts/build-css.mjs` ports
  `tools/gencss.nim` (`index.scss` + `sass/include` load path → dart-sass
  `compile()`); it writes `public/css/style.css` (gitignored, same as
  nitter's gitignore) and stages `public/` → `dist/public/` for the
  published bundle. `views` `build` is `tsdown && node scripts/build-css.mjs`;
  `files: ["dist"]` already covers the staged copy.
- **One deliberate divergence: `_mixins.css` → `_mixins.scss`.** Its content
  is SCSS (`@mixin`), which libsass tolerated under `.css` but dart-sass
  parses as plain CSS (`@mixin` is illegal there). Legacy `@import`/`unquote`
  deprecations are silenced; sources otherwise untouched.
- **`@parcel/watcher` stays denied.** It is dart-sass's watch-mode-only
  native dep; one-shot `compile()` never loads it, so `allowBuilds` records
  `false` with the reason (repo denies builds by default).
- **`packages/views/public` is excluded in `biome.json`.** The vendored
  assets are verbatim nitter files (minified JS, SVGs, a webmanifest) —
  biome would reformat/lint them into something no longer verbatim. The
  `files.includes` entry is `["**", "!packages/views/public"]` (biome
  requires the leading `**` before a negation).
- **Fresh boots serve the ported assets.** `apps/tseer` defaults an
  unconfigured `staticDir` (`./public`, which names a dir that only exists
  when the operator creates it) to `viewsPublicDir()`; any explicit config
  value or `staticDir` option wins. Kernel's default and `staticRoutePlugin`
  are untouched.
- **Dotted asset URLs reach static via match-time dotless params**
  (`web-routes/src/params.ts`: `NAME_PARAM`/`TAB_PARAM` =
  `:name([^.]+)`/`:tab([^.]+)`). Nitter's `cond '.' notin name` runs at
  *match* time (Jester skips the route, falls through to static); the old
  in-handler 404s let `/:name/:tab` swallow `/css/style.css`. Every `:name`
  across timeline/status/rss must use the *identical* pattern string, or
  find-my-way splits the radix node and one family shadows another (hit here:
  `/nasa/about` lost to `:tab` until about/followers/following shared the
  node). `:id`/`:slug`/`:hash` stay dot-allowing (nitter has no dot cond on
  them; `Invalid tweet ID` must keep firing in-handler).
- **Tests:** `views/tests/static.spec.ts` (every shell asset URL exists,
  theme-per-`themeOptions`, no `.scss` under `public/`, in-memory sass
  compile pins `--bg_color`/`.timeline-item`/`.tweet-body`);
  `web-routes/tests/routing.spec.ts` (timeline+status+rss mounted together:
  assets serve from static while each family keeps its routes);
  timeline/status dotted-name tests now assert static fallthrough instead of
  the error page (nitter parity).

## web-routes notes (plan §4/§5, `routes/timeline.nim` port)

- **`web-routes` is the plan §2 route-plugin package.** One plugin per nitter
  route family; the timeline plugin injects `server` + `twitter` + `render` +
  `prefs` (declared via the static `.inject` property, like `mediaRoutePlugin`)
  and registers: `/i/user/:user_id`, `/intent/user`, `/intent/follow`,
  `/:name/about`, `/:name/followers|following`, and the timeline as TWO fastify
  registrations (`/:name`, `/:name/:tab`) — Jester's optional `@tab` group.
  Fastify's radix router gives the static subpaths (`/about`, `/followers`,
  `/following`) precedence over `:tab`, mirroring nitter's dedicated routes.
- **cordis rc.10 does not run a plugin's returned disposer through
  `fiber.dispose()`.** The routes are unregistered via `ctx.effect(() => () =>
  disposeRoutes())` instead (same as `mediaRoutePlugin`) — the plugin's return
  value is belt-and-braces for manual disposal. Without the effect, an unloaded
  timeline plugin keeps serving pages from fastify's unregisterable routes.
- **`cond` failures are 404 error pages** (nitter: fall through to the global
  `error Http404` handler). Name conds ported verbatim: reserved names
  (`pic`/`gif`/…), no `.`, charset with (main route) or without (about/
  followers) comma. nitter's `getPath`/`getCursor`/`getNames`/`nitterParams`
  helpers live in `web-routes/src/timeline.ts` alongside the plugin.
- **`getUserId` collapses into `cachedUser`.** nitter's `getUserId` (pid-bucket
  lookup + `"suspended"` sentinel) plus `getCachedUser` were two cached fetches;
  here `cachedUser(name)` serves both — `user.id === ""` → not found (404 `User
  "x" not found`, which nitter also prints, only after leaking an empty 200
  through `respTimeline`), `user.suspended` → the sentinel's error page.
- **Error pages ride `ctx.render.errorPage`** with nitter's statuses:
  `RateLimitError`/`NoSessionsError` → 429, `InternalError`/`BadClientError` →
  500, suspended → 200 (nitter's `resp showError(...)` default). A `guard`
  wrapper maps the errors per handler; anything else rethrows to the server's
  500 handler.
- **Scroll fragments** (`?scroll=1`, infinite scroll) return `toHtml(...)` of
  the timeline component (no shell), 204/404 when empty — `toHtml` is a thin
  `renderToString` export on the views package.
- **`fetchProfile`** resolves the user first, then dispatches on `query.kind`
  to `tweets`/`tweetsAndReplies`/`media`/`articles`, else `search` (multi-user
  and the search tab). nitter's post-deployment `after.startsWith("scroll")`
  clearing and the `skipRail` media rule are kept.
- **Tests** (`packages/web-routes/tests/timeline.spec.ts`) boot a real cordis
  context (server + prefs + render plugins) with a **stubbed `ctx.twitter`**
  provided directly, then assert through `ctx.server.inject` — the plan §6
  "proving the seam is real" pattern. The **XSS regression test** feeds raw
  upstream JSON (tweet text + username + fullname containing markup) through
  the real `parseGraphTimeline` and asserts the page contains only escaped
  markup.

## search notes (plan §4, `routes/search.nim` port)

- **`searchPlugin` is the same four-seam shape as the timeline/status
  plugins** (`server` + `twitter` + `render` + `prefs` via static `.inject`,
  `ctx.effect` cleanup, `guard` error mapping) and registers `/search`,
  `/hashtag/:hash`, `/opensearch`. Static segments win over the timeline
  plugin's `/:name`/`/:name/:tab` in fastify's radix router, so mount order
  does not matter.
- **Route-level `f=` remap lives in the plugin, not `query.nim`.** The
  search-query compiler notes already called this out: `f=user` → `users`,
  `f=list` → `lists` (x.com compat) happens after `initQuery`, mirroring
  nitter mutating the parsed query in the route. The media `view` default
  (`prefs.mediaView`, lowercased) mirrors the `/user/media` tab rule.
- **Branch behavior ported verbatim:** `q` over 500 chars → 400; `users`
  with a comma redirects to the combined `/a,b` timeline; people-search
  swallows `InternalError` into an empty page (other errors propagate to
  the 429/500 `guard`); tweet tabs attach the RSS link only when
  `enableRSSSearch`; anything `initQuery` cannot produce (e.g. `f=posts`)
  → 404 `Invalid search`. No `?scroll=` fragment handling — nitter's
  search route has none either.
- **`generateOpenSearchXml` is the `opensearch.nimf` template** as a static
  string with XML-escaped config values, served as
  `application/opensearchdescription+xml`.
- **Tests** (`packages/web-routes/tests/search.spec.ts`) follow the timeline
  spec's boot pattern (stubbed `ctx.twitter` + `inject`); escaping is pinned
  at the auto-escaped layer (page title, list description) while the
  pre-escaped-sink path (tweet text, bio) stays covered by the timeline
  spec's real-parser XSS test.

## rss notes (plan §4, `routes/rss.nim` + `views/rss.nimf` port)

- **`rssPlugin` is the same four-seam shape as its siblings** (`server` +
  `twitter` + `render` + `prefs`, `ctx.effect` cleanup, `guard` mapping) and
  registers `/search/rss`, `/:name/rss`, `/:name/:tab/rss`,
  `/:name/lists/:slug/rss`, `/i/lists/:id/rss`. Jester's `/@name/?@tab?/rss`
  group becomes the two registrations; fastify gives the static `rss`
  segment precedence over the timeline plugin's `/:name/:tab` param, so
  `/nasa/rss` serves the feed (not a 404 tab) regardless of mount order.
- **The feed + min cursor ride `twitter.cachedRss`** (the `getCachedRss`/
  `cacheRss` port in `twitter-api/src/cached.ts`, namespaced `rss:` with the
  route's `redisKey` `<page>:<name>[:<cursor>]`). The whole `Rss` object is
  one JSON value — unlike nitter's two-field hash — including the
  `"suspended"` sentinel (feed holds the username). No-cache contexts
  degrade to direct fetch, like every other `cached*` (which are likewise
  unwired in prod — `twitterApiPlugin` never passes `{cache, ttls}`; wiring
  that is a separate job).
- **The search-key `$hash(...)` is FNV-1a**, not Nim's `hash` (unstable
  across builds; same substitution as the `pid:` buckets). That is why
  `web-routes` depends on `@tseer/cache` (public entry only: `fnv1a32`).
- **`timelineRss` resolves via `cachedUser`, not `getUserId` + `getCachedUser`.**
  One cached fetch instead of two; `user.suspended` carries the sentinel and
  an empty `fullname` becomes the empty cursor (route answers 404). The rail
  is skipped (`skipRail=true` equivalent) and the posts/replies `scroll`
  guard is kept. Multi-user feeds go through `search` with the default-pic
  stub user, verbatim.
- **`views/rss.ts` is string templates, not TSX** (like the `.nimf`): item
  bodies are CDATA HTML with parser-escaped tweet text interpolated raw;
  only titles/card fields/poll options pass through `escapeXml` (exact
  `xmltree.escape`: `&<>"`). Threads are flat (`Tweet[]`, not `seq[Tweets]`);
  the pinned splice compares `BigInt` ids (Nim: int64), as does the
  `2000000000000000000` GUID-cutoff check. `getTweetLink` keeps nitter's
  default `focus=true`, so feed links carry `#m` exactly like upstream.
- **Branch behavior ported verbatim:** per-tab `enableRSS*` gates → 403
  `RSS feed is disabled`; `/search/rss` caps `q` at 200 (not the 500 of
  `/search`) and only allows `tweets`/`top`/`media` kinds → 400 otherwise;
  empty cursor → 404 `User/List/Search … not found`; suspended → 404 with
  `getSuspended`. Success sends `application/rss+xml; charset=utf-8` with
  the `Min-Id` cursor header. The slug route redirects to `/i/lists/:id/rss`
  (with `?cursor=`, `%20`-encoded per the media notes).
- **Tests:** `views/tests/rss.spec.ts` pins titles/media/card/poll/quote
  rendering, the GUID cutoff, dedup + user filtering, and the pinned splice;
  `web-routes/tests/rss.spec.ts` follows the search spec's boot pattern
  (stubbed `ctx.twitter` with a passthrough `cachedRss`, key-shape and
  `Min-Id` assertions, gates, redirects, unload).

## preferences notes (plan §5, `routes/preferences.nim` + `views/preferences.nim` port)

- **The settings routes are the first `server`+`render`+`prefs`-only plugin**
  (no `twitter`): the form and the cookie writes never touch X. That absence
  is what lets `apps/tseer` mount it regardless of
  `withoutTwitter`/`withoutSessions`.
- **The split between `@tseer/prefs` and the route is the same
  decision-as-data rule as everywhere else:** `update.ts` reports *which*
  cookies get *what* values and which expire (`PrefCookieWrite[]`); the plugin
  serializes each write into a `Set-Cookie` header and applies `savePref`'s
  presence guard (`if not expire or pref in cookies(req)`) — the guard needs
  the request, so it lives at the boundary. Tests pin both halves:
  `prefs/tests/update.spec.ts` (the macro semantics) and
  `web-routes/tests/preferences.spec.ts` (headers, guard, redirects).
- **`savePref` header shape:** `name=value; Expires=<±360d/10d>; Path=/;
  HttpOnly[; Secure]; SameSite=<None|Lax>` — `Secure`+`SameSite=None` behind
  `useHttps`, `Lax` otherwise (verbatim). Redirects carry the cookies via the
  `AppReply.redirect(to, options)` overload added to the server seam (array
  header values become repeated `set-cookie` headers, never a joined string).
- **The `?prefs=` hook is the port of Jester's `before` block**
  (`applyUrlPrefs`), and it needed two new `ctx.server` capabilities: `hook()`
  (an `onRequest` hook whose disposer makes it a no-op — fastify can't
  unregister instance hooks) and urlencoded form parsing into `req.form`
  (`/saveprefs` reads `@"referer"`/pref names from the form body). The
  before-block's `cond "." notin request.path` is ported as a skip: dotted
  paths bypass the hook; `/embed/Tweet.html`'s exception belongs to the embed
  plugin, not yet ported. A prefs URL *replaces* the saved set (absent prefs
  expire) — that's `genApplyPrefs`, not a merge.
- **`/settings` renders `prefList` metadata, not a hand-written form** —
  the same table that drives parsing/encoding drives the widgets
  (`renderPref` dispatches on `kind`), so a new pref added to `prefs.ts`
  shows up in the form automatically. `theme`'s options are the one
  dynamic bit: `findThemes` (`views/static.ts`) lists
  `staticDir/css/themes/*.css` (`_`→space, titleized, sorted).
- **Cordis quirk (same as every route plugin so far):** rc.10 doesn't run a
  plugin's returned disposer through `fiber.dispose()`, so cleanup is a
  `ctx.effect` and the return value is belt-and-braces.

## space notes (plan §5, `routes/space.nim` + `views/space.nim` port)

- **`spacePlugin` is the four-seam route-plugin shape** (`server` + `twitter` +
  `render` + `prefs` via static `.inject`, `ctx.effect` cleanup, `guard`
  mapping) registering `/i/spaces/:id` and `/i/spaces/:id/stream`. The static
  `spaces` segment beats the unsupported plugin's `/i/:i/:j` param in the
  radix router regardless of mount order, and that plugin's deny list
  (`["status", "lists", "user"]`) is upstream-verbatim — **not** extended with
  `spaces`: with the space plugin unmounted, `/i/spaces/x` rendering the
  "Unsupported feature" panel is correct upstream-shaped behavior.
- **The alnum cond runs in-handler.** Jester's
  `cond @"id".allCharsInSet({'a'..'z','A'..'Z','0'..'9'})` is a match-time skip
  upstream (fall through to the global 404 handler); here both routes check
  `/^[A-Za-z0-9]+$/` in the handler and answer `showError("Page not found")`,
  so `:id` stays dot-allowing at match time (nitter has no match-time cond on
  it). The stream route's own 404/502 are **bare** (`reply.text("", …)`, no
  error page), verbatim; only thrown fetch errors ride the `guard` pages.
- **Manifest fetching is `@tseer/media` `safeFetchText`** (nitter's
  `safeFetch`, now shared with the media route's `.vmap`/`.m3u8` path —
  promoted from a private in `media/routes.ts` to a public export in
  `proxy.ts`). Never `ctx.http`: buffering + CF-retry semantics are wrong for
  manifests. The plugin owns its own `UndiciMediaFetcher` (same shape as
  `mediaRoutePlugin`, config `proxy`/`proxyAuth`/`httpMaxConns` handed over at
  mount) and closes it on unload — a second pool is the price of keeping the
  allowlist/abort invariants local to `@tseer/media`.
- **Content-type divergence:** the stream answers `VideoType.m3u8`
  (`application/x-mpegURL`, the enum's wire value in `@tseer/types` and the
  pinned test value). Upstream answers `m3u8Mime`
  (`application/vnd.apple.mpegurl`, the media route's own constant) — the two
  were never the same string in nitter; the media route port kept its
  constant, the space route carries the enum value.
- **Segment rewriting signs through the views' process-global `getVidUrl`**
  (installed by `renderPlugin`), exactly like nitter's process-global
  `getVidUrl` — no fifth (`media`) seam, matching the sibling route plugins.
- **`views/space.tsx` divergences:** the HLS overlay's
  `onclick="playAudio(this)"` is a raw-HTML sink (same rule as `tweet.tsx`'s
  video overlay); `year > 1` date guards map to empty-string guards, and
  `format("MMM d, YYYY")` is hand-rendered in UTC (no Intl; short month names
  are local — formatters' `monthsShort` is private). `insertSep` already lives
  in `formatters.ts`, so listener counts needed no new helper.

## broadcast notes (plan §5, `routes/broadcast.nim` + `views/broadcast.nim` port)

- **`broadcastPlugin` is the four-seam route-plugin shape** (`server` +
  `twitter` + `render` + `prefs` via static `.inject`, `ctx.effect` cleanup)
  registering `/i/broadcasts/:id` and `/i/broadcasts/:id/stream`. The static
  `broadcasts` segment beats the unsupported plugin's `/i/:i/:j` param in the
  radix router regardless of mount order, and that plugin's deny list is
  upstream-verbatim — **not** extended with `broadcasts`: with the broadcast
  plugin unmounted, `/i/broadcasts/x` rendering the "Unsupported feature"
  panel is correct upstream-shaped behavior. The routes also back the
  `broadcast` card kind (`parseBroadcast` links cards to both URLs).
- **No `guard` — the `try/except: discard` is ported verbatim.** nitter's
  broadcast route wraps `getCachedBroadcast` in a bare except that discards
  *every* failure, so a rate-limited fetch collapses to the empty broadcast
  and the 404 `Broadcast not found` page — **unlike the space sibling**, which
  maps errors to 429/500 pages. `cachedBroadcast` in the plugin returns
  `undefined` on any throw; only render bugs (a plugin bug) escape to the
  server's 500 handler. `web-routes/tests/broadcast.spec.ts` pins the 429→404
  divergence so it cannot be "fixed" into parity by accident.
- **Everything else is the space plugin's shape:** alnum cond in-handler
  (`:id` stays dot-allowing; failed conds answer `showError("Page not
  found")`), bare 404/502 on the stream route (`reply.text("")`, no error
  page), `VideoType.m3u8` content type (same divergence as space),
  `@tseer/media` `safeFetchText` over a dedicated `UndiciMediaFetcher` closed
  on unload, and segment signing through the views' process-global
  `getVidUrl` — no fifth (`media`) seam.
- **`views/broadcast.tsx` divergences:** the play overlay's
  `onclick="playVideo(this)"` is a raw-HTML sink (same rule as `tweet.tsx`/
  `space.tsx`); `year > 1` date guards map to empty-string guards, and the
  `format("MMM d, YYYY")` "Ended …" text reuses `space.tsx`'s exported
  `endedDate` (hand-rendered in UTC, no Intl). The duration badge subtracts
  `replayStart * 1000` (replays begin partway through the recording), ported
  verbatim. The no-manifest panels are upstream-verbatim, including the odd
  mapping: `availableForReplay` **true** → "Stream unavailable", false →
  "Replay is not available".
- **`cachedBroadcast` (the `getCachedBroadcast` port) refreshes the m3u8 URL
  on every hit** — `twitter-api/src/cached.ts` re-resolves
  `broadcast.mediaKey` through `broadcastStream` even on a cache hit, since
  playback URLs expire while the metadata (title/state/views) does not. The
  route never signs or caches the stream URL itself.



## twitter-parser notes (plan §3, `parser.nim` + `parserutils.nim` + `experimental/parser` port)

- **Accessors, not jsony.** The Nim parsers come in two styles — packedjson
  accessors (`parser.nim`) and jsony typed structs (`experimental/parser`).
  The port is all tolerant accessors (`src/json.ts`): nitter's
  `js{"a"}.getStr`/`getInt`/`select`/`with` semantics, with `undefined` and
  JSON `null` both meaning "absent". Nim code that would *raise* on upstream
  garbage (`parseInt` of a non-number) yields the 0/`""` default instead — a
  malformed card must not take down a timeline.
- **Ids and dates are strings.** int64 ids exceed `Number.MAX_SAFE_INTEGER`,
  so ids stay strings with `""` as the zero (see `idFromEntry`, the port of
  `getId`); `DateTime` is an ISO string with `""` as "not set" — this is what
  makes domain objects survive `JSON.stringify` for the cache seam.
- **Entity rewriting is codepoint-based.** Nim's `toRunes` slices map to
  `[...text]` codepoint arrays; X entity indices are half-open, but Nim's
  `..<` folds the exclusivity into `slice.b` at construction, so the port
  keeps the raw index and translates each rune expression at its use site
  (`slices.ts` documents the mapping). The `cmp` quirk
  (`cmp(x.slice.a, y.slice.b)`) is ported verbatim.
- **Quirks kept on purpose:** `replace("/video/1", "")` is `replaceAll` in
  Nim, so attribution links genuinely become `/clapper002`-style strings —
  the card-hiding comparison uses the same broken replace on both sides, so
  it still matches; the birdwatch splice drops the final codepoint
  (`0 ..< runes.len` folds to `len - 1`); the hashtag/mention regex is
  `parserutils.nim`'s `re` version everywhere (the experimental `nre`
  lookahead variant is not ported).
- **Suspended users.** `parser.nim`'s JsonNode `parseGraphUser` has no
  suspension handling — only the experimental string parser checks
  `unavailable_reason`/`reason == "Suspended"`, and the cache sentinel
  (`getCachedUsername` returning `"suspended"`) depends on it. The check is
  ported from the experimental parser into both user paths (documented at the
  call site).
- **Cursors.** nitter extracts the `Bottom` cursor only (`top` stays empty);
  the port keeps that. The search parsers handle `TimelineReplaceEntry`
  bottom updates; `Result.query` is attached by the fetch layer (the registry
  overwrites it when `options.query` is given) *after* parsing so #1372 can
  compare `after` with the parsed bottom cursor first.
- **Media links at parse time.** nitter builds `/pic/` card links through
  process globals (`setHmacKey`); the port keeps that shape with
  `setPicUrl`, wired by `parsersPlugin({ picUrl })` from `ctx.media` in
  `apps/tseer`. Unset (standalone parser use), card image fallbacks get no
  proxy link.
- **`ctx.parsers` is a class instance**, like `ctx.accounts` — `has`/
  `register` (reversible effect, un-registers on dispose) and
  `parse(kind, json, { after, query, tweetId, kind })`. The `followers` kind
  serves followers *and* following (the `kind` option picks the QueryKind),
  mirroring `getGraphUserConnections`.
- **Deliberate divergence: plain text is escaped at the splice boundary.**
  Upstream leaves the non-anchor segments of tweet text / bio raw and feeds
  them to karax `verbatim` (only anchor display text is `escape()`d, and only
  note tweets get the U+FFFA shield dance). Since `tweet.text`/`user.bio` are
  the views' raw-HTML sinks (plan §6 mandates the XSS test), `replacedWith`
  escapes plain segments and hashtag/mention anchor text, and the entity-less
  early returns of `expandTweetEntities`/`expandNoteTweetEntities` escape the
  untouched text. The note-tweet shield composes cleanly (U+FFFA isn't escaped
  material; the final unshield produces `&lt;`/`&gt;` exactly as before).
- **The experimental `parseGraphListMembers`/`parseGraphFollowers`** accept a
  raw string (they port `fetchRaw` bodies) or an already-parsed object, and
  read `entryType`/`cursorType` (camelCase, the jsony exact-name fields)
  while accepting both `user_results` and `userResults` — upstream sends
  snake_case and the Nim structs rename it.
- **Cache is optional for `twitterApiPlugin`.** `ctx.parsers` is required
  (helpful error if the parse seam is not mounted); `ctx.cache` is not —
  `apps/tseer` mounts `mediaPlugin` (pure signing) + `parsersPlugin` before
  `twitterApiPlugin` when sessions exist.
- **Fixtures are synthetic.** The plan asks for golden fixtures captured from
  real GraphQL responses; capturing needs a live session, so the suite pins
  parser behavior with hand-built payload fixtures per kind
  (`packages/twitter-parser/tests/fixtures`). Swap in captured payloads when
  a live smoke test happens (plan §6's optional job).
