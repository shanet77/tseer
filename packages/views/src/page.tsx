import { preferencesSchema } from "@tseer/prefs";
import type { VNode } from "preact";
import { renderToString } from "preact-render-to-string";
import { stripHtml } from "./formatters.ts";

export const doctype = "<!DOCTYPE html>\n";

export interface TseerPreferencesLike {
  theme: string;
  stickyNav: boolean;
  hlsPlayback: boolean;
  infiniteScroll: boolean;
}

export interface PageConfig {
  title: string;
  hostname: string;
  useHttps: boolean;
}

export interface HeadProps {
  prefs: TseerPreferencesLike;
  cfg: PageConfig;
  title: string;
  desc: string;
  video: string;
  images: string[];
  banner: string;
  ogTitle: string;
  rss: string;
  alternate: string;
  oembed: string;
  picUrl: (url: string) => string;
}

function toTheme(theme: string): string {
  return theme.toLowerCase().replace(" ", "_");
}

function getSmallPic(picUrl: (url: string) => string, url: string): string {
  if (url.length === 0) return "";
  let result = url;
  if (!url.includes("?") && !url.endsWith("placeholder.png")) {
    result += "?name=small&format=webp";
  }
  return picUrl(result);
}

export function renderHead(props: HeadProps): VNode {
  const { prefs, cfg, picUrl } = props;
  const theme = toTheme(prefs.theme);

  const ogType =
    props.video.length > 0
      ? "video"
      : props.rss.length > 0
        ? "object"
        : props.images.length > 0
          ? "photo"
          : "article";
  const opensearchUrl = `https://${cfg.hostname}/opensearch`;

  return (
    <head>
      <link rel="stylesheet" type="text/css" href="/css/style.css?v=106" />
      <link rel="stylesheet" type="text/css" href="/css/fontello.css?v=7" />
      {theme.length > 0 && (
        <link rel="stylesheet" type="text/css" href={`/css/themes/${theme}.css`} />
      )}
      <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
      <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
      <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
      <link rel="manifest" href="/site.webmanifest" />
      <link rel="mask-icon" href="/safari-pinned-tab.svg" {...{ color: "#b57e3d" }} />
      <link
        rel="search"
        type="application/opensearchdescription+xml"
        title={cfg.title}
        href={opensearchUrl}
      />
      {props.alternate.length > 0 && (
        <link rel="alternate" href={props.alternate} title="View on X" />
      )}
      {props.rss.length > 0 && (
        <link rel="alternate" type="application/rss+xml" href={props.rss} title="RSS feed" />
      )}
      {props.oembed.length > 0 && (
        <link
          rel="alternate"
          type="application/json+oembed"
          href={props.oembed}
          title={props.title.length > 0 ? props.title : "oEmbed"}
        />
      )}
      {prefs.hlsPlayback && <script src="/js/hls.min.js" defer />}
      {prefs.hlsPlayback && <script src="/js/hlsPlayback.js?v=1" defer />}
      {prefs.infiniteScroll && <script src="/js/infiniteScroll.js" defer />}
      <title>{props.title.length > 0 ? `${props.title} | ${cfg.title}` : cfg.title}</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="referrer" content="same-origin" />
      <meta name="theme-color" content="#1F1F1F" />
      <meta property="og:type" content={ogType} />
      <meta property="og:title" content={props.ogTitle.length > 0 ? props.ogTitle : props.title} />
      <meta property="og:description" content={stripHtml(props.desc)} />
      <meta property="og:site_name" content="Tseer" />
      <meta property="og:locale" content="en_US" />
      {props.banner.length > 0 && !props.banner.startsWith("#") && (
        <link rel="preload" type="image/png" href={picUrl(props.banner)} as="image" />
      )}
      {props.images.map((url) => {
        if (url.length === 0) return null;
        const preloadUrl = url.includes("400x400") ? picUrl(url) : getSmallPic(picUrl, url);
        const image = `https://${cfg.hostname}${picUrl(url)}`;
        return (
          <>
            <link rel="preload" type="image/png" href={preloadUrl} as="image" />
            <meta property="og:image" content={image} />
            <meta property="twitter:image:src" content={image} />
            {props.rss.length > 0 ? (
              <meta property="twitter:card" content="summary" />
            ) : (
              <meta property="twitter:card" content="summary_large_image" />
            )}
          </>
        );
      })}
      {props.video.length > 0 && (
        <>
          <meta property="og:video:url" content={props.video} />
          <meta property="og:video:secure_url" content={props.video} />
          <meta property="og:video:type" content="text/html" />
        </>
      )}
      <link
        rel="preload"
        type="font/woff2"
        as="font"
        href="/fonts/fontello.woff2?59696369"
        crossorigin="anonymous"
      />
    </head>
  );
}

export interface NavbarProps {
  cfg: PageConfig;
  path: string;
  rss: string;
  canonical: string;
}

function icon(name: string, title: string, href: string): VNode {
  return (
    <div class="icon-container">
      {/* biome-ignore lint/a11y/useAnchorContent: glyph is the CSS class; name via title/aria-label */}
      <a class={`icon-${name}`} title={title} aria-label={title} href={href} />
    </div>
  );
}

export function renderNavbar(props: NavbarProps): VNode {
  const { cfg, path, rss, canonical } = props;
  return (
    <nav>
      <div class="inner-nav">
        <div class="nav-item">
          <a class="site-name" href="/">
            {cfg.title}
          </a>
        </div>
        <a href="/">
          <img class="site-logo" src="/logo.png" alt="Logo" />
        </a>
        <div class="nav-item right">
          {icon("search", "Search", "/search")}
          {rss.length > 0 && icon("rss", "RSS Feed", rss)}
          {canonical.length > 0 && icon("bird", "Open in X", canonical)}
          {icon("info", "About", "/about")}
          {path.length > 0
            ? icon("cog", "Preferences", `/settings?referer=${encodeURIComponent(path)}`)
            : icon("cog", "Preferences", "/settings")}
        </div>
      </div>
    </nav>
  );
}

export interface MainProps extends Omit<HeadProps, "prefs"> {
  body: VNode;
  prefs: TseerPreferencesLike | undefined;
  path: string;
  canonical: string;
}

export function renderMain(props: MainProps): string {
  const { body, cfg } = props;
  const prefs = props.prefs ?? preferencesSchema.parse({});

  const node = (
    <html lang="en">
      {renderHead({ ...props, prefs })}
      <body class={prefs.stickyNav ? "fixed-nav" : ""}>
        {renderNavbar({ cfg, path: props.path, rss: props.rss, canonical: props.canonical })}
        <div class="container">{body}</div>
      </body>
    </html>
  );
  return doctype + renderToString(node);
}

export function toHtml(node: VNode): string {
  return renderToString(node);
}

export function renderError(error: string): VNode {
  return (
    <div class="panel-container">
      <div class="error-panel">
        <span>{error}</span>
      </div>
    </div>
  );
}
