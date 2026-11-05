/**
 * The safe default actions for stuck and failed runs, taken by the dispatch that sees them: a duplicate
 * is dropped; a no-commit run whose worker says the goal is already met is checked on main, and closed when
 * the checks pass there; no commit and checks that fail after a land merge and a land that hits a merge conflict drop the run for one rerun
 * of the goal, with a note; a time box drops the run and sends the issue to intake to split it, with no rerun, and an Ask
 * (input, rescue) instead when the issue is a part or has been split already; an infrastructure failure is rechecked or landed again, once. Each action
 * writes its reason to the run, the issue note and the news. Anything else, or the second time one
 * case hits one goal, sets an Ask (input, rescue) on the issue, which goes to the director. A run that a host
 * restart killed comes first: a build or recheck with commits ahead of main rechecks its branch; any other build or recheck is dropped for a new run of
 * the goal; a land lands again. None of them uses up a rerun. A lost run (its process ended with no end written, and no host
 * restart explains it) is marked failed and gets the same action, once per goal; a second lost run of the goal sets the Ask.
 * A land live past 30 minutes gets the Ask too, once per land run (`askSlowLands`, from the tick's firefighter).
 */
import { readFileSync } from "node:fs";
import * as issues from "../../todo/lib/todo.ts";
import { isVersion } from "./goal-spec.ts";
import { note, partsOf, reader, writeList } from "../../todo/lib/store.ts";
import { always, asked, askFromRun, clearAsk, logAlways, normalizeAsk, plainAsk, waitsForSpecEdit, type Ask, askOf } from "./ask.ts";
import { LAND_STUCK_MS, factoryRepos as sandboxRepos } from "./factory-status.ts";
import { fetchOrigin, git } from "./git.ts";
import { allJobs, isOpen, issue as issueOf, lastReal, stepOf, type Job } from "./job.ts";
import { askedQuestion, claimStep, clearRerun, conflictStep, duplicateStep, infraStep, killedStep, lostStep, markRescued, rerunStep, rescueCase, rescued, writeRerun, type Step, type Stuck as StuckRun } from "./continuation.ts";
import { factoryLog } from "./layout.ts";
import { allRuns, isAgentRun, loadRegistry, lock, tell, updateRun, type Repo } from "./ledger.ts";
import { isLive, isLost, isStarting, markEnded } from "./process.ts";
import { causeOf, type Fate } from "./outcome.ts";
import type { Baseline } from "./factory.ts";
import { onMain } from "./status.ts";
import { rescueWaitMs } from "./settings.ts";
import { ciLine, redCi } from "./ci.ts";
import { read as readRecord } from "./record.ts";

/** What a safe default action does to a run: both return the refusal, or null. */

export interface Rescue {
  /** Drop the job, with the reason; the factory writes the issue note and the news itself. */
  drop: (name: string, reason: string, fate?: Fate) => Promise<string | null>;
  /** Start a recheck of the job. */
  recheck: (name: string) => Promise<string | null>;
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
    return isOpen(j) && !!r.repo && keys.has(r.repo) && r.condition === "running" && (isAgentRun(r.kind) || r.kind === "land")
      && Date.parse(r.started) < booted && !isLive(last.folder) && !isStarting(last);
  });
};

/**
 * The open jobs whose last run is lost: a build, recheck or land still `running`, started since this boot, whose
 * process ended without writing `exit`. The unit writes the run's end before `exit`, so such a run will never end.
 */
const lost = (jobs: Job[]): Job[] => {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  const booted = bootedAt();
  return jobs.filter((j) => {
    const last = lastReal(j);
    const r = last.run;
    return isOpen(j) && !!r.repo && keys.has(r.repo) && r.condition === "running" && (isAgentRun(r.kind) || r.kind === "land")
      && Date.parse(r.started) >= booted && isLost(last.folder);
  });
};

/** The open jobs of factory repos whose next step is the rescue, with the unit of the last real run not live. */
const stuckJobs = (jobs: Job[]): Job[] => {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  return jobs.filter((j) => {
    const last = lastReal(j);
    return isOpen(j) && !!last.run.repo && keys.has(last.run.repo) && !isLive(last.folder) && stepOf(j).step === "rescue";
  });
};

/** How long a dispatch waits for a run's rescue lock before it skips the run. */

const SLOW_LAND_OPTIONS = [
  { label: "Wait", line: "Leave the land running; it may still end" },
  { label: "Kill and rerun", line: "Stop the land and land the job again" },
  { label: "Drop", line: "Stop the land and drop the job" },
];

/** The open jobs of factory repos whose last real run is a land live for LAND_STUCK_MS or more, with no Ask set on it. */
const slowLands = (jobs: Job[], now: number): Job[] => {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  return jobs.filter((j) => {
    const last = lastReal(j);
    const r = last.run;
    return isOpen(j) && !!r.repo && keys.has(r.repo) && r.kind === "land" && r.condition === "running" && isLive(last.folder)
      && now - Date.parse(r.started) >= LAND_STUCK_MS && !asked(last);
  });
};

/**
 * Each land live for 30 minutes or more gets a rescue Ask (input, rescue) on its issue, once per land run: the director
 * decides to wait, kill and rerun, or drop. The land runs on. Returns the names of the jobs it asked about.
 */
export async function askSlowLands(now = Date.now()): Promise<string[]> {
  const out: string[] = [];
  for (const first of slowLands(allJobs(), now)) {
    const name = first[0].run.name;
    const release = await lock(`rescue-${first[0].run.repo}-${name}`, 0);
    if (!release) continue;
    try {
      // Read again under the lock: another tick may have asked.
      const runs = slowLands(allJobs(), now).find((j) => j[0].run.job === first[0].run.job);
      if (!runs) continue;
      const last = lastReal(runs);
      const r = last.run;
      const repo = loadRegistry()[r.repo!];
      const minutes = Math.floor((now - Date.parse(r.started)) / 60_000);
      const question = `${name}: its land run ${last.id} is live for ${minutes} minutes, and 99% of lands end within 20. Wait, kill and rerun, or drop?`;
      const ask = normalizeAsk({ question, options: SLOW_LAND_OPTIONS, recommended: "Wait", why: [`Run: ${name}, land, running since ${r.started}`] }, { kind: "input", reason: "rescue" })!;
      const why = askFromRun(last, repo, issueOf(runs), ask, question);
      if (why) { factoryLog(`firefighter: ${name}: no rescue Ask for its slow land: ${why}`); continue; }
      factoryLog(`firefighter: ${name}: its land is live for ${minutes} minutes; a rescue Ask goes to the director`);
      out.push(name);
    } finally {
      release();
    }
  }
  return out;
}

/** The killed, lost, stuck and failed jobs that the rescue acts on. */
export const toRescue = (jobs: Job[]): Job[] => [...killed(jobs), ...lost(jobs), ...stuckJobs(jobs)];

/** Take the safe default action for each killed, lost, stuck or failed job, one job at a time under its lock. */
export async function rescueStuck(act: Rescue, land?: Land, checkMain?: CheckMain): Promise<void> {
  await releaseEdited(act);
  const pending = toRescue;
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

/** The open jobs whose last run waits for a spec edit and whose goal's spec is no longer the one it asked about. */
export const editedWaits = (jobs: Job[]): Job[] => jobs.filter((runs) => {
  const last = lastReal(runs), r = last.run;
  const waits = waitsForSpecEdit(last);
  if (!waits || !r.repo || !isOpen(runs) || (r.condition !== "stuck" && r.condition !== "failed")) return false;
  const issue = issueOf(runs);
  const item = issue === undefined ? undefined : reader().item(r.repo, issue);
  return !!loadRegistry()[r.repo] && !!item && issues.status(item) === "open" && !isVersion(item, waits.version);
});

/**
 * A run that ended with no commit and a question waits for a spec edit. When the goal's spec is no longer the one it asked
 * about, the run is dropped and the Ask comes off the item, so the next dispatch starts a run on the edited spec.
 */
async function releaseEdited(act: Rescue): Promise<void> {
  for (const runs of editedWaits(allJobs())) {
    const r = lastReal(runs).run;
    const { question } = waitsForSpecEdit(lastReal(runs))!;
    const repo = loadRegistry()[r.repo!];
    const issue = issueOf(runs)!;
    const release = await lock(`rescue-${r.repo}-${r.name}`, rescueWaitMs());
    if (!release) continue;
    try {
      const why = await act.drop(r.name, "the goal's spec was edited after the run asked about it; the goal starts again on the new spec");
      if (why) { factoryLog(`${r.name}: release after a spec edit failed (${why})`); continue; }
      if (askOf(`${repo.key}-${issue}`)?.question === question) clearAsk(`${repo.key}-${issue}`);
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
  const found = onMain(repo, { job: r.job, item: issue, fetch: true });
  if (found) return { onMain: found.commit.slice(0, 7) };
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

/** Whether intake cannot split this issue: it is a part (id `n.m`), has parts, or had a planner run that split it before intake. */
function splitAlready({ repo, issue }: Pick<Stuck, "repo" | "issue">): boolean {
  if (issue === undefined || typeof issue === "string") return true;
  const doc = reader().list(repo.key);
  const item = doc && issues.find(doc, issue);
  if (item && partsOf(doc, item).length) return true;
  return allRuns().some((e) => e.run.kind === "plan" && e.run.on === `${repo.key}-${issue}` && e.run.reason === "planned");
}

/** Set `plan` on the issue, so the next dispatch starts intake on it, which splits it. Returns the refusal, or null. */
function sendToIntake(repo: Repo, issue: number): string | null {
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
  const isLostRun = !isKilled && lost([runs]).length > 0;
  const stuck: Stuck = { last, r, repo, name, issue, reason: isKilled ? "host restart" : isLostRun ? "lost: its process ended with no end written" : r.reason ?? r.condition };
  const { reason } = stuck;

  const say = (line: string) => { factoryLog(`${name}: ${line}`); return tell(`${repo.key}/${name}: ${line}`); };
  const record = (text: string, opts: { done?: boolean } = {}) => {
    const why = issue === undefined ? "no issue" : note(repo, issue, text, opts);
    if (why) factoryLog(`${name}: no issue note: ${why}`);
  };
  const choice = (question: string, why: string[]) => normalizeAsk({ question, options: RERUN_OPTIONS, recommended: "Rerun", why: [`Run: ${name}, ${r.condition}`, `Reason: ${reason}`, ...why] }, { kind: "input", reason: "rescue" })!;
  // A run that ended with a QUESTION about the spec: a rerun reads the same spec and asks again, so it waits for a spec edit.
  const asked = askedQuestion(r);
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
    const step = killedStep(stuck, isAgentRun(r.kind) && hasWork(stuck));
    // The real recheck takes only a stuck or failed run, so the killed run ends failed first, as a killed land does.
    if (r.kind === "land" || step.action === "recheck") {
      markEnded(last.folder, 143);
      updateRun(last.folder, { condition: "failed", reason, cause: "other", phase: undefined, told: true, ended: new Date().toISOString() });
    }
    return take(step);
  }

  if (isLostRun) {
    // Marked failed first, so the run is no longer lost, whatever comes next: the recheck and the Ask both want an ended run.
    markEnded(last.folder, 143);
    updateRun(last.folder, { condition: "failed", reason, cause: "other", phase: undefined, told: true, ended: new Date().toISOString() });
    const again = allRuns().some((e) => e.run.repo === r.repo && e.run.name === name && e.folder !== last.folder && rescued(e) === "lost");
    if (again) return chris(`${name}: a second run of this goal was lost (its process ended with no end written). Drop it, or change the goal?`, choice(`${name}: a second run was lost: how should the factory go on?`, ["An earlier run of this goal was lost too, and its rerun did not clear it"]));
    markRescued(last, "lost");
    return take(lostStep(stuck, isAgentRun(r.kind) && hasWork(stuck)));
  }

  const noCommit = causeOf(r) === "no-commit";
  if (specQuestion) {
    const q = asked || reason;
    const item = issue === undefined ? undefined : reader().item(repo.key, issue);
    const text = `${name} ended with no commit and asked: ${q} The goal waits for a spec edit; the factory starts it again when you edit it. Or drop it.`;
    return chris(text, plainAsk("question", text, [`Run: ${name}, ${r.condition}`]), item);
  }
  const found = noCommit ? foundDone(stuck) : null;
  const claim = noCommit ? r.alreadyMet ?? null : null;
  const key = rescueCase(r, !!found, claim);
  if (!key) return chris(`${name} is ${r.condition} (${reason}); drop it, recheck it, or edit the goal?`, choice(`${name} is ${r.condition} (${reason}): how should the factory go on?`, ["No safe default covers this case"]));

  const earlier = allRuns().some((e) => e.run.repo === r.repo && e.run.name === name && e.folder !== last.folder && rescued(e) === key);
  if (key === "claimed") {
    // The worker says the goal is met: the repo's checks on origin/<main> decide. Green closes the item; red reruns
    // the goal with the claim as its note. An unchecked main is waited on: the run stays for the next dispatch.
    const main: Baseline = checkMain ? await checkMain(repo) : { state: "unchecked", line: "main is unchecked: no checks" };
    if (main.state === "unchecked" || main.state === "running") { factoryLog(`${name}: the claim waits: ${main.line}`); return; }
    // An issue a red CI started is met only when GitHub CI on main is green too: the checks here may pass where CI fails.
    const ci = r.on ? readRecord(r.on)?.ci : undefined;
    const ciRed = ci ? redCi().find((c) => c.repo === repo.key) : undefined;
    const red = main.state === "red" ? main.line : ciRed ? ciLine(ciRed) : null;
    markRescued(last, key);
    if (red && earlier) return chris(`${name} says the goal is already met again (${claim}), but ${red}. Drop it, or change the goal?`, choice(`${name} says the goal is already met again, but ${red}: how should the factory go on?`, [`Claim: ${claim}`]));
    return take(claimStep(stuck, claim, red, ciRed && ci?.failure));
  }
  if (key === "duplicate") {
    markRescued(last, key);
    return take(duplicateStep(stuck, found?.onMain));
  }
  if (key === "time-box") {
    // No rerun of the same goal: a plain issue goes to intake to be split; a part, or an issue split already, asks.
    if (earlier || splitAlready(stuck)) return chris(`${name} ran out of its time box again, and it cannot be split further (${earlier ? "an earlier run hit the time box too" : "it is a part, or it has been split already"}). Drop it, or change the goal?`, choice(`${name} ran out of its time box and cannot be split: how should the factory go on?`, ["Intake cannot split it again"]));
    markRescued(last, key);
    const why = await act.drop(name, `time box ran out in ${r.kind} run ${last.id}; the issue goes to intake to split`);
    const bad = why ?? sendToIntake(repo, issue as number);
    if (bad) return chris(`${name}: sending it to intake failed (${bad}); ${reason}. What now?`, choice(`${name}: sending it to intake failed: how should the factory go on?`, [`Failure: ${bad}`]));
    const text = `${r.kind} run ${last.id}: the time box ran out; dropped, and the issue goes to intake to split`;
    record(text);
    return void await say(text);
  }
  if (earlier) return chris(`${name} hit the same case again (${key}: ${reason}); a rerun did not clear it. Drop it, or change the goal?`, choice(`${name} hit the same case again (${key}): how should the factory go on?`, ["A rerun did not clear it"]));
  markRescued(last, key);
  return take(key === "infra" ? infraStep(stuck, r.kind !== "land" && hasBranch(stuck)) : key === "land-conflict" ? conflictStep(stuck, touched(stuck)) : rerunStep(stuck, key as "no-commit" | "land-checks"));
}
