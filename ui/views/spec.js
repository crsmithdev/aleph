// #/specs/<project>/<file>: one spec, rendered as Markdown with the renderer the Memory note view uses.
// The page reads one `view` per file, so the spec route is its own file.
import { crumb, esc, facts, md, pageHead } from "../lib.js";
import { panel } from "../timeline.js";

export const view = {
  path: "/specs/:project/:file",
  title: "Spec",
  group: "factory",
  api: (params) => `/api/specs/${encodeURIComponent(params.project)}/${encodeURIComponent(params.file)}`,
  render: (s) => renderSpec(s),
};

function renderSpec(s) {
  return `<div class="page dp-page">${crumb("#/issues", [["issues", "#/issues"], [s.project, `#/issues?project=${encodeURIComponent(s.project)}`], [s.file]])}${pageHead(s.title)}` +
    facts([["File", `<code>${esc(s.project)}/docs/specs/${esc(s.file)}</code>`]]) +
    panel("spec", "Spec", `<div class="md">${md(s.body)}</div>`) + `</div>`;
}
