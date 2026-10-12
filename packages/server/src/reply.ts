import { Readable } from "node:stream";
import type { FastifyReply } from "fastify";
import type { AppReply, ReplyOptions } from "./types.ts";

function applyReplyOptions(reply: FastifyReply, options: ReplyOptions | undefined): void {
  if (options?.status !== undefined) reply.code(options.status);
  if (options?.headers) {
    for (const [name, value] of Object.entries(options.headers)) reply.header(name, value);
  }
}

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
    redirect(to, options) {
      applyReplyOptions(reply, options);
      reply.code(options?.status ?? 302);
      reply.header("location", to);
      reply.send("");
    },
    send(body, contentType, options) {
      applyReplyOptions(reply, options);
      reply.header("content-type", contentType);
      reply.send(body);
    },
    stream(body, contentType, options) {
      reply.hijack();
      const res = reply.raw;
      res.writeHead(options?.status ?? 200, {
        "content-type": contentType,
        ...options?.headers,
      });

      const source = Readable.from(body, { objectMode: false });
      res.on("close", () => source.destroy());
      source.pipe(res);
    },
  };
}
