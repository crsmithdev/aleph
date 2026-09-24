import { spawnSync } from "bun";
import { relative } from "node:path";

export const TRAILER = "Co-Authored-By: Claude <noreply@anthropic.com>";

export function git(dir: string, ...args: string[]): { ok: boolean; out: string } {
  const p = spawnSync(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" });
  const out = (p.stdout.toString() + p.stderr.toString()).trim();
  return { ok: p.exitCode === 0, out };
}

export function tracked(dir: string, path: string): boolean {
  return git(dir, "ls-files", "--error-unmatch", "--", relative(dir, path)).ok;
}

/** The last commit date for a path, YYYY-MM-DD, or null when git has never seen it. */
export function lastCommitDate(dir: string, path: string): string | null {
  const r = git(dir, "log", "-1", "--format=%ad", "--date=short", "--", relative(dir, path));
  return r.ok && /^\d{4}-\d{2}-\d{2}$/.test(r.out) ? r.out : null;
}

/**
 * Stage the given paths only and commit with the agent trailer. Returns the
 * short sha, or null when nothing changed.
 *
 * `git add -A` used to stand here. It staged the whole vault, so any file
 * lying in `wiki/` rode into history on the next op's commit, whoever had put
 * it there and whether or not a write had ever accepted it: 67 of the 73 notes
 * that refuse lint on 2026-09-24 entered that way. An op may commit only the
 * paths it touched.
 */
export function commitPaths(dir: string, subject: string, paths: string[]): string | null {
  const rel = [...new Set(paths.map((p) => relative(dir, p)))].filter((p) => p && !p.startsWith(".."));
  if (!rel.length) return null;
  git(dir, "add", "-A", "--", ...rel);
  if (git(dir, "diff", "--cached", "--quiet", "--", ...rel).ok) return null;
  const r = git(dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", `${subject}\n\n${TRAILER}`, "--", ...rel);
  if (!r.ok) throw new Error(`git commit failed: ${r.out}`);
  return git(dir, "rev-parse", "--short", "HEAD").out;
}
