import type { RateLimit, RateLimitHeaders, SessionKind } from "@tseer/types";

export const HOUR_IN_SECONDS = 3600;

export const GRAPH_USER_TWEETS_V2 = "LE3eTyeqhBh2g-fX85O2eQ/UserWithProfileTweetsQueryV2";

export interface ApiEndpoint {
  oauth: string;
  cookie: string;
}

export type ApiSelector = string | ApiEndpoint;

export interface Session {
  kind: SessionKind;
  id: string;
  username: string;
  oauthToken: string;
  oauthSecret: string;
  authToken: string;
  ct0: string;
  apis: Map<string, RateLimit>;
  pending: number;
  limited: boolean;
  limitedAt: number;
}

export type Account = Session;

export interface LeasedAccount {
  readonly account: Session;
  readonly api: string;
  released: boolean;
}

export interface SessionDebug {
  kind: SessionKind;
  apis: Record<string, { remaining: number; reset: number }>;
  pending: number;
  limited?: boolean;
}

export interface AccountHealth {
  sessions: {
    total: number;
    limited: number;
    oauth: { total: number; limited: number };
    cookie: { total: number; limited: number };
    oldest: string;
    newest: string;
    average: string;
  };
  requests: {
    total: number;
    apis: Record<string, number>;
  };
}

export interface PoolHooks {
  onLimited?(account: Session, api: string): void;
  onInvalidated?(account: Session): void;
  onLimitReset?(account: Session): void;
  onChange?(): void;
  log?(message: string): void;
}

export interface Accounts {
  lease(api: ApiSelector): Promise<LeasedAccount>;
  release(lease: LeasedAccount, headers?: RateLimitHeaders | undefined): void;
  reportError(lease: LeasedAccount, code: number, message?: string | undefined): void;
  health(): AccountHealth;
  debug(): Record<string, SessionDebug>;
}

export interface SessionPoolOptions {
  maxConcurrentReqs?: number | undefined;
  leaseTimeoutMs?: number | undefined;
  random?: (() => number) | undefined;
  now?: (() => number) | undefined;
  hooks?: PoolHooks | undefined;
}

export interface SessionsPluginOptions {
  path?: string | undefined;
  sessions?: readonly Session[] | undefined;
  maxConcurrentReqs?: number | undefined;
  leaseTimeoutMs?: number | undefined;
  watch?: boolean | undefined;
}

export function resolveApi(selector: ApiSelector, kind: SessionKind): string {
  return typeof selector === "string" ? selector : selector[kind];
}
