/** Thin git wrapper for the vault. Every helper returns real output, never a guess. */
import { spawnSync } from "node:child_process";

export function git(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? "").trim() };
}

export function isRepo(cwd: string): boolean {
  return git(cwd, ["rev-parse", "--git-dir"]).ok;
}

export function initRepo(cwd: string): void {
  git(cwd, ["init", "-q", "-b", "main"]);
  // Identity is set locally so the daemon never depends on a global gitconfig.
  git(cwd, ["config", "user.name", "aleph"]);
  git(cwd, ["config", "user.email", "aleph@localhost"]);
}

/**
 * Three outcomes, not two. "Nothing changed" and "git refused" both used to
 * return null, so a vault that had stopped keeping history looked exactly like a
 * vault with nothing to record — and the caller emitted nothing either way.
 */
export type CommitResult =
  | { status: "committed"; sha: string }
  | { status: "nothing-staged" }
  | { status: "failed"; step: string; error: string };

export function commit(cwd: string, paths: string[], message: string, trailers: Record<string, string> = {}): CommitResult {
  const add = git(cwd, ["add", "--", ...paths]);
  if (!add.ok) return { status: "failed", step: "add", error: add.stderr || "git add failed" };
  const staged = git(cwd, ["diff", "--cached", "--name-only"]);
  if (!staged.stdout) return { status: "nothing-staged" };
  const body = [message, "", ...Object.entries(trailers).map(([k, v]) => `${k}: ${v}`)].join("\n");
  // Commit the pathspec, not the whole index. Without `--`, a concurrent write
  // that had staged another path rode along under this commit's Session:/Event:
  // trailers, which is exactly the joinability the trailers exist to provide.
  const c = git(cwd, ["commit", "-q", "-m", body, "--", ...paths]);
  if (!c.ok) return { status: "failed", step: "commit", error: c.stderr || "git commit failed" };
  const head = git(cwd, ["rev-parse", "HEAD"]);
  if (!head.ok) return { status: "failed", step: "rev-parse", error: head.stderr || "git rev-parse failed" };
  return { status: "committed", sha: head.stdout };
}

export function isClean(cwd: string): boolean {
  return git(cwd, ["status", "--porcelain"]).stdout === "";
}
