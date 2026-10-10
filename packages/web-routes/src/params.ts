/** Shared find-my-way params — the port of nitter's match-time
 * `cond '.' notin @"name"` (routes/timeline.nim, status.nim, rss.nim, …).
 *
 * Dotted paths (theme assets like `/css/style.css`, icons like `/logo.png`)
 * must never match a user route; they fall through to `staticDir`, exactly
 * like Jester skipping a route whose `cond` fails. Every `:name` (and every
 * `:tab` competing with one) across route families must use the *identical*
 * pattern string: find-my-way merges same-pattern params into one radix
 * node, where static subpaths (`/about`, `/rss`, `/status`) keep precedence
 * over `:tab`. A typo here silently splits the node and lets one family
 * shadow another, so there is exactly one definition. In-handler conds stay
 * the authority for reserved names, charsets, and tab values. */
export const NAME_PARAM = ":name([^.]+)";
export const TAB_PARAM = ":tab([^.]+)";
