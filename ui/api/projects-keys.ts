/** `GET /api/projects/keys`: the registry's repo keys, for the sidebar's project picker. */
import { loadRegistry } from "../../jobs/lib/ledger.ts";
import type { Routes } from "../server.ts";

export const routes: Routes = {
  "GET /api/projects/keys": () => Response.json(Object.keys(loadRegistry()).sort()),
};
