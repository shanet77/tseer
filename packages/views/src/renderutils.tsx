import type { TseerPreferences } from "@tseer/prefs";
import type { Query, QueryKind, User } from "@tseer/types";
import type { VNode } from "preact";
import { getPicUrl } from "./media.ts";

export const smallWebp = "?name=small&format=webp";
export const mediumWebp = "?name=medium&format=webp";

export function getSmallPic(url: string): string {
  if (url.length === 0) return "";
  let result = url;
  if (!url.includes("?") && !url.endsWith("placeholder.png")) result += smallWebp;
  return getPicUrl(result);
}

export function getMediumPic(url: string): string {
  if (url.length === 0) return "";
  let result = url;
  if (!url.includes("?") && !url.endsWith("placeholder.png")) result += mediumWebp;
  return getPicUrl(result);
}

export function icon(name: string, label = "", title = "", className = "", href = ""): VNode {
  let c = `icon-${name}`;
  if (className.length > 0) c = `${c} ${className}`;
  const glyph =
    href.length > 0 ? (
      // biome-ignore lint/a11y/useAnchorContent: glyph is the CSS class; name via title
      // biome-ignore lint/a11y/useValidAnchor: nitter's fontello icon anchors are contentless
      <a class={c} title={title} href={href} />
    ) : (
      <span class={c} title={title} />
    );
  return (
    <div class="icon-container">
      {glyph}
      {label.length > 0 ? ` ${label}` : ""}
    </div>
  );
}

export function verifiedIcon(user: Pick<User, "verifiedType">): VNode | string {
  if (user.verifiedType === "None") return "";
  const lower = user.verifiedType.toLowerCase();
  return (
    <div class={`verified-icon ${lower}`}>
      {icon("circle", "", `Verified ${lower} account`, "verified-icon-circle")}
      {icon("ok", "", `Verified ${lower} account`, "verified-icon-check")}
    </div>
  );
}

export function linkUser(
  user: Pick<User, "username" | "fullname"> & { protected?: boolean | undefined },
  className = "",
): VNode {
  const isName = !className.includes("username");
  const href = `/${user.username}`;
  const nameText = isName ? user.fullname : `@${user.username}`;
  return (
    <a href={href} class={className} title={nameText}>
      {nameText}
      {isName && user.protected ? ` ${icon("lock", "", "Protected account")}` : ""}
    </a>
  );
}

export function linkText(text: string, className = ""): VNode {
  const url = text.includes("http") ? text : `https://${text}`;
  return (
    <a href={url} class={className}>
      {text}
    </a>
  );
}

export function hiddenField(name: string, value: string): VNode {
  return <input name={name} style="display: none" value={value} />;
}

export function refererField(path: string): VNode {
  return hiddenField("referer", path);
}

export function buttonReferer(
  action: string,
  text: string,
  path: string,
  className = "",
  method = "post",
): VNode {
  return (
    <form method={method} action={action} class={className}>
      {refererField(path)}
      <button type="submit">{text}</button>
    </form>
  );
}

export function genCheckbox(pref: string, label: string, state: boolean): VNode {
  return (
    <label class="pref-group checkbox-container" title={pref}>
      {label}
      <input name={pref} type="checkbox" checked={state} />
      <span class="checkbox" />
    </label>
  );
}

export function genInput(
  pref: string,
  label: string,
  state: string,
  placeholder: string,
  className = "",
  autofocus = true,
): VNode {
  return (
    <div class={`pref-group pref-input ${className}`.trim()} title={pref}>
      {label.length > 0 && <label for={pref}>{label}</label>}
      <input
        name={pref}
        type="text"
        placeholder={placeholder}
        value={state}
        autofocus={autofocus && state.length === 0 ? true : undefined}
      />
    </div>
  );
}

export function genSelect(
  pref: string,
  label: string,
  state: string,
  options: readonly string[],
): VNode {
  return (
    <div class="pref-group pref-input" title={pref}>
      <label for={pref}>{label}</label>
      <select name={pref}>
        {options.map((option) => (
          <option value={option} selected={option === state ? true : undefined}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

export function genDate(pref: string, state: string): VNode {
  return (
    <span class="date-input">
      <input name={pref} type="date" value={state} />
      {icon("calendar")}
    </span>
  );
}

export function genNumberInput(
  pref: string,
  label: string,
  state: string,
  placeholder: string,
  className = "",
  autofocus = true,
  min = "0",
): VNode {
  return (
    <div class={`pref-group pref-input ${className}`.trim()}>
      {label.length > 0 && <label for={pref}>{label}</label>}
      <input
        name={pref}
        type="number"
        placeholder={placeholder}
        value={state}
        autofocus={autofocus && state.length === 0 ? true : undefined}
        min={min}
        step="1"
      />
    </div>
  );
}

export function genImg(url: string, className = "", alt = ""): VNode {
  return <img src={getPicUrl(url)} class={className} alt={alt} loading="lazy" />;
}

export function getTabClass(query: Query, tab: QueryKind): string {
  return query.kind === tab ? "tab-item active" : "tab-item";
}

export function getAvatarClass(prefs: TseerPreferences): string {
  return prefs.squareAvatars ? "avatar" : "avatar round";
}
