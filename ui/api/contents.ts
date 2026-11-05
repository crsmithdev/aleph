/**
 * `GET /api/contents`: the Inventory view's data: `{ issues, projects, tests }`, the rows of `/api/issues`, each with
 * the count and recorded cost of the runs on it and its parts, the registry's keys and each project's suite history records. `?project=<key>` shows only that project.
 */
import { suiteHistory } from "../../jobs/lib/factory-status.ts";
import { allRuns, loadRegistry, onOf } from "../../jobs/lib/ledger.ts";
import type { Routes } from "../server.ts";
import { routes as issueRoutes, type Row } from "./issues.ts";

/** Each issue's and part's runs and cost, by `<repo>-<ref>`. A part's run also counts for its issue. */
function runTotals(): Map<string, { runs: number; cost: number }> {
  const totals = new Map<string, { runs: number; cost: number }>();
  const add = (key: string, cost: number) => {
    const t = totals.get(key) ?? { runs: 0, cost: 0 };
    t.runs++; t.cost += cost;
    totals.set(key, t);
  };
  for (const { run } of allRuns()) {
    const on = onOf(run);
    if (on === undefined) continue;
    add(`${run.repo}-${on}`, run.cost ?? 0);
    if (typeof on === "string") add(`${run.repo}-${on.split(".")[0]}`, run.cost ?? 0);
  }
  return totals;
}

export const routes: Routes = {
  "GET /api/contents": async (req, params, url) => {
    const all = new URL(url);
    all.searchParams.set("all", "1");
    const res = await issueRoutes["GET /api/issues"](req, params, all);
    if (!res.ok) return res;
    const project = url.searchParams.get("project");
    const totals = runTotals();
    const issues = ((await res.json()) as Row[]).map((r) => ({ ...r, ...(totals.get(`${r.repo}-${r.ref}`) ?? { runs: 0, cost: 0 }) }));
    const projects = Object.keys(loadRegistry()).filter((k) => !project || k === project);
    return Response.json({ issues, projects, tests: Object.fromEntries(projects.map((k) => [k, suiteHistory(k)])) });
  },
};
