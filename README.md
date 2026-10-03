# tseer

**tseer**: a TypeScript re-implementation of [nitter](https://github.com/zedeus/nitter)
with an *everything-is-a-plugin* architecture, built on
[Cordis](https://github.com/cordiverse/cordis) inspired by dsh.

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Scaffold: workspace, tooling, CI, hello-cordis app | **done** |
| 1 | Kernel + types + config service (`tseer web`) | **done** |
| 2 | Platform seams (http-client, cache, sessions, server, media) | **done** |
| 3 | Provider + parsers (`twitter-api`, `twitter-parser`) | **in progress** (`twitter-api` landed) |
| 4 | Web parity, core routes (views, prefs, render) | not started |
| 5 | Long tail (embed, list, community, article, space, …) | not started |
| 6 | Extensibility proof (out-of-tree example plugin) | not started |

## Quickstart

Requirements: **Node.js 26+**, **pnpm 12+**.

```sh
pnpm install
pnpm build
pnpm test
pnpm start    # `tseer web` — reads nitter.conf, serves GET /about
```

`tseer web [--config=<path>] [--port=<n>] [--sessions=<path>]`: config defaults to
`TSEER_CONF_FILE` / `NITTER_CONF_FILE`, then `./nitter.conf` — any missing file
falls back to built-in defaults with a warning-free boot. The sessions file
defaults to `TSEER_SESSIONS_FILE` / `NITTER_SESSIONS_FILE`, then
`./sessions.jsonl`; a missing file boots with an empty pool and a warning.

Session-pool state is exposed at `GET /.health`, and per-session detail at
`GET /.sessions` when `enableDebug = true`.

Other scripts: `pnpm lint` / `pnpm lint:fix` (biome), `pnpm typecheck` (tsc).

## Repository layout

```
apps/tseer/        # composition root: bin `tseer`, boots cordis, mounts plugins
packages/           # capability seams (kernel, types, http-client, cache, …) — Phase 1+
docs/TS_PORT_PLAN.md
```

Plugins are the unit of composition: every route family, provider, and service is a
plugin registered with `ctx.plugin(...)`, and unloading a plugin cleanly unwinds
everything it registered. See [AGENTS.md](AGENTS.md) for conventions and the verified
cordis API notes.

## License

**AGPL-3.0-only.** nitter is licensed under the GNU Affero General Public License
v3.0 (AGPL-3.0), and this project ports its parser logic, endpoint definitions, and
behavior, it is therefore a derivative work licensed under AGPL-3.0-only. Every
`package.json` in this workspace declares the same license.
