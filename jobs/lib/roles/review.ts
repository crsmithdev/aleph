/**
 * The reviewer: a fresh `claude -p` that reads a passing run's diff against its goal, in a detached worktree at the
 * branch's tip, as a `review` job of its own that follows the build.
 */
import { writeFileSync } from "node:fs";
import { git } from "../../../lib/git.ts";
import { errText } from "../../../lib/errtext.ts";
import { atCommit } from "../gates/checks.ts";
import { parseReview, REVIEW_SCHEMA } from "../gates/gate.ts";
import { reviewPrompt, type Review } from "../gates/worker-verdict.ts";
import { reviewDiffMax, reviewSeconds, reviewerCmd } from "../infra/settings.ts";
import type { Run } from "../records/ledger.ts";
import { jobOfFolder, jobSpec, runFile } from "../records/run-files.ts";
import { readModels } from "../routing/models.ts";
import { agentEnv, openRun } from "./agent-run.ts";
import { outsideSurface } from "./issue-spec.ts";

/**
 * The range the reviewer reads: from the merge base to the tip; for a merge run, the newest merge commit
 * ahead of the base, read as its remerge diff (the conflict resolution only). A merge run that made no merge commit reads the whole range.
 */
function reviewRange(cwd: string, run: Run, base: string, tip: string): { from: string; to: string; merge: boolean } {
  const r = run.merge ? git(cwd, "rev-list", "--merges", "-1", `${base}..${tip}`) : null;
  const m = r?.ok ? r.out : "";
  return m ? { from: `${m}^1`, to: m, merge: true } : { from: base, to: tip, merge: false };
}

/**
 * The diff the reviewer reads, cut at `max` characters with a stat in front. A merge run's own work is how it
 * resolved the merge, so its diff is the remerge diff of the merge commit: the resolution only, not what main brought in.
 */
function reviewDiff(cwd: string, range: { from: string; to: string; merge: boolean }, max: number): string {
  const show = (...o: string[]) => range.merge ? git(cwd, "show", "--remerge-diff", "--format=", ...o, range.to).out : git(cwd, "diff", ...o, range.from, range.to).out;
  const whole = show() || (range.merge ? "(the merge applied cleanly: it resolved no conflict)" : "");
  return whole.length <= max ? whole
    : `${show("--stat")}\n\n${whole.slice(0, max)}\n\n(diff cut at ${max} of ${whole.length} characters; read the changed files in the working directory)`;
}

/**
 * The reviewer call of the worker verdict, on the review model with the build's env. It gives the reason to hold, or
 * null on a pass, and the cost; it fails closed. `onSpawn` gets the reviewer's process, so the unit's stop signal reaches it.
 */
export const reviewer = (onSpawn: (p: ReturnType<typeof Bun.spawn>) => void): Review => async (folder, run, repo, base, branch, findings, changed, env) => {
  const spec = jobSpec(run);
  const range = reviewRange(repo.path, run, base, `refs/heads/${branch}`);
  const diff = reviewDiff(repo.path, range, reviewDiffMax());
  const text = reviewPrompt(run.name, spec, diff, findings, { outside: outsideSurface(spec, changed), merge: range.merge });
  const model = readModels().review.model;
  // The reviewer is a job of its own: it follows the build, which holds the unit and the process.
  // No GPU slot: the job's own run holds it, as in the worker's call.
  const rv = openRun({
    role: "review", who: "reviewer", name: run.name, command: `review ${run.name}`, shown: true, told: false, prev: jobOfFolder(folder), target: run.target, repo: run.repo,
    model, cmd: reviewerCmd(), flags: ["--permission-mode", "bypassPermissions", "--tools", "Read", "Grep", "Glob", "Bash"], schema: REVIEW_SCHEMA,
    seconds: reviewSeconds(), env: agentEnv(env, folder), slot: false, onSpawn,
  });
  const tip = git(repo.path, "rev-parse", `refs/heads/${branch}`).out;
  try {
    return await atCommit(repo, tip, async (wt) => {
      const w = await rv.reply(text, wt);
      const v = parseReview(w.data);
      writeFileSync(runFile(rv.folder, "result.md"), typeof v === "string" ? w.text : v.text);
      const cost = w.cost;
      const none = (why: string) => { rv.end(why, {}, "failed"); return { reason: `reviewer: no verdict (${why})`, cost, none: true, model, session: w.session }; };
      if (w.cause?.kind === "credit") return { ...none(w.cause.reason), credit: w.cause.reason };
      if (w.cause) return none(w.cause.reason);
      if (typeof v === "string") return none(v);
      writeFileSync(runFile(rv.folder, "review.json"), JSON.stringify({ ...v.json, model }));
      rv.end(v.pass ? "pass" : "hold");
      return { reason: v.pass ? null : `reviewer: ${v.reason}`, cost, model, session: w.session };
    });
  } catch (e) {
    const why = errText(e);
    rv.end(why, {}, "failed");
    return { reason: `reviewer: no verdict (${why})`, none: true, model };
  }
};
