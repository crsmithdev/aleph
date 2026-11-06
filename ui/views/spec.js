// #/specs/<project>/<file>: one spec, rendered as Markdown with the renderer the Memory note view uses.
// The page reads one `view` per file, so the spec route is its own file.
import { crumb, esc, md, pageHead } from "../lib.js";

export const view = {
  path: "/specs/:project/:file",
  title: "Spec",
  group: "factory",
  api: (params) => `/api/specs/${encodeURIComponent(params.project)}/${encodeURIComponent(params.file)}`,
  render: (s) => renderSpec(s),
};

function renderSpec(s) {
  return `<div class="page">${crumb("#/issues", [["issues", "#/issues"], [s.project, `#/issues?project=${encodeURIComponent(s.project)}`], [s.file]])}${pageHead(s.title)}` +
    `<p class="hint"><code>${esc(s.project)}/docs/specs/${esc(s.file)}</code></p>` +
    `<article class="note">${md(s.body)}</article></div>`;
}
