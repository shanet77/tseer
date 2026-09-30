# AGENTS.md

Guidance for coding agents (and humans) working in this repository.

## What this is

tseer ("nitter-ts") is a greenfield TypeScript port of
[nitter](https://github.com/zedeus/nitter) with an everything-is-a-plugin
architecture on [cordis](https://www.npmjs.com/package/cordis). The authoritative
spec is [docs/TS_PORT_PLAN.md](docs/TS_PORT_PLAN.md) — read it (especially §0 ground
rules, §1 seam map, and the phase you are implementing) before making architectural
decisions. This file records what the plan cannot: repo conventions and
plan-vs-reality deltas discovered during implementation.

## Phase status

- [x] Phase 0 — scaffold: pnpm workspace, tsconfig, biome, vitest, CI, hello-cordis app
- [ ] Phase 1 — `kernel/createApp(config)`, config service (zod + nitter.conf ini), `types`, `logger`, `nitter web` serving `/about`
- [ ] Phase 2 — platform seams: `http-client`, `cache`, `twitter-sessions`, `server`, `media`
- [ ] Phase 3 — `twitter-api` + `twitter-parser` with golden fixtures
- [ ] Phase 4 — `views`, `prefs`, `ctx.render`, core route plugins
- [ ] Phase 5 — long-tail route plugins
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
| `pnpm start` | run the built `apps/nitter` entry (`dist/cli.js`) |

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
  `ctx.plugin(...)`; `apps/nitter` is only the composition root (the plugin list
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
apps/nitter/          # bin `nitter`; src/index.ts (createApp), src/cli.ts (boot),
                      # src/plugins/hello.ts (scaffold plugin), tests/
packages/             # empty — seam packages arrive in Phase 1
docs/TS_PORT_PLAN.md  # the spec
```
