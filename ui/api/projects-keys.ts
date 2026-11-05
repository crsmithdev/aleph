/** `GET /api/projects/keys`: the registry's repo keys, for the sidebar's project picker. `GET /api/projects/codes`: each key's ID code. */
import { loadRegistry } from "../../jobs/lib/records/ledger.ts";
import type { Routes } from "../server.ts";

export const routes: Routes = {
  "GET /api/projects/keys": () => Response.json(Object.keys(loadRegistry()).sort()),
  "GET /api/projects/codes": () => Response.json(Object.fromEntries(Object.values(loadRegistry()).filter((r) => r.code).map((r) => [r.key, r.code]))),
};
