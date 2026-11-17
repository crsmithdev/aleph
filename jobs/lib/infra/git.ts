/**
 * git for the jobs: a job's commit, a job's worktree and a file at a rev, over
 * the runner in lib/git.ts.
 */
import { git, lockRetry } from "../../../lib/git.ts";

type Result = { ok: boolean; out: string };
const locked = (r: Result) => !r.ok && r.out.includes("could not lock config file");

/** `step` again, up to 5 times, while another process holds the lock of `.git/config`. Returns the last result. */
function whileLocked(step: () => Result): Result {
  let r: Result = { ok: false, out: "" };
  for (let i = 0; i < 5; i++) {
    if (i) lockRetry.pause();
    r = step();
    if (!locked(r)) break;
  }
  return r;
}

/** Removes the worktree and deletes the branch, each when given; returns the branch delete. Both write `.git/config`. */
function clear(repo: string, wt: string | undefined, branch: string | undefined): Result {
  if (wt) {
    git(repo, "worktree", "remove", "--force", wt);
    git(repo, "worktree", "prune");
  }
  return branch ? git(repo, "branch", "-D", branch) : { ok: true, out: "" };
}

/** A job's worktree, when it has one, and its branch, gone; tried again while `.git/config` is locked. */
export function removeWorktree(repo: string, wt: string | undefined, branch: string | undefined): void {
  whileLocked(() => clear(repo, wt, branch));
}

/**
 * Clears what an ended job of that name left, then `git worktree add -q -b <branch> <wt> <base>`. When another
 * process holds the config lock the whole step is tried again, the cleanup included. Returns the last result.
 */
export function addWorktree(repo: string, wt: string, branch: string, base: string): Result {
  return whileLocked(() => {
    const del = clear(repo, wt, branch);
    return locked(del) ? del : git(repo, "worktree", "add", "-q", "-b", branch, wt, base);
  });
}
