// #/specs/<project>/<file>: one spec, rendered as Markdown with the renderer the Memory note view uses.
// The page reads one `view` per file, so the spec route is its own file.
import { esc, md, pageHead } from "../lib.js";

export const view = {
  path: "/specs/:project/:file",
  title: "Spec",
  group: "factory",
  order: 3,
  api: (params) => `/api/specs/${encodeURIComponent(params.project)}/${encodeURIComponent(params.file)}`,
  render: (s) => renderSpec(s),
};

export function renderSpec(s) {
  return `<div class="page"><p class="quiet"><a href="#/contents">Contents</a></p>${pageHead(s.title, { count: s.file })}` +
    `<p class="hint"><code>${esc(s.project)}/docs/specs/${esc(s.file)}</code></p>` +
    `<article class="note">${md(s.body)}</article></div>`;
}
