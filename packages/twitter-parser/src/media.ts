export type PicUrl = (url: string) => string;

let picUrlBuilder: PicUrl | undefined;

export function setPicUrl(builder: PicUrl | undefined): PicUrl | undefined {
  const previous = picUrlBuilder;
  picUrlBuilder = builder;
  return previous;
}

export function getPicUrl(link: string): string {
  if (link.length === 0) return "";
  return picUrlBuilder ? picUrlBuilder(link) : "";
}
