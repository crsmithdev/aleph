/**
 * The safe default actions for returned and failed runs, taken by the dispatch that sees them: a duplicate
 * is dropped; a no-commit run whose worker says the issue is already met is checked on main, and closed when
 * the checks pass there; no commit and checks that fail after a land merge and a land that hits a merge conflict drop the run for one rerun
 * of the issue, with a note; a time box drops the run and sends the issue to intake to split it, with no rerun, and an Ask
 * (input, rescue) instead when the issue is a part or has been split already; an infrastructure failure is rechecked or landed again, once. Each action
 * writes its reason to the run, the issue note and the news. Anything else, or the second time one
 * case hits one issue, sets an Ask (input, rescue) on the issue, which goes to the director. A run whose cause is not
 * `rescuable` (`POLICY`), such as credit, never reaches the rescue: its step is a wait. A run that a host
 * restart killed comes first: a build or recheck with commits ahead of main rechecks its branch; any other build or recheck is dropped for a new run of
 * the issue; a land lands again. None of them uses up a rerun. A lost run (its process ended with no end written, or it has had no `pid` for two minutes, and no host
 * restart explains it) is marked failed and gets the same action, once per issue; a second lost run of the issue sets the Ask.
 * A land live past 30 minutes gets the Ask too, once per land run (`askSlowLands`, from the tick's firefighter).
 * A build or recheck whose failed check's tests all fail on main too waits while main is red, and is rechecked once when it turns green.
 */
import { issueKey, key as keyOf, parseId, shortId } from "../../../lib/naming.ts";
import * as issues from "../../../lib/todo.ts";
import { isVersion } from "../roles/issue-spec.ts";
import { close, reader, writeList } from "../../../lib/store.ts";
import { partsOf, setPlan } from "../../../lib/todo.ts";
import { always, asked, askFromRun, clearAsk, logAlways, normalizeAsk, plainAsk, waitsForSpecEdit, type Ask, askOf } from "../asks/ask.ts";
import { LAND_STALL_MS } from "../gates/factory-status.ts";
import { sandboxRepos } from "../gates/gpu.ts";
import { fetchOrigin, git, mainRef } from "../../../lib/git.ts";
import { issue as issueOf, tailOf, type Job } from "../records/job.ts";
import { allJobs, isOpen, isAgentRun, loadRegistry, repoOf, realTell, type Entry, type Repo, type Run, type Tell } from "../records/ledger.ts";
import { askedQuestion, clearRerun, markRescued, rescued, writeRerun } from "../transitions/continuation.ts";
import { logEvent } from "../../../lib/layout.ts";
import { lock } from "../../../lib/locks.ts";
import { bootedAt, markEnded, runHealth, type Health } from "../infra/process.ts";
import { causeOf, type Fate } from "../records/outcome.ts";
import type { MainState } from "../gates/tables.ts";
import { branchFacts, onMain } from "../records/status.ts";
import { rescueWaitMs } from "../infra/settings.ts";
import { ciLine, redCi } from "../gates/ci.ts";
import { counting, read as readRecord, setState, stepOf, allRuns, jobOfRun } from "../records/record.ts";
import { errText } from "../../../lib/errtext.ts";

/** What a safe default action does to a run: both return the refusal, or null. */

export interface Rescue {
  /** Drop the job, with the reason; the factory writes the issue note and the news itself. */
  drop: (name: string, reason: string, fate?: Fate) => Promise<string | null>;
  /** Start a recheck of the job. */
  recheck: (name: string) => Promise<string | null>;
  /** Where the rescue's lines for Chris go; Sidetone when absent. */
  tell?: Tell;
}

/** Land the job again: returns the refusal, or null. */
type Land = (name: string) => Promise<string | null>;
/** The state of the repo's main (baseline.ts `mainState`). */
type CheckMain = (repo: Repo) => Promise<MainState>;

const RERUN_OPTIONS = [
  { label: "Rerun", line: "Drop the failed run and start the issue again as it is" },
  { label: "Another way", line: "Start the issue again, taking a different route than the run that failed" },
];

/** The open jobs of factory repos whose last real run passes `test`, given that run, its runHealth and the job. */
function factoryJobs(jobs: Job[], test: (last: Entry, h: Health, j: Job) => boolean): Job[] {
  const keys = new Set(sandboxRepos().map((r) => r.key)), booted = bootedAt();
  return jobs.filter((j) => {
    const last = counting(j);
    return isOpen(j) && !!last.run.repo && keys.has(last.run.repo) && test(last, runHealth(last, booted), j);
  });
}

/** A build, recheck or land still `running`. */
const inFlight = (r: Run): boolean => r.state === "running" && (isAgentRun(r.role) || r.role === "land");

/** The open jobs whose last run, in flight, a host restart killed. No mark is kept: a run stays here until it ends. */
const killed = (jobs: Job[]): Job[] => factoryJobs(jobs, (last, h) => inFlight(last.run) && h === "killed");

/**
 * The open jobs whose last run, in flight, is lost: its process ended since this boot without writing `exit`. The
 * unit writes the run's end before `exit`, so such a run will never end.
 */
const lost = (jobs: Job[]): Job[] => factoryJobs(jobs, (last, h) => inFlight(last.run) && h === "lost");

/** The open jobs of factory repos whose next step is the rescue, with the unit of the last real run not live. */
const errorJobs = (jobs: Job[]): Job[] => factoryJobs(jobs, (_, h, j) => h !== "live" && stepOf(j).step === "rescue");

/** How long a dispatch waits for a run's rescue lock before it skips the run. */

const SLOW_LAND_OPTIONS = [
  { label: "Wait", line: "Leave the land running; it may still end" },
  { label: "Kill and rerun", line: "Stop the land and land the job again" },
  { label: "Drop", line: "Stop the land and drop the job" },
];

/** The open jobs of factory repos whose last real run is a land live for LAND_STALL_MS or more, with no Ask set on it. */
const slowLands = (jobs: Job[], now: number): Job[] => factoryJobs(jobs, (last, h) =>
  last.run.role === "land" && last.run.state === "running" && h === "live" && now - Date.parse(last.run.started) >= LAND_STALL_MS && !asked(last));

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
      const last = counting(runs);
      const r = last.run;
      const repo = repoOf(r.repo);
      const minutes = Math.floor((now - Date.parse(r.started)) / 60_000);
      const question = `${name}: its land run ${last.id} is live for ${minutes} minutes, and 99% of lands end within 20. Wait, kill and rerun, or drop?`;
      const ask = normalizeAsk({ question, options: SLOW_LAND_OPTIONS, recommended: "Wait", why: [`Run: ${name}, land, running since ${r.started}`] }, { reason: "rescue" })!;
      const why = askFromRun(last, repo, issueOf(runs), ask, question);
      if (why) { logEvent({ subject: "gate", action: "failed", object: name, detail: `${name}: no rescue Ask for its slow land: ${why}` }); continue; }
      logEvent({ subject: "gate", action: "waiting", object: name, detail: `${name}: its land is live for ${minutes} minutes; a rescue Ask goes to the director` });
      out.push(name);
    } finally {
      release();
    }
  }
  return out;
}

/** The killed, lost, returned and failed jobs that the rescue acts on. */
export const toRescue = (jobs: Job[]): Job[] => [...killed(jobs), ...lost(jobs), ...errorJobs(jobs)];

/** Take the safe default action for each killed, lost, returned or failed job, one job at a time under its lock. */
export async function rescueErrors(act: Rescue, land?: Land, checkMain?: CheckMain): Promise<void> {
  await releaseEdited(act);
  const pending = toRescue;
  for (const first of pending(allJobs())) {
    const name = first[0].run.name;
    // Wait: the dispatch that holds it may have read the job before this run ended, and would not act on it.
    const release = await lock(`rescue-${first[0].run.repo}-${name}`, rescueWaitMs());
    if (!release) { logEvent({ subject: "gate", action: "skipped", object: name, detail: "the rescue lock stayed busy" }); continue; }
    try {
      // Read again under the lock: another dispatch may have acted on it.
      const runs = pending(allJobs()).find((j) => j[0].run.job === first[0].run.job);
      if (runs) await rescueJob(runs, act, land, checkMain);
    } catch (e) {
      logEvent({ subject: "gate", action: "failed", object: name, detail: errText(e) });
    } finally {
      release();
    }
  }
}

/** The open jobs whose last run waits for a spec edit and whose issue's spec is no longer the one it asked about. */
export const editedWaits = (jobs: Job[]): Job[] => jobs.filter((runs) => {
  const last = counting(runs), r = last.run;
  if (!r.repo || (r.state !== "returned" && r.state !== "failed") || !isOpen(runs)) return false;
  const waits = waitsForSpecEdit(last);
  if (!waits) return false;
  const issue = issueOf(runs);
  const item = issue === undefined ? undefined : reader().item(r.repo, issue);
  return !!loadRegistry()[r.repo] && !!item && issues.status(item) === "open" && !isVersion(item, waits.version);
});

/**
 * A run that ended with no commit and a question waits for a spec edit. When the issue's spec is no longer the one it asked
 * about, the run is dropped and the Ask comes off the item, so the next dispatch starts a run on the edited spec.
 */
async function releaseEdited(act: Rescue): Promise<void> {
  const tell = act.tell ?? realTell;
  for (const runs of editedWaits(allJobs())) {
    const r = counting(runs).run;
    const { question } = waitsForSpecEdit(counting(runs))!;
    const repo = repoOf(r.repo);
    const issue = issueOf(runs)!;
    const release = await lock(`rescue-${r.repo}-${r.name}`, rescueWaitMs());
    if (!release) continue;
    try {
      const why = await act.drop(r.name, "the issue's spec was edited after the run asked about it; the issue starts again on the new spec");
      if (why) { logEvent({ subject: "gate", action: "failed", object: r.name, detail: `release after a spec edit failed (${why})` }); continue; }
      if (askOf(issueKey(issue))?.question === question) clearAsk(issueKey(issue));
      await tell.send(`${repo.key}/${r.name}: the spec was edited; the issue starts again`);
    } catch (e) {
      logEvent({ subject: "gate", action: "failed", object: r.name, detail: `release after a spec edit failed: ${errText(e)}` });
    } finally {
      release();
    }
  }
}

/** The run a rescue acts on: its entry, its repo, its job name, its issue, and why it stopped. */
type Ended = { last: Entry; r: Run; repo: Repo; name: string; issue: number | string | undefined; reason: string };

type RescueCase = "duplicate" | "no-commit" | "claimed" | "timeout" | "infra" | "land-checks" | "land-conflict" | "main-red";

/** Which safe case a returned or failed run is in, or null: not safe. `claim` is the worker's "already met" reason, if it made one. */
function rescueCase(r: Run, onMainOrDone: boolean, claim: string | null): RescueCase | null {
  const cause = causeOf(r);
  if (cause === "no-commit") return onMainOrDone ? "duplicate" : claim !== null ? "claimed" : "no-commit";
  if (cause === "timeout" && r.role !== "land") return "timeout";
  if (cause === "infra" || cause === "locked") return "infra";
  if (r.role === "land" && cause === "conflict") return "land-conflict";
  if (r.role === "land" && !r.conflicts?.length && cause === "check") return "land-checks";
  if (isAgentRun(r.role) && cause === "check" && failsOnMain(r)) return "main-red";
  return null;
}

/** Whether each failed test of the run's failed check fails on main too, as the worker verdict's `failsOnMain` marks it. */
function failsOnMain(r: Run): boolean {
  const tests = r.checks?.findLast((c) => c.name === r.checkName)?.tests;
  // The record keeps at most 20 failures, so a check with more cannot show that each fails on main.
  return !!tests?.failures.length && tests.failures.length === tests.failed && tests.failures.every((f) => f.onMain);
}

/** One action on a run. `rerun` is the rerun note; `dropReason` is the drop's text, when it is not `noted`; `told` is the news, when it is not `noted`. */
type Step = { action: "drop" | "land again" | "recheck"; rerun?: string; dropReason?: string; noted: string; told?: string; done?: boolean; fate?: Fate };

/** The step for a run that a host restart killed. `hasWork`: its branch has commits ahead of main. The issue did not cause this: no rescue mark, so the issue keeps its rerun. */
function killedStep({ last, r }: Ended, hasWork: boolean): Step {
  const text = `a host restart killed ${r.role} run ${last.id}`;
  // The branch passed, and the land may have pushed: a new land finds that, and a new issue run would do the work twice.
  if (r.role === "land") return { action: "land again", noted: `${text}: landed again`, told: `${text}: landing again` };
  // A build or recheck with commits ahead of main has finished work: a recheck of its branch keeps it, and no new run is started.
  if (isAgentRun(r.role) && hasWork) return { action: "recheck", noted: `${text}: rechecked, its branch has the worker's commits`, told: `${text}: rechecking its branch` };
  return { action: "drop", dropReason: `${text}. The issue did not cause this. Run the issue again from the start.`, noted: `${text}: dropped, and the issue starts again`, told: `${text}: the issue starts again` };
}

/** The step for a lost run: a host restart's step, as the issue did not cause it either. The rescue counts it once per issue. */
function lostStep({ last, r }: Ended, hasWork: boolean): Step {
  const text = `${r.role} run ${last.id} was lost: its process ended with no end written`;
  if (r.role === "land") return { action: "land again", noted: `${text}: landed again, once`, told: `${text}: landing again` };
  if (isAgentRun(r.role) && hasWork) return { action: "recheck", noted: `${text}: rechecked once, its branch has the worker's commits`, told: `${text}: rechecking its branch` };
  return { action: "drop", dropReason: `${text}. Run the issue again from the start.`, noted: `${text}: dropped, and the issue reruns once`, told: `${text}: the issue reruns` };
}

/** The step for a worker's claim that the issue is met, by `red`, the red line of main. `failure` is the red CI's failure, which the rerun quotes. */
function claimStep({ last, r, repo }: Ended, claim: string | null, red: string | null, failure?: string): Step {
  const said = `${r.role} run ${last.id} says the issue is already met (${claim})`;
  if (!red) return { action: "drop", noted: `${said}, and the checks pass on origin/${repo.main}: dropped, and the item is done`, done: true, fate: "met" };
  return {
    action: "drop",
    rerun: `The last run said the issue is already met (${claim}), but the checks do not pass on origin/${repo.main} (${red}). Make the change the issue asks for.${failure ? ` The failure happens on GitHub CI: a pass on this host does not show the issue met. The CI failure:\n\n\`\`\`\n${failure}\n\`\`\`` : ""}`,
    noted: `${said}, but ${red}; dropped, and the issue reruns once`,
  };
}

/** The step for a run that ended with no commit while the item is already on main (`onMain`) or done. */
function duplicateStep({ last, r }: Ended, onMain: string | null | undefined): Step {
  return { action: "drop", noted: `${r.role} run ${last.id} ended with no commit and the item is already ${onMain ? `on main as ${onMain}` : "done"}: dropped as a duplicate, and the item is closed`, done: !!onMain, fate: "met" };
}

/** The step for an infrastructure failure: a land lands again, a run with a branch (`hasBranch`) is rechecked, and any other run reruns. */
function infraStep({ last, r, reason }: Ended, hasBranch: boolean): Step {
  const text = `${r.role} run ${last.id} failed for infrastructure (${reason}): `;
  if (r.role === "land") return { action: "land again", noted: `${text}landed again, once`, told: `${text}landing again` };
  if (hasBranch) return { action: "recheck", noted: `${text}rechecked, once`, told: `${text}rechecking` };
  return { action: "drop", rerun: `The last run failed before it made a branch: ${reason}.`, dropReason: `${text}dropped for one rerun`, noted: `${text}dropped; the issue reruns once`, told: `${text}the issue reruns` };
}

/** The step for a land that hit a merge conflict. `touched` is the last commit on main that changed the files. */
function conflictStep({ last, r, repo }: Ended, touched: string): Step {
  const files = r.conflicts ?? [];
  const what = `${files.join(", ") || "unknown files"}${touched ? `, last changed on ${repo.main} by ${touched}` : ""}`;
  return {
    action: "drop",
    rerun: `The last land failed with a merge conflict in ${what}. Another issue landed on the same lines first; this run starts from the current ${repo.main}.`,
    noted: `${r.role} run ${last.id}: merge conflict in ${what}; dropped, and the issue reruns once from current ${repo.main}`,
  };
}

/** The step for a run whose failed tests all fail on main, once main is green. */
function greenStep({ last, r }: Ended): Step {
  const text = `${r.role} run ${last.id} failed only tests that fail on main too, and main is green now: `;
  return { action: "recheck", noted: `${text}rechecked, once`, told: `${text}rechecking` };
}

/** The step for a run that stopped with nothing to keep. The note quotes the end of its log. */
function rerunStep({ last, r, reason }: Ended, key: "no-commit" | "land-checks"): Step {
  const why = key === "no-commit" ? "the last run made no commit" : `the checks failed after the land merged main (${reason})`;
  const file = key === "land-checks" ? "checks" : "result.md";
  return {
    action: "drop",
    rerun: `${why[0].toUpperCase()}${why.slice(1)}. The last 20 lines of its ${file === "checks" ? "checks log" : file}:\n\n\`\`\`\n${tailOf(last, file, 20) || "(empty)"}\n\`\`\``,
    noted: `${r.role} run ${last.id}: ${why}; dropped, and the issue reruns once`,
  };
}

/** The commit of this job or this item on main, or `{ onMain: null }` when the item is closed without one; null when neither. */
function foundDone({ last, repo, issue }: Pick<Ended, "last" | "repo" | "issue">): { onMain: string | null } | null {
  const found = onMain(repo, { jobs: jobOfRun(last.id).map((e) => e.id), item: issue, fetch: true });
  if (found) return { onMain: found.commit.slice(0, 7) };
  const item = issue === undefined ? undefined : reader().item(repo.key, issue);
  return item && (issues.status(item) === "done" || issues.status(item) === "dropped") ? { onMain: null } : null;
}

/** Whether the run's branch exists. */
const hasBranch = ({ r, repo }: Pick<Ended, "r" | "repo">): boolean => !!r.branch && git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${r.branch}`).ok;

/** The last commit on main that changed the files a land conflicted in, after a fetch; empty when none. */
function touched({ r, repo }: Pick<Ended, "r" | "repo">): string {
  const files = r.conflicts ?? [];
  fetchOrigin(repo.path);
  return files.length ? git(repo.path, "log", `origin/${repo.main}`, "-1", "--format=%h %s", "--", ...files).out : "";
}

/** Whether a branch carries the worker's finished work, as `branchFacts` decides: commits reach the branch only after the worker ended. */
function hasWork({ r, repo }: Pick<Ended, "r" | "repo">): boolean {
  if (!r.branch || !git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${r.branch}`).ok) return false;
  return !!branchFacts(repo, mainRef(repo.path, repo.main), `refs/heads/${r.branch}`);
}

/** Whether intake cannot split this issue: it is a part (id `n.m`) or a child filed with `from:`, or it has parts. */
function splitAlready({ repo, issue }: Pick<Ended, "repo" | "issue">): boolean {
  if (issue === undefined || typeof issue === "string") return true;
  const doc = reader().list(repo.key);
  const item = doc && issues.find(doc, issue);
  return !!item && (issues.parentRef(item) !== undefined || partsOf(doc, item).length > 0);
}

/** Set `plan` on the issue, so the next dispatch starts intake on it, which splits it. Returns the refusal, or null. */
function sendToIntake(repo: Repo, issue: number): string | null {
  try {
    const w = writeList(repo, `time box: plan ${repo.key}-${issue}`, (doc) => {
      const item = issues.find(doc, issue);
      if (!item || issues.status(item) !== "open") return null;
      setPlan(item, true);
      return true;
    });
    return w?.value ? null : "the issue is no longer open";
  } catch (e) {
    return errText(e);
  }
}

/** Choose the rescue of one job, and do it. The once-only rule is here: a mark on the run counts the case against the issue. */
async function rescueJob(runs: Job, act: Rescue, land?: Land, checkMain?: CheckMain): Promise<void> {
  const tell = act.tell ?? realTell;
  const last = counting(runs);
  const r = last.run;
  const repo = repoOf(r.repo);
  const name = r.name;
  const p = parseId(name);
  const issue = issueOf(runs) ?? (p === null ? undefined : p.sub === undefined ? p.n : `${p.n}.${p.sub}`);
  const isKilled = killed([runs]).length > 0;
  const isLostRun = !isKilled && lost([runs]).length > 0;
  const ended: Ended = { last, r, repo, name, issue, reason: isKilled ? "host restart" : isLostRun ? "lost: its process ended with no end written" : r.reason ?? r.state };
  const { reason } = ended;

  const say = (line: string) => tell.send(`${shortId(name)}: ${line}`);
  // Code writes no issue note: a rescue that closes the issue logs `done`, any other step logs `changed`.
  const record = (text: string, opts: { done?: boolean } = {}) => {
    if (issue !== undefined && !opts.done) logEvent({ subject: "gate", action: "changed", object: keyOf("issue", Number(issue)), detail: text });
    const why = issue === undefined ? "no issue" : opts.done ? close(repo, issue, text, "done", "gate") : null;
    if (why) logEvent({ subject: "gate", action: "failed", object: name, detail: `no issue note: ${why}` });
  };
  const choice = (question: string, why: string[]) => normalizeAsk({ question, options: RERUN_OPTIONS, recommended: "Rerun", why: [`Run: ${name}, ${r.state}`, `Reason: ${reason}`, ...why] }, { reason: "rescue" })!;
  // A run that ended with a QUESTION about the spec: a rerun reads the same spec and asks again, so it waits for a spec edit.
  const asked = askedQuestion(r);
  const specQuestion = asked !== null;
  // `spec`: the run asked about this issue's spec, so it waits for a spec edit.
  const chris = async (question: string, ask: Ask, spec?: issues.Issue) => {
    // An Always rule to take the recommendation: Rerun drops the run, and the issue reruns. Not for a run that asked a question.
    if (!specQuestion && ask.recommended === "Rerun" && always("rescue", repo.key)?.action === "resolve") {
      const why = await act.drop(name, question);
      if (!why) {
        logAlways("rescue", name, "reran", { detail: `dropped ${runs[0].id}` });
        record("always: Rerun");
        await tell.send(`${repo.key}/${name}: always: Rerun; dropped, and the issue reruns`);
        return;
      }
      logEvent({ subject: "gate", action: "failed", object: name, detail: `always Rerun failed (${why})` });
    }
    const why = askFromRun(last, repo, issue, ask, question, spec);
    if (why) logEvent({ subject: "gate", action: "failed", object: name, detail: `no issue note: ${why}` });
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

  if (isKilled || isLostRun) {
    const step = (isKilled ? killedStep : lostStep)(ended, isAgentRun(r.role) && hasWork(ended));
    // The real recheck takes only a returned or failed run, so a killed land or recheck ends failed first. A lost run always
    // does, so it is no longer lost, whatever comes next: the recheck and the Ask both want an ended run.
    if (isLostRun || r.role === "land" || step.action === "recheck") {
      markEnded(last.folder, 143);
      setState(last.id, "failed", { reason, cause: "other", phase: undefined, told: true });
    }
    if (isKilled) return take(step);
    const again = allRuns().some((e) => e.run.repo === r.repo && e.run.name === name && e.folder !== last.folder && rescued(e) === "lost");
    if (again) return chris(`${name}: a second run of this issue was lost (its process ended with no end written). Drop it, or change the issue?`, choice(`${name}: a second run was lost: how should the factory go on?`, ["An earlier run of this issue was lost too, and its rerun did not clear it"]));
    markRescued(last, "lost");
    return take(step);
  }

  const noCommit = causeOf(r) === "no-commit";
  if (specQuestion) {
    const q = asked || reason;
    const item = issue === undefined ? undefined : reader().item(repo.key, issue);
    const text = `${name} ended with no commit and asked: ${q} The issue waits for a spec edit; the factory starts it again when you edit it. Or drop it.`;
    return chris(text, plainAsk("question", text, [`Run: ${name}, ${r.state}`]), item);
  }
  const found = noCommit ? foundDone(ended) : null;
  const claim = noCommit ? r.alreadyMet ?? null : null;
  const key = rescueCase(r, !!found, claim);
  if (!key) return chris(`${name} is ${r.state} (${reason}); drop it, recheck it, or edit the issue?`, choice(`${name} is ${r.state} (${reason}): how should the factory go on?`, ["No safe default covers this case"]));

  const earlier = allRuns().some((e) => e.run.repo === r.repo && e.run.name === name && e.folder !== last.folder && rescued(e) === key);
  if (key === "claimed") {
    // The worker says the issue is met: the repo's checks on origin/<main> decide. Green closes the item; red reruns
    // the issue with the claim as its note. An unchecked main is waited on: the run stays for the next dispatch.
    const main: MainState = checkMain ? await checkMain(repo) : { state: "unchecked", line: "main is unchecked: no checks" };
    if (main.state === "unchecked" || main.state === "running") { logEvent({ subject: "gate", action: "waiting", object: name, detail: `the claim waits: ${main.line}` }); return; }
    // An issue a red CI started is met only when GitHub CI on main is green too: the checks here may pass where CI fails.
    const ci = issue === undefined ? undefined : readRecord(keyOf("issue", Number(issue)))?.ci;
    const ciRed = ci ? redCi().find((c) => c.repo === repo.key) : undefined;
    const red = main.state === "red" ? main.line : ciRed ? ciLine(ciRed) : null;
    markRescued(last, key);
    if (red && earlier) return chris(`${name} says the issue is already met again (${claim}), but ${red}. Drop it, or change the issue?`, choice(`${name} says the issue is already met again, but ${red}: how should the factory go on?`, [`Claim: ${claim}`]));
    return take(claimStep(ended, claim, red, ciRed && ci?.failure));
  }
  if (key === "duplicate") {
    markRescued(last, key);
    return take(duplicateStep(ended, found?.onMain));
  }
  if (key === "timeout") {
    // No rerun of the same issue: a plain issue goes to intake to be split; a part, or an issue split already, asks.
    if (earlier || splitAlready(ended)) return chris(`${name} ran out of its time box again, and it cannot be split further (${earlier ? "an earlier run hit the time box too" : "it is a part, or it has been split already"}). Drop it, or change the issue?`, choice(`${name} ran out of its time box and cannot be split: how should the factory go on?`, ["Intake cannot split it again"]));
    markRescued(last, key);
    const why = await act.drop(name, `time box ran out in ${r.role} run ${last.id}; the issue goes to intake to split`);
    const bad = why ?? sendToIntake(repo, issue as number);
    if (bad) return chris(`${name}: sending it to intake failed (${bad}); ${reason}. What now?`, choice(`${name}: sending it to intake failed: how should the factory go on?`, [`Failure: ${bad}`]));
    const text = `${r.role} run ${last.id}: the time box ran out; dropped, and the issue goes to intake to split`;
    record(text);
    return void await say(text);
  }
  if (key === "main-red") {
    // Main fails these tests too, so a fix round or an Ask waits for main: a green main rechecks the branch.
    const main: MainState = checkMain ? await checkMain(repo) : { state: "unchecked", line: "main is unchecked: no checks" };
    if (main.state !== "green") { logEvent({ subject: "gate", action: "waiting", object: name, detail: `each failed test fails on main too; the run waits: ${main.line}` }); return; }
  }
  if (earlier) return chris(`${name} hit the same case again (${key}: ${reason}); a rerun did not clear it. Drop it, or change the issue?`, choice(`${name} hit the same case again (${key}): how should the factory go on?`, ["A rerun did not clear it"]));
  markRescued(last, key);
  return take(key === "infra" ? infraStep(ended, r.role !== "land" && hasBranch(ended)) : key === "land-conflict" ? conflictStep(ended, touched(ended)) : key === "main-red" ? greenStep(ended) : rerunStep(ended, key as "no-commit" | "land-checks"));
}
