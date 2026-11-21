/**
 * `GET /api/specs/:project/:file`: one spec of a registered repo's `docs/specs/*.md`, with its body.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRegistry } from "../../jobs/lib/records/ledger.ts";
import type { Routes } from "../server.ts";
import { NAME, specs } from "../specs.ts";

export const routes: Routes = {
  "GET /api/specs/:project/:file": (_req, params) => {
    const row = NAME.test(params.file) ? specs(params.project).find((s) => s.file === params.file) : undefined;
    if (!row) return Response.json({ error: `no spec ${params.project}/${params.file}` }, { status: 404 });
    const body = readFileSync(join(loadRegistry()[row.project].path, "docs", "specs", row.file), "utf8");
    return Response.json({ ...row, body });
  },
};
