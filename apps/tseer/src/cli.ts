#!/usr/bin/env node
import { createApp } from "./index.ts";

const ctx = await createApp();
console.log(`tseer scaffold booted — "${ctx.get("hello")}" plugin mounted on a cordis context`);
