/** nitter's views reach the media signer through process globals
 * (`utils.nim`'s `getPicUrl`/`getOrigPicUrl`/`getVidUrl`, configured from
 * `nitter.conf`). The port keeps that shape: view components call the `get*`
 * helpers below, and the composition root (or `renderPlugin`) installs the
 * signer once. Unset signers — or empty links — produce `""`, which is how
 * views degrade when no media plugin is mounted. */

export interface MediaUrlSigners {
  picUrl(url: string): string;
  origPicUrl(url: string): string;
  vidUrl(url: string): string;
}

let signers: MediaUrlSigners | undefined;

/** Install (or clear) the process-global signers; returns the previous set. */
export function setMediaSigners(next: MediaUrlSigners | undefined): MediaUrlSigners | undefined {
  const previous = signers;
  signers = next;
  return previous;
}

function signed(build: ((url: string) => string) | undefined, link: string): string {
  return link.length === 0 || build === undefined ? "" : build(link);
}

/** utils.nim `getPicUrl` — proxied image URL. */
export function getPicUrl(link: string): string {
  return signed(signers?.picUrl, link);
}

/** utils.nim `getOrigPicUrl` — original-resolution image. */
export function getOrigPicUrl(link: string): string {
  return signed(signers?.origPicUrl, link);
}

/** utils.nim `getVidUrl` — signed video proxy URL. */
export function getVidUrl(link: string): string {
  return signed(signers?.vidUrl, link);
}
