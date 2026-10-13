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
          No followed accounts configured for this instance.
          <br />
          Set the TSEER_HOME_FOLLOWS environment variable or the [Home] follows key in the
          configuration file to a comma-separated list of usernames.
        </div>
      </div>
    </div>
  );
}
