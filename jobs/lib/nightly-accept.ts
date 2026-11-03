/**
 * The nightly run of the archived goal tests: `bun run accept` on origin/<main>, in a worktree of its own, once a
 * night (jobs/systemd/aleph-accept.timer). The result goes to <factory>/accept-nightly.json. A failure is a health
 * line until a later run passes; it files no issue.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fetchOrigin, git } from "./git.ts";
import { layout } from "./layout.ts";
import type { Repo } from "./ledger.ts";

/** The file that holds the last nightly result. */
export const nightlyFile = () => join(layout().factory, "accept-nightly.json");

/** The longest a run takes before it is killed and counts as a failure. */
const LIMIT_MS = 30 * 60_000;

export interface Nightly { repo: string; at: string; sha: string; ok: boolean; fails: number; tail: string }

/** What `bun run accept` in `cwd` gave: its exit code and output. */
export type Accept = (cwd: string) => { code: number; output: string };

const bunAccept: Accept = (cwd) => {
  const p = Bun.spawnSync(["bun", "run", "accept"], { cwd, stdout: "pipe", stderr: "pipe", timeout: LIMIT_MS });
  return { code: p.exitCode ?? 1, output: p.stdout.toString() + p.stderr.toString() };
};

/** Run `bun run accept` on the repo's origin/<main>, and keep the result in `file`. */
export function runNightly(repo: Repo, run: Accept = bunAccept, file = nightlyFile(), now = new Date()): Nightly {
  const f = fetchOrigin(repo.path, repo.main);
  if (!f.ok) throw new Error(`fetch failed: ${f.out}`);
  const sha = git(repo.path, "rev-parse", "--short=7", `origin/${repo.main}`).out;
  const dir = mkdtempSync(join(tmpdir(), "aleph-accept-"));
  const tree = join(dir, "tree");
  try {
    const w = git(repo.path, "worktree", "add", "-q", "--detach", tree, `origin/${repo.main}`);
    if (!w.ok) throw new Error(`worktree add failed: ${w.out}`);
    // The archive needs the repo's packages; main's own checkout has them.
    symlinkSync(join(repo.path, "node_modules"), join(tree, "node_modules"));
    const r = run(tree);
    const fails = Number(/^\s*(\d+) fail$/m.exec(r.output)?.[1] ?? 0);
    const tail = r.output.trim().split("\n").slice(-20).join("\n");
    const result: Nightly = { repo: repo.key, at: now.toISOString(), sha, ok: r.code === 0 && fails === 0, fails, tail };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(result));
    return result;
  } finally {
    git(repo.path, "worktree", "remove", "--force", tree);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The health line of a failed last run, or null when it passed or never ran. */
export function nightlyLine(file = nightlyFile()): string | null {
  let n: Nightly;
  try { n = JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
  if (n.ok) return null;
  const what = n.fails ? `${n.fails} test${n.fails === 1 ? "" : "s"} failed` : "the run failed";
  return `health: ${n.repo} nightly acceptance run failed at ${n.sha}: ${what}`;
}
