import type { List } from "@tseer/types";
import { type Query, QueryKind } from "@tseer/types";
import type { VNode } from "preact";
import { getPicUrl } from "./media.ts";
import { genImg, getTabClass } from "./renderutils.tsx";

export function renderListTabs(query: Query, path: string): VNode {
  return (
    <ul class="tab">
      <li class={getTabClass(query, QueryKind.posts)}>
        <a href={path}>Tweets</a>
      </li>
      <li class={getTabClass(query, QueryKind.userList)}>
        <a href={`${path}/members`}>Members</a>
      </li>
    </ul>
  );
}

export function renderList(body: VNode, query: Query, list: List): VNode {
  return (
    <div class="timeline-container">
      {list.banner.length > 0 && (
        <div class="timeline-banner">
          <a href={getPicUrl(list.banner)} target="_blank" rel="noopener">
            {genImg(list.banner)}
          </a>
        </div>
      )}
      <div class="timeline-header">
        {`"${list.name}" by @${list.username}`}
        <div class="timeline-description">{list.description}</div>
      </div>
      {renderListTabs(query, `/i/lists/${list.id}`)}
      {body}
    </div>
  );
}
