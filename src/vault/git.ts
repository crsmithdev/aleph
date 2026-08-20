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

export function commit(cwd: string, paths: string[], message: string, trailers: Record<string, string> = {}): string | null {
  const add = git(cwd, ["add", "--", ...paths]);
  if (!add.ok) return null;
  const staged = git(cwd, ["diff", "--cached", "--name-only"]);
  if (!staged.stdout) return null;
  const body = [message, "", ...Object.entries(trailers).map(([k, v]) => `${k}: ${v}`)].join("\n");
  const c = git(cwd, ["commit", "-q", "-m", body]);
  if (!c.ok) return null;
  return git(cwd, ["rev-parse", "HEAD"]).stdout;
}

export function isClean(cwd: string): boolean {
  return git(cwd, ["status", "--porcelain"]).stdout === "";
}
