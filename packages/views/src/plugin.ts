/** Provide `ctx.render` — the page shell seam (plan §1's `ctx.render`), plus
 * the `render/pre` and `render/post` events. */
import type { Context } from "cordis";
import { setMediaSigners } from "./media.ts";
import { type PageContext, type Render, RenderImpl } from "./render.ts";

declare module "cordis" {
  interface Context {
    /** Page shell: `page()` / `errorPage()` over the preact theme (plan §4). */
    render: Render;
  }

  interface Events {
    /** Fired before the shell is built; mutate the context to add head
     * elements, change the title, etc. */
    "render/pre": (page: PageContext) => void;
    /** Final HTML transform (cordis waterfall): return the new HTML or call
     * `next()` to pass it through. */
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
  // Views reach the media signer through process globals (nitter's
  // `getPicUrl` & co.); install the full set here and restore on unload.
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
