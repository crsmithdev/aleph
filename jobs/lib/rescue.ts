/**
 * The safe default actions for stuck and failed runs, taken by the dispatch that sees them: a duplicate
 * is dropped; a no-commit run whose worker says the goal is already met is checked on main, and closed when
 * the checks pass there; no commit and checks that fail after a land merge and a land that hits a merge conflict drop the run for one rerun
 * of the goal, with a note; a time box drops the run and sends the issue to the planner to split it, with no rerun, and an Ask
 * (input, rescue) instead when the issue is a part or the planner has already split it; an infrastructure failure is rechecked or landed again, once. Each action
 * writes its reason to the run, the issue note and the news. Anything else, or the second time one
 * case hits one goal, sets an Ask (input, rescue) on the issue; such a run holds nothing. A run that a host
 * restart killed comes first: a build or recheck with commits ahead of main rechecks its branch; any other build or recheck is dropped for a new run of
 * the goal; a land lands again. None of them uses up a rerun.
 */
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { isVersion } from "./goal-spec.ts";
import { note, partsOf, reader, writeList } from "../../todo/lib/store.ts";
import { endRun } from "./agent-run.ts";
import { always, askFromRun, clearAsk, logAlways, needsOf, normalizeAsk, plainAsk, waitsForSpecEdit, type Ask } from "./ask.ts";
import { factoryRepos as sandboxRepos, holders } from "./factory-status.ts";
import { alreadyMet } from "./gate.ts";
import { fetchOrigin, git, jobCommit } from "./git.ts";
import { allJobs, isOpen, issue as issueOf, lastReal, readFile, type Job } from "./job.ts";
import { askedQuestion, claimStep, clearRerun, conflictStep, duplicateStep, infraStep, killedStep, markRescued, rerunStep, rescueCase, rescued, writeRerun, type Step, type Stuck as StuckRun } from "./continuation.ts";
import { factoryLog } from "./layout.ts";
import { allRuns, askOf as runAskOf, isAwaiting, isBuild, isWorker, isLive, isStarting, loadRegistry, lock, tell, updateRun, type Repo } from "./ledger.ts";
import { causeOf, type Fate } from "./outcome.ts";
import type { Baseline } from "./factory.ts";
import { startReview } from "./review.ts";
import { itemOnMain } from "./status.ts";
import { rescueWaitMs } from "./settings.ts";

/** What a safe default action does to a run: both return the refusal, or null. */
export interface Rescue {
  /** Drop the job, with the reason; the factory writes the issue note and the news itself. */
  drop: (name: string, reason: string, fate?: Fate) => Promise<string | null>;
  /** Start a recheck of the job. */
  recheck: (name: string) => Promise<string | null>;
  /** Start a review of the run's folder (startReview, when absent). */
  review?: (folder: string) => boolean;
}

/** Land the job again: returns the refusal, or null. */
type Land = (name: string) => Promise<string | null>;
/** The state of the repo's main (factory.ts `baseline`). */
type CheckMain = (repo: Repo) => Promise<Baseline>;

const RERUN_OPTIONS = [
  { label: "Rerun", line: "Drop the stuck run and start the goal again as it is" },
  { label: "Another way", line: "Start the goal again, taking a different route than the run that failed" },
];

/** When this host booted, in ms. */
const bootedAt = (): number => Number(readFileSync("/proc/stat", "utf8").match(/^btime (\d+)$/m)![1]) * 1000;

/**
 * The open jobs whose last run a host restart killed: a build, recheck or land still `running`, started before
 * this boot, with its process gone. isLive asks that the pid's process names the run's folder, so a process
 * that got the same pid after the restart does not count as the run. No mark is kept: a run stays here until it ends.
 */
const killed = (jobs: Job[]): Job[] => {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  const booted = bootedAt();
  return jobs.filter((j) => {
    const last = lastReal(j);
    const r = last.run;
    return isOpen(j) && !!r.repo && keys.has(r.repo) && r.condition === "running" && (isWorker(r.kind) || r.kind === "recheck" || r.kind === "land")
      && Date.parse(r.started) < booted && !isLive(last.folder) && !isStarting(last);
  });
};

/**
 * The folders of runs a host restart left with a review that cannot be alive: `awaiting` for a held-path or review
 * ask, call.md still `PENDING` and written before this boot. Sandbox repos only, as `killed`.
 */
const killedReviews = (): string[] => {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  const booted = bootedAt();
  const out: string[] = [];
  for (const j of allJobs()) {
    const last = lastReal(j);
    const r = last.run;
    if (!isOpen(j) || !r.repo || !keys.has(r.repo) || !isAwaiting(r.condition) || !["held", "review"].includes(needsOf(runAskOf(r)) ?? "")) continue;
    const call = join(last.folder, "call.md");
    try {
      if (readFileSync(call, "utf8").trim() === "PENDING" && statSync(call).mtimeMs < booted) out.push(last.folder);
    } catch { /* no call.md */ }
  }
  return out;
};

/**
 * End each facts run that a host restart killed: `running`, started before this boot. A facts run writes no pid, so its
 * process cannot be checked, and a run from before the boot has no reviewer left. It ends `done` with the reason, and
 * stays unshown so the news reports it. It is not run again: its facts are lost, and the job has a facts run, so the
 * gate never reviews them. Sandbox repos only, as `killed`.
 */
export const endKilledFacts = (): void => {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  const booted = bootedAt();
  for (const e of allRuns()) {
    const r = e.run;
    if (r.kind !== "facts" || r.condition !== "running" || !r.repo || !keys.has(r.repo) || Date.parse(r.started) >= booted) continue;
    endRun(e.folder, "host restart");
    factoryLog(`${r.name}: a host restart killed its facts run; its facts are lost`);
  }
};

/** Start again each review that a host restart killed: the stale call.md goes, and the new start writes a new PENDING. */
function restartReviews(act: Rescue): void {
  for (const folder of killedReviews()) {
    try {
      rmSync(join(folder, "call.md"), { force: true });
      factoryLog(`${folder}: a host restart killed its review; starting it again`);
      (act.review ?? startReview)(folder);
    } catch (e: any) {
      factoryLog(`review restart of ${folder} failed: ${e?.message ?? e}`);
    }
  }
}

/** How long a dispatch waits for a run's rescue lock before it skips the run. */

/** Take the safe default action for each stuck job and each killed review, one job at a time under its lock. */
export async function rescueStuck(act: Rescue, land?: Land, checkMain?: CheckMain): Promise<void> {
  restartReviews(act);
  await releaseEdited(act);
  const pending = (jobs: Job[]) => [...killed(jobs), ...holders(jobs)];
  for (const first of pending(allJobs())) {
    const name = first[0].run.name;
    // Wait: the dispatch that holds it may have read the job before this run ended, and would not act on it.
    const release = await lock(`rescue-${first[0].run.repo}-${name}`, rescueWaitMs());
    if (!release) { factoryLog(`rescue of ${name} skipped: the rescue lock stayed busy`); continue; }
    try {
      // Read again under the lock: another dispatch may have acted on it.
      const runs = pending(allJobs()).find((j) => j[0].run.job === first[0].run.job);
      if (runs) await rescueJob(runs, act, land, checkMain);
    } catch (e: any) {
      factoryLog(`rescue of ${name} failed: ${e?.message ?? e}`);
    } finally {
      release();
    }
  }
}

/**
 * A run that ended with no commit and a question waits for a spec edit. When the goal's spec is no longer the one it asked
 * about, the run is dropped and the Ask comes off the item, so the next dispatch starts a run on the edited spec.
 */
async function releaseEdited(act: Rescue): Promise<void> {
  for (const runs of allJobs()) {
    const last = lastReal(runs);
    const r = last.run;
    const waits = waitsForSpecEdit(last);
    if (!waits || !r.repo || !isOpen(runs) || (r.condition !== "stuck" && r.condition !== "failed")) continue;
    const repo = loadRegistry()[r.repo];
    const { version: was, question } = waits;
    const issue = issueOf(runs);
    if (!repo || issue === undefined) continue;
    const item = reader().item(repo.key, issue);
    if (!item || issues.status(item) !== "open" || isVersion(item, was)) continue;
    const release = await lock(`rescue-${r.repo}-${r.name}`, rescueWaitMs());
    if (!release) continue;
    try {
      const why = await act.drop(r.name, "the goal's spec was edited after the run asked about it; the goal starts again on the new spec");
      if (why) { factoryLog(`${r.name}: release after a spec edit failed (${why})`); continue; }
      writeList(repo, `spec edit: release ${repo.key}-${issue}`, (doc) => {
        const i = issues.find(doc, issue);
        if (!i || i.fm.question !== question) return null;
        clearAsk(i);
        return true;
      });
      factoryLog(`${r.name}: the spec was edited; the run is dropped and the goal starts again`);
      await tell(`${repo.key}/${r.name}: the spec was edited; the goal starts again`);
    } catch (e: any) {
      factoryLog(`${r.name}: release after a spec edit failed: ${e?.message ?? e}`);
    } finally {
      release();
    }
  }
}

/** The run a rescue acts on, and what its goal is. */
type Stuck = StuckRun & { name: string; issue: number | string | undefined };

/** The commit of this job or this item on main, or `{ onMain: null }` when the item is closed without one; null when neither. */
function foundDone({ r, repo, issue }: Pick<Stuck, "r" | "repo" | "issue">): { onMain: string | null } | null {
  fetchOrigin(repo.path);
  const mine = jobCommit(repo.path, repo.main, r.job);
  if (mine) return { onMain: mine.slice(0, 7) };
  const there = itemOnMain(repo, issue);
  if (there) return { onMain: there };
  const item = issue === undefined ? undefined : reader().item(repo.key, issue);
  return item && (issues.status(item) === "done" || issues.status(item) === "dropped") ? { onMain: null } : null;
}

/** Whether the run's branch exists. */
const hasBranch = ({ r, repo }: Pick<Stuck, "r" | "repo">): boolean => !!r.branch && git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${r.branch}`).ok;

/** The last commit on main that changed the files a land conflicted in, after a fetch; empty when none. */
function touched({ r, repo }: Pick<Stuck, "r" | "repo">): string {
  const files = r.conflicts ?? [];
  fetchOrigin(repo.path);
  return files.length ? git(repo.path, "log", `origin/${repo.main}`, "-1", "--format=%h %s", "--", ...files).out : "";
}

/** Whether a branch has commits ahead of main: the worker's finished work, since commits reach the branch only after the worker ended. */
function hasWork({ r, repo }: Pick<Stuck, "r" | "repo">): boolean {
  if (!r.branch || !git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${r.branch}`).ok) return false;
  const ahead = git(repo.path, "rev-list", "--count", `${repo.main}..refs/heads/${r.branch}`);
  return ahead.ok && Number(ahead.out) > 0;
}

/** Whether the planner cannot split this issue: it is a part (id `n.m`), has parts, or has had a planner run that split it. */
function splitAlready({ repo, issue }: Pick<Stuck, "repo" | "issue">): boolean {
  if (issue === undefined || typeof issue === "string") return true;
  const doc = reader().list(repo.key);
  const item = doc && issues.find(doc, issue);
  if (item && partsOf(doc, item).length) return true;
  return allRuns().some((e) => e.run.kind === "plan" && e.run.on === `${repo.key}-${issue}` && e.run.reason === "planned");
}

/** Set `plan` on the issue, so the next dispatch starts the planner on it. Returns the refusal, or null. */
function sendToPlanner(repo: Repo, issue: number): string | null {
  try {
    const w = writeList(repo, `time box: plan ${repo.key}-${issue}`, (doc) => {
      const item = issues.find(doc, issue);
      if (!item || issues.status(item) !== "open") return null;
      item.fm.plan = "true";
      return true;
    });
    return w?.value ? null : "the issue is no longer open";
  } catch (e: any) {
    return e?.message ?? String(e);
  }
}

/** Choose the rescue of one job, and do it. The once-only rule is here: a mark on the run counts the case against the goal. */
async function rescueJob(runs: Job, act: Rescue, land?: Land, checkMain?: CheckMain): Promise<void> {
  const last = lastReal(runs);
  const r = last.run;
  const repo = loadRegistry()[r.repo!];
  const name = r.name;
  const fromName = name.match(/-(\d+(?:\.\d+)?)$/)?.[1];
  const issue = issueOf(runs) ?? (fromName === undefined ? undefined : fromName.includes(".") ? fromName : Number(fromName));
  const isKilled = killed([runs]).length > 0;
  const stuck: Stuck = { last, r, repo, name, issue, reason: isKilled ? "host restart" : r.reason ?? r.condition };
  const { reason } = stuck;

  const say = (line: string) => { factoryLog(`${name}: ${line}`); return tell(`${repo.key}/${name}: ${line}`); };
  const record = (text: string, opts: { done?: boolean } = {}) => {
    const why = issue === undefined ? "no issue" : note(repo, issue, text, opts);
    if (why) factoryLog(`${name}: no issue note: ${why}`);
  };
  const choice = (question: string, why: string[]) => normalizeAsk({ question, options: RERUN_OPTIONS, recommended: "Rerun", why: [`Run: ${name}, ${r.condition}`, `Reason: ${reason}`, ...why] }, { kind: "input", reason: "rescue" })!;
  // A run that ended with a QUESTION about the spec: a rerun reads the same spec and asks again, so it waits for a spec edit.
  const asked = askedQuestion(r, readFile(last, "result.md") ?? "");
  const specQuestion = asked !== null;
  // `spec`: the run asked about this issue's spec, so it waits for a spec edit.
  const chris = async (question: string, ask: Ask, spec?: issues.Issue) => {
    // An Always rule to take the recommendation: Rerun drops the run, and the goal reruns. Not for a run that asked a question.
    if (!specQuestion && ask.recommended === "Rerun" && always("rescue")?.action === "recommended") {
      const why = await act.drop(name, question);
      if (!why) {
        logAlways("rescue", "recommended", `${repo.key}-${issue ?? name}`);
        record("always: Rerun");
        await say(`always: Rerun; dropped, and the goal reruns`);
        return;
      }
      factoryLog(`${name}: always Rerun failed (${why})`);
    }
    const why = askFromRun(last, repo, issue, ask, question, spec);
    if (why) factoryLog(`${name}: no issue note: ${why}`);
    await say(`asks Chris: ${question}`);
  };
  const take = async (step: Step) => {
    if (step.rerun) writeRerun(name, step.rerun);
    const why = step.action === "drop" ? await act.drop(name, step.dropReason ?? step.noted, step.fate)
      : step.action === "recheck" ? await act.recheck(name)
      : land ? await land(name) : "no land";
    if (why) {
      clearRerun(name);
      return chris(`${name}: ${step.action} failed (${why}); ${reason}. What now?`, choice(`${name}: ${step.action} failed: how should the factory go on?`, [`Failure: ${why}`]));
    }
    record(step.noted, { done: step.done });
    await say(step.told ?? step.noted);
  };

  if (isKilled) {
    const step = killedStep(stuck, (isBuild(r.kind) || r.kind === "recheck") && hasWork(stuck));
    // The real recheck takes only a stuck or failed run, so the killed run ends failed first, as a killed land does.
    if (r.kind === "land" || step.action === "recheck") {
      writeFileSync(join(last.folder, "exit"), "143");
      updateRun(last.folder, { condition: "failed", reason, cause: "other", phase: undefined, told: true, ended: new Date().toISOString() });
    }
    return take(step);
  }

  const noCommit = causeOf(r) === "no-commit";
  if (specQuestion) {
    const q = asked || reason;
    const item = issue === undefined ? undefined : reader().item(repo.key, issue);
    const text = `${name} ended with no commit and asked: ${q} The goal waits for a spec edit; the factory starts it again when you edit it. Or drop it.`;
    return chris(text, plainAsk("question", text, [`Run: ${name}, ${r.condition}`]), item);
  }
  const found = noCommit ? foundDone(stuck) : null;
  const claim = noCommit ? alreadyMet(readFile(last, "result.md") ?? "") : null;
  const key = rescueCase(r, !!found, claim);
  if (!key) return chris(`${name} is ${r.condition} (${reason}); drop it, recheck it, or edit the goal?`, choice(`${name} is ${r.condition} (${reason}): how should the factory go on?`, ["No safe default covers this case"]));

  const earlier = allRuns().some((e) => e.run.repo === r.repo && e.run.name === name && e.folder !== last.folder && rescued(e) === key);
  if (key === "claimed") {
    // The worker says the goal is met: the repo's checks on origin/<main> decide. Green closes the item; red reruns
    // the goal with the claim as its note. An unchecked main is waited on: the run stays for the next dispatch.
    const main: Baseline = checkMain ? await checkMain(repo) : { state: "unchecked", line: "main is unchecked: no checks" };
    if (main.state === "unchecked" || main.state === "running") { factoryLog(`${name}: the claim waits: ${main.line}`); return; }
    const red = main.state === "red" ? main.line : null;
    markRescued(last, key);
    if (red && earlier) return chris(`${name} says the goal is already met again (${claim}), but ${red}. Drop it, or change the goal?`, choice(`${name} says the goal is already met again, but ${red}: how should the factory go on?`, [`Claim: ${claim}`]));
    return take(claimStep(stuck, claim, red));
  }
  if (key === "duplicate") {
    markRescued(last, key);
    return take(duplicateStep(stuck, found?.onMain));
  }
  if (key === "time-box") {
    // No rerun of the same goal: a plain issue goes to the planner to be split; a part, or an issue the planner has split, asks.
    if (earlier || splitAlready(stuck)) return chris(`${name} ran out of its time box again, and it cannot be split further (${earlier ? "an earlier run hit the time box too" : "it is a part, or the planner has already split it"}). Drop it, or change the goal?`, choice(`${name} ran out of its time box and cannot be split: how should the factory go on?`, ["The planner cannot split it again"]));
    markRescued(last, key);
    const why = await act.drop(name, `time box ran out in ${r.kind} run ${last.id}; the issue goes to the planner`);
    const bad = why ?? sendToPlanner(repo, issue as number);
    if (bad) return chris(`${name}: sending it to the planner failed (${bad}); ${reason}. What now?`, choice(`${name}: sending it to the planner failed: how should the factory go on?`, [`Failure: ${bad}`]));
    const text = `${r.kind} run ${last.id}: the time box ran out; dropped, and the issue goes to the planner to split`;
    record(text);
    return void await say(text);
  }
  if (earlier) return chris(`${name} hit the same case again (${key}: ${reason}); a rerun did not clear it. Drop it, or change the goal?`, choice(`${name} hit the same case again (${key}): how should the factory go on?`, ["A rerun did not clear it"]));
  markRescued(last, key);
  return take(key === "infra" ? infraStep(stuck, r.kind !== "land" && hasBranch(stuck)) : key === "land-conflict" ? conflictStep(stuck, touched(stuck)) : rerunStep(stuck, key as "no-commit" | "land-checks"));
}
