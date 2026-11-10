/** `GET /api/projects`: each registry repo key and its ID code (null for a repo with none), sorted by key. */
import { loadRegistry } from "../../jobs/lib/records/ledger.ts";
import type { Routes } from "../server.ts";

export const routes: Routes = {
  "GET /api/projects": () => Response.json(Object.fromEntries(Object.values(loadRegistry()).sort((a, b) => a.key.localeCompare(b.key)).map((r) => [r.key, r.code ?? null]))),
};
