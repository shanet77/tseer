/** Port of nitter's `src/views/feature.nim` — the "Unsupported feature" panel
 * that every unported route renders. Text kept verbatim from upstream. */

import type { VNode } from "preact";

export function renderFeature(): VNode {
  return (
    <div class="overlay-panel">
      <h1>Unsupported feature</h1>
      <p>
        Nitter doesn't support this feature yet, but it might in the future. You can check for an
        issue and open one if needed here:{" "}
        <a href="https://github.com/zedeus/nitter/issues">
          https://github.com/zedeus/nitter/issues
        </a>
      </p>
      <p>
        To find out more about the Nitter project, see the <a href="/about">About page</a>
      </p>
    </div>
  );
}
