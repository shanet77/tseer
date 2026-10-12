import type { Context } from "cordis";
import { setMediaSigners } from "./media.ts";
import { type PageContext, type Render, RenderImpl } from "./render.ts";

declare module "cordis" {
  interface Context {
    render: Render;
  }

  interface Events {
    "render/pre": (page: PageContext) => void;
    "render/post": (html: string, next: () => string) => string;
  }
}

export interface RenderPluginOptions {
  title: string;
  hostname: string;
  useHttps: boolean;
  picUrl?: ((url: string) => string) | undefined;
  origPicUrl?: ((url: string) => string) | undefined;
  vidUrl?: ((url: string) => string) | undefined;
}

export default function renderPlugin(ctx: Context, options: RenderPluginOptions): () => void {
  const previousSigners = setMediaSigners({
    picUrl: options.picUrl ?? (() => ""),
    origPicUrl: options.origPicUrl ?? (() => ""),
    vidUrl: options.vidUrl ?? (() => ""),
  });
  const render = new RenderImpl(
    { title: options.title, hostname: options.hostname, useHttps: options.useHttps },
    {
      pre: (page) => void ctx.emit("render/pre", page),
      post: (html) => (ctx.waterfall("render/post", html, () => html) as string) ?? html,
    },
    options.picUrl !== undefined ? { picUrl: options.picUrl } : {},
  );
  const dispose = ctx.provide("render", render);
  return () => {
    setMediaSigners(previousSigners);
    void dispose();
  };
}
