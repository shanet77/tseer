import type { TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest } from "@tseer/server";
import type { TwitterApi } from "@tseer/twitter-api";
import type { Render } from "@tseer/views";
import { replaceUrls } from "@tseer/views";
import type { Context } from "cordis";
import { mountRoutes, type RouteShell } from "./shell.ts";

export interface ResolverRouteDeps {
  twitter: TwitterApi;
  render: Render;
  shell: RouteShell;
}

export function cardUrl(card: string, id: string): string {
  return `https://cards.twitter.com/cards/${card}/${id}`;
}

export function tcoUrl(url: string): string {
  return `https://t.co/${url}`;
}

export function registerResolverRoutes(deps: ResolverRouteDeps): () => void {
  const { twitter, shell } = deps;
  const { route, showError } = shell;

  async function showResolved(
    _req: AppRequest,
    reply: AppReply,
    url: string,
    kind: "card" | "t.co",
    requestPrefs: TseerPreferences,
  ): Promise<void> {
    const location = replaceUrls(await twitter.resolve(url), requestPrefs);
    if (location.length === 0) {
      showError(reply, `Invalid ${kind} link`, 200, requestPrefs);
      return;
    }
    await reply.redirect(location);
  }

  route({
    method: "GET",
    path: "/cards/:card/:id",
    handler: (req, reply, requestPrefs) =>
      showResolved(
        req,
        reply,
        cardUrl(req.params["card"] ?? "", req.params["id"] ?? ""),
        "card",
        requestPrefs,
      ),
  });

  route({
    method: "GET",
    path: "/t.co/:url",
    handler: (req, reply, requestPrefs) =>
      showResolved(req, reply, tcoUrl(req.params["url"] ?? ""), "t.co", requestPrefs),
  });

  return shell.dispose;
}

export default function resolverPlugin(ctx: Context): () => void {
  return mountRoutes(ctx, "resolver", ["twitter"], (resolve, shell) =>
    registerResolverRoutes({
      twitter: resolve<TwitterApi>("twitter"),
      render: resolve<Render>("render"),
      shell,
    }),
  );
}

resolverPlugin.inject = ["server", "twitter", "render", "prefs"];
