/**
 * `GET /api/contents`: the Contents view's data, the state to browse: `{ issues, projects }`,
 * the rows of `/api/issues` and the cards of `/api/projects`. `?project=<key>` shows only that project.
 */
import type { Routes } from "../server.ts";
import { routes as issueRoutes } from "./issues.ts";
import { projects } from "./projects.ts";

export const routes: Routes = {
  "GET /api/contents": async (req, params, url) => {
    const all = new URL(url);
    all.searchParams.set("all", "1");
    const res = await issueRoutes["GET /api/issues"](req, params, all);
    if (!res.ok) return res;
    return Response.json({ issues: await res.json(), projects: projects(url.searchParams.get("project") || null) });
  },
};
