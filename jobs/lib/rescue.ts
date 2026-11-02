/**
 * The safe default actions for stuck and failed runs, taken by the dispatch that sees them: a duplicate
 * is dropped; a no-commit run whose worker says the goal is already met is checked on main, and closed when
 * the checks pass there; no commit and checks that fail after a land merge and a land that hits a merge conflict drop the run for one rerun
 * of the goal, with a note; a time box drops the run and sends the issue to the planner to split it, with no rerun, and an Ask
 * (input, rescue) instead when the issue is a part or the planner has already split it; an infrastructure failure is rechecked or landed again, once. Each action
 * writes its reason to the run, the issue note and the news. Anything else, or the second time one
 * case hits one goal, sets an Ask (input, rescue) on the issue; such a run holds nothing. A run that a host
 * restart killed comes first: it is dropped for a new run of the goal, or landed again, and uses up no rerun.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { note, partsOf, reader, writeList } from "../../todo/lib/store.ts";
import { endRun } from "./agent-run.ts";
import { always, logAlways, normalizeAsk, type Ask } from "./ask.ts";
import { factoryDir, factoryRepos as sandboxRepos, holders } from "./factory-status.ts";
import { alreadyMet } from "./gate.ts";
import { fetchOrigin, git, jobCommit } from "./git.ts";
import { allJobs, isOpen, issue as issueOf, lastReal, markAsked, markRescued, readFile, rescued, tailOf, type Job } from "./job.ts";
import { factoryLog } from "./layout.ts";
import { allRuns, askOf as runAskOf, isAwaiting, isBuild, isLive, isStarting, loadRegistry, lock, tell, updateRun, type Entry, type Repo } from "./ledger.ts";
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

const rerunFile = (name: string) => join(factoryDir(), "rerun", `${name}.md`);
/** The note the goal's next run reads, under "Note on the last run". */
export function writeRerun(name: string, note: string): void {
  mkdirSync(dirname(rerunFile(name)), { recursive: true });
  writeFileSync(rerunFile(name), note + "\n");
}
export const rerunNote = (name: string): string => (existsSync(rerunFile(name)) ? readFileSync(rerunFile(name), "utf8").trim() : "");
export const clearRerun = (name: string): void => rmSync(rerunFile(name), { force: true });

const RERUN_OPTIONS = [
  { label: "Rerun", line: "Drop the stuck run and start the goal again as it is" },
  { label: "Another way", line: "Start the goal again, taking a different route than the run that failed" },
];

type Case = "duplicate" | "no-commit" | "claimed" | "time-box" | "infra" | "land-checks" | "land-conflict";

/** Which safe case a stuck or failed run is in, or null: not safe. `claim` is the worker's "already met" reason, if it made one. */
function caseOf(r: Entry["run"], onMainOrDone: boolean, claim: string | null): Case | null {
  const cause = causeOf(r);
  if (cause === "no-commit") return onMainOrDone ? "duplicate" : claim !== null ? "claimed" : "no-commit";
  if (cause === "time-box" && r.kind !== "land") return "time-box";
  if (cause === "infra" || cause === "lock-busy") return "infra";
  if (r.kind === "land" && cause === "conflict") return "land-conflict";
  if (r.kind === "land" && !r.conflicts?.length && cause === "check") return "land-checks";
  return null;
}

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
    return isOpen(j) && !!r.repo && keys.has(r.repo) && r.condition === "running" && (isBuild(r.kind) || r.kind === "recheck" || r.kind === "land")
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
    if (!isOpen(j) || !r.repo || !keys.has(r.repo) || !isAwaiting(r.condition) || !["held-path", "review"].includes(runAskOf(r)?.reason ?? "")) continue;
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

/** One action on a run. `dropReason` is the drop's text, when it is not `noted`; `told` is the news, when it is not `noted`. */
type Step = { action: "drop" | "land again" | "recheck"; rerun?: string; dropReason?: string; noted: string; told?: string; done?: boolean; fate?: Fate };

/** The run a rescue acts on, and what its goal is. */
type Stuck = { last: Entry; r: Entry["run"]; repo: Repo; name: string; issue: number | string | undefined; reason: string };

/** The commit of this job or this item on main, or `{ onMain: null }` when the item is closed without one; null when neither. */
function foundDone({ r, repo, issue }: Pick<Stuck, "r" | "repo" | "issue">): { onMain: string | null } | null {
  fetchOrigin(repo.path);
  const mine = jobCommit(repo.path, repo.main, r.job);
  if (mine) return { onMain: mine.slice(0, 7) };
  const there = itemOnMain(repo, issue);
  if (there) return { onMain: there };
  const item = issue === undefined ? undefined : reader().item(repo.key, issue);
  return item && issues.status(item) !== "open" ? { onMain: null } : null;
}

/** The step for a run that a host restart killed. The goal did not cause this: no rescue mark, so the goal keeps its rerun. */
function killedStep({ last, r }: Stuck): Step {
  const text = `a host restart killed ${r.kind} run ${last.id}`;
  // The branch passed, and the land may have pushed: a new land finds that, and a new goal run would do the work twice.
  if (r.kind === "land") return { action: "land again", noted: `${text}: landed again`, told: `${text}: landing again` };
  return { action: "drop", dropReason: `${text}. The goal did not cause this. Run the goal again from the start.`, noted: `${text}: dropped, and the goal starts again`, told: `${text}: the goal starts again` };
}

/** The step for a worker's claim that the goal is met, by `red`, the red line of main. */
function claimStep({ last, r, repo }: Stuck, claim: string | null, red: string | null): Step {
  const said = `${r.kind} run ${last.id} says the goal is already met (${claim})`;
  if (!red) return { action: "drop", noted: `${said}, and the checks pass on origin/${repo.main}: dropped, and the item is done`, done: true, fate: "already-met" };
  return {
    action: "drop",
    rerun: `The last run said the goal is already met (${claim}), but the checks do not pass on origin/${repo.main} (${red}). Make the change the goal asks for.`,
    noted: `${said}, but ${red}; dropped, and the goal reruns once`,
  };
}

/** The step for an infrastructure failure: a land lands again, a run with a branch is rechecked, and any other run reruns. */
function infraStep({ last, r, repo, reason }: Stuck): Step {
  const text = `${r.kind} run ${last.id} failed for infrastructure (${reason}): `;
  if (r.kind === "land") return { action: "land again", noted: `${text}landed again, once`, told: `${text}landing again` };
  if (r.branch && git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${r.branch}`).ok) return { action: "recheck", noted: `${text}rechecked, once`, told: `${text}rechecking` };
  return { action: "drop", rerun: `The last run failed before it made a branch: ${reason}.`, dropReason: `${text}dropped for one rerun`, noted: `${text}dropped; the goal reruns once`, told: `${text}the goal reruns` };
}

/** The step for a land that hit a merge conflict. The note names the files and what last changed them on main. */
function conflictStep({ last, r, repo }: Stuck): Step {
  const files = r.conflicts ?? [];
  fetchOrigin(repo.path);
  const touched = files.length ? git(repo.path, "log", `origin/${repo.main}`, "-1", "--format=%h %s", "--", ...files).out : "";
  const what = `${files.join(", ") || "unknown files"}${touched ? `, last changed on ${repo.main} by ${touched}` : ""}`;
  return {
    action: "drop",
    rerun: `The last land failed with a merge conflict in ${what}. Another goal landed on the same lines first; this run starts from the current ${repo.main}.`,
    noted: `${r.kind} run ${last.id}: merge conflict in ${what}; dropped, and the goal reruns once from current ${repo.main}`,
  };
}

/** The step for a run that stopped with nothing to keep. The note quotes the end of its log. */
function rerunStep({ last, r, reason }: Stuck, key: "no-commit" | "land-checks"): Step {
  const why = key === "no-commit" ? "the last run made no commit" : `the checks failed after the land merged main (${reason})`;
  const file = key === "land-checks" ? "checks.log" : "result.md";
  return {
    action: "drop",
    rerun: `${why[0].toUpperCase()}${why.slice(1)}. The last 20 lines of its ${file}:\n\n\`\`\`\n${tailOf(last, file, 20) || "(empty)"}\n\`\`\``,
    noted: `${r.kind} run ${last.id}: ${why}; dropped, and the goal reruns once`,
  };
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
  const record = (text: string, opts: { done?: boolean; ask?: Ask } = {}) => {
    const why = issue === undefined ? "no issue" : note(repo, issue, text, opts);
    if (why) factoryLog(`${name}: no issue note: ${why}`);
  };
  const choice = (question: string, why: string[]) => normalizeAsk({ question, options: RERUN_OPTIONS, recommended: "Rerun", why: [`Run: ${name}, ${r.condition}`, `Reason: ${reason}`, ...why] }, { kind: "input", reason: "rescue" })!;
  const chris = async (question: string, ask: Ask) => {
    // An Always rule to take the recommendation: Rerun drops the run, and the goal reruns.
    if (ask.recommended === "Rerun" && always("rescue")?.action === "recommended") {
      const why = await act.drop(name, question);
      if (!why) {
        logAlways("rescue", "recommended", `${repo.key}-${issue ?? name}`);
        record("always: Rerun");
        await say(`always: Rerun; dropped, and the goal reruns`);
        return;
      }
      factoryLog(`${name}: always Rerun failed (${why})`);
    }
    markAsked(last, question);
    record(`asks Chris: ${question}`, { ask });
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
    if (r.kind === "land") {
      writeFileSync(join(last.folder, "exit"), "143");
      updateRun(last.folder, { condition: "failed", reason, cause: "other", phase: undefined, told: true, ended: new Date().toISOString() });
    }
    return take(killedStep(stuck));
  }

  const noCommit = causeOf(r) === "no-commit";
  const found = noCommit ? foundDone(stuck) : null;
  const claim = noCommit ? alreadyMet(readFile(last, "result.md") ?? "") : null;
  const key = caseOf(r, !!found, claim);
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
    const onMain = found?.onMain;
    return take({ action: "drop", noted: `${r.kind} run ${last.id} ended with no commit and the item is already ${onMain ? `on main as ${onMain}` : "done"}: dropped as a duplicate, and the item is closed`, done: !!onMain, fate: "already-met" });
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
  return take(key === "infra" ? infraStep(stuck) : key === "land-conflict" ? conflictStep(stuck) : rerunStep(stuck, key as "no-commit" | "land-checks"));
}
