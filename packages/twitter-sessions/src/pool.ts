import { NoSessionsError, type RateLimitHeaders, SessionKind } from "@tseer/types";
import { hasCredentials, prettySession } from "./session.ts";
import {
  type AccountHealth,
  type Accounts,
  type ApiSelector,
  GRAPH_USER_TWEETS_V2,
  HOUR_IN_SECONDS,
  type LeasedAccount,
  type PoolHooks,
  resolveApi,
  type Session,
  type SessionDebug,
  type SessionPoolOptions,
} from "./types.ts";

const LOW_REMAINING = 10;
const SNOWFLAKE_EPOCH_OFFSET = 1288834974657n;

export function snowflakeToEpoch(id: string): number {
  let flake: bigint;
  try {
    flake = BigInt(id);
  } catch {
    return 0;
  }
  if (flake === 0n) return 0;
  return Number((flake >> 22n) + SNOWFLAKE_EPOCH_OFFSET) / 1000;
}

function fromUnix(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(".000Z", "Z");
}

export class SessionPool implements Accounts {
  private sessions: Session[] = [];
  private maxConcurrentReqs: number;
  private leaseTimeoutMs: number;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly hooks: PoolHooks;
  private waiters: Array<() => void> = [];

  constructor(sessions: readonly Session[] = [], options: SessionPoolOptions = {}) {
    this.sessions = [...sessions];
    this.maxConcurrentReqs = Math.max(1, options.maxConcurrentReqs ?? 2);
    this.leaseTimeoutMs = Math.max(0, options.leaseTimeoutMs ?? 0);
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.hooks = options.hooks ?? {};
  }

  get size(): number {
    return this.sessions.length;
  }

  setMaxConcurrentReqs(reqs: number): void {
    if (reqs > 0) this.maxConcurrentReqs = reqs;
  }

  replace(sessions: readonly Session[]): void {
    this.sessions = [...sessions];
    this.hooks.onChange?.();
    this.wake();
  }

  all(): readonly Session[] {
    return this.sessions;
  }

  isLimited(session: Session, api: string): boolean {
    if (api !== GRAPH_USER_TWEETS_V2 && session.limited) {
      if (this.now() - session.limitedAt > HOUR_IN_SECONDS) {
        session.limited = false;
        this.hooks.onLimitReset?.(session);
        this.hooks.log?.(`resetting limit: ${prettySession(session)}`);
        return false;
      }
      return true;
    }
    const limit = session.apis.get(api);
    if (limit === undefined) return false;
    return limit.remaining <= LOW_REMAINING && limit.reset > this.now();
  }

  isReady(session: Session, api: string): boolean {
    return !(session.pending > this.maxConcurrentReqs || this.isLimited(session, api));
  }

  setRateLimit(session: Session, api: string, headers: RateLimitHeaders): void {
    const existing = session.apis.get(api);
    if (existing !== undefined) {
      if (existing.reset >= headers.reset && existing.remaining < headers.remaining) return;
      if (existing.reset === headers.reset && existing.remaining >= headers.remaining) {
        existing.remaining = headers.remaining;
        this.hooks.onChange?.();
        return;
      }
    }
    session.apis.set(api, {
      limit: headers.limit,
      remaining: headers.remaining,
      reset: headers.reset,
    });
    this.hooks.onChange?.();
  }

  setLimited(session: Session, api: string): void {
    session.limited = true;
    session.limitedAt = this.now();
    const remaining = session.apis.get(api)?.remaining;
    this.hooks.log?.(
      `rate limited by api: ${api}, reqs left: ${remaining ?? 0}, ${prettySession(session)}`,
    );
    this.hooks.onLimited?.(session, api);
    this.hooks.onChange?.();
    this.wake();
  }

  invalidate(session: Session): void {
    const index = this.sessions.indexOf(session);
    if (index !== -1) this.sessions.splice(index, 1);
    this.hooks.log?.(`invalidating: ${prettySession(session)}`);
    this.hooks.onInvalidated?.(session);
    this.hooks.onChange?.();
    this.wake();
  }

  release(lease: LeasedAccount, headers?: RateLimitHeaders | undefined): void {
    if (lease.released) return;
    lease.released = true;
    if (lease.account.pending > 0) lease.account.pending -= 1;
    if (headers !== undefined) this.setRateLimit(lease.account, lease.api, headers);
    this.wake();
  }

  reportError(lease: LeasedAccount, code: number, message?: string | undefined): void {
    const account = lease.account;
    if (code === 88) {
      this.setLimited(account, lease.api);
      this.release(lease);
      return;
    }
    if (code === 89 || code === 239 || code === 326) {
      this.hooks.log?.(
        `invalidating session after error ${code}${message ? `: ${message}` : ""}: ${prettySession(account)}`,
      );
      this.invalidate(account);
      this.release(lease);
    }
  }

  private pick(selector: ApiSelector): Session | undefined {
    if (this.sessions.length === 0) return undefined;
    const start = Math.floor(this.random() * this.sessions.length) % this.sessions.length;
    for (let offset = 0; offset < this.sessions.length; offset++) {
      const candidate = this.sessions[(start + offset) % this.sessions.length];
      if (candidate === undefined) continue;
      if (!hasCredentials(candidate)) continue;
      if (this.isReady(candidate, resolveApi(selector, candidate.kind))) return candidate;
    }
    return undefined;
  }

  async lease(selector: ApiSelector): Promise<LeasedAccount> {
    const deadline = this.leaseTimeoutMs > 0 ? Date.now() + this.leaseTimeoutMs : 0;
    let lastTried: Session | undefined;
    for (;;) {
      const found = this.pick(selector);
      if (found !== undefined) {
        found.pending += 1;
        const lease: LeasedAccount = {
          account: found,
          api: resolveApi(selector, found.kind),
          released: false,
        };
        this.hooks.onChange?.();
        return lease;
      }
      if (this.sessions.length > 0)
        lastTried = this.sessions[Math.floor(this.random() * this.sessions.length)];
      if (deadline === 0 || Date.now() >= deadline) break;
      await this.waitForChange();
    }
    if (lastTried === undefined) {
      this.hooks.log?.(
        `no sessions available for API: ${resolveApi(selector, SessionKind.cookie)}`,
      );
    } else {
      this.hooks.log?.(
        `no sessions available for API: ${resolveApi(selector, lastTried.kind)}, ` +
          `last tried: ${prettySession(lastTried)}`,
      );
    }
    throw new NoSessionsError();
  }

  private wake(): void {
    if (this.waiters.length === 0) return;
    const pending = this.waiters;
    this.waiters = [];
    for (const resolve of pending) resolve();
  }

  private waitForChange(): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  health(): AccountHealth {
    const now = this.now();
    let totalReqs = 0;
    let oldest = now;
    let newest = 0;
    let sum = 0;
    let oauthTotal = 0;
    let cookieTotal = 0;
    let oauthLimited = 0;
    let cookieLimited = 0;
    let limited = 0;
    const reqsPerApi: Record<string, number> = {};

    for (const session of this.sessions) {
      const created = snowflakeToEpoch(session.id);
      if (created > newest) newest = created;
      if (created < oldest) oldest = created;
      sum += created;

      if (session.kind === SessionKind.oauth) oauthTotal += 1;
      else cookieTotal += 1;

      if (session.limited) {
        limited += 1;
        if (session.kind === SessionKind.oauth) oauthLimited += 1;
        else cookieLimited += 1;
      }

      for (const [api, status] of session.apis) {
        if (status.reset < now) continue;
        const reqs = status.limit - status.remaining;
        reqsPerApi[api] = (reqsPerApi[api] ?? 0) + reqs;
        totalReqs += reqs;
      }
    }

    let average = 0;
    if (this.sessions.length > 0) average = Math.floor(sum / this.sessions.length);
    else {
      oldest = 0;
      average = 0;
    }

    return {
      sessions: {
        total: this.sessions.length,
        limited,
        oauth: { total: oauthTotal, limited: oauthLimited },
        cookie: { total: cookieTotal, limited: cookieLimited },
        oldest: fromUnix(oldest),
        newest: fromUnix(newest),
        average: fromUnix(average),
      },
      requests: { total: totalReqs, apis: reqsPerApi },
    };
  }

  debug(): Record<string, SessionDebug> {
    const now = this.now();
    const list: Record<string, SessionDebug> = {};
    for (const session of this.sessions) {
      const entry: SessionDebug = { kind: session.kind, apis: {}, pending: session.pending };
      if (session.limited) entry.limited = true;
      let hasApi = false;
      for (const [api, status] of session.apis) {
        if (status.reset <= now) continue;
        entry.apis[api] = { remaining: status.remaining, reset: status.reset };
        hasApi = true;
      }
      if (!hasApi) continue;
      list[session.id] = entry;
    }
    return list;
  }
}
