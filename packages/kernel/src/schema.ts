/** `ctx.config` contract: zod schema ported from `config.nim`. The prefs model
 * (`preferencesSchema`, the option lists, `TseerPreferences`) lives in
 * `@tseer/prefs` — the owner of the `prefs_impl.nim` port — and is re-exported
 * here so the config schema can embed it. */

import {
  gallerySizeOptions,
  mediaViewOptions,
  preferencesSchema,
  themeOptions,
} from "@tseer/prefs";
import { z } from "zod";

export type { TseerPreferences } from "@tseer/prefs";
export { gallerySizeOptions, mediaViewOptions, preferencesSchema, themeOptions };

export const configSchema = z.object({
  address: z.string().default("0.0.0.0"),
  port: z.number().int().min(1).max(65535).default(8080),
  useHttps: z.boolean().default(true),
  httpMaxConns: z.number().int().min(1).default(100),
  staticDir: z.string().default("./public"),
  title: z.string().default("Nitter"),
  hostname: z.string().default("nitter.net"),
  listCacheTime: z.number().int().min(0).default(120),
  rssCacheTime: z.number().int().min(0).default(10),
  redisHost: z.string().default("localhost"),
  redisPort: z.number().int().min(1).max(65535).default(6379),
  redisConns: z.number().int().min(1).default(20),
  redisMaxConns: z.number().int().min(1).default(30),
  redisPassword: z.string().default(""),
  hmacKey: z.string().default("secretkey"),
  base64Media: z.boolean().default(false),
  minTokens: z.number().int().min(0).default(10),
  enableRSS: z.boolean().default(true),
  enableRSSUserTweets: z.boolean().default(true),
  enableRSSUserReplies: z.boolean().default(true),
  enableRSSUserMedia: z.boolean().default(true),
  enableRSSUserArticles: z.boolean().default(true),
  enableRSSSearch: z.boolean().default(true),
  enableRSSList: z.boolean().default(true),
  enableDebug: z.boolean().default(false),
  proxy: z.string().default(""),
  proxyAuth: z.string().default(""),
  apiProxy: z.string().default(""),
  disableTid: z.boolean().default(false),
  maxConcurrentReqs: z.number().int().min(1).default(2),
  maxRetries: z.number().int().min(0).default(1),
  retryDelayMs: z.number().int().min(0).default(150),
  preferences: preferencesSchema.prefault({}),
});

export type TseerConfig = z.infer<typeof configSchema>;
export interface ConfigWarning {
  /** 1-based INI line, when the warning refers to file content. */
  line?: number | undefined;
  message: string;
}

export interface LoadedConfig {
  config: TseerConfig;
  warnings: ConfigWarning[];
}
