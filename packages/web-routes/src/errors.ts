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
