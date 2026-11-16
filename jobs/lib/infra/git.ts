/**
 * git for the jobs: a job's commit, a job's worktree and a file at a rev, over
 * the runner in lib/git.ts.
 */
import { git, lockRetry } from "../../../lib/git.ts";

/**
 * Clears what an ended job of that name left, then `git worktree add -q -b <branch> <wt> <base>`. Both write `.git/config`,
 * so when another process holds its lock the whole step is tried again (up to 5 times, the cleanup included). Returns the last result.
 */
export function addWorktree(repo: string, wt: string, branch: string, base: string): { ok: boolean; out: string } {
  const locked = (r: { ok: boolean; out: string }) => !r.ok && r.out.includes("could not lock config file");
  let r = { ok: false, out: "" };
  for (let i = 0; i < 5; i++) {
    if (i) lockRetry.pause();
    git(repo, "worktree", "remove", "--force", wt);
    git(repo, "worktree", "prune");
    const del = git(repo, "branch", "-D", branch);
    r = locked(del) ? del : git(repo, "worktree", "add", "-q", "-b", branch, wt, base);
    if (!locked(r)) break;
  }
  return r;
}
