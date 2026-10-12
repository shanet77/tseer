import { type PrefMeta, prefList, type TseerPreferences } from "@tseer/prefs";
import { Fragment, type VNode } from "preact";
import { buttonReferer, genCheckbox, genInput, genSelect, refererField } from "./renderutils.tsx";

function prefState(prefs: TseerPreferences, pref: PrefMeta): boolean | string {
  return (prefs as unknown as Record<string, boolean | string>)[pref.name] ?? pref.default;
}

function renderPref(pref: PrefMeta, prefs: TseerPreferences, themes: readonly string[]): VNode {
  const state = prefState(prefs, pref);
  if (pref.kind === "checkbox") return genCheckbox(pref.name, pref.label, state === true);
  if (pref.kind === "input") {
    return genInput(pref.name, pref.label, String(state), pref.placeholder ?? "");
  }
  const options = pref.name === "theme" ? themes : (pref.options ?? []);
  return genSelect(pref.name, pref.label, String(state), options);
}

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
