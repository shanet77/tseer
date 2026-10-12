# @tseer/profile-web

The default composition: an **ordered plugin list = full nitter parity**. The
list lives here instead of `apps/tseer`, and it is driven by the config file —
operators add or remove plugins in `nitter.conf` without touching the app.

## How composition works

`createApp(options)` boots the kernel (config service, logger), then
`mountProfile(ctx)` mounts the ordered list from [`src/entries.ts`](src/entries.ts):

| order | name | provides |
| --- | --- | --- |
| 1 | `hello` | scaffold greeting (`ctx.hello`) |
| 2 | `server` | `ctx.server` (fastify) |
| 3 | `http-client` | `ctx.http` |
| 4 | `about` | `GET /about` |
| 5 | `prefs` | `ctx.prefs` |
| 6 | `render` | `ctx.render` (+ media signers when `media` mounts) |
| 7 | `cache` | `ctx.cache` |
| 8 | `sessions` | `ctx.accounts` |
| 9–12 | `media`, `media-routes`, `parsers`, `twitter-api` | `ctx.media`, `/pic*` `/video*`, `ctx.parsers`, `ctx.twitter` |
| 13–23 | `timeline`, `status`, `article`, `list`, `community`, `search`, `rss`, `space`, `broadcast`, `resolver`, `embed` | the route families |
| 24–27 | `preferences`, `unsupported`, `health`, `static` | `/settings`, the unsupported panel, `/.health`, static files |

Every entry has a stable **name**; each one declares what it `requires` and an
option derivation from `ctx.config`. The order mirrors the original
`apps/tseer/src/index.ts` composition, which mirrored nitter's boot.

## The `[Plugins]` config section

```ini
[Plugins]
; comma-separated specifiers: file paths (relative to this conf file) or npm names
add = ./plugins/json-api.ts, @my-org/tseer-plugin
; comma-separated built-in names to drop
remove = broadcast, space
```

- `remove` drops a built-in by name. Drops **cascade** through `requires`:
  `remove = sessions` unmounts `media`, `media-routes`, `parsers`,
  `twitter-api` too — the whole X stack disappears and the instance still
  serves `/about`, `/settings`, static files, and the health routes.
- `add` loads an out-of-tree plugin module per specifier. A path (starting
  with `./`, `../`, `/`, or `file:`) resolves relative to the config file's
  directory; anything else is imported as an npm package name. The module's
  **default export must be the plugin function**. A specifier that fails to
  load logs a warning and the rest of the profile boots normally.
- Added plugins mount **after** the built-ins, so a route plugin added this
  way sees the full platform (`ctx.server`, `ctx.twitter`, `ctx.render`, …).

## Write your first plugin

Create `plugins/json-api.ts` next to your `nitter.conf`:

```ts
import type { Context } from "cordis";
import type { HttpServer } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";

export default function jsonStatus(ctx: Context): () => void {
  const server = ctx.get("server" as never) as HttpServer | undefined;
  const twitter = ctx.get("twitter" as never) as TwitterApi | undefined;
  if (server === undefined)
    throw new Error("json-api: ctx.server is not mounted (load serverPlugin first)");
  if (twitter === undefined)
    throw new Error("json-api: ctx.twitter is not mounted (load twitterApiPlugin first)");

  const disposeRoute = server.route({
    method: "GET",
    path: "/status/:id.json",
    handler: async (req, reply) => {
      const id = req.params["id"] ?? "";
      if (!/^\d+$/.test(id)) {
        reply.json({ errors: [{ code: 44, message: "Invalid tweet ID" }] }, { status: 400 });
        return;
      }
      try {
        const conversation = await twitter.tweet(id);
        reply.json(conversation.tweet);
      } catch (err) {
        reply.json(
          { errors: [{ message: err instanceof Error ? err.message : String(err) }] },
          { status: 502 },
        );
      }
    },
  });
  const disposeEffect = ctx.effect(() => () => {
    disposeRoute();
  });
  return () => {
    disposeRoute();
    void disposeEffect();
  };
}

jsonStatus.inject = ["server", "twitter"];
```

Then one line in `nitter.conf`:

```ini
[Plugins]
add = ./plugins/json-api.ts
```

Boot with `tseer web` and `GET /status/<id>.json` now serves the tweet as
JSON. This exact plugin ships at
[`examples/json-api.ts`](examples/json-api.ts) and is exercised by the test
suite — it is the plan §6 extensibility proof.

The same plugin works as a library mount:

```ts
import { loadPluginEntry } from "@tseer/profile-web";

const entry = await loadPluginEntry("./plugins/json-api.ts", process.cwd());
const fiber = await ctx.plugin(entry.plugin);
await fiber.dispose(); // the route disappears, everything else keeps serving
```

## API

- `createApp(options)` — kernel boot + profile mount (what `tseer web` runs).
- `mountProfile(ctx, options)` — mount the composed list on an existing
  kernel-booted context; returns `{ names, fibers }`.
- `profileEntries` — the ordered built-in list (`ProfileEntry[]`).
- `resolveProfile(entries, options, remove)` — the `when`/`remove`/`requires`
  resolution, exported for tests and custom profiles.
- `loadPluginEntry(specifier, base)` — the out-of-tree module loader
  (file paths + npm names).

Programmatic options (`withoutCache`, `withoutSessions`, `withoutTwitter`,
`sessionsPath`, `cacheProvider`, `name`) do what the pre-profile composition
did; config-driven composition uses `[Plugins]` instead.
