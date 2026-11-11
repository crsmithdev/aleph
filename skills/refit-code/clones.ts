/**
 * jscpd over the repo, with the repo's `.jscpd.json`: the copies of code (renamed copies too, when the config sets
 * `ignoreIdentifiers` and `ignoreLiterals`) and the copies of code a boundary keeps in its owner. One run answers
 * both. Given a base commit, each clone says whether the base already had it.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** The jscpd of the nearest `node_modules` at or above `dir`, so a `.worktrees/<name>` checkout uses its parent's. */
export function jscpd(dir: string): string {
  const bin = join(dir, "node_modules/.bin/jscpd");
  return existsSync(bin) || dirname(dir) === dir ? bin : jscpd(dirname(dir));
}

const JSCPD = jscpd(join(import.meta.dir, "../.."));

type Side = { name: string; start: number; end: number };
export type Clone = { a: Side; b: Side; lines: number; isNew: boolean };
export type Violation = { rule: string; copy: Side & { function?: string }; owner: Side & { function?: string } };

/** The clones and boundary violations of the working tree, or nothing when the repo has no `.jscpd.json`. */
export function scan(root: string, base?: string): { clones: Clone[]; violations: Violation[] } {
  if (!existsSync(join(root, ".jscpd.json"))) return { clones: [], violations: [] };
  const out = mkdtempSync(join(tmpdir(), "refit-"));
  try {
    const run = Bun.spawnSync([process.execPath, JSCPD, "--reporters", "json", "--output", out, "--silent", ...(base ? ["--baseline-from-ref", base] : []), "."], { cwd: root, stdout: "ignore", stderr: "pipe" });
    const file = join(out, "jscpd-report.json");
    if (!existsSync(file)) throw new Error(`jscpd exited ${run.exitCode} and wrote no report: ${run.stderr}`);
    const report = JSON.parse(readFileSync(file, "utf8"));
    const side = (f: any) => ({ name: f.name, start: f.start, end: f.end, ...(f.function ? { function: f.function } : {}) });
    const violations = (report.boundaries ?? []).flatMap((b: any) => b.violations.map((v: any) => ({ rule: b.name, copy: side(v.copy), owner: side(v.protected) })));
    // jscpd exits 1 when it finds a boundary violation; any other failure is an error.
    if (run.exitCode !== 0 && !violations.length) throw new Error(`jscpd exited ${run.exitCode}: ${run.stderr}`);
    return { clones: report.duplicates.map((d: any) => ({ a: side(d.firstFile), b: side(d.secondFile), lines: d.lines, isNew: d.isNew === true })), violations };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
