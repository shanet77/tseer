import type { Context } from "cordis";

export default function staticRoute(ctx: Context): () => void {
  const dir = ctx.config.staticDir.trim();
  if (!dir) return () => {};
  const dispose = ctx.server.static("/", dir);
  const disposeEffect = ctx.effect(() => dispose);
  return () => {
    dispose();
    void disposeEffect();
  };
}

staticRoute.inject = ["server", "config"];
