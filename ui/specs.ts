/** The specs of the registered repos: `docs/specs/*.md`, by project, date and title. `GET /api/specs/:project/:file` and `GET /api/issues` read them. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRegistry } from "../jobs/lib/records/ledger.ts";

export interface Spec { project: string; file: string; date: string; title: string }

export const NAME = /^[\w.-]+\.md$/;
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
