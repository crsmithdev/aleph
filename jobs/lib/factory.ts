/**
 * The factory around the runs: the timer's tick, the dispatch and the report.
 * What it reads of its state is in factory-status.ts. Its state lives in
 * ~/.aleph/factory. See docs/specs/2026-10-26-seed-factory.md.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { byPriority, afterOf, goal, goals, isSorted, note, partsOf, planSet, readFetched, readList, readLists, reader, type Reader } from "../../todo/lib/store.ts";
import { fetchOrigin, git } from "./git.ts";
import { askChris, askOf, needsOf, plainAsk } from "./ask.ts";
import { factoryLog } from "./layout.ts";
import { itemOnMain, repoStages } from "./status.ts";
import { countsLine, triageIssue, type Counts } from "./triage.ts";
import { allRuns, askOf as runAskOf, isAwaiting, loadRegistry, lock, updateRun, type Entry, type Repo } from "./ledger.ts";
import { isLive, isStarting } from "./process.ts";
import { rescueStuck, type Rescue } from "./rescue.ts";
import { clearRerun, goalBrief } from "./continuation.ts";
import { causeOf, type Fate } from "./outcome.ts";
import { allJobs, checkedBy, lookMinutes, openJob } from "./job.ts";
import { mine, proposals, readStore } from "./corrections.ts";
import { directAll, pendingCases, type Decision, type Ports as DirectorPorts } from "./director.ts";
import { writeEpisodes } from "./episode.ts";
import { vaultDir } from "../../vault/lib/vault.ts";
import { readdirSync } from "node:fs";
import { waitingToLand } from "./landing.ts";
import { baselineChecks, type ChecksStop } from "./checks.ts";
import { drop, land, recheck, refusal, startGoal } from "./transitions.ts";
import { startKept } from "./unit.ts";
import { directorDetached, dispatchDetached, planDetached, specCheckDetached, triageDetached } from "./launch.ts";
import { markLaunched, passNotes, recordedVerdict, specChecking } from "./spec-check.ts";
import { needsPlan, planning, runPlan, type Rate } from "./plan.ts";
import { route, type Tier } from "./route.ts";
import { mainRed, writeBaseline, clearCap, goalFacts, issueJob, markCap, markStreak, setPaused, baselines, changedLinesOf, factoryDir, factoryGates, factoryRepos as sandboxRepos, gates, liveRuns, paused, recordHold, redLine, runsToday, spentToday } from "./factory-status.ts";
export { setPaused };

import { goalDecision, NO_COMMIT_LIMIT, pendingWaits, refDone, type Gate } from "./goal-decision.ts";

/** A start refused because the live cap filled: the line `gates` gives for it. */
const LIVE_REFUSAL = / agent runs are live/;
import { TRIAGE_CAP, goalLockWaitMs, rescueOn } from "./settings.ts";


/** The buildable issues of each factory repo. */
export const openGoals = (lists?: Reader): { repo: Repo; item: issues.Issue }[] => goals(sandboxRepos(), lists);

/** Whether `<repo>-<n>` is done, by `refDone`. It fetches each repo once; with `fetch` false it reads what was last fetched. */
export function doneChecker(fetch = true): (ref: string) => boolean {
  const reg = loadRegistry();
  const known = new Map<string, { doc: issues.Doc | null; stages: Map<string, string>; read: boolean }>();
  return (ref) => {
    const r = issues.parseGoalRef(ref);
    const repo = r && reg[r.repo];
    if (!r || !repo) return false;
    if (!known.has(r.repo)) {
      const k = { doc: null as issues.Doc | null, stages: new Map<string, string>(), read: false };
      try {
        k.doc = fetch ? readList(repo) : readFetched(repo);
        for (const s of repoStages(repo, { fetch, doc: k.doc })) k.stages.set(s.id, s.stage);
        k.read = !!k.doc;
      } catch {}
      known.set(r.repo, k);
    }
    const { doc, stages, read } = known.get(r.repo)!;
    return refDone(doc ? issues.find(doc, r.id) : undefined, read, stages.get(`${r.repo}-${r.id}`));
  };
}

/** Dispatch is off when `ALEPH_DISPATCH=off`: a run's end and `aleph issue` then start nothing; the tick's sweep still does. */

/** `tier` is the router's rating when the dispatch has it already; undefined lets the start rate the spec itself. */
type Start = (repo: Repo, name: string, id: number | string, spec: string, tier?: Tier | null) => Promise<string | null>;
export type Checks = (repo: Repo, commit: string, logs: string) => Promise<ChecksStop | null>;
type Land = (name: string) => Promise<string | null>;
/**
 * Start every ready goal, in order, until the live cap. It runs when a run ends, when a goal is added or edited,
 * and from the tick's sweep when the sweep finds work it missed. While the factory is paused it does nothing. Else its steps run first: the next
 * steps a pause kept (`startKept`), the rescue of stuck, failed, killed and lost runs, the lands and the close of parents whose parts are done.
 * It runs no checks: main's state is what the last `aleph suite` recorded (`mainState`). Then each goal meets the 7 gates of goalDecision in
 * order; the first that binds skips it, and its hold record names that gate. A goal no gate holds goes to the
 * routing step (its spec check, or the planner) and then starts. Each start holds a lock on its goal and re-reads
 * the jobs under it, so two dispatches at once start a goal once. `start` dispatches the run; it
 * is `aleph job`, in-process (transitions.ts). With `rate`, a large goal's
 * first run is a planner run on its issue instead (plan.ts). It starts goals
 * only: an issue is closed as done once its goals are all done (`closeIssues`).
 * `plan` starts an issue's planner detached; the dispatch does not wait for it.
 * `specCheck` starts a goal's spec check detached (spec-check.ts), for a repo with `author` set: a goal
 * starts only once its spec version has a recorded verdict of pass or error.
 */
export async function dispatchIssues(start: Start, land?: Land, rescue?: Rescue, rate?: Rate, plan: (repo: Repo, id: number) => void = planDetached, specCheck: (repo: Repo, ref: string) => void = specCheckDetached): Promise<{ started: string[]; skipped: string[]; paused?: true; landed?: string[]; planned?: string[] }> {
  if (gates({ only: ["pause"] })) {
    factoryLog("paused");
    return { started: [], skipped: [], paused: true };
  }
  const kept = await startKept();
  if (kept.length) factoryLog(`started the steps the pause kept: ${kept.join(", ")}`);
  if (rescue) await rescueStuck(rescue, land, async (repo) => mainState(repo));
  const landed: string[] = [];
  if (land) {
    // All at once: the lands queue on the repo's lock, and the first takes the rest into one batch.
    const names = waitingToLand();
    const whys = await Promise.all(names.map((name) => land(name)));
    names.forEach((name, i) => { if (!whys[i]) landed.push(name); });
    if (landed.length) factoryLog(`landed ${landed.join(", ")}`);
  }
  const started: string[] = [];
  const skipped: string[] = [];
  const planned: string[] = [];
  const redOf = mainRed();
  const done = doneChecker();
  // A parent whose parts all landed closes without a green main.
  for (const repo of sandboxRepos()) for (const l of await closeIssues(repo, done)) skipped.push(l);
  const goals = openGoals();
  // The planner starts an agent run, so the baseline gate holds it as it holds a goal.
  const planners: { repo: Repo; item: issues.Issue }[] = [];
  for (const repo of sandboxRepos()) {
    if (redOf(repo)) continue;
    for (const item of reader({ fetch: false }).list(repo.key)?.items ?? []) if (planSet(item)) planners.push({ repo, item });
  }
  for (const { repo, item } of byPriority(planners)) {
    if (issues.status(item) !== "open" || askOf(item) || pendingWaits(afterOf(item), done).length || await planning(repo, item.id)) continue;
    plan(repo, item.id);
    planned.push(issueJob(repo, item.id));
  }
  /** Records the hold and the skip line of a goal no start reached. */
  const skip = (name: string, kind: Gate, why: string, line = why) => { recordHold(name, kind, why); skipped.push(`${name}: ${line}`); };
  for (const { repo, item: listed } of goals) {
    const ref = issues.idOf(listed);
    const name = issueJob(repo, ref);
    const red = redOf(repo);
    // The cheap facts first: the pause was asked above.
    const first = goalDecision({ name, item: listed, done, red });
    if (first.kind !== "ready") { skip(name, first.kind, first.why); continue; }
    // Wait for a dispatch that holds the goal: it may skip it (an open job a drop is closing right now), and a
    // dispatch that skipped here too would leave the goal until the next tick. Under the lock all is read again.
    const release = await lock(`goal-${name}`, goalLockWaitMs());
    if (!release) { skip(name, "not-ready", "another dispatch is starting it"); continue; }
    try {
      const jobs = allJobs();
      const open = openJob(name, null, jobs);
      // Read after the jobs: a note added before the last run's drop is in the rerun's spec. It may also have gained an after.
      const item = open ? listed : goal(repo, ref);
      if (!item) { skip(name, "not-ready", "not a goal"); continue; }
      const d = goalDecision({
        ...goalFacts(repo, item, jobs), done, red,
        // A pass that began before a pause must not start a run after it.
        ...factoryGates(jobs),
        // A plan job and a spec check run detached: the goal gets no second one and no worker while either does.
        planning: !open && await planning(repo, item.id),
        checking: !open && !!repo.author && await specChecking(name),
      });
      if (d.kind !== "ready" && d.kind !== "loop-guard") { skip(name, d.kind, d.why); continue; }
      // Read again just before the start or the Ask: an item done, dropped or parked since it was read gets neither, whatever the trigger.
      const latest = reader().item(repo.key, ref);
      if (!latest || issues.status(latest) !== "open") {
        skip(name, "not-ready", `the item is ${latest ? (issues.status(latest) === "parked" ? "parked" : issues.status(latest)) : "gone"}`);
        continue;
      }
      if (d.kind === "loop-guard") {
        // The Ask goes to the director, as every Ask does.
        recordHold(name, d.kind, d.why);
        skipped.push(`${name}: ${d.why}`);
        if (d.ask === "no-commit") {
          markStreak(name);
          const text = `the last ${NO_COMMIT_LIMIT} runs of this goal ended with no commit, so the factory stopped starting it; rewrite the goal or close the item.`;
          const bad = askChris(repo, ref, plainAsk("no-commit", text), text);
          if (bad) factoryLog(`${name}: no issue note: ${bad}`);
        } else {
          const text = `the factory started this goal ${d.starts} times in the last hour; it stops starting it until Chris reruns it.`;
          const bad = askChris(repo, ref, plainAsk("run-cap", text), text);
          if (bad) factoryLog(`${name}: no issue note: ${bad}`);
          else markCap(name);
        }
        continue;
      }
      // Routing: the spec check runs in a process of its own (it clones the repo and may take 900 s); the dispatch reads its
      // verdict. With none for this spec version, the dispatch starts the check, and Not ready holds the goal while it runs.
      // A pass or an error starts the goal. A hold sets the Ask, so the goal leaves the list until it is answered; a hold with
      // no Ask left is one answered with a rerun and no edit, and it starts, as a checked version is not checked again.
      if (repo.author) {
        const v = recordedVerdict(latest);
        if (!v) { markLaunched(name); specCheck(repo, issues.refOf(latest)); skip(name, "not-ready", "spec check running"); continue; }
        if (v.verdict === "hold" && askOf(latest)) { skip(name, "not-ready", v.problems, "spec check held"); continue; }
      }
      const { spec, rerun } = goalBrief(item, name, jobs, repo.author ? passNotes(latest) : "");
      let tier: Tier | null | undefined;
      if (rate) {
        const p = await needsPlan(repo, item, spec, rate);
        if (paused()) { skip(name, "pause", "paused"); continue; }
        if ("plan" in p) { plan(repo, item.id); planned.push(name); continue; }
        tier = p.tier;
      }
      const why = await start(repo, name, ref, spec, tier);
      // A refused start: the item landed or its job runs (another dispatch got there first), or the last live slot filled.
      if (why) skip(name, LIVE_REFUSAL.test(why) ? "live-cap" : "not-ready", why);
      else { recordHold(name, "started", "started"); started.push(name); clearCap(name); if (rerun) clearRerun(name); }
    } finally {
      release();
    }
  }
  factoryLog(`started ${started.join(", ") || "none"}${planned.length ? `; planning ${planned.join(", ")}` : ""}${skipped.length ? `; skipped ${skipped.join("; ")}` : ""}`);
  return { started, skipped, ...(landed.length ? { landed } : {}), ...(planned.length ? { planned } : {}) };
}

/** Whether every part is done or dropped, at least one is done, and the parent is neither asking nor to plan: then it closes. */
const finished = (doc: issues.Doc, item: issues.Issue, repo: Repo, done: (ref: string) => boolean): boolean => {
  const parts = partsOf(doc, item);
  if (issues.status(item) !== "open" || !parts.length || askOf(item) || planSet(item)) return false;
  const isDone = (p: issues.Issue) => issues.status(p) !== "dropped" && done(`${repo.key}-${issues.refOf(p)}`);
  return parts.some(isDone) && parts.every((p) => issues.status(p) === "dropped" || isDone(p));
};

/**
 * An open parent whose parts are all done or dropped, with at least one done and no Ask, is closed as done, with a note naming the
 * parts' commits. The write that drops the last open part sets the Ask, so Chris decides first. Returns the lines for the dispatch's skipped list.
 */
async function closeIssues(repo: Repo, done: (ref: string) => boolean): Promise<string[]> {
  const lines: string[] = [];
  const doc = reader({ fetch: false }).list(repo.key);
  for (const listed of doc?.items ?? []) {
    if (!doc || !finished(doc, listed, repo, done)) continue;
    const name = `${repo.key}-${listed.id}`;
    const release = await lock(`issue-${name}`, 0);
    if (!release) { lines.push(`${name}: another dispatch holds it`); continue; }
    try {
      const now = reader().list(repo.key);
      const item = now ? issues.find(now, listed.id) : undefined;
      if (!now || !item || !finished(now, item, repo, done)) continue;
      const commits = partsOf(now, item).filter((p) => issues.status(p) !== "dropped").map((p) => `${repo.key}-${issues.refOf(p)} (${itemOnMain(repo, issues.idOf(p)) ?? "no commit"})`);
      const bad = note(repo, item.id, `its parts are done: ${commits.join(", ")}`, { done: true });
      lines.push(bad ? `${name}: not closed: ${bad}` : `${name}: closed as done`);
    } finally {
      release();
    }
  }
  return lines;
}

const localDay = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

/** True from 03:00 local, when the store has not been mined on this local date. */
export function correctionsDue(now = Date.now()): boolean {
  if (new Date(now).getHours() < 3) return false;
  const at = readStore().minedAt;
  const t = Date.parse(at);
  return !at || Number.isNaN(t) || localDay(t) !== localDay(now);
}

/** The tick's daily correction mining (corrections.ts), under the pause gate. An error is logged, never thrown. */
export async function correctionsStep(now = Date.now()): Promise<{ signals: number; lessons: number; proposed: number } | null> {
  if (gates({ only: ["pause"] }) || !correctionsDue(now)) return null;
  try {
    const store = await mine(now);
    const r = {
      signals: store.lessons.reduce((n, l) => n + l.signals.length, 0),
      lessons: store.lessons.length,
      proposed: store.lessons.filter((l) => l.state === "proposed").length,
    };
    factoryLog(`corrections: ${r.signals} signals, ${r.lessons} lessons, ${r.proposed} proposed`);
    // A proposed lesson is an Ask.
    if (r.proposed) directIfNew();
    return r;
  } catch (e) {
    factoryLog(`corrections: failed: ${(e as Error).message}`);
    return null;
  }
}

/** The detached starts that follow a write: a triage of one issue, and the director. Tests replace them. */
export interface Starts { triage(repo: Repo, id: number): void; director(): void }
const starts: Starts = { triage: triageDetached, director: directorDetached };

/** A triage or director run of `on` that has not ended: its process holds the work, so nothing starts a second. */
const running = (runs: Entry[], kind: string, on: string) => runs.some((e) => e.run.kind === kind && e.run.on === on && e.run.condition === "running");

/**
 * The triage queue: a triage for each open issue that is not sorted, oldest first, at most `ALEPH_TRIAGE_CAP`,
 * each detached. While the live cap binds it starts none: the dispatch at the end of the next run calls it again.
 * Returns the issues it started a triage for.
 */
export function triageQueued(start: (repo: Repo, id: number) => void = triageDetached, runs: Entry[] = allRuns(), lists: Reader = reader({ fetch: false })): string[] {
  if (gates({ only: ["pause", "live-cap"], jobs: [runs] })) return [];
  const queue: { repo: Repo; item: issues.Issue }[] = [];
  for (const repo of sandboxRepos()) {
    const doc = lists.list(repo.key);
    for (const item of doc?.items ?? []) if (issues.status(item) === "open" && !isSorted(doc!, item)) queue.push({ repo, item });
  }
  queue.sort((a, b) => String(a.item.fm.created ?? "").localeCompare(String(b.item.fm.created ?? "")) || a.repo.key.localeCompare(b.repo.key) || a.item.id - b.item.id);
  const started: string[] = [];
  for (const { repo, item } of queue.slice(0, TRIAGE_CAP())) {
    const name = `${repo.key}-${item.id}`;
    if (running(runs, "triage", name)) continue;
    start(repo, item.id);
    started.push(name);
  }
  return started;
}

/**
 * Start the director at once when an Ask has no case text and no director run is on it. A dispatch, a triage, the
 * corrections and the firefighter call it after a write that can set an Ask, so no Ask waits for the tick.
 * Returns whether it started the director.
 */
export function directIfNew(start: () => void = directorDetached, runs: Entry[] = allRuns(), lists: Reader = reader({ fetch: false })): boolean {
  if (gates({ only: ["pause"] })) return false;
  if (!pendingCases(sandboxRepos(), runs, lists).some((c) => !running(runs, "director", c.on))) return false;
  start();
  return true;
}

/**
 * `aleph director` (director.ts): one run for each new Ask. `directIfNew` starts it where an Ask is set. Under the
 * pause alone: a decision can let a goal start. An error is logged, never thrown.
 */
export async function directorStep(ports?: DirectorPorts): Promise<Decision[]> {
  if (gates({ only: ["pause"] })) return [];
  const d = await directAll(sandboxRepos(), ports);
  if (d.some((x) => x.outcome === "decided")) dispatchDetached();
  return d;
}

/** The tick's episode pages for goals that finished (episode.ts); never throws. */
export async function episodeStep(): Promise<string[]> {
  try {
    if (gates({ only: ["pause"] })) return [];
    const r = await writeEpisodes(sandboxRepos());
    factoryLog(`episodes ${r.written.join(", ") || "none"}`);
    for (const f of r.failed) factoryLog(`episode failed: ${f}`);
    return r.written;
  } catch (e: any) {
    try { factoryLog(`episodes failed: ${e?.message ?? e}`); } catch {}
    return [];
  }
}

/** Main's baseline as a closed state: `line` is the sentence for logs and skip lines. */
export type Baseline = { state: "green" } | { state: "red" | "unchecked" | "running"; line: string };

/**
 * Main's state as the last suite run recorded it in baseline.json. A red record stays red until a later suite run
 * is green, also when main has moved since; a repo with no record is unchecked.
 */
export function mainState(repo: Repo): Baseline {
  const b = baselines()[repo.key];
  if (!b) return { state: "unchecked", line: "main is unchecked: no suite run yet" };
  return b.ok ? { state: "green" } : { state: "red", line: redLine(b) };
}

/**
 * Whether the repo's checks pass on its current origin/<main>: run once per
 * commit, kept in baseline.json. Returns the closed state with its line.
 * One baseline runs per repo at a time, under a lock; a suite run that finds it
 * taken leaves it. A pass and a failed check are recorded: an error that kept
 * the checks from running (no verdict) is reported, and the next suite run tries again.
 */
export async function baseline(repo: Repo, checks: (repo: Repo, commit: string, logs: string) => Promise<ChecksStop | null>): Promise<Baseline> {
  const unchecked = (line: string): Baseline => ({ state: "unchecked", line });
  if (!fetchOrigin(repo.path).ok) return unchecked("main is unchecked: fetch failed");
  const commit = git(repo.path, "rev-parse", `origin/${repo.main}`).out;
  if (!commit) return unchecked(`main is unchecked: no origin/${repo.main}`);
  const known = () => { const b = baselines()[repo.key]; return b && b.commit === commit ? b : undefined; };
  let b = known();
  if (!b) {
    const release = await lock(`baseline-${repo.key}`, 0);
    if (!release) return { state: "running", line: "main baseline running" };
    try {
      // Another dispatch may have recorded this commit between the read and the lock.
      b = known();
      if (!b) {
        const why = await checks(repo, commit, join(factoryDir(), "baseline", repo.key));
        if (why && why.cause !== "check") return unchecked(`main is unchecked: ${why.reason}`);
        b = { repo: repo.key, commit, ok: !why, ...(why ? { failed: why.checkName ?? "" } : {}) };
        const entry = b;
        await writeBaseline(repo.key, () => entry);
      }
    } finally {
      release();
    }
  }
  return b.ok ? { state: "green" } : { state: "red", line: redLine(b) };
}

/**
 * `aleph suite`, from its own timer: the full checks on origin/<main> of each factory repo whose main moved since
 * the last record (`baseline`). While the factory is paused it does nothing. A repo that turns green starts a
 * dispatch, so the goals its red or unchecked main held start at once.
 */
export async function suiteStep(checks: Checks = baselineChecks): Promise<Record<string, string>> {
  if (gates({ only: ["pause"] })) return {};
  const out: Record<string, string> = {};
  for (const repo of sandboxRepos()) {
    const was = mainState(repo).state;
    const b = await baseline(repo, checks);
    out[repo.key] = b.state === "green" ? "green" : b.line;
    factoryLog(`suite ${repo.key}: ${out[repo.key]}`);
    if (b.state === "green" && was !== "green") dispatchDetached();
  }
  return out;
}

/**
 * What the factory could move now and does not, as `land:<job>`, `goal:<job>` and `ingest:<id>`: a passed run with no
 * land live; a goal that can start with no agent or planner run live; an issue to triage or plan with no triage or
 * planner run live. The gates that stop each step leave its work out, because each gate has its own line.
 */
export function stalled(jobs = allJobs(), lists = reader(), done = doneChecker()): string[] {
  if (gates({ only: ["pause"], jobs })) return [];
  const runs = jobs.flat();
  const live = (kind: string) => runs.some((e) => e.run.kind === kind && isLive(e.folder));
  const redOf = mainRed();
  const out = live("land") ? [] : waitingToLand(jobs).map((name) => `land:${name}`);
  if (!liveRuns(runs) && !live("plan")) {
    for (const { repo, item } of openGoals(lists)) {
      const facts = goalFacts(repo, item, jobs);
      if (goalDecision({ ...facts, done, red: redOf(repo) }).kind === "ready") out.push(`goal:${facts.name}`);
    }
  }
  if (!live("triage") && !live("plan") && !gates({ only: ["live-cap"], jobs })) {
    for (const repo of sandboxRepos()) {
      const doc = lists.list(repo.key);
      for (const item of doc?.items ?? []) {
        if (issues.status(item) !== "open") continue;
        const toPlan = planSet(item) && !askOf(item) && !pendingWaits(afterOf(item), done).length && !redOf(repo);
        if (toPlan || !isSorted(doc!, item)) out.push(`ingest:${issueJob(repo, issues.idOf(item))}`);
      }
    }
  }
  return out;
}

/** How far a checkout is behind origin/<main>, with the diff a pull would bring. */
export function behind(repo: Repo): string | null {
  const n = Number(git(repo.path, "rev-list", "--count", `HEAD..origin/${repo.main}`).out || 0);
  if (!n) return null;
  return `${repo.path} is ${n} commit${n > 1 ? "s" : ""} behind origin/${repo.main}; git pull brings:\n${git(repo.path, "diff", "--stat", "HEAD", `origin/${repo.main}`).out}`;
}

const money = (n: number) => (n > 0 && n < 0.005 ? "<$0.01" : `$${n.toFixed(2)}`);

/** The heading a run's report entry goes under. */
const laneOf = (e: Entry): string =>
  e.run.condition === "landed" ? "delivered" : isAwaiting(e.run.condition) ? "needs you" : e.run.condition === "stuck" || e.run.condition === "failed" ? "stuck" : "other";

/** One run as the report gives it. */
function entry(e: Entry): string {
  const r = e.run;
  const needs = isAwaiting(r.condition) ? needsOf(runAskOf(r)) : undefined;
  const lane = laneOf(e);
  const prio = (lane === "delivered" || lane === "needs you") && r.repo && r.on ? reader().item(r.repo, issues.parseGoalRef(r.on)?.id ?? r.on)?.fm.priority : undefined;
  const head = `${r.repo}/${r.name} ${r.condition}${prio === "high" || prio === "critical" ? ` [${prio}]` : ""}${needs ? ` (${needs})` : ""}${r.round && r.condition !== "stuck" ? ` after ${r.round} fix rounds` : ""}`;
  const lines = [r.reason ? `${head}: ${r.reason}` : head];
  if (r.condition === "landed" && r.commit) {
    lines.push(`  commit ${r.commit.slice(0, 7)}`);
    const j = allJobs().find((x) => x[0].run.job === r.job);
    if (j) lines.push(`  checked by: ${checkedBy(j).join(", ") || "nothing recorded"}`);
    const repo = r.repo ? loadRegistry()[r.repo] : undefined;
    const stat = repo ? git(repo.path, "show", "--shortstat", "--format=", r.commit).out : "";
    if (stat) lines.push(`  look: about ${lookMinutes(changedLinesOf(stat))} min (estimate)`);
  }
  if (needs === "held" || needs === "review") {
    if (r.stat) lines.push(...r.stat.split("\n").map((l) => `  ${l}`));
    lines.push(`  aleph land ${r.name}   (lands it, with Held-by: Chris)`, `  aleph drop ${r.name}   (drops it; the item stays open)`);
  }
  for (const d of r.defaults ?? []) lines.push(`  DEFAULT: ${d}`);
  for (const c of r.checks ?? []) if (c.rerun) lines.push(`  ${c.name} passed on rerun`);
  if (r.cost !== undefined) lines.push(`  cost ${money(r.cost)} at the API price`);
  return lines.join("\n");
}

/**
 * The runs the report has not shown, oldest first; each is then marked
 * shown. `told` is Sidetone's flag and the report leaves it alone.
 */
export function report(now = Date.now()): string {
  const lines = runLines(now);
  const due = cameDue();
  if (due.length) lines.unshift(["came due:", ...due.map((d) => `  ${d}`)].join("\n"));
  const eps = newEpisodes();
  if (eps.length) lines.push(["episodes:", ...eps.map((t) => `  ${t}`)].join("\n"));
  const lessons = proposals();
  if (lessons.length) lines.push(["proposed lessons (Yes or No on Status):", ...lessons.map((l) => `  ${l.id} ${l.kind}: ${l.sentence} (${l.count} signals)`)].join("\n"));
  return lines.join("\n");
}

const episodesSeenFile = () => join(factoryDir(), "episodes-seen");

/** The episode page titles under the vault's wiki/episodes/ that no report has listed; each is then appended to the seen file. */
function newEpisodes(): string[] {
  let titles: string[] = [];
  try { titles = readdirSync(join(vaultDir(), "wiki", "episodes")).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort(); } catch { return []; }
  const seen = new Set(existsSync(episodesSeenFile()) ? readFileSync(episodesSeenFile(), "utf8").split("\n").filter(Boolean) : []);
  const fresh = titles.filter((t) => !seen.has(t));
  if (fresh.length) {
    mkdirSync(factoryDir(), { recursive: true });
    appendFileSync(episodesSeenFile(), fresh.join("\n") + "\n");
  }
  return fresh;
}

const seenFile = () => join(factoryDir(), "seen");

/**
 * The open items whose waited-on item is done, that no report has listed;
 * each is then written to the seen file.
 */
function cameDue(): string[] {
  const seen = new Set(existsSync(seenFile()) ? readFileSync(seenFile(), "utf8").split("\n").filter(Boolean) : []);
  const done = doneChecker();
  const lines: string[] = [];
  const ids: string[] = [];
  const repos = Object.values(loadRegistry());
  let docs: (issues.Doc | null)[] = [];
  try { docs = readLists(repos); } catch {}
  for (const [n, repo] of docs.map((_, n) => [n, repos[n]] as const)) {
    for (const item of docs[n]?.items ?? []) {
      const id = `${repo.key}-${item.id}`;
      if (issues.status(item) !== "open" || seen.has(id)) continue;
      const waits = afterOf(item);
      if (waits.length > 0 && !pendingWaits(waits, done).length) {
        ids.push(id);
        lines.push(`${id} ${item.title}`);
      }
    }
  }
  if (ids.length) {
    mkdirSync(factoryDir(), { recursive: true });
    appendFileSync(seenFile(), ids.join("\n") + "\n");
  }
  return lines;
}

/** The runs the report has not shown, oldest first; each is then marked shown, and the last line counts the day's runs. */
function runLines(now: number): string[] {
  const fresh = allRuns().filter((e) => e.run.shown === false && e.run.kind !== "plain" && e.run.condition !== "running" && !(isLive(e.folder) || isStarting(e)));
  const lines: string[] = [];
  for (const lane of ["delivered", "needs you", "stuck", "other"]) {
    const here = fresh.filter((e) => laneOf(e) === lane);
    if (here.length) lines.push(`${lane}:`, ...here.map(entry));
  }
  for (const e of fresh) updateRun(e.folder, { shown: true });
  const today = runsToday(now);
  if (lines.length) lines.push(`runs in the last 24 hours: ${today.length}, ${money(spentToday(now))} at the API price${paused() ? "; the factory is paused" : ""}`);
  return lines;
}

/**
 * Triage one issue at once, as `aleph issue add`, a note that answers an Ask, a
 * worker's follow-ups and the triage queue do. The gate is the factory's pause. An issue
 * the live cap holds is started by the queue (`triageQueued`) when a run ends. A run of
 * this call that ended with no verdict starts the retry at once, while the issue is still
 * unsorted with no Ask (after `ALEPH_TRIAGE_TRIES` such runs, triage sets the Ask).
 * An Ask the triage set goes to the director at once.
 */
export async function triageNow(repo: Repo, id: number, p: Starts = starts): Promise<{ triaged: Counts; skipped: string[] }> {
  if (gates({ only: ["pause"] })) return { triaged: {}, skipped: [] };
  const name = `${repo.key}-${id}`;
  const mine = () => allRuns().filter((e) => e.run.kind === "triage" && e.run.on === name);
  const before = new Set(mine().map((e) => e.id));
  const t = await triageIssue(repo, id, doneChecker());
  factoryLog(`triaged ${name}: ${countsLine(t.triaged)}${t.skipped.length ? `; skipped ${t.skipped.join("; ")}` : ""}`);
  if (t.triaged.build || t.triaged.plan) dispatchDetached();
  const failed = mine().some((e) => !before.has(e.id) && causeOf(e.run) === "no-answer");
  const doc = reader({ fetch: false }).list(repo.key);
  const item = doc ? issues.find(doc, id) : undefined;
  if (failed && item && issues.status(item) === "open" && !askOf(item) && !isSorted(doc!, item)) {
    factoryLog(`triage ${name}: no verdict; triage again now`);
    p.triage(repo, id);
  }
  directIfNew(p.director);
  return t;
}

/**
 * Plan one goal at once, as `aleph plan` does, under the factory's gates: not paused, a factory repo. When it ends, the parts or the fallback worker start from
 * a dispatch of their own.
 */
export async function planNow(repo: Repo, id: number): Promise<{ planned: string[] } | { why: string }> {
  const gated = gates({ only: ["pause"] });
  if (gated) return { why: gated.why };
  if (!repo.sandbox) return { why: `${repo.key} is not a factory repo` };
  const r = await runPlan(repo, id);
  factoryLog(`plan ${repo.key}-${id}: ${"planned" in r ? `into ${r.planned.join(",")}` : r.why}`);
  dispatchDetached();
  return r;
}

/** The factory's ports onto the transitions, each in-process; each returns the refusal, or null. */
const landGoal = (name: string) => refusal(async () => { await (await land(name, {}, { output: "ignore" })).child?.exited; });
/** A safe default drop: quiet, as the factory writes the issue note and the news. */
const dropGoal = (name: string, reason: string, fate?: Fate) => refusal(() => drop(name, { reason, quiet: true, fate }));
const recheckGoal = (name: string) => refusal(async () => { await (await recheck(name, { output: "ignore" })).child?.exited; });

/**
 * `aleph dispatch`: one dispatch of the ready goals, then the triage queue and the director for an Ask that the
 * dispatch or the run before it set. A run's end calls it, so a triage the live cap held starts when a slot frees.
 */
export async function runDispatch(p: Starts = starts): Promise<Awaited<ReturnType<typeof dispatchIssues>> & { triaging?: string[] }> {
  // `ALEPH_RESCUE=off` leaves a stuck or failed run as it is: its open job keeps its goal not ready.
  const d = await dispatchIssues(startGoal, landGoal, !rescueOn() ? undefined : { drop: dropGoal, recheck: recheckGoal }, route);
  if (d.paused) return d;
  const triaging = triageQueued(p.triage);
  directIfNew(p.director);
  return { ...d, ...(triaging.length ? { triaging } : {}) };
}
