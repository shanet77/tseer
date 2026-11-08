import type { TseerPreferences } from "@tseer/prefs";
import type { TimelineResult } from "@tseer/types";
import type { VNode } from "preact";
import { renderTimelineTweets } from "./timeline.tsx";

export function renderHome(results: TimelineResult, prefs: TseerPreferences, path = ""): VNode {
  return (
    <div class="timeline-container">
      <div class="timeline-header">Home</div>
      {renderTimelineTweets(results, prefs, path)}
    </div>
  );
}

export function renderHomeEmpty(): VNode {
  return (
    <div class="timeline-container">
      <div class="timeline-header">Home</div>
      <div class="timeline-item">
        <div class="tweet-content media-body" dir="auto">
          You aren't following anyone yet.
          <br />
          Use the Follow button on a profile, or add usernames under Following in{" "}
          <a href="/settings">preferences</a>. Instance admins can set a default list with the
          TSEER_HOME_FOLLOWS environment variable or the [Home] follows key in the configuration
          file.
        </div>
      </div>
    </div>
  );
}
