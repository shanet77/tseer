/** `@tseer/twitter-sessions` — `ctx.accounts` seam: session pool, JSONL store, lease/release. */

export { default as twitterSessionsPlugin } from "./plugin.ts";
export { SessionPool, snowflakeToEpoch } from "./pool.ts";
export {
  createSession,
  hasCredentials,
  parseSession,
  parseSessionLine,
  prettySession,
  type RawSession,
  SessionParseError,
} from "./session.ts";
export {
  type LoadedSessions,
  loadSessionsFile,
  parseSessionsJsonl,
  SessionsFileError,
  type SessionsWatcher,
  watchSessionsFile,
} from "./store.ts";
export type {
  Account,
  AccountHealth,
  Accounts,
  ApiEndpoint,
  ApiSelector,
  LeasedAccount,
  PoolHooks,
  Session,
  SessionDebug,
  SessionPoolOptions,
  SessionsPluginOptions,
} from "./types.ts";
export { GRAPH_USER_TWEETS_V2, HOUR_IN_SECONDS, resolveApi } from "./types.ts";
