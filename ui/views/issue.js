// The Issue view: one issue, its body, notes, jobs and commits. The shell takes
// one `view` per file, so the detail route has its own; render is in issues.js.
import { renderIssue } from "./issues.js";

export const view = {
  path: "/issues/:repo/:n",
  title: "Issue",
  group: "work",
  api: "/api/issues/:repo/:n",
  render: renderIssue,
};
