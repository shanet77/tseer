import type { AppReply, AppRequest, HttpServer } from "@tseer/server";
import type { Context } from "cordis";
import { UndiciMediaFetcher } from "./fetcher.ts";
import { getM3u8Url, PROXYABLE_EXTENSIONS, proxifyVideo } from "./hls.ts";
import { collect, DEFAULT_CACHE_CONTROL, proxyMedia, safeFetchText } from "./proxy.ts";
import type { MediaFetcher, MediaRoutePluginOptions, MediaSigner } from "./types.ts";
import { decodeSegment, isTwitterUrl, normalizeImgUrl, type SegmentEncoding } from "./urls.ts";

const M3U8_MIME = "application/vnd.apple.mpegurl";

const MANIFEST_EXTENSIONS = [".vmap", ".m3u8"];

const AMPLIFY_MARKER = "/amplify_video/";

interface HandlerDeps {
  media: MediaSigner;
  fetcher: MediaFetcher;
  proxyVideos: boolean;
  maxAttempts: number | undefined;
  headersTimeoutMs: number | undefined;
  cacheControl: string;
  onRetry: ((message: string) => void) | undefined;
}

function hasExtension(url: string, extensions: string[]): boolean {
  return extensions.some((ext) => url.includes(ext));
}

function fail(reply: AppReply, status: number): void {
  reply.text("", { status });
}

function readUrl(req: AppRequest, encoding: SegmentEncoding): string {
  return decodeSegment(req.params["url"] ?? "", encoding);
}

function passthroughHeaders(headers: Record<string, string>, cacheControl: string) {
  const out: Record<string, string> = {
    "cache-control": headers["cache-control"] ?? cacheControl,
  };
  const etag = headers["etag"];
  if (etag !== undefined) out["etag"] = etag;
  const length = headers["content-length"];
  if (length !== undefined && /^\d+$/.test(length)) out["content-length"] = length;
  const range = headers["content-range"];
  if (range !== undefined) out["content-range"] = range;
  const acceptRanges = headers["accept-ranges"];
  if (acceptRanges !== undefined) out["accept-ranges"] = acceptRanges;
  return out;
}

async function streamBody(
  reply: AppReply,
  body: AsyncIterable<Uint8Array>,
  contentType: string,
  options: { status?: number | undefined; headers?: Record<string, string> | undefined },
): Promise<void> {
  if (reply.stream) {
    await reply.stream(body, contentType, options);
    return;
  }
  await reply.send(await collect(body), contentType, options);
}

async function servePic(
  req: AppRequest,
  reply: AppReply,
  deps: HandlerDeps,
  encoding: SegmentEncoding,
  original: boolean,
): Promise<void> {
  const raw = readUrl(req, encoding);
  if (raw.length === 0 || raw.includes(AMPLIFY_MARKER)) return fail(reply, 404);

  let url = normalizeImgUrl(raw);
  if (original) url = `${url}?name=orig`;

  if (!isTwitterUrl(url)) return fail(reply, 404);

  const result = await proxyMedia(url, {
    fetcher: deps.fetcher,
    maxAttempts: deps.maxAttempts,
    headersTimeoutMs: deps.headersTimeoutMs,
    cacheControl: deps.cacheControl,
    onRetry: deps.onRetry,
  });
  if (!result.ok) return fail(reply, result.status);

  if (req.headers["if-none-match"] === result.etag) {
    result.abort();
    return reply.text("", {
      status: 304,
      headers: { etag: result.etag, "cache-control": deps.cacheControl },
    });
  }

  const contentType = result.headers["content-type"] ?? "application/octet-stream";
  await streamBody(reply, result.body, contentType, {
    status: 200,
    headers: passthroughHeaders(result.headers, deps.cacheControl),
  });
}

async function serveVideo(
  req: AppRequest,
  reply: AppReply,
  deps: HandlerDeps,
  encoding: SegmentEncoding,
): Promise<void> {
  const url = readUrl(req, encoding);
  if (!isTwitterUrl(url)) return fail(reply, 403);

  const signature = req.params["sig"] ?? "";
  if (!deps.media.verify(url, signature)) return fail(reply, 403);

  if (PROXYABLE_EXTENSIONS.test(url)) {
    const range = req.headers["range"];
    const rangeHeaders =
      range !== undefined && /^bytes=\d*-\d*$/.test(range) ? { range } : undefined;
    const result = await proxyMedia(url, {
      fetcher: deps.fetcher,
      maxAttempts: deps.maxAttempts,
      headersTimeoutMs: deps.headersTimeoutMs,
      cacheControl: deps.cacheControl,
      headers: rangeHeaders,
      onRetry: deps.onRetry,
    });
    if (!result.ok) return fail(reply, result.status);
    if (rangeHeaders === undefined && req.headers["if-none-match"] === result.etag) {
      result.abort();
      return reply.text("", {
        status: 304,
        headers: { etag: result.etag, "cache-control": deps.cacheControl },
      });
    }
    const contentType = result.headers["content-type"] ?? "application/octet-stream";
    await streamBody(reply, result.body, contentType, {
      status: result.status,
      headers: passthroughHeaders(result.headers, deps.cacheControl),
    });
    return;
  }

  if (hasExtension(url, MANIFEST_EXTENSIONS)) {
    const fetchText = (target: string): Promise<string> =>
      safeFetchText(target, {
        fetcher: deps.fetcher,
        maxAttempts: deps.maxAttempts,
        headersTimeoutMs: deps.headersTimeoutMs,
        onRetry: deps.onRetry,
      });
    let manifestUrl = url;
    if (url.includes(".vmap")) {
      const resolved = getM3u8Url(await fetchText(url));
      if (resolved.length === 0) return fail(reply, 404);
      manifestUrl = resolved;
    }
    const playlist = await fetchText(manifestUrl);
    if (playlist.length === 0) return fail(reply, 404);

    const rewritten = proxifyVideo(playlist, {
      proxy: deps.proxyVideos,
      manifestUrl,
      vidUrl: (target) => deps.media.vidUrl(target),
    });
    await reply.send(rewritten, M3U8_MIME, {
      status: 200,
      headers: { "cache-control": deps.cacheControl },
    });
    return;
  }

  fail(reply, 404);
}
interface PicRoute {
  encoding: SegmentEncoding;
  original: boolean;
  path: string;
}

const PIC_ROUTES: PicRoute[] = [
  { path: "/pic/orig/enc/:url", encoding: "enc", original: true },
  { path: "/pic/orig/:url", encoding: "percent", original: true },
  { path: "/pic/enc/:url", encoding: "enc", original: false },
  { path: "/pic/:url", encoding: "percent", original: false },
];

const VIDEO_ROUTES: { path: string; encoding: SegmentEncoding }[] = [
  { path: "/video/enc/:sig/:url", encoding: "enc" },
  { path: "/video/:sig/:url", encoding: "percent" },
];

function registerRoutes(server: HttpServer, deps: HandlerDeps): () => void {
  const disposers = [
    server.route({ method: "GET", path: "/pic", handler: (_req, reply) => fail(reply, 404) }),
    ...PIC_ROUTES.map((route) =>
      server.route({
        method: "GET",
        path: route.path,
        handler: (req, reply) => servePic(req, reply, deps, route.encoding, route.original),
      }),
    ),
    ...VIDEO_ROUTES.map((route) =>
      server.route({
        method: "GET",
        path: route.path,
        handler: (req, reply) => serveVideo(req, reply, deps, route.encoding),
      }),
    ),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}

export default function mediaRoutePlugin(
  ctx: Context,
  options: MediaRoutePluginOptions = {},
): () => void {
  const server = ctx.get("server") as HttpServer | undefined;
  if (!server) throw new Error("media: ctx.server is not mounted (load serverPlugin first)");
  const media = ctx.get("media") as MediaSigner | undefined;
  if (!media) throw new Error("media: ctx.media is not mounted (load mediaPlugin first)");

  const fetcher = options.fetcher ?? new UndiciMediaFetcher(options);
  const disposeFetcher = options.fetcher === undefined ? () => void fetcher.close() : undefined;

  const deps: HandlerDeps = {
    media,
    fetcher,
    proxyVideos: options.proxyVideos ?? true,
    maxAttempts: options.maxAttempts,
    headersTimeoutMs: options.headersTimeoutMs,
    cacheControl: options.cacheControl ?? DEFAULT_CACHE_CONTROL,
    onRetry: (message) => ctx.logger.debug(message),
  };

  const disposeRoutes = registerRoutes(server, deps);
  const disposeEffect = ctx.effect(() => () => {
    disposeRoutes();
    disposeFetcher?.();
  });
  return () => {
    disposeRoutes();
    disposeFetcher?.();
    void disposeEffect();
  };
}

mediaRoutePlugin.inject = ["server", "media"];
