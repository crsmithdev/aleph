/**
 * The factory around the runs: the timer's tick, the dispatch and the report.
 * What it reads of its state is in factory-status.ts. Its state lives in
 * ~/.aleph/factory. See docs/factory.md.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LANES, lane, shortId } from "../../../lib/naming.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { byPriority, afterOf, buildableIssue, buildableIssues, note, partsOf, planSet, priorityOf, readLists, reader, type Reader } from "../../../issues/lib/store.ts";
import { fetchOrigin, git } from "../infra/git.ts";
import { askChris, askOf, needsOf, plainAsk, refIn } from "../asks/ask.ts";
import { logEvent } from "../../../lib/layout.ts";
import { itemOnMain } from "../records/status.ts";
import { intakeIssue, type Counts } from "../roles/intake.ts";
import { allRuns, isWaiting, loadRegistry, type Entry, type Repo } from "../records/ledger.ts";
import { lock } from "../infra/locks.ts";
import { holdsWork, isLive, isRunning } from "../infra/process.ts";
import { rescueStuck, type Rescue } from "../land/rescue.ts";
import { clearRerun, issueBrief } from "./continuation.ts";
import { doneChecker, filing } from "./filing.ts";
import { causeOf, type Fate } from "../records/outcome.ts";
import { allJobs, checkedBy, isOpen, lookMinutes, openJob } from "../records/job.ts";
import { counting, patchRun } from "../records/record.ts";
import { mine, proposals, readStore } from "../learning/corrections.ts";
import { directAll, pendingCases, subjectOfCase, type Decision, type Ports as DirectorPorts } from "../roles/director.ts";
import { episodesDir, writeEpisodes } from "../learning/episode.ts";
import { readdirSync } from "node:fs";
import { waitingToLand } from "../land/landing.ts";
import { baselineChecks, type CheckTask, type ChecksStop } from "../gates/checks.ts";
import { drop, land, recheck, refusal, startIssue, type Refused } from "./transitions.ts";
import { startKept } from "../roles/unit.ts";
import { directorDetached, dispatchDetached, intakeDetached } from "./launch.ts";
import { route, type Tier } from "../routing/route.ts";
import { appendSuiteHistory, recordRan, type MainState, mainRed, writeBaseline, clearCap, issueFacts, issueJob, markCap, markStreak, setPaused, baselines, changedLinesOf, factoryDir, factoryRepos as sandboxRepos, gates, liveRuns, paused, recordHold, redLine, redMains, stallLines, runsToday, spentToday } from "../gates/factory-status.ts";
export { setPaused };

import { issueDecision, NO_COMMIT_LIMIT, pendingWaits, type Gate, type Hold, type IssueDecision } from "../gates/issue-decision.ts";
import { decideStart, unrouted } from "../gates/start-decision.ts";
import { decideIntake } from "../gates/intake-decision.ts";
import { INTAKE_CAP, issueLockWaitMs, rescueOn } from "../infra/settings.ts";


/** The buildable issues of each factory repo. */
export const openIssues = (lists?: Reader): { repo: Repo; item: issues.Issue }[] => buildableIssues(sandboxRepos(), lists);

/** Dispatch is off when `ALEPH_DISPATCH=off`: a run's end and `aleph issue` then start nothing; the tick's sweep still does. */

/** `tier` is the router's rating when the dispatch has it already; undefined lets the start rate the spec itself. */
type Start = (repo: Repo, name: string, id: number | string, spec: string, tier?: Tier | null) => Promise<Refused | null>;
export type Checks = (repo: Repo, commit: string, logs: string, record?: CheckTask["record"]) => Promise<ChecksStop | null>;
type Land = (name: string) => Promise<string | null>;
/**
 * Start every ready issue, in order, until the live cap. It runs when a run ends, when an issue is added or edited,
 * and from the tick's sweep when the sweep finds work it missed. While the factory is paused it does nothing. Else its steps run first: the next
 * steps a pause kept (`startKept`), the rescue of returned, failed, killed and lost runs, the lands and the close of parents whose parts are done.
 * It runs no checks: main's state is what the last `aleph suite` recorded (`mainState`). Then each issue meets the 7 gates of issueDecision in
 * order; the first that binds skips it, and its hold record names that gate. Between Busy file and Loop guard an issue whose last build run ended with the
 * API credit error (`API Error: 402`) less than 10 minutes ago (`waitMs` of `POLICY`) waits out its credit wait with a `credit-wait` hold; the credit wait is
 * not one of the 7 gates, because the issue's own last run decides it. The run a gate reads is the issue's newest build run (`nextRun`),
 * whose model names the backend the issue runs on. An issue no gate holds starts. Each start
 * holds a lock on its issue and re-reads the jobs under it, so two dispatches at once start an issue once. `start`
 * dispatches the run; it is `aleph job`, in-process (transitions.ts). It starts issues
 * only: an issue is closed as done once its parts are all done (`closeIssues`). Intake (intake.ts) took each issue in
 * before: an issue to plan (`plan` set) goes to an intake run, started detached by `intake`; the dispatch does not wait for it.
 */
export async function dispatchIssues(start: Start, land?: Land, rescue?: Rescue, intake: (repo: Repo, id: number) => void = intakeDetached): Promise<{ started: string[]; skipped: string[]; paused?: true; landed?: string[]; planned?: string[] }> {
  if (gates({ only: ["pause"] })) {
    logEvent({ by: "rule", subject: "factory", action: "paused" });
    return { started: [], skipped: [], paused: true };
  }
  const kept = await startKept();
  for (const name of kept) logEvent({ by: "rule", subject: name, action: "started", note: "the pause kept this step" });
  if (rescue) await rescueStuck(rescue, land, async (repo) => mainState(repo));
  const landed: string[] = [];
  if (land) {
    // All at once: the lands queue on the repo's lock, and the first takes the rest into one batch.
    const names = waitingToLand();
    const whys = await Promise.all(names.map((name) => land(name)));
    names.forEach((name, i) => { if (!whys[i]) landed.push(name); });
  }
  const started: string[] = [];
  const skipped: string[] = [];
  const planned: string[] = [];
  const redOf = mainRed();
  const done = doneChecker(true, (key, id) => reader({ fetch: false }).item(key, id));
  // A parent whose parts all landed closes without a green main.
  for (const repo of sandboxRepos()) for (const l of await closeIssues(repo, done)) skipped.push(l);
  const ready = openIssues();
  // An issue to plan goes to intake, which splits it.
  const planners: { repo: Repo; item: issues.Issue }[] = [];
  for (const repo of sandboxRepos()) {
    const doc = reader({ fetch: false }).list(repo.key);
    for (const item of doc?.items ?? []) if (decideIntake(repo, item, { doc: doc!, done, red: redOf(repo) }).kind === "plan") planners.push({ repo, item });
  }
  for (const { repo, item } of byPriority(planners)) {
    intake(repo, item.id);
    planned.push(issueJob(repo, item.id));
    logEvent({ by: "rule", subject: issueJob(repo, item.id), action: "started", sub: "intake", note: "planning" });
  }
  /** Records the hold and the skip line of an issue no start reached. */
  const skip = (name: string, kind: Gate, why: string, ev: Hold) => { recordHold(name, kind, why, ev); skipped.push(`${name}: ${why}`); };
  /** Skips an issue that a gate holds; a red main's event names its commit, and the note its failed checks. */
  const held = (name: string, repo: Repo, d: IssueDecision) => {
    const b = d.kind === "baseline" ? baselines()[repo.key] : undefined;
    skip(name, d.kind as Gate, d.why, b ? { action: "red", on: [b.commit.slice(0, 7)], note: b.failed } : d.ev!);
  };
  for (const { repo, item: listed } of ready) {
    const ref = issues.idOf(listed);
    const name = issueJob(repo, ref);
    const red = redOf(repo);
    // An open issue whose work is on main is done: the store closes it, so no dispatch lists it again.
    if (done(name)) {
      const bad = note(repo, ref, `its work is on origin/${repo.main}: ${itemOnMain(repo, ref) ?? "no commit"}`, { done: true });
      if (bad) logEvent({ by: "rule", subject: name, action: "failed", sub: "error", note: `not closed: ${bad}` });
      continue;
    }
    // The cheap facts first: the pause was asked above.
    const first = issueDecision({ name, item: listed, done, red });
    if (first.kind !== "ready") { held(name, repo, first); continue; }
    // Wait for a dispatch that holds the issue: it may skip it (an open job a drop is closing right now), and a
    // dispatch that skipped here too would leave the issue until the next tick. Under the lock all is read again.
    const release = await lock(`goal-${name}`, issueLockWaitMs());
    if (!release) { skip(name, "not-ready", "another dispatch is starting it", { action: "starting" }); continue; }
    try {
      const jobs = allJobs();
      const open = openJob(name, null, jobs);
      // Read after the jobs: a note added before the last run's drop is in the rerun's spec. It may also have gained an after.
      const item = open ? listed : buildableIssue(repo, ref);
      if (!item) { skip(name, "not-ready", "not a goal", { action: "parent" }); continue; }
      // A pass that began before a pause must not start a run after it.
      const d = await decideStart(repo, { ...issueFacts(repo, item, jobs), done, red }, jobs, () => route(issueBrief(item, name, jobs).spec));
      if (d.kind !== "ready" && d.kind !== "loop-guard") { held(name, repo, d); continue; }
      // Read again just before the start or the Ask: an item done, dropped or parked since it was read gets neither, whatever the trigger.
      const latest = reader().item(repo.key, ref);
      if (!latest || issues.status(latest) !== "open") {
        const status = latest ? issues.status(latest) : "dropped";
        skip(name, "not-ready", `the item is ${latest ? status : "gone"}`, { action: status });
        continue;
      }
      if (d.kind === "loop-guard") {
        // The Ask goes to the director, as every Ask does.
        recordHold(name, d.kind, d.why, d.ev);
        skipped.push(`${name}: ${d.why}`);
        if (d.ask === "no-commit") {
          markStreak(name);
          const text = `the last ${NO_COMMIT_LIMIT} runs of this goal ended with no commit, so the factory stopped starting it; rewrite the goal or close the item.`;
          const bad = askChris(repo, ref, plainAsk("no-commit", text), text);
          if (bad) logEvent({ by: "rule", subject: name, action: "failed", sub: "error", note: `no issue note: ${bad}` });
        } else {
          const text = `the factory started this goal ${d.starts} times in the last hour; it stops starting it until Chris reruns it.`;
          const bad = askChris(repo, ref, plainAsk("run-cap", text), text);
          if (bad) logEvent({ by: "rule", subject: name, action: "failed", sub: "error", note: `no issue note: ${bad}` });
          else markCap(name);
        }
        continue;
      }
      const { spec, rerun } = issueBrief(item, name, jobs);
      const no = await start(repo, name, ref, spec, d.tier);
      // A refused start: the item landed or its job runs (another dispatch got there first), or the last live slot filled.
      if (no) skip(name, no.gate, no.why, no.ev);
      else { recordHold(name, "started", "started"); started.push(name); clearCap(name); if (rerun) clearRerun(name); }
    } finally {
      release();
    }
  }
  return { started, skipped, ...(landed.length ? { landed } : {}), ...(planned.length ? { planned } : {}) };
}

/** Whether every part is done or dropped, at least one is done, and the parent is neither asking nor to plan: then it closes. */
const finished = (doc: issues.Doc, item: issues.Issue, repo: Repo, done: (ref: string) => boolean): boolean => {
  const parts = partsOf(doc, item);
  if (issues.status(item) !== "open" || !parts.length || askOf(refIn(repo.key, item)) || planSet(item)) return false;
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
    if (!release) { lines.push(`${name}: another dispatch holds it`); logEvent({ by: "rule", subject: name, action: "busy", note: "another dispatch holds it" }); continue; }
    try {
      const now = reader().list(repo.key);
      const item = now ? issues.find(now, listed.id) : undefined;
      if (!now || !item || !finished(now, item, repo, done)) continue;
      const commits = partsOf(now, item).filter((p) => issues.status(p) !== "dropped").map((p) => `${repo.key}-${issues.refOf(p)} (${itemOnMain(repo, issues.idOf(p)) ?? "no commit"})`);
      const bad = note(repo, item.id, `its sub-issues are done: ${commits.join(", ")}`, { done: true });
      lines.push(bad ? `${name}: not closed: ${bad}` : `${name}: closed as done`);
      logEvent(bad ? { by: "rule", subject: name, action: "failed", sub: "error", note: `not closed: ${bad}` } : { by: "rule", subject: name, action: "done", note: "its sub-issues are done" });
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
    const store = await mine(now, filing);
    const r = {
      signals: store.lessons.reduce((n, l) => n + l.signals.length, 0),
      lessons: store.lessons.length,
      proposed: store.lessons.filter((l) => l.state === "proposed").length,
    };
    // A proposed lesson is an Ask.
    if (r.proposed) directIfNew();
    return r;
  } catch (e) {
    logEvent({ by: "monitor", subject: "corrections", action: "failed", sub: "error", note: (e as Error).message });
    return null;
  }
}

/** The detached starts that follow a write: an intake of one issue, and the director. Tests replace them. */
export interface Starts { intake(repo: Repo, id: number): void; director(): void }
const starts: Starts = { intake: intakeDetached, director: directorDetached };


/**
 * The intake queue: an intake for each issue that decideIntake lets in, oldest first, at most `ALEPH_INTAKE_CAP`,
 * each detached. While the live cap binds it starts none: the dispatch at the end of the next run calls it again.
 * Returns the issues it started an intake for.
 */
export function intakeQueued(start: (repo: Repo, id: number) => void = intakeDetached, runs: Entry[] = allRuns(), lists: Reader = reader({ fetch: false }), done = doneChecker(false)): string[] {
  if (gates({ only: ["pause", "live-cap"], jobs: [runs] })) return [];
  const queue: { repo: Repo; item: issues.Issue }[] = [];
  const redOf = mainRed();
  for (const repo of sandboxRepos()) {
    const doc = lists.list(repo.key);
    for (const item of doc?.items ?? []) if (decideIntake(repo, item, { doc: doc!, done, red: redOf(repo) }).kind !== "none") queue.push({ repo, item });
  }
  queue.sort((a, b) => (issues.created(a.item) ?? "").localeCompare(issues.created(b.item) ?? "") || a.repo.key.localeCompare(b.repo.key) || a.item.id - b.item.id);
  const started: string[] = [];
  for (const { repo, item } of queue.slice(0, INTAKE_CAP())) {
    const name = `${repo.key}-${item.id}`;
    if (holdsWork(runs, "intake", name)) continue;
    start(repo, item.id);
    started.push(name);
  }
  return started;
}

/**
 * Start the director at once when an Ask has no case text and no director run is on it. A dispatch, an intake, the
 * corrections and the firefighter call it after a write that can set an Ask, so no Ask waits for the tick.
 * Returns whether it started the director.
 */
export function directIfNew(start: () => void = directorDetached, runs: Entry[] = allRuns(), lists: Reader = reader({ fetch: false })): boolean {
  if (gates({ only: ["pause"] })) return false;
  if (!pendingCases(sandboxRepos(), runs, lists).some((c) => !holdsWork(runs, "director", subjectOfCase(c)))) return false;
  start();
  return true;
}

/**
 * `aleph director` (director.ts): one run for each new Ask. `directIfNew` starts it where an Ask is set. Under the
 * pause alone: a decision can let an issue start. An error is logged, never thrown.
 */
export async function directorStep(ports?: DirectorPorts): Promise<Decision[]> {
  if (gates({ only: ["pause"] })) return [];
  const d = await directAll(sandboxRepos(), ports);
  if (d.some((x) => x.outcome === "decided")) dispatchDetached();
  return d;
}

/** The tick's episode pages for issues that finished (episode.ts); never throws. */
export async function episodeStep(): Promise<string[]> {
  try {
    if (gates({ only: ["pause"] })) return [];
    const r = await writeEpisodes(sandboxRepos());
    for (const f of r.failed) logEvent({ by: "rule", subject: "episodes", action: "failed", sub: "error", note: f });
    return r.written;
  } catch (e: any) {
    try { logEvent({ by: "rule", subject: "episodes", action: "failed", sub: "error", note: String(e?.message ?? e) }); } catch {}
    return [];
  }
}

/** Main's baseline as a closed state: `line` is the sentence for logs and skip lines. */

/**
 * Main's state as the last suite run recorded it in baseline.json. A red record stays red until a later suite run
 * is green, also when main has moved since; a repo with no record is unchecked.
 */
export function mainState(repo: Repo): MainState {
  const b = baselines()[repo.key];
  if (!b) return { state: "unchecked", line: "main is unchecked: no suite run yet" };
  return b.ok ? { state: "green" } : { state: "red", line: redLine(b) };
}

/** What a suite record holds for besides its commit: the setup and checks it ran. A change of either runs the suite again. */
export const baselineConfig = (repo: Repo): string => JSON.stringify([repo.setup ?? [], repo.checks ?? []]);

/**
 * Whether the repo's checks pass on its current origin/<main>: run once per
 * commit, kept in baseline.json. Returns the closed state with its line.
 * One baseline runs per repo at a time, under a lock; a suite run that finds it
 * taken leaves it. A pass and a failed check are recorded: an error that kept
 * the checks from running (no verdict) is reported, and the next suite run tries again.
 */
export async function baseline(repo: Repo, checks: Checks): Promise<MainState> {
  const unchecked = (line: string): MainState => ({ state: "unchecked", line });
  if (!fetchOrigin(repo.path).ok) return unchecked("main is unchecked: fetch failed");
  const commit = git(repo.path, "rev-parse", `origin/${repo.main}`).out;
  if (!commit) return unchecked(`main is unchecked: no origin/${repo.main}`);
  const config = baselineConfig(repo);
  const known = () => { const b = baselines()[repo.key]; return b && b.commit === commit && b.config === config ? b : undefined; };
  let b = known();
  if (!b) {
    const release = await lock(`baseline-${repo.key}`, 0);
    if (!release) return { state: "running", line: "main baseline running" };
    try {
      // Another dispatch may have recorded this commit between the read and the lock.
      b = known();
      if (!b) {
        const sum = { ran: 0, passed: 0, failed: 0, skipped: 0, rerunPassed: 0 };
        const why = await checks(repo, commit, join(factoryDir(), "baseline", repo.key), (c) => {
          if (!c.tests) return;
          sum.ran += c.tests.ran; sum.passed += c.tests.passed; sum.failed += c.tests.failed; sum.skipped += c.tests.skipped;
          sum.rerunPassed += c.rerunPassed ?? 0;
        });
        if (why && why.cause !== "check") return unchecked(`main is unchecked: ${why.reason}`);
        b = { repo: repo.key, commit, config, ok: !why, ...(why ? { failed: why.checkName ?? "" } : {}) };
        const entry = b;
        await writeBaseline(repo.key, () => entry);
        appendSuiteHistory({ repo: repo.key, commit, at: new Date().toISOString(), ...sum });
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
 * dispatch, so the issues its red or unchecked main held start at once.
 */
export async function suiteStep(checks: Checks = baselineChecks): Promise<Record<string, string>> {
  if (gates({ only: ["pause"] })) return {};
  const out: Record<string, string> = {};
  for (const repo of sandboxRepos()) {
    const was = mainState(repo).state;
    const b = await baseline(repo, checks);
    out[repo.key] = b.state === "green" ? "green" : b.line;
    await recordRan(`suite ${repo.key}`, out[repo.key]);
    if (b.state === "green" && was !== "green") dispatchDetached();
  }
  return out;
}

/**
 * What the factory could move now and does not, as `land:<job>`, `goal:<job>` and `ingest:<id>`: a passed run with no
 * land live; an issue that can start with no agent run live; an issue to take in or plan with no intake run live. The gates that stop each step leave its work out, because each gate has its own line.
 */
export async function stalled(jobs = allJobs(), lists = reader(), done = doneChecker()): Promise<string[]> {
  if (gates({ only: ["pause"], jobs })) return [];
  const runs = jobs.flat();
  const live = (kind: string) => runs.some((e) => e.run.kind === kind && isLive(e.folder));
  const redOf = mainRed();
  const out = live("land") ? [] : waitingToLand(jobs).map((name) => `land:${name}`);
  if (!liveRuns(runs)) {
    for (const { repo, item } of openIssues(lists)) {
      // No model call: the stall check agrees with the dispatch on all but the router's tier.
      const facts = issueFacts(repo, item, jobs);
      if ((await decideStart(repo, { ...facts, done, red: redOf(repo) }, jobs, unrouted)).kind === "ready") out.push(`goal:${facts.name}`);
    }
  }
  if (!live("intake") && !gates({ only: ["live-cap"], jobs })) {
    for (const repo of sandboxRepos()) {
      const doc = lists.list(repo.key);
      for (const item of doc?.items ?? []) if (decideIntake(repo, item, { doc: doc!, done, red: redOf(repo) }).kind !== "none") out.push(`ingest:${issueJob(repo, issues.idOf(item))}`);
    }
  }
  return out;
}

/** How far a checkout is behind origin/<main>, with the diff a pull would bring; with `short`, the key and the count alone. */
export function behind(repo: Repo, short = false): string | null {
  const n = Number(git(repo.path, "rev-list", "--count", `HEAD..origin/${repo.main}`).out || 0);
  if (!n) return null;
  if (short) return `${repo.key} is ${n} commit${n > 1 ? "s" : ""} behind origin/${repo.main}`;
  return `${repo.path} is ${n} commit${n > 1 ? "s" : ""} behind origin/${repo.main}; git pull brings:\n${git(repo.path, "diff", "--stat", "HEAD", `origin/${repo.main}`).out}`;
}

/** The SessionStart hook's lines: a pause, the asks, the alarms and each sandbox checkout that is behind. It writes nothing. */
export function hookLines(now = Date.now()): string[] {
  const lines = paused() ? ["factory paused"] : [];
  const refs = allJobs().filter((j) => isOpen(j) && isWaiting(counting(j).run.condition) && counting(j).run.ask).map((j) => j[0].run.name);
  for (const repo of Object.values(loadRegistry())) {
    for (const item of reader({ fetch: false }).list(repo.key)?.items ?? []) {
      if (issues.status(item) === "open" && askOf(refIn(repo.key, item))) refs.push(`${repo.key}-${issues.idOf(item)}`);
    }
  }
  refs.push(...proposals().map((l) => l.id));
  if (refs.length) lines.push(`${refs.length} asks wait for Chris: ${refs.slice(0, 5).join(", ")}`);
  lines.push(...redMains().map((r) => r.line), ...stallLines(now).map((h) => h.text));
  for (const repo of Object.values(loadRegistry()).filter((r) => r.sandbox)) {
    fetchOrigin(repo.path);
    lines.push(behind(repo, true) ?? "");
  }
  return lines.filter(Boolean);
}

const money = (n: number) => (n > 0 && n < 0.005 ? "<$0.01" : `$${n.toFixed(2)}`);

/** The heading a run's report entry goes under: the report lane of its condition. */
const laneOf = (e: Entry): string => lane(e.run.condition);

/** One run as the report gives it. */
function entry(e: Entry): string {
  const r = e.run;
  const needs = isWaiting(r.condition) ? needsOf(r.ask) : undefined;
  const lane = laneOf(e);
  const hit = (lane === "landed" || lane === "waiting") && r.repo && r.on ? reader().item(r.repo, issues.parseIssueRef(r.on)?.id ?? r.on) : undefined, prio = hit && priorityOf(hit);
  const head = `${shortId(r.name)} ${r.condition}${prio === "high" || prio === "critical" ? ` [${prio}]` : ""}${needs ? ` (${needs})` : ""}${r.round && r.condition !== "returned" && r.condition !== "failed" ? ` after ${r.round} fix rounds` : ""}`;
  const lines = [r.reason ? `${head}: ${r.reason}` : head];
  if (r.condition === "landed" && r.commit) {
    lines.push(`  commit ${r.commit.slice(0, 7)}`);
    const j = allJobs().find((x) => x[0].run.job === r.job);
    if (j) lines.push(`  checked by: ${checkedBy(j).join(", ") || "nothing recorded"}`);
    const repo = r.repo ? loadRegistry()[r.repo] : undefined;
    const stat = repo ? git(repo.path, "show", "--shortstat", "--format=", r.commit).out : "";
    if (stat) lines.push(`  look: about ${lookMinutes(changedLinesOf(stat))} min (estimate)`);
  }
  if (needs === "protected" || needs === "review") {
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
  loadRegistry();
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

/**
 * The episode page titles under `<factoryDir()>/episodes/` that no report has listed. The seen file is then
 * rewritten as the titles on disk, so a page deleted after KEEP_DAYS (episode.ts) leaves it too.
 */
function newEpisodes(): string[] {
  let titles: string[] = [];
  try { titles = readdirSync(episodesDir()).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort(); } catch { return []; }
  const seen = new Set(existsSync(episodesSeenFile()) ? readFileSync(episodesSeenFile(), "utf8").split("\n").filter(Boolean) : []);
  const fresh = titles.filter((t) => !seen.has(t));
  if (fresh.length || seen.size !== titles.length - fresh.length) {
    mkdirSync(factoryDir(), { recursive: true });
    writeFileSync(episodesSeenFile(), titles.map((t) => t + "\n").join(""));
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
  const fresh = allRuns().filter((e) => e.run.shown === false && e.run.kind !== "plain" && e.run.condition !== "running" && !isRunning(e));
  const lines: string[] = [];
  for (const l of LANES) {
    const here = fresh.filter((e) => laneOf(e) === l);
    if (here.length) lines.push(`${l}:`, ...here.map(entry));
  }
  for (const e of fresh) patchRun(e.id, { shown: true });
  const today = runsToday(now);
  if (lines.length) lines.push(`runs in the last 24 hours: ${today.length}, ${money(spentToday(now))} at the API price${paused() ? "; the factory is paused" : ""}`);
  return lines;
}

/**
 * Take in one issue at once, as `aleph issue add`, a note that answers an Ask, a
 * worker's follow-ups, the dispatch for an issue to plan and the intake queue do. The gate is the factory's pause. An
 * issue the live cap holds is started by the queue (`intakeQueued`) when a run ends. A run of this call that ended
 * with no reply starts the retry at once, while decideIntake still lets intake run (after `ALEPH_INTAKE_TRIES`
 * such runs, intake sets the Ask). An Ask that intake set goes to the director at once.
 */
export async function intakeNow(repo: Repo, id: number, p: Starts = starts): Promise<{ counts: Counts; skipped: string[] }> {
  if (gates({ only: ["pause"] })) return { counts: {}, skipped: [] };
  const name = `${repo.key}-${id}`;
  const mine = () => allRuns().filter((e) => e.run.kind === "intake" && e.run.on === name);
  const before = new Set(mine().map((e) => e.id));
  const done = doneChecker();
  const t = await intakeIssue(repo, id, done);
  for (const l of t.skipped) logEvent({ by: "intake", subject: name, action: "skipped", sub: "intake", note: l });
  if (t.counts.build) dispatchDetached();
  const failed = mine().some((e) => !before.has(e.id) && causeOf(e.run) === "unanswered");
  const doc = reader({ fetch: false }).list(repo.key);
  const item = doc ? issues.find(doc, id) : undefined;
  // Only an intake of this call that ended with no reply starts the retry.
  if (failed && item && decideIntake(repo, item, { doc: doc!, done, red: mainRed()(repo) }).kind !== "none") {
    logEvent({ by: "rule", subject: name, action: "started", sub: "intake", note: "no reply; intake again now" });
    p.intake(repo, id);
  }
  directIfNew(p.director);
  return t;
}

/** The factory's ports onto the transitions, each in-process; each returns the refusal, or null. */
const landPart = (name: string) => refusal(async () => { await (await land(name, {}, { output: "ignore" })).child?.exited; });
/** A safe default drop: quiet, as the factory writes the issue note and the news. */
const dropIssue = (name: string, reason: string, fate?: Fate) => refusal(() => drop(name, { reason, quiet: true, fate }));
const recheckIssue = (name: string) => refusal(async () => { await (await recheck(name, { output: "ignore" })).child?.exited; });

/**
 * `aleph dispatch`: one dispatch of the ready issues, then the intake queue and the director for an Ask that the
 * dispatch or the run before it set. A run's end calls it, so an intake the live cap held starts when a slot frees.
 */
export async function runDispatch(p: Starts = starts): Promise<Awaited<ReturnType<typeof dispatchIssues>> & { intaking?: string[] }> {
  // `ALEPH_RESCUE=off` leaves a returned or failed run as it is: its open job keeps its issue not ready.
  const d = await dispatchIssues(startIssue, landPart, !rescueOn() ? undefined : { drop: dropIssue, recheck: recheckIssue });
  if (d.paused) return d;
  const intaking = intakeQueued(p.intake);
  directIfNew(p.director);
  return { ...d, ...(intaking.length ? { intaking } : {}) };
}
