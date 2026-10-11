/** Port of nitter's `src/views/preferences.nim` — the settings form. The
 * `renderPrefs` macro (which iterates the `prefList` DSL at compile time)
 * becomes a map over the same metadata at render time: one legend per
 * category, then the `genCheckbox`/`genInput`/`genSelect` widget per pref.
 * `theme` is the one special case — its select options are the themes
 * discovered on disk, not the static list (the macro's `themes` argument). */

import { type PrefMeta, prefList, type TseerPreferences } from "@tseer/prefs";
import { Fragment, type VNode } from "preact";
import { buttonReferer, genCheckbox, genInput, genSelect, refererField } from "./renderutils.tsx";

/** The state slot for one pref: booleans for checkboxes, strings otherwise. */
function prefState(prefs: TseerPreferences, pref: PrefMeta): boolean | string {
  return (prefs as unknown as Record<string, boolean | string>)[pref.name] ?? pref.default;
}

/** `genCheckbox`/`genInput`/`genSelect` dispatch, ported from the macro. */
function renderPref(pref: PrefMeta, prefs: TseerPreferences, themes: readonly string[]): VNode {
  const state = prefState(prefs, pref);
  if (pref.kind === "checkbox") return genCheckbox(pref.name, pref.label, state === true);
  if (pref.kind === "input") {
    return genInput(pref.name, pref.label, String(state), pref.placeholder ?? "");
  }
  const options = pref.name === "theme" ? themes : (pref.options ?? []);
  return genSelect(pref.name, pref.label, String(state), options);
}

/**
 * `renderPreferences`: the `/settings` page body. `path` is the referer the
 * save/reset redirects return to (`refPath()`), `themes` comes from
 * `findThemes`, `prefsUrl` is the shareable `?prefs=` bookmark URL.
 */
export function renderPreferences(
  prefs: TseerPreferences,
  path: string,
  themes: readonly string[],
  prefsUrl: string,
): VNode {
  return (
    <div class="overlay-panel">
      <fieldset class="preferences">
        <form method="post" action="/saveprefs" autocomplete="off">
          {refererField(path)}
          {prefList.flatMap((category) => [
            <legend key={`legend-${category.category}`}>{category.category}</legend>,
            ...category.prefs.map((pref) => (
              <Fragment key={pref.name}>{renderPref(pref, prefs, themes)}</Fragment>
            )),
          ])}
          <legend>Bookmark</legend>
          <p class="bookmark-note">
            Save this URL to restore your preferences (?prefs works on all pages)
          </p>
          <pre class="prefs-code">{prefsUrl}</pre>
          <p class="bookmark-note">
            You can override preferences with query parameters (e.g. <code>?hlsPlayback=on</code>).
            These overrides aren't saved to cookies, and links won't retain the parameters. Intended
            for configuring RSS feeds and other cookieless environments. Hover over a preference to
            see its name.
          </p>
          <h4 class="note">
            Preferences are stored client-side using cookies without any personal information.
          </h4>
          <button type="submit" class="pref-submit">
            Save preferences
          </button>
        </form>
        {buttonReferer("/resetprefs", "Reset preferences", path, "pref-reset")}
      </fieldset>
    </div>
  );
}
