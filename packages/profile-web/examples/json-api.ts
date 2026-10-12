import type { HttpServer } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import type { Context } from "cordis";

export default function jsonStatus(ctx: Context): () => void {
  const server = ctx.get("server" as never) as HttpServer | undefined;
  const twitter = ctx.get("twitter" as never) as TwitterApi | undefined;
  if (server === undefined)
    throw new Error("json-api: ctx.server is not mounted (load serverPlugin first)");
  if (twitter === undefined)
    throw new Error("json-api: ctx.twitter is not mounted (load twitterApiPlugin first)");

  const disposeRoute = server.route({
    method: "GET",
    path: "/status/:id.json",
    handler: async (req, reply) => {
      const id = req.params["id"] ?? "";
      if (!/^\d+$/.test(id)) {
        reply.json({ errors: [{ code: 44, message: "Invalid tweet ID" }] }, { status: 400 });
        return;
      }
      try {
        const conversation = await twitter.tweet(id);
        if (conversation === undefined) {
          reply.json({ errors: [{ message: "Tweet not found" }] }, { status: 404 });
          return;
        }
        reply.json(conversation.tweet);
      } catch (err) {
        reply.json(
          { errors: [{ message: err instanceof Error ? err.message : String(err) }] },
          { status: 502 },
        );
      }
    },
  });
  const disposeEffect = ctx.effect(() => () => {
    disposeRoute();
  });
  return () => {
    disposeRoute();
    void disposeEffect();
  };
}

jsonStatus.inject = ["server", "twitter"];
