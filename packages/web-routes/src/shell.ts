import type { PrefsService, TseerPreferences } from "@tseer/prefs";
import type { AppReply, AppRequest, HttpMethodInput, HttpServer, RequestHook } from "@tseer/server";
import { BadClientError, InternalError, NoSessionsError, RateLimitError } from "@tseer/types";
import type { Render } from "@tseer/views";
import type { Context } from "cordis";
import { createShowError, type ShowError } from "./errors.ts";

export type WebRouteHandler = (
  req: AppRequest,
  reply: AppReply,
  requestPrefs: TseerPreferences,
) => Promise<void> | void;

export interface WebRouteSpec {
  method: HttpMethodInput;
  path: string;
  handler: WebRouteHandler;
}

export interface RouteShellDeps {
  server: HttpServer;
  render: Render;
  prefs: PrefsService;
}

export interface RouteShell {
  readonly showError: ShowError;
  route(spec: WebRouteSpec): void;
  raw(spec: WebRouteSpec): void;
  hook(handler: RequestHook): void;
  dispose(): void;
}

export type ServiceResolver = <T>(service: string) => T;

const SERVICE_PLUGIN_NAMES: Record<string, string> = {
  server: "serverPlugin",
  twitter: "twitterApiPlugin",
  render: "renderPlugin",
  prefs: "prefsPlugin",
};

export function createRouteShell(deps: RouteShellDeps): RouteShell {
  const { server, prefs } = deps;
  const showError = createShowError(deps.render);
  const disposers: (() => void)[] = [];

  const translateErrors = async (
    reply: AppReply,
    requestPrefs: TseerPreferences,
    body: () => Promise<void> | void,
  ): Promise<void> => {
    try {
      await body();
    } catch (error) {
      if (error instanceof RateLimitError) {
        showError(
          reply,
          "Instance has been rate limited. Use another instance or try again later.",
          429,
          requestPrefs,
        );
        return;
      }
      if (error instanceof NoSessionsError) {
        showError(
          reply,
          "Instance has no auth tokens, or is fully rate limited. Use another instance or try again later.",
          429,
          requestPrefs,
        );
        return;
      }
      if (error instanceof InternalError) {
        showError(
          reply,
          "An error occurred, please open a GitHub issue with the URL you tried to visit.",
          500,
          requestPrefs,
        );
        return;
      }
      if (error instanceof BadClientError) {
        showError(reply, "Network error occurred, please try again.", 500, requestPrefs);
        return;
      }
      throw error;
    }
  };

  const register = (spec: WebRouteSpec, translate: boolean): void => {
    disposers.push(
      server.route({
        method: spec.method,
        path: spec.path,
        handler: (req, reply) => {
          const requestPrefs = prefs.parse(req.cookies, req.query);
          if (!translate) return spec.handler(req, reply, requestPrefs);
          return translateErrors(reply, requestPrefs, () => spec.handler(req, reply, requestPrefs));
        },
      }),
    );
  };

  return {
    showError,
    route: (spec) => register(spec, true),
    raw: (spec) => register(spec, false),
    hook: (handler) => {
      disposers.push(server.hook(handler));
    },
    dispose: () => {
      for (const dispose of disposers) dispose();
    },
  };
}

export function mountRoutes(
  ctx: Context,
  plugin: string,
  requires: readonly string[],
  register: (resolve: ServiceResolver, shell: RouteShell) => (() => void) | void,
): () => void {
  for (const service of ["server", "render", "prefs", ...requires]) {
    if (ctx.get(service as never) === undefined) {
      const from = SERVICE_PLUGIN_NAMES[service] ?? `${service}Plugin`;
      throw new Error(`${plugin}: ctx.${service} is not mounted (load ${from} first)`);
    }
  }
  const shell = createRouteShell({
    server: ctx.get("server" as never) as unknown as HttpServer,
    render: ctx.get("render" as never) as unknown as Render,
    prefs: ctx.get("prefs" as never) as unknown as PrefsService,
  });
  const resolve: ServiceResolver = (service) => ctx.get(service as never) as never;
  const disposeRoutes = register(resolve, shell) ?? (() => {});
  const disposeEffect = ctx.effect(() => () => {
    disposeRoutes();
  });
  return () => {
    disposeRoutes();
    void disposeEffect();
  };
}
