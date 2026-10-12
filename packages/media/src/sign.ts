import { createHmac, timingSafeEqual } from "node:crypto";
import type { MediaSigner } from "./types.ts";
import { encodeUrl, encodeUrlSafeBase64 } from "./urls.ts";

const HMAC_HEX_LENGTH = 13;

export interface MediaSignerOptions {
  hmacKey?: string | undefined;
  base64Media?: boolean | undefined;
}

export class MediaSignerImpl implements MediaSigner {
  readonly base64Media: boolean;
  private readonly key: string;

  constructor(options: MediaSignerOptions = {}) {
    this.base64Media = options.base64Media ?? false;
    this.key = options.hmacKey ?? "secretkey";
  }

  sign(url: string): string {
    return createHmac("sha256", this.key)
      .update(url, "utf8")
      .digest("hex")
      .slice(0, HMAC_HEX_LENGTH);
  }

  verify(url: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(url), "utf8");
    const presented = Buffer.from(signature, "utf8");
    if (expected.length !== presented.length) return false;
    return timingSafeEqual(expected, presented);
  }

  private segment(url: string): string {
    return this.base64Media ? encodeUrlSafeBase64(url) : encodeUrl(url);
  }

  private encPrefix(): string {
    return this.base64Media ? "/enc" : "";
  }

  picUrl(url: string): string {
    if (url.length === 0) return "";
    return `/pic${this.encPrefix()}/${this.segment(url)}`;
  }

  origPicUrl(url: string): string {
    if (url.length === 0) return "";
    return `/pic/orig${this.encPrefix()}/${this.segment(url)}`;
  }

  vidUrl(url: string): string {
    if (url.length === 0) return "";
    return `/video${this.encPrefix()}/${this.sign(url)}/${this.segment(url)}`;
  }
}
