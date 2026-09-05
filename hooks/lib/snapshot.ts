/**
 * A fingerprint of a repo and every worktree it lists: HEAD, status, and a
 * hash of the diff. Two equal fingerprints mean the turn changed nothing.
 */
import { createHash } from "node:crypto";

function git(cwd: string, ...args: string[]): string | null {
  const proc = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "ignore" });
  return proc.exitCode === 0 ? proc.stdout.toString() : null;
}

function worktreesOf(cwd: string): string[] {
  const top = git(cwd, "rev-parse", "--show-toplevel")?.trim();
  if (!top) return [];
  const listed = git(top, "worktree", "list", "--porcelain") ?? "";
  const paths = listed.split("\n").filter((line) => line.startsWith("worktree ")).map((line) => line.slice("worktree ".length));
  return paths.length ? paths : [top];
}

/** null when cwd is not inside a git repo. */
export function snapshot(cwd: string): string | null {
  const trees = worktreesOf(cwd);
  if (trees.length === 0) return null;
  const hash = createHash("sha256");
  for (const tree of trees) {
    hash.update(tree).update("\0");
    hash.update(git(tree, "rev-parse", "HEAD") ?? "").update("\0");
    hash.update(git(tree, "status", "--porcelain=v2", "--untracked-files=all") ?? "").update("\0");
    hash.update(git(tree, "diff", "HEAD") ?? "").update("\0");
  }
  return hash.digest("hex");
}
