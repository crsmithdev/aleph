#!/usr/bin/env bun
/**
 * Co-change from git history: which files change together, and which files the history says are fixed again and
 * again. The seed adds jscpd's copies of code (clones.ts). The retro seeds its hunt with it (`seed`); the Stop hook asks it which companions a change left out (`holes`).
 *
 * A rule A → B says: a commit that changes A also changes B. Its confidence is the Wilson lower bound of
 * co(A,B) / n(A), so a pair seen 3 times of 3 does not outrank one seen 40 times of 44. Merges and commits of more
 * than 30 files teach nothing about pairs and are skipped, and so are test files.
 *
 *   bun cochange.ts seed  [--since 90.days]   JSON: the files fixed most, and the strongest pairs
 *   bun cochange.ts holes                      JSON: companions the current change left out
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scan } from "./clones.ts";

const WIDE = 30;
const SUPPORT = 10;
const FLOOR = 0.6;
export const BLOCK = 0.7;
/** A test changes with its code by design; it is not a second copy of a concept. */
const TEST = /(\.test\.|_test\.|(^|\/)tests?\/)/;
const FIX = /\b(fix|fixes|fixed|stale|mismatch|wrong|again|drift)\b/i;

export type Commit = { sha: string; subject: string; files: string[] };
export type Rule = { a: string; b: string; co: number; n: number; conf: number; shas: string[] };
export type Accepted = { concept?: string; copies: string[]; reason: string };

function git(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return p.exitCode === 0 ? p.stdout.toString() : "";
}

/** The last `limit` commits that are not merges, newest first. */
export function history(cwd: string, limit = 2000, since?: string): Commit[] {
  const out = git(cwd, "log", "--no-merges", "--name-only", "--format=\x1e%h\x1f%s", `-n${limit}`, ...(since ? [`--since=${since}`] : []));
  return out.split("\x1e").slice(1).map((c) => {
    const [head, ...files] = c.split("\n");
    const [sha, subject] = head.split("\x1f");
    return { sha, subject, files: files.filter(Boolean) };
  });
}

const Z = 1.96;

/** The Wilson lower bound of k successes in n trials, at 95%. */
export function wilson(k: number, n: number): number {
  if (n === 0) return 0;
  const p = k / n, z2 = Z * Z;
  return (p + z2 / (2 * n) - Z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n);
}

/** Every rule A → B with n(A) ≥ 10 and confidence ≥ 0.6, keyed by A. */
export function rules(commits: Commit[]): Map<string, Rule[]> {
  const n = new Map<string, number>();
  const co = new Map<string, { k: number; shas: string[] }>();
  for (const c of commits) {
    if (c.files.length > WIDE) continue;
    const files = c.files.filter((f) => !TEST.test(f));
    for (const a of files) {
      n.set(a, (n.get(a) ?? 0) + 1);
      for (const b of files) {
        if (a === b) continue;
        const e = co.get(`${a}\0${b}`) ?? { k: 0, shas: [] };
        e.k++;
        if (e.shas.length < 3) e.shas.push(c.sha);
        co.set(`${a}\0${b}`, e);
      }
    }
  }
  const out = new Map<string, Rule[]>();
  for (const [key, e] of co) {
    const [a, b] = key.split("\0");
    const na = n.get(a)!;
    if (na < SUPPORT) continue;
    const conf = wilson(e.k, na);
    if (conf < FLOOR) continue;
    out.set(a, [...(out.get(a) ?? []), { a, b, co: e.k, n: na, conf, shas: e.shas }]);
  }
  return out;
}

/** The accepted second ways of the repo, from `.improve.json`. */
export function accepted(root: string): Accepted[] {
  const path = join(root, ".improve.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")).accepted ?? []) : [];
}

const fileOf = (copy: string) => copy.split(":")[0];
export const isAccepted = (list: Accepted[], a: string, b: string) =>
  list.some((e) => e.copies.some((c) => fileOf(c) === a) && e.copies.some((c) => fileOf(c) === b));

/** The commit where the branch left the default branch, or "" when there is none. */
export function base(root: string): string {
  return git(root, "merge-base", "HEAD", "origin/HEAD").trim() || git(root, "merge-base", "HEAD", "main").trim();
}

/** The files the current change touches: the branch since it left the default branch, plus the working tree. */
export function changed(root: string, from = base(root)): Set<string> {
  const branch = from ? git(root, "diff", "--name-only", `${from}...HEAD`).split("\n") : [];
  const tree = git(root, "status", "--porcelain", "--untracked-files=all").split("\n").map((l) => l.slice(3).split(" -> ").pop()!);
  return new Set([...branch, ...tree].filter(Boolean));
}

/** For each file a rule predicts and the change left out, the strongest rule that predicts it. */
export function holes(root: string, change: Set<string>, all: Map<string, Rule[]>, ok: Accepted[], floor = BLOCK): Rule[] {
  const best = new Map<string, Rule>();
  for (const a of change) {
    for (const r of all.get(a) ?? []) {
      if (r.conf < floor || change.has(r.b) || !existsSync(join(root, r.b)) || isAccepted(ok, a, r.b)) continue;
      if ((best.get(r.b)?.conf ?? 0) < r.conf) best.set(r.b, r);
    }
  }
  return [...best.values()].sort((x, y) => y.conf - x.conf);
}

/** The files whose commits most often read as a fix, the strongest pairs and the largest copies of code: the retro's first candidates. */
export function seed(root: string, since = "90.days") {
  const commits = history(root, 5000, since);
  const fixes = new Map<string, string[]>();
  for (const c of commits) if (FIX.test(c.subject)) for (const f of c.files) fixes.set(f, [...(fixes.get(f) ?? []), `${c.sha} ${c.subject}`]);
  const pairs = [...rules(commits).values()].flat().sort((x, y) => y.conf - x.conf);
  return {
    fixes: [...fixes].sort((x, y) => y[1].length - x[1].length).slice(0, 25).map(([file, cs]) => ({ file, count: cs.length, commits: cs.slice(0, 5) })),
    pairs: pairs.slice(0, 25).map(({ a, b, co, n, conf }) => ({ a, b, co, n, conf: Math.round(conf * 100) / 100 })),
    clones: scan(root).clones.sort((x, y) => y.lines - x.lines).slice(0, 40).map((c) => `${c.a.name}:${c.a.start}-${c.a.end} ~ ${c.b.name}:${c.b.start}-${c.b.end} (${c.lines} lines)`),
  };
}

if (import.meta.main) {
  const root = git(process.cwd(), "rev-parse", "--show-toplevel").trim() || process.cwd();
  const [cmd, ...rest] = Bun.argv.slice(2);
  const since = rest[rest.indexOf("--since") + 1];
  if (cmd === "seed") console.log(JSON.stringify(seed(root, rest.includes("--since") ? since : undefined), null, 1));
  else if (cmd === "holes") console.log(JSON.stringify(holes(root, changed(root), rules(history(root)), accepted(root)), null, 1));
  else { console.error("usage: bun cochange.ts <seed [--since 90.days]|holes>"); process.exit(2); }
}
