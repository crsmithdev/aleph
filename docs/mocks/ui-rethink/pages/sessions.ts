// The Sessions page: List and Tools & Skills (README, Pages). Not built yet: each view's `draw` is still missing.
import { markLine } from "../../../../ui/views/lib/format.js";
import { now, type Page } from "../kit.ts";

export const page: Page = {
  id: "sessions", title: "Sessions", group: "Claude", order: 5, icon: "comments", route: "sessions",
  views: [{ id: "list", label: "List" }, { id: "tools", label: "Tools & Skills" }],
  // `stale` is the live page's mark of an old index, `{ error, since }`; the snapshot of 2026-11-21 has none.
  attention: (d) => (d.sessions.stale ? [{ tone: "need" as const, text: markLine("Sessions", d.sessions.stale, now(d)) }] : []),
};
