/**
 * The next step of a run that ended, and the steps a pause kept: `start` runs a step in-process, `startKept` runs the
 * kept ones. The roles' unit calls `start`, and the factory's dispatch calls `startKept`.
 */
import { appendFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import * as issues from "../../../lib/todo.ts";
import { reader } from "../../../lib/store.ts";
import { errText } from "../../../lib/errtext.ts";
import { allJobs, isOpen, issueKeyOf, loadRegistry, onOf, type Run } from "../records/ledger.ts";
import * as jobRecord from "../records/record.ts";
import { jobOfRun } from "../records/record.ts";
import { onMain } from "../records/status.ts";
import { jobOfFolder, logStream, logTo, runFile } from "../records/run-files.ts";
import { paused } from "../gates/pause.ts";
import { MERGE_MODEL, nextBrief } from "./continuation.ts";
import { land as startLand, recheck as startRecheck, startJob } from "./transitions.ts";

/**
 * The file in a run folder that marks a next step the pause kept: the run keeps `next`, so it does not show as failed,
 * and the first dispatch after the resume starts the step (`startKept`). A `next` without this file is history.
 */
const PAUSED_NEXT = "paused-next";

/**
 * Start the kept step of each open job whose last real run has the `paused-next` file, and remove the file first.
 * The removal is the claim: of two dispatches at once, only the one whose removal succeeds starts the step.
 * Returns the names of the jobs it started a step for.
 */
export async function startKept(go: typeof start = start): Promise<string[]> {
  const started: string[] = [];
  for (const j of allJobs()) {
    if (!isOpen(j)) continue;
    const { folder, run } = jobRecord.counting(j);
    const mark = runFile(folder, PAUSED_NEXT);
    const { step } = jobRecord.stepOf(j);
    if ((step !== "worker" && step !== "land" && step !== "recheck") || !existsSync(mark)) continue;
    try { rmSync(mark); } catch { continue; }
    await go(folder, run, step);
    started.push(run.name);
  }
  return started;
}

/** Start the next run as `aleph land` or `aleph job` would, in-process. What it prints and its refusal go to next.log. */
export async function start(folder: string, run: Run, next: NonNullable<Run["next"]>): Promise<void> {
  if (paused()) {
    logTo(folder, "dispatch", `paused: no ${next} started; the first dispatch after the resume starts it\n`);
    writeFileSync(runFile(folder, PAUSED_NEXT), `${next}\n`);
    return;
  }
  const dropped = jobOfRun(jobOfFolder(folder)).some((e) => e.run.state === "dropped");
  const repo = run.repo ? loadRegistry()[run.repo] : undefined;
  const there = dropped ? null : onMain(repo, { item: onOf(run), fetch: onOf(run) !== undefined })?.commit;
  if (dropped || there) {
    logTo(folder, "dispatch", dropped ? `dropped: no ${next} started\n` : `item landed as ${there}: no ${next} started\n`);
    jobRecord.patchRun(jobOfFolder(folder), { next: undefined });
    return;
  }
  // A parked issue's job keeps its `next` and its branch: the dispatch lands it once the issue is open (waitingToLand).
  const on = onOf(run);
  const item = next === "land" && repo && on !== undefined ? reader().item(repo.key, on) : undefined;
  const parked = item !== undefined && issues.status(item) === "parked";
  if (parked) {
    const reason = `${issueKeyOf(run)} is parked`;
    logTo(folder, "dispatch", `${reason}: no land started\n`);
    jobRecord.patchRun(jobOfFolder(folder), { reason });
    return;
  }
  const back = nextBrief(folder, run);
  const merge = next === "worker" && back.merge;
  // A merge round runs on MERGE_MODEL, so the round after it takes the size of the build before it.
  const size = jobOfRun(jobOfFolder(folder)).findLast((e) => e.run.role === "build" && !e.run.merge)?.run.size;
  const log = logStream(folder, "dispatch");
  try {
    const s = next === "land"
      ? await startLand(run.name, {}, { output: { file: log } })
      : next === "recheck"
      ? await startRecheck(run.name, { output: { file: log } })
      : await startJob({ repo: run.repo!, name: run.name, spec: back.note, land: true, ...(merge ? { merge: true, model: MERGE_MODEL } : size ? { model: size } : {}) }, { output: { file: log } });
    appendFileSync(log, JSON.stringify(s.started, null, 2) + "\n");
    await s.child?.exited;
  } catch (e) {
    appendFileSync(log, `${errText(e)}\n`);
    jobRecord.patchRun(jobOfFolder(folder), { next: undefined });
  }
}
