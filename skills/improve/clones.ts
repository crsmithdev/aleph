/**
 * jscpd over the repo, with the repo's `.jscpd.json`: the copies of code (renamed copies too, when the config sets
 * `ignoreIdentifiers` and `ignoreLiterals`) and the copies of code a boundary keeps in its owner. One run answers
 * both. Given a base commit, each clone says whether the base already had it.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const JSCPD = join(import.meta.dir, "../../node_modules/.bin/jscpd");

export type Side = { name: string; start: number; end: number };
export type Clone = { a: Side; b: Side; lines: number; isNew: boolean };
export type Violation = { rule: string; copy: Side & { function?: string }; owner: Side & { function?: string } };

/** The clones and boundary violations of the working tree, or nothing when the repo has no `.jscpd.json`. */
export function scan(root: string, base?: string): { clones: Clone[]; violations: Violation[] } {
  if (!existsSync(join(root, ".jscpd.json"))) return { clones: [], violations: [] };
  const out = mkdtempSync(join(tmpdir(), "improve-"));
  try {
    Bun.spawnSync([JSCPD, "--reporters", "json", "--output", out, "--silent", ...(base ? ["--baseline-from-ref", base] : []), "."], { cwd: root, stdout: "ignore", stderr: "ignore" });
    const report = JSON.parse(readFileSync(join(out, "jscpd-report.json"), "utf8"));
    const side = (f: any) => ({ name: f.name, start: f.start, end: f.end, ...(f.function ? { function: f.function } : {}) });
    return {
      clones: report.duplicates.map((d: any) => ({ a: side(d.firstFile), b: side(d.secondFile), lines: d.lines, isNew: d.isNew === true })),
      violations: (report.boundaries ?? []).flatMap((b: any) => b.violations.map((v: any) => ({ rule: b.name, copy: side(v.copy), owner: side(v.protected) }))),
    };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
