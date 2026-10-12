import type { Context } from "cordis";
import { MediaSignerImpl } from "./sign.ts";
import type { MediaPluginOptions, MediaSigner } from "./types.ts";

declare module "cordis" {
  interface Context {
    media: MediaSigner;
  }
}

export default function mediaPlugin(ctx: Context, options: MediaPluginOptions = {}): () => void {
  const signer = new MediaSignerImpl(options);
  if (options.hmacKey === undefined || options.hmacKey === "secretkey") {
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
