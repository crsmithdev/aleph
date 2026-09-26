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

/**
 * Push the current branch to `origin`, if there is one. Returns what happened.
 *
 * Best-effort on purpose. The vault held 165 notes and 179 commits on one
 * Windows drive with no remote until 2026-09-26, so every op that commits now
 * pushes; but a write must not fail because the network did. A failure is
 * reported and the commit stands, ready for the next push.
 */
export function pushOrigin(dir: string): { pushed: boolean; detail?: string } {
  if (!git(dir, "remote", "get-url", "origin").ok) return { pushed: false, detail: "no origin" };
  const r = git(dir, "push", "--quiet", "origin", "HEAD");
  return r.ok ? { pushed: true } : { pushed: false, detail: r.out.split("\n").at(-1) ?? "push failed" };
}

/** Every path git tracks under `dir`, relative and posix-style. */
export function trackedFiles(dir: string, ...pathspec: string[]): string[] {
  const r = git(dir, "ls-files", "--", ...pathspec);
  return r.ok ? r.out.split("\n").map((l) => l.trim()).filter(Boolean) : [];
}
