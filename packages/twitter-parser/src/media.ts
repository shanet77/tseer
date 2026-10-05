/**
 * The media-link seam for the parsers. nitter's `utils.nim` builds `/pic/`
 * proxy links at *parse* time through process-global state
 * (`setHmacKey`/`setProxyEncoding`); the port keeps that shape with a setter
 * the `parsers` plugin wires to `ctx.media` at mount. Unset (parsers used
 * standalone, e.g. in tests), card image fallbacks get no proxy link.
 */
export type PicUrl = (url: string) => string;

let picUrlBuilder: PicUrl | undefined;

/** Mount-time wiring; returns the previous builder for the disposer. */
export function setPicUrl(builder: PicUrl | undefined): PicUrl | undefined {
  const previous = picUrlBuilder;
  picUrlBuilder = builder;
  return previous;
}

/** Port of `getPicUrl("")` semantics: empty in, empty out. */
export function getPicUrl(link: string): string {
  if (link.length === 0) return "";
  return picUrlBuilder ? picUrlBuilder(link) : "";
}
