# tseer: Conversion Plan

Plan for re-implementing nitter as a new TypeScript project with an
**everything-is-a-plugin** architecture, modeled on deepseek-harness (dsh).
Greenfield repo, full architectural ownership. This document is the handoff
spec for the implementing agent.

The original: Nim/Jester monolith (~4.3k loc core + parser/types/views/routes).
The new project keeps feature parity with nitter's *route surface and behavior*,
but every layer becomes a swappable plugin.

---

## 0. Ground rules

- **License:** nitter is AGPL-3.0. We are porting parser logic, endpoint
  definitions, and behavior → the new repo **must be AGPL-3.0**. State this in
  the README and every package.json. Do not write the LICENSE file.
- **Runtime:** Node.js 26+, TypeScript strict, ESM-only, pnpm workspaces.
- **Plugin kernel:** [Cordis](https://www.npmjs.com/package/cordis) (the public
  npm package dsh is built on). Plugins are functions receiving a shared
  `Context`; they contribute **typed services** (`ctx.twitter`, `ctx.cache`) and
  **typed events**; every registration is a reversible effect that unwinds on
  unload. We get load/unload lifecycle, dependency-scoped disposal, and config
  composition for free instead of writing a plugin runtime.
- **Not adopted from dsh (yet):** bundle/profile YAML patch layering, HMR,
  desktop carriers, plugin marketplace. Boot composition is a plugin list in a
  config file. These are additive later; do not build them speculatively.

### Cordis in 30 seconds (for the implementing agent)

```ts
import { Context, Service, define } from 'cordis'

// a plugin: a function that receives ctx and registers reversible effects
export default define((ctx: Context) => {
  // service via module augmentation (declared once in the owning package):
  ctx.set('twitter', new TwitterServiceImpl(ctx))

  // typed event listener — disposed automatically when plugin unloads
  ctx.on('account/limited', (acct) => ctx.logger.warn(...))

  // cleanup is implicit; explicit resources return a disposer
  return () => ctx.server.close()
})

// consumers: any plugin can inject
ctx.inject(['twitter', 'cache'], (ctx) => { /* ctx.twitter is ready here */ })
```

Service interfaces are declared via `declare module 'cordis' { interface Context { ... } }`
in the owning package — exactly the dsh pattern (`ctx.sessions`, `ctx.tools`).

---

## 1. The seam map

This is the core architectural decision. Each row is a **capability seam**:
a service definition (interface), at least one default provider, and consumers.

| Seam (`ctx.*`) | Owns | Default provider | Why it's a seam |
|---|---|---|---|
| `ctx.config` | zod-validated config | file loader (nitter.conf compat) | config source/format swappable |
| `ctx.logger` | structured logs | pino | — |
| `ctx.http` | outbound HTTP: pooling, proxy, retries, CF detection | undici Agent + ProxyAgent | transport swap (residential proxy, mirror) |
| `ctx.cache` | `get/set(namespace, key, factory, ttl)` | memory; redis provider plugin | cache backend swap |
| `ctx.accounts` | X session pool: JSONL store, lease/release, per-API rate limits, health | oauth+cookie pool (port of `auth.nim`) | account sources, guest tokens, rotation policy |
| `ctx.twitter` | **the provider seam**: typed fetchers (`user()`, `tweets()`, `tweet()`, `search()`…) | GraphQL/REST client (port of `api.nim`) | the whole point: swap upstream strategy |
| `ctx.parsers` | registry: `parse(kind, json) -> domain` | GraphQL parsers (port of `experimental/parser/*`) | X changes response shapes; override per-kind without forking |
| `ctx.server` | HTTP listener + `route()` registration | fastify behind the seam | listeners are replaceable; routes never import fastify |
| `ctx.prefs` | per-request prefs from cookies/URL | port of `prefs.nim` | — |
| `ctx.media` | media URL signing (HMAC) + proxy | port of `utils.nim` signing | — |
| `ctx.render` | `page(title, body, opts) -> html`; view registry | nitter theme (ported SCSS + TSX) | alternative themes, JSON-API "view", embeds |

**Routes are plugins too.** Each route family (timeline, status, search, rss,
media, embed, list, community, article, space, broadcast, resolver, debug,
prefs) is a standalone plugin that injects `ctx.server` + `ctx.twitter`. Unload
the article plugin → article routes disappear cleanly. That's the demo of the
architecture working.

**Output formats ride the same data.** Route plugins fetch domain objects via
`ctx.twitter`; HTML pages, RSS, and (future) JSON all render the same objects
through `ctx.render` or their own view code. Original nitter special-cases RSS;
we don't.

### Events (extension points)

```ts
declare module 'cordis' {
  interface Events {
    'http/request': (req: OutboundRequest) => void        // rewrite headers, audit
    'http/response': (res: OutboundResponse) => void
    'account/limited': (account: Account, api: string) => void
    'account/health': () => AccountHealth                  // debug route reads this
    'parse/post': (kind: string, raw: Json, out: unknown) => void  // normalize upstream junk
    'render/pre': (page: PageContext) => void              // inject head elements, CSP
    'render/post': (html: string) => string | void         // final HTML transforms
    'cache/write': (ns: string, key: string, ttl: number) => void
    'server/listening': (info: { host: string; port: number }) => void
  }
}
```

Add events sparingly; each one needs a producer, consumers, and docs.

---

## 2. Repo layout

pnpm monorepo. Packages are cohesion units; **plugins are the unit of
composition** (one package may export several plugins).

```
apps/
  tseer/                   # bin: `tseer web` — reads config, mounts plugin list, starts
packages/
  kernel/                  # createApp(): cordis boot, config service, plugin loader (file paths + npm names)
  types/                   # domain model: User, Tweet, Conversation, Timeline, Query, Account, Prefs — pure types + zod schemas where input crosses a boundary
  http-client/             # ctx.http: undici pool, proxy, retry w/ backoff, cloudflare-HTML detection, rate-limit header parsing
  cache/                   # ctx.cache service; plugins: memory provider, redis provider (JSON values, versioned keys)
  twitter-sessions/        # ctx.accounts: pool, sessions.jsonl store+watch, per-API RateLimit tracking, lease/concurrency caps
  twitter-api/             # ctx.twitter: endpoint consts (ported hashes/features), ApiReq dual oauth|cookie URL mapping, fetchers, search-query compiler (query.nim)
  twitter-parser/          # ctx.parsers registry + default GraphQL parsers (port of experimental/parser/* and parser.nim)
  server/                  # ctx.server: fastify listener, route() registration, static files, cookies
  prefs/                   # ctx.prefs: cookie/URL-param prefs, defaults from config
  media/                   # ctx.media: HMAC sign/verify + streaming proxy route plugin
  views/                   # ctx.render + nitter theme: TSX components (ported views/*), formatters (port formatters.nim), ported SCSS
  web-routes/              # route plugins: timeline, status, search, rss, list, community, article, space, broadcast, embed, resolver, unsupported, debug, preferences
  profile-web/             # the default composition: ordered plugin list = full nitter parity
```

~14 packages. That's enough to enforce seams by import boundaries; splitting
further is cheap later if a provider forks.

### Tech choices (decided, don't re-litigate in implementation)

| Concern | Choice | Why |
|---|---|---|
| Plugin kernel | `cordis` (npm) | dsh's actual foundation; reversible effects, typed services/events |
| HTTP server | fastify (behind `ctx.server`) | boring, fast, good inject-testing |
| HTTP client | undici | ships with Node; Agent pooling + ProxyAgent; interceptors |
| HTML | preact TSX + `renderToString` | **auto-escaping**: tweet text is attacker-controlled; template-literal views are an XSS factory. No client runtime shipped. |
| Styles | port `src/sass/**` as-is via `sass` | zero redesign; theme seam still exists via `render/post` |
| Logs | pino | — |
| Validation | zod (config, prefs; *not* upstream JSON) | upstream parsing stays hand-rolled tolerant accessors, ported from nitter's `{...}` patterns |
| Redis | ioredis | — |
| Build | tsdown per package, tsc for types | dsh parity |
| Tests | vitest + fastify `inject` + golden JSON/HTML fixtures | no live X dependency in CI |
| Lint/format | biome | one tool |

---

## 3. Porting map (Nim → TS)

| Nim source | Destination | Notes |
|---|---|---|
| `nitter.nim` | `apps/tseer` | boot only; no route definitions inline |
| `config.nim`, `nitter.conf` | `kernel` config service | zod schema; keep nitter.conf ini keys readable for drop-in migration |
| `http_pool.nim`, `apiutils.nim` (fetch/retry/CF) | `http-client` | undici Agent; keep `isCloudflareHtml` check + retry/backoff |
| `auth.nim`, `sessions.jsonl`, `experimental/parser/session.nim` | `twitter-sessions` | pool semantics: per-session concurrency cap, per-API rate limits from response headers, limited/unlimited state, `getSessionPoolHealth` → `account/health` event for debug route |
| `consts.nim` (endpoint hashes, `gqlFeatures`, headers) | `twitter-api/src/endpoints.ts` | single file; this is X's churn surface |
| `api.nim` | `twitter-api/src/client.ts` | keep the **ApiReq dual-URL pattern** (`oauth:` vs `cookie:` per endpoint) — that's load-bearing for session kinds |
| `query.nim` | `twitter-api/src/search-query.ts` | search operator → GraphQL variables compiler |
| `experimental/parser/**`, `parser.nim`, `parserutils.nim` | `twitter-parser` | registry keyed by kind (user, timeline, tweet, article, card, space, broadcast, session…); port parsers 1:1 with fixture tests |
| `experimental/types/**`, `types.nim` (domain part) | `types` | discriminated unions where Nim used case objects |
| `redis_cache.nim` | `cache` | JSON (not flatty/snappy); namespaced keys; TTLs from config; profile-cache buckets ported |
| `formatters.nim`, `utils.nim` (URL rewrite, t.co unwrapping, titles) | `views/src/formatters` | rendering concern; port regex set |
| `utils.nim` (HMAC media signing, base64) | `media` | keep signature format for compat |
| `routes/*` | `web-routes` (one plugin per family) | handlers port 1:1; validation stays at the boundary (tweet-id digit check etc.) |
| `views/*` (+`.nimf` templates) | `views` | TSX components; rss/oembed/opensearch as string templates |
| `sass/**`, `public/**` | copy into `views` / `server` static | unchanged |
| `prefs.nim`, `prefs_impl.nim` | `prefs` | pref list is data; keep cookie names for compat |

---

## 4. Contracts to write first (blocking everything downstream)

The implementing agent should land `packages/types` + these interfaces before
any providers:

```ts
// packages/types — domain model (no framework imports)
export interface Tweet { id: string; user: User; text: string; /* …ported fields */ }
export interface Conversation { tweet: Tweet; before: Thread; after: Tweet[]; replies: TimelineResult }
export interface TimelineResult { content: TimelineItem[]; cursor?: string; query: Query; }
export interface User { id: string; username: string; profileImageUrl: string; /* … */ }
export interface Query { kind: QueryKind; text: string; filters: string[]; /* …ported */ }

// packages/twitter-api — the provider seam
export interface TwitterApi {
  user(username: string): Promise<User>
  userById(id: string): Promise<User>
  aboutAccount(username: string): Promise<AccountInfo>
  tweets(userId: string, cursor?: string): Promise<TimelineResult>
  tweetsAndReplies(userId: string, cursor?: string): Promise<TimelineResult>
  media(userId: string, cursor?: string): Promise<TimelineResult>
  articles(userId: string, cursor?: string): Promise<TimelineResult>
  tweet(id: string, cursor?: string, mode?: RankingMode): Promise<Conversation>
  search(q: Query, cursor?: string): Promise<TimelineResult>
  list(id: string, cursor?: string): Promise<TimelineResult>
  listMembers(id: string, cursor?: string): Promise<TimelineResult>
  community(id: string, cursor?: string): Promise<TimelineResult>
  article(id: string): Promise<Article>
  space(id: string): Promise<AudioSpace>
  broadcast(id: string): Promise<Broadcast>
  broadcastStream(mediaKey: string): Promise<string>
}

// packages/cache
export interface Cache {
  get<T>(ns: string, key: string): Promise<T | undefined>
  set<T>(ns: string, key: string, value: T, ttlSeconds: number): Promise<void>
  cached<T>(ns: string, key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T>  // stampede-safe get-or-fill
}

// packages/twitter-sessions
export interface Accounts {
  lease(api: string): Promise<LeasedAccount>   // blocks/respects concurrency cap; skips rate-limited
  release(lease: LeasedAccount, headers: RateLimitHeaders): void
  reportError(lease: LeasedAccount, err: ApiError): void
  health(): AccountHealth
}

// packages/server — routes never touch fastify types directly
export interface RouteSpec { method: string; path: string; handler: (req: AppRequest) => Promise<Response> }
export interface HttpServer {
  route(spec: RouteSpec): void
  static(prefix: string, dir: string): void
  start(): Promise<void>
}

// packages/views — a view is just a component; render owns layout/meta
export interface Render {
  page(title: string, body: VNode, opts: PageOpts): Promise<string>  // fires render/pre + render/post
  errorPage(message: string, code?: number): string
}
```

---

## 5. Phases

Each phase ends with a runnable, testable state. An implementing agent should
commit per phase.

### Phase 0 — Scaffold (half day)
pnpm workspace, tsconfig.base, tsdown, biome, vitest, CI, AGENTS.md, LICENSE
(AGPL-3.0). Hello-cordis app boots under `apps/tseer`.
**Accept:** `pnpm i && pnpm build && pnpm test` green in CI.

### Phase 1 — Kernel + types (1 day)
`kernel/createApp(config)`, config service (zod + nitter.conf ini reader),
`types` package, `logger`. `tseer web` starts an empty server serving
`/about` (static HTML stub).
**Accept:** `nitter.conf` from original repo parses; unknown-key warnings work.

### Phase 2 — Platform seams (2–3 days)
`http-client` (pool/proxy/retry/CF-detect/rate-limit-header parse),
`cache` (memory + redis providers, `cached()`), `twitter-sessions`
(JSONL store, lease/release, rate-limit state machine, health event),
`server` route registry, `media` signing.
**Accept:** unit tests w/ fixture rate-limit headers; sessions.jsonl from
original repo loads; debug route `/debug health` renders pool health.

### Phase 3 — Provider + parsers (3–5 days; the big one)
`twitter-api` (endpoints.ts, dual-URL mapping, fetchers, search-query compiler)
and `twitter-parser` (registry + ported parsers) with **golden fixtures**:
capture real GraphQL responses per kind into `tests/fixtures/*.json`, assert
parsed output. Debug CLI: `tseer debug user/<name>` prints parsed JSON.
**Accept:** fixture suite green; live smoke test (with a real session) for
user/timeline/tweet/search.

### Phase 4 — Web parity, core routes (3–4 days)
`views` (TSX components, formatters, ported SCSS), `prefs`, `ctx.render`,
then route plugins: timeline, status, search, rss, media proxy, resolver.
**Accept:** golden HTML tests per route (structure-asserted, not byte-exact);
RSS output validates; media proxy enforces HMAC; tweet text is escaped
(XSS test with fixture containing `<script>`).

### Phase 5 — Long tail (2 days)
Route plugins: embed/oEmbed, opensearch.xml, list, community, article, space,
broadcast, unsupported, preferences save route. Port `.nimf` string templates.
**Accept:** every route in original `routes/` has a plugin + test.

### Phase 6 — Extensibility proof (1 day)
`profile-web` as a config-file plugin list; load one **out-of-tree example
plugin** (e.g. a `/@:name/status/:id.json` JSON-API route) from a path in
config to prove the seam; README with "write your first plugin" walkthrough.
**Accept:** example plugin loads/unloads at runtime without restart regressions.

Total: roughly 2 focused weeks for an agent with the original repo as reference.

---

## 6. Testing strategy

- **Fixtures, not live calls, in CI.** Captured GraphQL payloads per parser
  kind; golden HTML per route. Live smoke = separate optional CI job with
  secrets.
- **XSS regression test is mandatory** (Phase 4): tweet text, usernames, and
  card titles containing markup must render escaped.
- Route tests use fastify `inject` against a context with a stubbed
  `ctx.twitter` — proving the seam is real.

## 7. Risks & mitigations

- **X churn** (endpoint hashes, feature flags, response shapes) → isolated in
  `endpoints.ts` + parser registry + fixtures; that churn is *the* reason for
  this architecture. Bump = edit one package, others unaffected.
- **Session/account fragility** → port `auth.nim` semantics faithfully
  (per-API limits, concurrency caps, dual OAuth/cookie URLs); it's the real IP
  of nitter forks.
- **Anti-bot/Cloudflare** → `ctx.http` proxy support from day one (undici
  ProxyAgent); CF-HTML detection ported.
- **Perf vs Nim** → personal-instance scale is fine on Node; undici pooling +
  cache make it a non-issue. Measure before optimizing.
- **Escaping/XSS** → preact auto-escaping + explicit tests. Never build HTML
  with string concatenation of upstream data.

## 8. Non-goals (v1)

dsh-style profiles/bundles/YAML patching, HMR, desktop app, admin web UI,
multi-theme support beyond the seam, i18n, JS client framework. The seams make
all of these additive; build none of them now.
