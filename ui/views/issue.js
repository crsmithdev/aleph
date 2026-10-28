// The Issue view: one issue, its body, notes, jobs and commits. The shell takes
// one `view` per file, so the detail route has its own; render is in contents.js.
import { renderIssue } from "./contents.js";

export const view = {
  path: "/issues/:repo/:n",
  title: "Issue",
  group: "work",
  api: "/api/issues/:repo/:n",
  render: renderIssue,
};
