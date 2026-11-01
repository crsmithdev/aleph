// One project: `#/projects/<key>`. The page loads one view module per path, so
// this file is the detail route of views/projects.js and shares its renderers.
import { hashQuery, setQuery } from "../lib.js";
import { NOTES, renderDetail } from "./projects.js";

export const view = {
  path: "/projects/:key",
  title: "Project",
  group: "work",
  order: 1,
  api: "/api/projects/:key",
  refresh: 30,
  render: (p, _params, q) => renderDetail(p, Number(q?.get("limit")) || undefined),
  mount: (root, p) => {
    root.onclick = (e) => {
      const m = e.target.closest?.("[data-more]");
      if (!m) return;
      const limit = (Number(hashQuery().get("limit")) || NOTES) + Number(m.dataset.more);
      setQuery({ limit: String(limit) });
      root.innerHTML = renderDetail(p, limit);
    };
  },
};
