import { isTwitterUrl } from "@tseer/media";
import type { TseerPreferences } from "@tseer/prefs";
import type { Article, ArticleParagraph, ArticleStyle, Tweet, User } from "@tseer/types";
import type { VNode } from "preact";
import { getShortTime, getUserPic } from "./formatters.ts";
import { getOrigPicUrl, getVidUrl } from "./media.ts";
import {
  genImg,
  getAvatarClass,
  getSmallPic,
  icon,
  linkUser,
  verifiedIcon,
} from "./renderutils.tsx";
import { renderStats, renderTweet } from "./tweet.tsx";

type Inline = string | VNode;

const BOLD = 1 << 0;
const ITALIC = 1 << 1;
const STRIKETHROUGH = 1 << 2;
const UNDERLINE = 1 << 3;
const CODE = 1 << 4;

const STYLE_BITS: Record<string, number> = {
  Bold: BOLD,
  Italic: ITALIC,
  Strikethrough: STRIKETHROUGH,
  Underline: UNDERLINE,
  Code: CODE,
};

const WORD_CHAR = /^[A-Za-z0-9_]$/;

function wrapStyle(node: Inline, style: number): Inline {
  let result = node;
  if ((style & CODE) !== 0) result = <code>{result}</code>;
  if ((style & BOLD) !== 0) result = <strong>{result}</strong>;
  if ((style & ITALIC) !== 0) result = <em>{result}</em>;
  if ((style & STRIKETHROUGH) !== 0) result = <del>{result}</del>;
  if ((style & UNDERLINE) !== 0) result = <u>{result}</u>;
  return result;
}

function addContent(content: string, style = 0): Inline[] {
  const out: Inline[] = [];
  let first = true;
  for (const line of content.split("\n")) {
    if (!first) out.push(<br />);
    first = false;
    let pos = 0;
    while (pos < line.length) {
      const atPos = line.indexOf("@", pos);
      if (atPos === -1) {
        out.push(wrapStyle(line.slice(pos), style));
        break;
      }
      if (atPos > 0 && WORD_CHAR.test(line[atPos - 1] ?? "")) {
        out.push(wrapStyle(line.slice(pos, atPos + 1), style));
        pos = atPos + 1;
        continue;
      }
      let j = atPos + 1;
      while (j < line.length && j - atPos - 1 < 15 && WORD_CHAR.test(line[j] ?? "")) j++;
      if (j === atPos + 1) {
        out.push(wrapStyle(line.slice(pos, atPos + 1), style));
        pos = atPos + 1;
        continue;
      }
      if (atPos > pos) out.push(wrapStyle(line.slice(pos, atPos), style));
      const username = line.slice(atPos + 1, j);
      out.push(wrapStyle(<a href={`/${username}`}>{`@${username}`}</a>, style));
      pos = j;
    }
  }
  return out;
}

function applyInlineStyles(
  runes: string[],
  start: number,
  length: number,
  styles: ArticleStyle[],
): Inline[] {
  if (styles.length === 0) return addContent(runes.slice(start, start + length).join(""));

  const out: Inline[] = [];
  let lastStyle = 0;
  let lastStart = start;
  const endPos = start + length;

  for (let i = start; i < endPos; i++) {
    let style = 0;
    for (const sr of styles) {
      const sStart = sr.offset;
      const sEnd = sStart + sr.length;
      if (sStart <= i && sEnd > i) style |= STYLE_BITS[sr.style] ?? 0;
    }
    if (style !== lastStyle) {
      if (i > lastStart) out.push(...addContent(runes.slice(lastStart, i).join(""), lastStyle));
      lastStyle = style;
      lastStart = i;
    }
  }
  if (lastStart < endPos) {
    out.push(...addContent(runes.slice(lastStart, endPos).join(""), lastStyle));
  }
  return out;
}

function renderToTop(focus = "#"): VNode {
  return <div class="top-ref">{icon("down", "", "", "", focus)}</div>;
}

function renderTextParagraph(paragraph: ArticleParagraph, article: Article): VNode {
  if (paragraph.kind === "code-block") {
    return (
      <pre>
        <code>{paragraph.text}</code>
      </pre>
    );
  }

  const runes = [...paragraph.text];
  const textLen = runes.length;
  const children: Inline[] = [];
  let last = 0;
  for (const er of paragraph.entityRanges) {
    if (er.offset > last) {
      children.push(...applyInlineStyles(runes, last, er.offset - last, paragraph.inlineStyles));
    }
    last = er.offset + er.length;

    const entity = article.entities[er.key];
    if (entity !== undefined && entity.kind === "LINK") {
      let parsed: URL | undefined;
      try {
        parsed = new URL(entity.url);
      } catch {}
      if (parsed !== undefined && (parsed.protocol === "http:" || parsed.protocol === "https:")) {
        const href = isTwitterUrl(entity.url) ? parsed.pathname : entity.url;
        children.push(
          <a href={href}>
            {applyInlineStyles(runes, er.offset, er.length, paragraph.inlineStyles)}
          </a>,
        );
        continue;
      }
    }
    children.push(...applyInlineStyles(runes, er.offset, er.length, paragraph.inlineStyles));
  }
  if (last < textLen) {
    children.push(...applyInlineStyles(runes, last, textLen - last, paragraph.inlineStyles));
  }

  if (paragraph.kind === "blockquote" && children.length > 0) {
    children[children.length - 1] = withBlockquoteAttribution(
      children[children.length - 1] as Inline,
    );
  }

  switch (paragraph.kind) {
    case "header-one":
      return <h1>{children}</h1>;
    case "header-two":
      return <h2>{children}</h2>;
    case "header-three":
      return <h3>{children}</h3>;
    case "ordered-list-item":
    case "unordered-list-item":
      return <li>{children}</li>;
    case "blockquote":
      return <blockquote>{children}</blockquote>;
    default:
      return <p>{children}</p>;
  }
}

function withBlockquoteAttribution(node: Inline): Inline {
  if (typeof node === "string" || node.type !== "strong") return node;
  const inner = node.props.children;
  const first = Array.isArray(inner) ? inner[0] : inner;
  if (typeof first !== "string") return node;
  return <strong class="blockquote-attribution">{node.props.children}</strong>;
}

function renderAtomicParagraph(
  paragraph: ArticleParagraph,
  article: Article,
  tweets: Map<string, Tweet>,
  path: string,
  prefs: TseerPreferences,
): Inline {
  if (paragraph.entityRanges.length === 0) return "";

  const er = paragraph.entityRanges[0];
  if (er === undefined) return "";
  const entity = article.entities[er.key];
  if (entity === undefined) return "";

  switch (entity.kind) {
    case "MEDIA": {
      const media: (VNode | string)[] = [];
      for (const id of entity.mediaIds) {
        const item = article.media[id];
        if (item === undefined || item.url.length === 0) continue;
        if (item.kind === "ApiGif") {
          media.push(
            <video controls autoplay loop muted playsinline>
              <source src={getVidUrl(item.url)} type="video/mp4" />
            </video>,
          );
        } else if (item.kind === "ApiVideo") {
          media.push(
            // biome-ignore lint/a11y/useMediaCaption: upstream's article media carries no caption track
            <video controls playsinline preload="metadata">
              <source src={getVidUrl(item.url)} type="video/mp4" />
            </video>,
          );
        } else {
          media.push(
            <a href={getOrigPicUrl(item.url)} target="_blank" rel="noopener">
              <img src={getSmallPic(item.url)} alt={entity.caption} loading="lazy" />
            </a>,
          );
        }
      }
      return (
        <div class="article-media">
          {media}
          {entity.caption.length > 0 && <p class="article-media-caption">{entity.caption}</p>}
        </div>
      );
    }
    case "TWEET": {
      let key = "";
      try {
        key = BigInt(entity.tweetId).toString();
      } catch {}
      const tweet = key.length > 0 ? tweets.get(key) : undefined;
      return tweet !== undefined ? renderTweet(tweet, prefs, path) : "";
    }
    case "MARKDOWN": {
      let content = entity.markdown;
      if (content.startsWith("```")) {
        const firstNl = content.indexOf("\n");
        if (firstNl >= 0) content = content.slice(firstNl + 1);
        if (content.endsWith("```")) content = content.slice(0, -3);
        content = content.trim();
      }
      return (
        <pre>
          <code>{content}</code>
        </pre>
      );
    }
    case "DIVIDER":
      return <hr class="article-divider" />;
    default:
      return "";
  }
}

export function renderArticle(
  article: Article,
  tweets: Map<string, Tweet>,
  path: string,
  prefs: TseerPreferences,
  tweetId = "",
): VNode {
  const author: User = article.user;

  const blocks: (VNode | string)[] = [];
  let listKind = "";
  let listItems: VNode[] = [];
  const flushList = (): void => {
    if (listItems.length > 0) {
      blocks.push(listKind === "ordered-list-item" ? <ol>{listItems}</ol> : <ul>{listItems}</ul>);
    }
    listItems = [];
  };

  for (const paragraph of article.paragraphs) {
    const isListItem =
      paragraph.kind === "ordered-list-item" || paragraph.kind === "unordered-list-item";
    if (!isListItem && listKind.length > 0) flushList();

    if (paragraph.kind === "atomic") {
      blocks.push(renderAtomicParagraph(paragraph, article, tweets, path, prefs));
    } else if (isListItem) {
      if (paragraph.kind !== listKind) {
        flushList();
        listKind = paragraph.kind;
      }
      listItems.push(renderTextParagraph(paragraph, article));
    } else {
      blocks.push(renderTextParagraph(paragraph, article));
    }
  }
  flushList();

  const main = (
    <article class="article-body">
      <h1 class="article-title">{article.title}</h1>
      <div class="article-author">
        <div class="article-author-row">
          <a class="article-avatar" href={`/${author.username}`}>
            {genImg(getUserPic(author.userPic, "_bigger"), getAvatarClass(prefs))}
          </a>
          <div class="article-author-info">
            <div class="article-author-name">
              {linkUser(author, "fullname")}
              {verifiedIcon(author)}
            </div>
            <div class="article-author-meta">
              {linkUser(author, "username")}
              <span class="article-date-sep">{" · "}</span>
              <a class="article-date" href={`/${author.username}/status/${tweetId}`}>
                {getShortTime(article.time)}
              </a>
            </div>
          </div>
        </div>
        {!prefs.hideTweetStats && renderStats(article.stats)}
      </div>
      {blocks}
    </article>
  );

  return (
    <div class="article-page">
      {article.coverImage.length > 0 && (
        <a href={getOrigPicUrl(article.coverImage)} target="_blank" rel="noopener">
          <img class="article-cover" src={getSmallPic(article.coverImage)} alt="" />
        </a>
      )}
      {main}
      {renderToTop()}
    </div>
  );
}
