// The Jobs page: Runs and Timing (README, Pages). Not built yet: each view's `draw` is still missing.
import { type Page } from "../kit.ts";

export const page: Page = {
  id: "jobs", title: "Jobs", group: "Factory", order: 4, icon: "stopwatch", route: "factory/jobs",
  views: [{ id: "runs", label: "Runs" }, { id: "timing", label: "Timing" }],
  attention: () => [],
};
