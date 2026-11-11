/**
 * A job's diff and its stat, for the Job page and the Status diff panel. The branch while it exists; a landed job's
 * `run.commit` once the branch is gone; else the `diff.patch` and `diff.stat` that a run folder kept when aleph
 * deleted the branch (`keepDiff`). Null when none of them is there: no diff was recorded.
 */
import { logEvent } from "../../../lib/layout.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../infra/git.ts";
import { loadRegistry, type Entry, type Repo } from "./ledger.ts";

export const DIFF_FILE = "diff.patch";
export const STAT_FILE = "diff.stat";

export interface JobDiff { diff: string; stat: string }

const branchOf = (runs: Entry[]) => runs.findLast((e) => e.run.branch)?.run.branch;

/** The diff and stat of `branch` against its merge base with main, or null when the branch is not there. */
function ofBranch(repo: Repo, branch: string): JobDiff | null {
  const ref = `refs/heads/${branch}`;
  if (!git(repo.path, "rev-parse", "--verify", "-q", ref).ok) return null;
  const mb = git(repo.path, "merge-base", `origin/${repo.main}`, ref);
  if (!mb.ok || !mb.out) return null;
  const base = mb.out.trim();
  const d = git(repo.path, "diff", base, ref);
  if (!d.ok) return null;
  const s = git(repo.path, "diff", "--stat", base, ref);
  return { diff: d.out + "\n", stat: s.ok ? s.out : "" };
}

function ofCommit(repo: Repo, commit: string): JobDiff | null {
  const d = git(repo.path, "diff", `${commit}^1`, commit);
  if (!d.ok) return null;
  const s = git(repo.path, "diff", "--stat", `${commit}^1`, commit);
  return { diff: d.out + "\n", stat: s.ok ? s.out : "" };
}

/** Before aleph deletes `branch`: write its diff and stat into `folder`, when the branch is there to read. */
export function keepDiff(repo: Repo, branch: string | undefined, folder: string): void {
  if (!branch) return;
  try {
    const j = ofBranch(repo, branch);
    if (!j) return;
    writeFileSync(join(folder, DIFF_FILE), j.diff);
    writeFileSync(join(folder, STAT_FILE), j.stat);
  } catch (e: any) { logEvent({ by: "rule", subject: "jobdiff", action: "failed", sub: "error", note: String(e?.message ?? e) }); }
}

function kept(runs: Entry[]): JobDiff | null {
  for (const e of [...runs].reverse()) {
    const p = join(e.folder, DIFF_FILE);
    if (!existsSync(p)) continue;
    const s = join(e.folder, STAT_FILE);
    return { diff: readFileSync(p, "utf8"), stat: existsSync(s) ? readFileSync(s, "utf8") : "" };
  }
  return null;
}

/** The job's diff and stat, from the branch, else the landed commit, else what a run folder kept; null when none. */
export function jobDiff(runs: Entry[]): JobDiff | null {
  const last = runs.at(-1)!.run;
  const repo = last.repo ? loadRegistry()[last.repo] : undefined;
  if (repo) {
    const branch = branchOf(runs);
    const b = branch && ofBranch(repo, branch);
    if (b) return b;
    const commit = runs.findLast((e) => e.run.condition === "landed" && e.run.commit)?.run.commit;
    const c = commit ? ofCommit(repo, commit) : null;
    if (c) return c;
  }
  return kept(runs);
}

export const NO_DIFF = "No diff was recorded for this job.";
