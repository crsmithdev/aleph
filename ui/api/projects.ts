/**
 * `GET /api/projects`: each registry repo key, sorted, with its ID code (null for a repo with none), its count of open
 * issues and whether it is onboarded: its agent runs are factory runs (`sandbox` in the registry).
 */
import { loadRegistry } from "../../jobs/lib/records/ledger.ts";
import { readLists } from "../../issues/lib/store.ts";
import { status } from "../../issues/lib/todo.ts";
import type { Routes } from "../server.ts";

export const routes: Routes = {
  "GET /api/projects": () => {
    const repos = Object.values(loadRegistry()).sort((a, b) => a.key.localeCompare(b.key));
    // The codes route every ID on the page, so a work store that cannot be read gives counts of 0, not an error.
    let docs: ReturnType<typeof readLists> = [];
    try { docs = readLists(repos); } catch { /* counts of 0 */ }
    return Response.json(Object.fromEntries(repos.map((r, n) => [r.key, {
      code: r.code ?? null, issues: docs[n]?.items.filter((i) => status(i) === "open").length ?? 0, onboarded: r.sandbox,
    }])));
  },
};
