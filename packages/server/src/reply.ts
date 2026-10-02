/** Map the seam's `AppReply` onto a fastify reply. */
import { Readable } from "node:stream";
import type { FastifyReply } from "fastify";
import type { AppReply, ReplyOptions } from "./types.ts";

function applyReplyOptions(reply: FastifyReply, options: ReplyOptions | undefined): void {
  if (options?.status !== undefined) reply.code(options.status);
  if (options?.headers) {
    for (const [name, value] of Object.entries(options.headers)) reply.header(name, value);
  }
}

/** Map the seam's `AppReply` onto a fastify reply. */
export function toAppReply(reply: FastifyReply): AppReply {
  return {
    html(body, options) {
      applyReplyOptions(reply, options);
      reply.header("content-type", "text/html; charset=utf-8");
      reply.send(body);
    },
    text(body, options) {
      applyReplyOptions(reply, options);
      reply.header("content-type", "text/plain; charset=utf-8");
      reply.send(body);
    },
    json(body, options) {
      applyReplyOptions(reply, options);
      reply.header("content-type", "application/json; charset=utf-8");
      reply.send(JSON.stringify(body));
    },
    redirect(to, status) {
      reply.code(status ?? 302);
      reply.header("location", to);
      reply.send("");
    },
    send(body, contentType, options) {
      applyReplyOptions(reply, options);
      reply.header("content-type", contentType);
      reply.send(body);
    },
    stream(body, contentType, options) {
      // fastify's own stream path is unusable from an `async` handler: the
      // wrapper treats the handler's resolved value as a payload and calls
      // `reply.send(undefined)`, which ends the response before a lazily-pulled
      // stream has produced anything. `hijack()` is fastify's supported way to
      // say "this handler owns the raw response" — and it is the shape nitter's
      // proxy already has, since nitter writes to the raw socket directly.
      //
      // Owning the response also means owning framing: `content-length` from
      // upstream can be forwarded as-is (nitter does), and otherwise Node uses
      // chunked encoding on its own.
      reply.hijack();
      const res = reply.raw;
      res.writeHead(options?.status ?? 200, {
        "content-type": contentType,
        ...options?.headers,
      });

      const source = Readable.from(body, { objectMode: false });
      // If the client disconnects mid-segment, tear down the upstream read too;
      // otherwise a dropped video leaves the origin streaming into the void.
      res.on("close", () => source.destroy());
      source.pipe(res);
    },
  };
}
