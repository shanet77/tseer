/** Port of nitter's `src/views/embed.nim` (`renderVideoEmbed`,
 * `renderTweetEmbed`, `renderErrorEmbed`) and `src/views/oembed.nimf`
 * (`renderOembedIframe`).
 *
 * Like the `.nimf` templates, the oEmbed iframe is a plain string template.
 * The three embed pages are complete HTML documents built with preact: they
 * share the shell's `renderHead` (no navbar, no container) plus a
 * `<base target="_blank">` so every link inside the iframe opens in a new
 * tab, and inline the static `embedResize.js` resizer.
 *
 * Divergences from the Nim originals:
 * - upstream's `staticRead("../../public/js/embedResize.js")` becomes a
 *   lazily memoized read of `viewsPublicDir()/js/embedResize.js`, inlined as
 *   a raw-HTML sink (same rule as the video overlay in `tweet.tsx`).
 * - the iframe URL is XML-escaped before interpolation, since it lands in
 *   third-party pages; upstream interpolates it raw.
 * - `getVideoEmbed` is used for the og:video meta, which points at this
 *   port's `/i/videos/tweet/<id>` handler (upstream emits `/i/videos/<id>`,
 *   which resolves to the unsupported panel).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TseerPreferences } from "@tseer/prefs";
import type { Tweet } from "@tseer/types";
import { getVideos } from "@tseer/types";
import type { VNode } from "preact";
import { renderToString } from "preact-render-to-string";
import { getTweetLink } from "./formatters.ts";
import { getPicUrl } from "./media.ts";
import { doctype, type PageConfig, renderHead } from "./page.tsx";
import { escapeXml } from "./rss.ts";
import { viewsPublicDir } from "./static.ts";
import { getUrlPrefix as getStatusUrlPrefix, getVideoEmbed } from "./status.tsx";
import { renderTweet, renderVideo } from "./tweet.tsx";

let embedResizeJs: string | undefined;

function getEmbedResizeJs(): string {
  if (embedResizeJs === undefined) {
    embedResizeJs = readFileSync(join(viewsPublicDir(), "js", "embedResize.js"), "utf8");
  }
  return embedResizeJs;
}

/** oembed.nimf `renderOembedIframe`: the resizable iframe string template. */
export function renderOembedIframe(embedUrl: string, maxwidth = 550): string {
  const src = escapeXml(embedUrl);
  return (
    `<iframe src="${src}" style="width:100%;max-width:${maxwidth}px;` +
    'height:250px;border:none" scrolling="no" loading="lazy" ' +
    'onload="let c=new MessageChannel;' +
    "c.port1.onmessage=e=>this.style.height=e.data+'px';" +
    `this.contentWindow.postMessage('','*',[c.port2])"></iframe>`
  );
}

function headNode(
  cfg: PageConfig,
  prefs: TseerPreferences,
  video: string,
  images: string[],
): VNode {
  return renderHead({
    prefs,
    cfg,
    title: "",
    desc: "",
    ogTitle: "",
    rss: "",
    alternate: "",
    oembed: "",
    banner: "",
    video,
    images,
    picUrl: getPicUrl,
  });
}

function resizeScript(): VNode {
  return <script dangerouslySetInnerHTML={{ __html: getEmbedResizeJs() }} />;
}

/** views/embed.nim `renderVideoEmbed`. */
export function renderVideoEmbed(tweet: Tweet, cfg: PageConfig, prefs: TseerPreferences): string {
  const video = getVideos(tweet)[0];
  if (video === undefined) {
    throw new Error("tweet has no video");
  }
  const thumb = video.thumb;
  const urlPrefix = getStatusUrlPrefix(cfg);
  const vidUrl = getVideoEmbed(urlPrefix, tweet.id);
  const tweetUrl = getTweetLink(tweet);

  const node = (
    <html lang="en">
      {headNode(cfg, prefs, vidUrl, [thumb])}
      <base target="_blank" />
      <body>
        <div class="embed-video">
          {renderVideo(video, prefs, "")}
          <a class="video-overlay-link" href={tweetUrl}>
            {`Watch on ${cfg.hostname}`}
          </a>
        </div>
        {resizeScript()}
      </body>
    </html>
  );
  return doctype + renderToString(node);
}

/** views/embed.nim `renderTweetEmbed`. */
export function renderTweetEmbed(
  tweet: Tweet,
  path: string,
  prefs: TseerPreferences,
  cfg: PageConfig,
): string {
  const node = (
    <html lang="en">
      {headNode(cfg, prefs, "", [])}
      <base target="_blank" />
      <body>
        <div class="embed-wrapper">
          <div class="tweet-embed">
            {/* biome-ignore lint/a11y/useAnchorContent: nitter's invisible tweet-link overlay */}
            <a class="tweet-link" href={getTweetLink(tweet)} />
            {renderTweet(tweet, prefs, path, { mainTweet: true })}
          </div>
          <a class="embed-footer" href={getTweetLink(tweet)}>
            {`Read more on ${cfg.hostname}`}
          </a>
        </div>
        {resizeScript()}
      </body>
    </html>
  );
  return doctype + renderToString(node);
}

/** views/embed.nim `renderErrorEmbed`. */
export function renderErrorEmbed(
  error: string,
  prefs: TseerPreferences,
  cfg: PageConfig,
  opts: { tweetId?: string; username?: string } = {},
): string {
  const { tweetId = "", username = "" } = opts;
  let link = "/";
  if (tweetId.length > 0) {
    link = username.length > 0 ? `/${username}/status/${tweetId}` : `/i/status/${tweetId}`;
  }

  const node = (
    <html lang="en">
      {headNode(cfg, prefs, "", [])}
      <base target="_blank" />
      <body>
        <div class="embed-wrapper">
          <div class="tweet-embed error-embed">
            {/* biome-ignore lint/a11y/useAnchorContent: nitter's invisible tweet-link overlay */}
            <a class="tweet-link" href={link} />
            <div class="error-panel">
              <span>{error}</span>
            </div>
          </div>
          <a class="embed-footer" href={link}>
            {`Read more on ${cfg.hostname}`}
          </a>
        </div>
        {resizeScript()}
      </body>
    </html>
  );
  return doctype + renderToString(node);
}
