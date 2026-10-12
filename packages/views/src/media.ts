export interface MediaUrlSigners {
  picUrl(url: string): string;
  origPicUrl(url: string): string;
  vidUrl(url: string): string;
}

let signers: MediaUrlSigners | undefined;

export function setMediaSigners(next: MediaUrlSigners | undefined): MediaUrlSigners | undefined {
  const previous = signers;
  signers = next;
  return previous;
}

function signed(build: ((url: string) => string) | undefined, link: string): string {
  return link.length === 0 || build === undefined ? "" : build(link);
}

export function getPicUrl(link: string): string {
  return signed(signers?.picUrl, link);
}

export function getOrigPicUrl(link: string): string {
  return signed(signers?.origPicUrl, link);
}

export function getVidUrl(link: string): string {
  return signed(signers?.vidUrl, link);
}
