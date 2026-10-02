/**
 * Provide `ctx.media` — the HMAC media URL signing service
 * (port of nitter `src/utils.nim`'s `setHmacKey`/`setProxyEncoding`).
 *
 * Mounted by the composition root with `config.hmacKey` and
 * `config.base64Media`. Pure and I/O-free, so `views` can inject `ctx.media`
 * alone and generate links without mounting the proxy routes.
 */
import type { Context } from "cordis";
import { MediaSignerImpl } from "./sign.ts";
import type { MediaPluginOptions, MediaSigner } from "./types.ts";

declare module "cordis" {
  interface Context {
    /** Media URL signing (pic/origPic/vid link generation, HMAC verification). */
    media: MediaSigner;
  }
}

export default function mediaPlugin(ctx: Context, options: MediaPluginOptions = {}): () => void {
  const signer = new MediaSignerImpl(options);
  if (options.hmacKey === undefined || options.hmacKey === "secretkey") {
    // nitter warns about the insecure default in `nitter.nim`; `/video/` links
    // are only as trustworthy as this key, so say it where it can be acted on.
    ctx.logger.warn(
      "media: using the default hmacKey; set a unique random value in nitter.conf " +
        "or media links are forgeable",
    );
  }
  const dispose = ctx.provide("media", signer);
  return () => {
    void dispose();
  };
}
