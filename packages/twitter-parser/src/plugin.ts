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
    parsers: Parsers;
  }
}

export interface ParsersPluginOptions {
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
