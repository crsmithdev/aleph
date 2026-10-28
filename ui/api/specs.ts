/**
 * `GET /api/specs` and `GET /api/specs/:project/:file`: each registered repo's `docs/specs/*.md`, one row per file
 * (`{ project, file, date, title }`), and one spec with its body. `?project=<key>` shows only that project.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRegistry } from "../../jobs/lib/ledger.ts";
import type { Routes } from "../server.ts";

export interface Spec { project: string; file: string; date: string; title: string }

const NAME = /^[\w.-]+\.md$/;
const titleOf = (text: string, file: string) => /^# +(.+?)\s*$/m.exec(text)?.[1] ?? file;

/** The specs of the registered repos (or of `only`), newest first. */
export function specs(only: string | null): Spec[] {
  const out: Spec[] = [];
  for (const r of Object.values(loadRegistry())) {
    const dir = join(r.path, "docs", "specs");
    if ((only && r.key !== only) || !existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => NAME.test(f)).sort()) {
      let text = "";
      try { text = readFileSync(join(dir, file), "utf8"); } catch { continue; }
      out.push({ project: r.key, file, date: /^(\d{4}-\d{2}-\d{2})-/.exec(file)?.[1] ?? "", title: titleOf(text, file) });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.project.localeCompare(b.project) || a.file.localeCompare(b.file));
}

export const routes: Routes = {
  "GET /api/specs": (_req, _p, url) => Response.json(specs(url.searchParams.get("project") || null)),
  "GET /api/specs/:project/:file": (_req, params) => {
    const row = NAME.test(params.file) ? specs(params.project).find((s) => s.file === params.file) : undefined;
    if (!row) return Response.json({ error: `no spec ${params.project}/${params.file}` }, { status: 404 });
    const body = readFileSync(join(loadRegistry()[row.project].path, "docs", "specs", row.file), "utf8");
    return Response.json({ ...row, body });
  },
};
