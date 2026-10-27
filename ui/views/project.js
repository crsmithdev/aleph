// One project: `#/projects/<key>`. The page loads one view module per path, so
// this file is the detail route of views/projects.js and shares its renderers.
import { renderDetail } from "./projects.js";

export const view = {
  path: "/projects/:key",
  title: "Project",
  group: "work",
  order: 1,
  api: "/api/projects/:key",
  refresh: 30,
  render: (p) => renderDetail(p),
};
