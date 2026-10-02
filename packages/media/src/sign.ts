/**
 * `ctx.media` — HMAC media URL signing (port of nitter `src/utils.nim`).
 *
 * Views call `picUrl`/`origPicUrl`/`vidUrl` to build links; the media routes
 * call `verify` to check the one HMAC nitter signs (`/video/<sig>/<url>`).
 * Images are deliberately *unsigned* upstream — see the note on `picUrl`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { MediaSigner } from "./types.ts";
import { encodeUrl, encodeUrlSafeBase64 } from "./urls.ts";

/**
 * Length of the hex digest prefix nitter uses: `($hmac(sha256, key, data))[0 .. 12]`
 * — Nim ranges are inclusive, so that is 13 characters, not 12.
 *
 * 13 hex chars is 52 bits of a 256-bit MAC: short enough for a URL segment,
 * and the truncation is what nitter ships, so existing links keep verifying.
 */
const HMAC_HEX_LENGTH = 13;

/** Options for {@link MediaSignerImpl}; defaults match `config.nim`. */
export interface MediaSignerOptions {
  /** `config.hmacKey`. nitter defaults to the literal `"secretkey"`. */
  hmacKey?: string | undefined;
  /** `config.base64Media` — use `/…/enc/` URL-safe base64 links. */
  base64Media?: boolean | undefined;
}

/**
 * Default `ctx.media` provider: the pure signing half of the seam.
 *
 * Holds no I/O and no mutable state beyond the config it was constructed with,
 * which is what lets `views` build links without pulling in the proxy.
 */
export class MediaSignerImpl implements MediaSigner {
  /** Whether links use the `/enc/` URL-safe base64 path variant. */
  readonly base64Media: boolean;
  private readonly key: string;

  constructor(options: MediaSignerOptions = {}) {
    this.base64Media = options.base64Media ?? false;
    this.key = options.hmacKey ?? "secretkey";
  }

  /**
   * HMAC-SHA256 of `url`, truncated to {@link HMAC_HEX_LENGTH} hex chars
   * (port of `getHmac`).
   */
  sign(url: string): string {
    return createHmac("sha256", this.key)
      .update(url, "utf8")
      .digest("hex")
      .slice(0, HMAC_HEX_LENGTH);
  }

  /**
   * Constant-time check of a presented signature against {@link sign}.
   *
   * nitter compares with `!=`. That is a timing oracle on a MAC, so this uses
   * `timingSafeEqual`; a length mismatch still short-circuits, which leaks only
   * the length of a value the attacker already supplied in full.
   */
  verify(url: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(url), "utf8");
    const presented = Buffer.from(signature, "utf8");
    if (expected.length !== presented.length) return false;
    return timingSafeEqual(expected, presented);
  }

  /** Encode a link for a path prefix: `/…/enc/<payload>` or `/…/<payload>`. */
  private segment(url: string): string {
    return this.base64Media ? encodeUrlSafeBase64(url) : encodeUrl(url);
  }

  /**
   * The `/…/enc/` variant of a path prefix, empty when percent-encoding is in
   * use. nitter inlines this into each `&"/pic/…"` template; routing needs it
   * separately so the registered paths match the links exactly.
   */
  private encPrefix(): string {
    return this.base64Media ? "/enc" : "";
  }

  /**
   * Proxied image link (port of `getPicUrl`). Empty input yields an empty
   * string, matching nitter — callers treat that as "leave the href alone".
   *
   * Unsigned by design: this is the link embedded in rendered HTML, so signing
   * it would break caching and require a round trip per image to verify. Only
   * `/video/` carries an HMAC upstream, and we match that.
   */
  picUrl(url: string): string {
    if (url.length === 0) return "";
    return `/pic${this.encPrefix()}/${this.segment(url)}`;
  }

  /** Original-resolution image link (port of `getOrigPicUrl`). */
  origPicUrl(url: string): string {
    if (url.length === 0) return "";
    return `/pic/orig${this.encPrefix()}/${this.segment(url)}`;
  }

  /** Signed video/manifest link (port of `getVidUrl`). */
  vidUrl(url: string): string {
    if (url.length === 0) return "";
    return `/video${this.encPrefix()}/${this.sign(url)}/${this.segment(url)}`;
  }
}
