import { basename, dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createApp as createKernelApp } from "@tseer/kernel";
import { viewsPublicDir } from "@tseer/views";
import type { Context, Fiber } from "cordis";
import { type ProfileEntry, type ProfileOptions, profileEntries } from "./entries.ts";

export interface MountProfileOptions extends ProfileOptions {
  staticDir?: string;
  configPath?: string;
  add?: string[];
}

export interface MountedProfile {
  names: string[];
  fibers: Fiber[];
}

function pluginLists(ctx: Context): { add: string[]; remove: string[] } {
  const config = ctx.config as { plugins?: { add?: string[]; remove?: string[] } } | undefined;
  return { add: config?.plugins?.add ?? [], remove: config?.plugins?.remove ?? [] };
}

export function resolveProfile(
  entries: readonly ProfileEntry[],
  options: ProfileOptions,
  remove: readonly string[],
): ProfileEntry[] {
  const removeSet = new Set(remove);
  const list = entries
    .filter((entry) => entry.when?.(options) ?? true)
    .filter((entry) => !removeSet.has(entry.name));
  const alive = new Set(list.map((entry) => entry.name));
  for (let changed = true; changed; ) {
    changed = false;
    for (const entry of list) {
      if (!alive.has(entry.name)) continue;
      if ((entry.requires ?? []).some((dep) => !alive.has(dep))) {
        alive.delete(entry.name);
        changed = true;
      }
    }
  }
  return list.filter((entry) => alive.has(entry.name));
}

function isPathSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    isAbsolute(specifier) ||
    specifier.startsWith("file:")
  );
}

function entryName(specifier: string): string {
  const base = basename(specifier);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

export async function loadPluginEntry(specifier: string, base: string): Promise<ProfileEntry> {
  const href = isPathSpecifier(specifier)
    ? pathToFileURL(isAbsolute(specifier) ? specifier : resolve(base, specifier)).href
    : specifier;
  const module = (await import(href)) as { default?: unknown };
  if (typeof module.default !== "function") {
    throw new Error("module has no default-export plugin function");
  }
  return { name: entryName(specifier), plugin: module.default as ProfileEntry["plugin"] };
}

async function loadAddedEntries(
  ctx: Context,
  specifiers: readonly string[],
  base: string,
): Promise<ProfileEntry[]> {
  const added: ProfileEntry[] = [];
  for (const specifier of specifiers) {
    try {
      added.push(await loadPluginEntry(specifier, base));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      ctx.logger.warn(`plugins: failed to load "${specifier}": ${detail}`);
    }
  }
  return added;
}

export async function mountProfile(
  ctx: Context,
  options: MountProfileOptions = {},
): Promise<MountedProfile> {
  const lists = pluginLists(ctx);
  if (ctx.config !== undefined) {
    if (options.staticDir !== undefined) ctx.config.staticDir = options.staticDir;
    else if (ctx.config.staticDir === "./public") ctx.config.staticDir = viewsPublicDir();
  }

  const resolved = resolveProfile(profileEntries, options, lists.remove);
  const mounted = new Set(resolved.map((entry) => entry.name));
  const base = options.configPath !== undefined ? dirname(options.configPath) : process.cwd();
  const added = await loadAddedEntries(ctx, options.add ?? lists.add, base);

  const state = { options, mounted };
  const names: string[] = [];
  const fibers: Fiber[] = [];
  for (const entry of [...resolved, ...added]) {
    fibers.push(await ctx.plugin(entry.plugin, entry.options?.(ctx, state) as never));
    names.push(entry.name);
  }
  ctx.logger.info(`profile: mounted ${names.length} plugins (${names.join(", ")})`);
  return { names, fibers };
}

export interface CreateAppOptions extends MountProfileOptions {
  configText?: string;
  port?: number;
}

export async function createApp(options: CreateAppOptions = {}): Promise<Context> {
  const ctx = await createKernelApp({
    configPath: options.configPath,
    configText: options.configText,
  });
  if (options.port !== undefined) ctx.config.port = options.port;
  await mountProfile(ctx, options);
  return ctx;
}
