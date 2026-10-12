import type { CacheStore, MemoryCacheOptions } from "./types.ts";

interface Entry {
  value: string;
  expiresAt: number;
}

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_SWEEP_INTERVAL_MS = 30_000;

export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, Entry>();
  private readonly maxEntries: number;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | undefined;

  constructor(options: MemoryCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
    const interval = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    if (interval > 0) {
      this.timer = setInterval(() => this.sweep(), interval);
      this.timer.unref?.();
    }
  }

  get size(): number {
    return this.entries.size;
  }

  async get(key: string): Promise<string | undefined> {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) {
      this.entries.delete(key);
      return;
    }
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    this.evictIfNeeded();
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async deletePattern(pattern: string): Promise<void> {
    const matcher = globToRegExp(pattern);
    for (const key of [...this.entries.keys()]) {
      if (matcher.test(key)) this.entries.delete(key);
    }
  }

  async close(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.entries.clear();
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  private evictIfNeeded(): void {
    if (this.entries.size <= this.maxEntries) return;
    this.sweep();
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }
}

export function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (const char of pattern) {
    if (char === "*") source += ".*";
    else if (char === "?") source += ".";
    else source += char.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  }
  return new RegExp(`${source}$`, "u");
}
