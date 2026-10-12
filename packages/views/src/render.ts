import type { VNode } from "preact";
import { type PageConfig, renderError, renderMain, type TseerPreferencesLike } from "./page.tsx";

export type { TseerPreferencesLike };
export interface PageOpts {
  body: VNode;
  title?: string;
  desc?: string;
  ogTitle?: string;
  rss?: string;
  video?: string;
  images?: string[];
  banner?: string;
  canonical?: string;
  alternate?: string;
  oembed?: string;
  path?: string;
  prefs?: TseerPreferencesLike;
}

export interface PageContext extends Omit<PageOpts, "prefs"> {
  title: string;
  desc: string;
  ogTitle: string;
  rss: string;
  video: string;
  images: string[];
  banner: string;
  canonical: string;
  alternate: string;
  oembed: string;
  path: string;
  prefs: TseerPreferencesLike | undefined;
}

export interface Render {
  page(opts: PageOpts): Promise<string>;
  errorPage(message: string, code?: number, prefs?: TseerPreferencesLike): string;
}

export interface RenderOptions extends PageConfig {
  picUrl?: (url: string) => string;
}

export class RenderImpl implements Render {
  private readonly picUrl: (url: string) => string;

  constructor(
    private readonly cfg: PageConfig,
    private readonly events: RenderEvents,
    options: Pick<RenderOptions, "picUrl"> = {},
  ) {
    this.picUrl = options.picUrl ?? (() => "");
  }

  async page(opts: PageOpts): Promise<string> {
    const context: PageContext = {
      title: opts.title ?? "",
      desc: opts.desc ?? "",
      ogTitle: opts.ogTitle ?? "",
      rss: opts.rss ?? "",
      video: opts.video ?? "",
      images: opts.images ?? [],
      banner: opts.banner ?? "",
      canonical:
        opts.canonical ??
        (opts.path !== undefined && opts.path.length > 0 ? `https://x.com${opts.path}` : ""),
      alternate: opts.alternate ?? "",
      oembed: opts.oembed ?? "",
      path: opts.path ?? "",
      body: opts.body,
      prefs: opts.prefs,
    };
    this.events.pre(context);
    return this.events.post(this.build(context, context.prefs));
  }

  errorPage(message: string, code?: number, prefs?: TseerPreferencesLike): string {
    const titleText = code === undefined ? "Error" : `HTTP ${code}`;
    return this.build(
      {
        title: titleText,
        desc: "",
        ogTitle: "",
        rss: "",
        video: "",
        images: [],
        banner: "",
        canonical: "",
        alternate: "",
        oembed: "",
        path: "",
        body: renderError(message),
        prefs: undefined,
      },
      prefs,
    );
  }

  private build(context: PageContext, prefs: TseerPreferencesLike | undefined): string {
    return renderMain({
      ...context,
      body: context.body,
      cfg: this.cfg,
      picUrl: this.picUrl,
      prefs,
    });
  }
}

export interface RenderEvents {
  pre(page: PageContext): void;
  post(html: string): string;
}
