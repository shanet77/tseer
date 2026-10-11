/** The error-page helper shared by every route plugin — nitter's
 * `resp showError(message, cfg)` rendered through `ctx.render` with the
 * request's prefs. Status defaults to 200 (nitter's `showError` default);
 * the `guard` wrappers in each plugin pass the mapped code (429/500/404). */

import type { TseerPreferences } from "@tseer/prefs";
import type { AppReply } from "@tseer/server";
import type { Render } from "@tseer/views";

export type ShowError = (
  reply: AppReply,
  message: string,
  status?: number,
  requestPrefs?: TseerPreferences,
) => void;

export function createShowError(render: Render): ShowError {
  return (reply, message, status = 200, requestPrefs) => {
    void reply.html(render.errorPage(message, undefined, requestPrefs), { status });
  };
}
