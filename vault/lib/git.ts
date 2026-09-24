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

/**
 * The date a path first entered git, YYYY-MM-DD, or null when git has never
 * seen it.
 *
 * The *last* commit date used to stand here, and it lies. A housekeeping
 * commit that touches only frontmatter moves it, so `lint --fix` would have
 * stamped two notes 2026-09-24 when they landed on 2026-09-20 — four days
 * young on the one field the `stale` warning reads. The date a note entered
 * never moves, and under-dating is the safe direction: it asks for a re-check
 * that is not needed, where over-dating hides one that is.
 */
export function addedDate(dir: string, path: string): string | null {
  const r = git(dir, "log", "--diff-filter=A", "-1", "--format=%ad", "--date=short", "--", relative(dir, path));
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

/** Every path git tracks under `dir`, relative and posix-style. */
export function trackedFiles(dir: string, ...pathspec: string[]): string[] {
  const r = git(dir, "ls-files", "--", ...pathspec);
  return r.ok ? r.out.split("\n").map((l) => l.trim()).filter(Boolean) : [];
}
