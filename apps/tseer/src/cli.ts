#!/usr/bin/env node
import { createApp } from "./index.ts";

// Phase 0: no subcommands yet. Phase 1 adds `tseer web` (config + kernel +
// HTTP server) per docs/TS_PORT_PLAN.md §5.
const ctx = await createApp();
console.log(`tseer scaffold booted — "${ctx.get("hello")}" plugin mounted on a cordis context`);
