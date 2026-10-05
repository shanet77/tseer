/**
 * Provide `ctx.parsers` — the parse seam (plan §1). Pure, no I/O; the
 * composition root passes `picUrl` from `ctx.media` so card image fallback
 * links are built the way nitter's parse-time `getPicUrl` builds them.
 */
import type { Context } from "cordis";
import type { PicUrl } from "./media.ts";
import {
  configureParserLinks,
  type ParseFn,
  type ParseOptions,
  type ParserKind,
  Parsers,
} from "./registry.ts";

declare module "cordis" {
  interface Context {
    /** The parse registry: `ctx.parsers.parse(kind, json, options) → domain`. */
    parsers: Parsers;
  }
}

export interface ParsersPluginOptions {
  /** `ctx.media.picUrl` — wired at mount by the composition root. */
  picUrl?: PicUrl | undefined;
}

export default function parsersPlugin(
  ctx: Context,
  options: ParsersPluginOptions = {},
): () => void {
  const restoreLinks = configureParserLinks(options.picUrl);
  const parsers = new Parsers();

  const dispose = ctx.provide("parsers", parsers);
  return () => {
    void dispose();
    restoreLinks();
  };
}

export type { ParseFn, ParseOptions, ParserKind };
export { configureParserLinks, Parsers };
