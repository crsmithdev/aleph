/**
 * A fingerprint of a repo and every worktree it lists, except subagent
 * worktrees under .claude/worktrees: HEAD, status, and a hash of the diff.
 * Two equal fingerprints mean the turn changed nothing.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function git(cwd: string, ...args: string[]): string | null {
  const proc = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "ignore" });
  return proc.exitCode === 0 ? proc.stdout.toString() : null;
}

function worktreesOf(cwd: string): string[] {
  const top = git(cwd, "rev-parse", "--show-toplevel")?.trim();
  if (!top) return [];
  const listed = git(top, "worktree", "list", "--porcelain") ?? "";
  const paths = listed.split("\n").filter((line) => line.startsWith("worktree ")).map((line) => line.slice("worktree ".length));
  // A subagent's worktree under .claude/worktrees holds another agent's edits, not this turn's, unless cwd is in it.
  const own = paths.filter((p) => p === top || !p.includes("/.claude/worktrees/"));
  return own.length ? own : [top];
}

/** Hash of the bytes of every untracked, non-ignored file. A file that vanishes or cannot be read counts as missing. */
function untrackedContents(tree: string): string {
  const names = (git(tree, "ls-files", "--others", "--exclude-standard", "-z") ?? "").split("\0").filter(Boolean).sort();
  const hash = createHash("sha256");
  for (const name of names) {
    let body = "";
    try {
      body = createHash("sha256").update(readFileSync(join(tree, name))).digest("hex");
    } catch {
      body = "unreadable";
    }
    hash.update(name).update("\0").update(body).update("\0");
  }
  return hash.digest("hex");
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
    hash.update(untrackedContents(tree)).update("\0");
  }
  return hash.digest("hex");
}
