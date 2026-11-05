/**
 * `GET /api/contents`: the Inventory view's data: `{ issues, projects, tests }`, the rows of `/api/issues`, each with
 * the count and recorded cost of the runs on it and its parts, the registry's keys and each project's suite history records. `?project=<key>` shows only that project.
 */
import { suiteHistory } from "../../jobs/lib/gates/factory-status.ts";
import { allRuns, loadRegistry, onOf } from "../../jobs/lib/records/ledger.ts";
import type { Routes } from "../server.ts";
import { routes as issueRoutes, type Row } from "./issues.ts";

/** Each issue's own runs and cost, by `<repo>-<ref>`. */
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
    const rows = (await res.json()) as Row[];
    const sums = new Map(rows.map((r) => [`${r.repo}-${r.ref}`, { ...(totals.get(`${r.repo}-${r.ref}`) ?? { runs: 0, cost: 0 }) }]));
    // A child's runs also count for its parent.
    for (const r of rows) {
      const own = totals.get(`${r.repo}-${r.ref}`), up = r.parent === null ? undefined : sums.get(`${r.repo}-${r.parent}`);
      if (own && up) { up.runs += own.runs; up.cost += own.cost; }
    }
    const issues = rows.map((r) => ({ ...r, ...sums.get(`${r.repo}-${r.ref}`)! }));
    const projects = Object.keys(loadRegistry()).filter((k) => !project || k === project);
    return Response.json({ issues, projects, tests: Object.fromEntries(projects.map((k) => [k, suiteHistory(k)])) });
  },
};
