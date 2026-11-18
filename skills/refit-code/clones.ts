/**
 * jscpd over the repo, with the repo's `.jscpd.json`: the copies of code (renamed copies too, when the config sets
 * `ignoreIdentifiers` and `ignoreLiterals`) and the copies of code a boundary keeps in its owner. One run answers
 * both. Given a base commit, each clone says whether the base already had it. A clone of import lines alone is no clone.
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

// A statement that imports, or re-exports from, a module; it may span lines.
const IMPORT = /^(?:import\b[^;'"]*?|export\b[^;'"]*?\bfrom\s*)["'][^"']*["'];?[ \t]*$/gm;

/** Whether every line of `side` is a blank line or part of an import statement. */
function isImports(root: string, side: { name: string; start: number; end: number }): boolean {
  const text = readFileSync(join(root, side.name), "utf8");
  const lines = text.split("\n");
  const imported = new Set<number>();
  for (const m of text.matchAll(IMPORT)) {
    const first = text.slice(0, m.index).split("\n").length;
    for (let n = first; n < first + m[0].split("\n").length; n++) imported.add(n);
  }
  return lines.slice(side.start - 1, side.end).every((line, i) => !line.trim() || imported.has(side.start + i));
}

type Side = { name: string; start: number; end: number };
export type Clone = { a: Side; b: Side; lines: number; isNew: boolean };
type Violation = { rule: string; copy: Side & { function?: string }; owner: Side & { function?: string } };

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
    const clones = report.duplicates.map((d: any) => ({ a: side(d.firstFile), b: side(d.secondFile), lines: d.lines, isNew: d.isNew === true }));
    return { clones: clones.filter((c: Clone) => !(isImports(root, c.a) && isImports(root, c.b))), violations };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
