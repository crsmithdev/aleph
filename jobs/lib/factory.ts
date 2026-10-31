/**
 * The factory around the runs: the pause file, the 24-hour cap, the timer's
 * tick, the report and its health line. Its state lives in ~/.aleph/factory,
 * which no sandbox can see. See docs/specs/2026-10-26-seed-factory.md.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { afterOf, askOf, flakeTracker, goal, goals, goalsOf, issueOf as issueRefOf, kindOf, note, readList, readLists, reader } from "../../todo/lib/store.ts";
import { fetchOrigin, git } from "./git.ts";
import { startProposals, takeFresh } from "./deps.ts";
import { normalizeAsk, type Ask } from "./ask.ts";
import { itemOnMain, repoStages } from "./status.ts";
import { ciLine, redCi } from "./ci.ts";
import { firefight, type Fired, type Ports } from "./firefighter.ts";
import { countsLine, triageIssue, triageOpen, type Counts } from "./triage.ts";
import { allRuns, askOf as runAskOf, expand, isAwaiting, isBuild, needsOf, onOf, isLive, isStarting, loadRegistry, lock, tell, updateRun, type Entry, type Repo } from "./ledger.ts";
import { allJobs, isOpen, issue as issueOf, jobsNamed, asked, lastReal, markAsked, markRescued, openJob, readFile, rescued, tailOf, type Job } from "./job.ts";
import { accept, final, readRecord, reaccept, reopenedByAcceptance, sandboxRunner, unshown, type Runner } from "./acceptance.ts";
import { mine, proposals, readStore } from "./corrections.ts";
import { factsGate } from "./facts.ts";
import { writeEpisodes } from "./episode.ts";
import { vaultDir } from "../../vault/lib/vault.ts";
import { readdirSync } from "node:fs";
import { alreadyMet } from "./gate.ts";
import { always, logAlways } from "./always.ts";
import { detached } from "./launch.ts";
import { needsPlan, planning, runPlan, section, type Rate } from "./plan.ts";
import type { Tier } from "./route.ts";

export const factoryDir = () => expand(process.env.ALEPH_FACTORY_DIR ?? "~/.aleph/factory");
const pauseFile = () => join(factoryDir(), "paused");
const probeFile = () => join(factoryDir(), "probe.json");

/** `caps.json` in the factory directory: `{ "day", "live", "awaiting" }`. A missing or bad file is empty. */
function capsFile(): Record<string, unknown> {
  try {
    const c = JSON.parse(readFileSync(join(factoryDir(), "caps.json"), "utf8"));
    return c && typeof c === "object" && !Array.isArray(c) ? c : {};
  } catch { return {}; }
}
/** The environment variable first, then caps.json, then the default. */
function cap(envName: string, key: string, dflt: number): number {
  const e = process.env[envName];
  if (e !== undefined && e !== "") return Number(e);
  const f = capsFile()[key] ?? (key === "awaiting" ? capsFile().waiting : undefined);
  return typeof f === "number" && Number.isFinite(f) ? f : dflt;
}

/** Runs that start a worker, in any 24 hours. Checks and probes start none. */
export const DAY_CAP = () => cap("ALEPH_DAY_CAP", "day", 12);
/** The most agent runs live at once. */
export const LIVE_CAP = () => cap("ALEPH_LIVE_CAP", "live", 10);
const DAY = 24 * 3600_000;

export const paused = () => existsSync(pauseFile());

export function setPaused(on: boolean): void {
  mkdirSync(factoryDir(), { recursive: true });
  if (on) writeFileSync(pauseFile(), new Date().toISOString() + "\n");
  else rmSync(pauseFile(), { force: true });
}

export function factoryLog(line: string): void {
  mkdirSync(factoryDir(), { recursive: true });
  appendFileSync(join(factoryDir(), "tick.log"), `${new Date().toISOString()} ${line}\n`);
}

/** The most open jobs awaiting Chris before no new run starts. */
export const AWAITING_CAP = () => cap("ALEPH_AWAITING_CAP", "awaiting", 5);
/** The old name, for ui/state.ts until step 5. */
export const WAITING_CAP = AWAITING_CAP;

const sandboxRepos = () => Object.values(loadRegistry()).filter((r) => r.sandbox);
/** The registry's factory repos: those whose runs are sandboxed. */
export const factoryRepos = sandboxRepos;

/** Factory agent and triage runs started in the last 24 hours. */
export function runsToday(now = Date.now()): Entry[] {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  return allRuns().filter((e) => (isBuild(e.run.kind) || e.run.kind === "triage" || e.run.kind === "plan") && e.run.repo && keys.has(e.run.repo) && now - Date.parse(e.run.started) < DAY);
}

/** The dollars of the runs started in the last 24 hours: `runsToday`, and the facts and firefighter runs, which the day cap does not count. */
export function spentToday(now = Date.now()): number {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  const others = allRuns().filter((e) => (e.run.kind === "firefighter" || (e.run.kind === "facts" && e.run.repo && keys.has(e.run.repo))) && now - Date.parse(e.run.started) < DAY);
  return [...runsToday(now), ...others].reduce((a, e) => a + (e.run.cost ?? 0), 0);
}

/** Open jobs in factory repos whose last run awaits Chris (a stuck run needs no answer). */
export function waiting(jobs = allJobs()): number {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  return jobs.filter((j) => isOpen(j) && j.at(-1)!.run.repo && keys.has(j.at(-1)!.run.repo!) && isAwaiting(j.at(-1)!.run.state)).length;
}

export interface Hold { name: string; state: string; reason?: string; line: string }

/** Whether an open job holds the factory: its last real run is stuck or failed, with no next run pending and no Ask on its run. */
function holds(j: Job, keys: Set<string>, except?: string): boolean {
  const last = lastReal(j);
  const r = last.run;
  return isOpen(j) && !!r.repo && keys.has(r.repo) && (r.state === "stuck" || r.state === "failed") && r.job !== except
    && !r.next && !isLive(last.folder) && !asked(last);
}

/** The open jobs that hold the factory, in the order given: hold's filter, which rescueStuck uses too. */
const holders = (jobs: Job[], except?: string): Job[] => {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  return jobs.filter((j) => holds(j, keys, except));
};

/**
 * The factory's own hold: on while any open job in a factory repo is `stuck` or
 * `failed`. No run starts or lands by itself until it clears. `except` is a job
 * that does not count (the run asking is that job's own). Separate from the pause.
 * A run with a next run pending (`next` set, or its unit still live) does not count:
 * a conflicted land goes back to its worker by itself, and the hold waits for that.
 * A run the factory set an Ask on does not count: Chris answers it when he can.
 */
export function hold(jobs = allJobs(), except?: string): Hold | null {
  const bad = holders(jobs, except).sort((a, b) => Date.parse(a[0].run.started) - Date.parse(b[0].run.started));
  if (!bad.length) return null;
  const r = lastReal(bad[0]).run;
  const more = bad.length > 1 ? ` and ${bad.length - 1} more` : "";
  return { name: r.name, state: r.state, reason: r.reason, line: `Held: ${r.name}${more} ${bad.length > 1 ? "are" : "is"} ${r.state}${r.reason ? ` (${r.reason})` : ""}. No run starts or lands until ${bad.length > 1 ? "they are" : "it is"} cleared.` };
}

/** Passed agent runs waiting to land by themselves (`--land` or an autoland repo), oldest first. */
export function waitingToLand(jobs = allJobs()): string[] {
  const repos = loadRegistry();
  return jobs.filter((j) => {
    const last = lastReal(j);
    const r = last.run;
    return isOpen(j) && (isBuild(r.kind) || r.kind === "recheck") && r.state === "passed" && !isLive(last.folder) && (r.land || (r.repo && repos[r.repo]?.autoland));
  }).sort((a, b) => Date.parse(a[0].run.started) - Date.parse(b[0].run.started)).map((j) => j.at(-1)!.run.name);
}

/**
 * The facts gate for every landed job of a factory repo that has a commit, no facts marker on its land run and no facts run yet. A land that
 * comes through the unit's own next step is picked up by the dispatch the unit starts when it ends.
 */
async function factsStep(): Promise<void> {
  const keys = new Map(sandboxRepos().map((r) => [r.key, r]));
  for (const j of allJobs()) {
    const last = lastReal(j);
    const repo = last.run.repo ? keys.get(last.run.repo) : undefined;
    if (!repo || last.run.state !== "landed" || !last.run.commit || last.run.facts || j.some((e) => e.run.kind === "facts")) continue;
    const name = last.run.name;
    const release = await lock(`facts-${name}`, 0);
    if (!release) continue;
    try {
      // Read again under the lock: another dispatch may have run the gate meanwhile.
      const now = allJobs().find((x) => x[0].run.job === j[0].run.job);
      if (!now || now.some((e) => e.run.kind === "facts" || e.run.facts)) continue;
      await factsGate(repo, last, last.run.commit, factoryLog);
    } catch (e: any) {
      factoryLog(`${name}: facts gate failed: ${e?.message ?? e}`);
    } finally {
      release();
    }
  }
}

/** The open items labelled `goal` in each factory repo. */
export const openGoals = (): { repo: Repo; item: issues.Issue }[] => goals(sandboxRepos()).filter(({ item }) => kindOf(item) === "goal");

/**
 * Whether `<repo>-<n>` is done: the store says done, or the derived state
 * `aleph status` gives is done. The store counts on its own because a goal
 * closed as already met has no commit that names it. A repo outside the
 * registry, or an item the store lacks, is not done.
 */
export function doneChecker(): (ref: string) => boolean {
  const reg = loadRegistry();
  const known = new Map<string, Set<string>>();
  return (ref) => {
    const r = issues.parseGoalRef(ref);
    const repo = r && reg[r.repo];
    if (!r || !repo) return false;
    if (!known.has(r.repo)) {
      const done = new Set<string>();
      try {
        const doc = readList(repo);
        for (const i of doc?.items ?? []) if (issues.status(i) === "done") done.add(`${r.repo}-${issues.refOf(i)}`);
        for (const s of repoStages(repo, { fetch: true, doc })) if (s.stage === "done") done.add(s.id);
      } catch {}
      known.set(r.repo, done);
    }
    return known.get(r.repo)!.has(`${r.repo}-${r.id}`);
  };
}

/** Why an item is not ready to start today, or null: its `due` is after today, or a goal it is `after` is not done. */
export function notReady(item: issues.Issue, done: (ref: string) => boolean, now = issues.clock()): string | null {
  const due = item.fm.due;
  if (typeof due === "string" && issues.validDate(due) && due > issues.today(now)) return `due ${due}`;
  const open = pendingWaits(afterOf(item), done);
  if (open.length) return `blocked: after ${open.join(",")}`;
  return null;
}

/** The goals of `after` (a list of ids) that are not done. */
export function pendingWaits(after: string[], done: (ref: string) => boolean): string[] {
  return after.filter((w) => !done(w));
}

export type WaitReason =
  | { kind: "ready"; text: string }
  | { kind: "waits_on"; ids: string[]; text: string }
  | { kind: "due"; text: string }
  | { kind: "ask"; reason: string; text: string }
  | { kind: "planning"; text: string }
  | { kind: "red"; text: string }
  | { kind: "gate"; gate: Gate; text: string };

/** What `waitReason` reads: the caller computes these once for all its goals. `planning` is `planning(repo, id)`'s answer. */
export interface WaitContext { done: (ref: string) => boolean; jobs?: Job[]; gated?: ReturnType<typeof gates>; red?: string | null; planning?: boolean; now?: Date }

/** Why a queued goal does not start now, by the order and the texts `dispatchGoals` skips it with; `ready` when nothing stops it. */
export function waitReason(_repo: Repo, item: issues.Issue, ctx: WaitContext): WaitReason {
  if (ctx.red) return { kind: "red", text: ctx.red };
  const due = item.fm.due;
  if (typeof due === "string" && issues.validDate(due) && due > issues.today(ctx.now ?? issues.clock())) return { kind: "due", text: `Due ${due}` };
  const ids = pendingWaits(afterOf(item), ctx.done);
  if (ids.length) return { kind: "waits_on", ids, text: `Waits on ${ids.join(", ")}` };
  const ask = askOf(item);
  if (ask) {
    const last = item.notes.at(-1)?.replace(/^- \d{4}-\d\d-\d\d \d\d:\d\d: /, "").replace(/^asks Chris: /, "");
    const reason = ask.question || last || ask.reason || "the factory stopped starting it";
    return { kind: "ask", reason, text: `Waits for you: ${reason}` };
  }
  if (ctx.planning) return { kind: "planning", text: "A planner run is splitting it" };
  const g = ctx.gated;
  if (g) {
    const n = g.why.match(/^\d+/)?.[0];
    const text = g.gate === "live" ? `Waiting for a slot (${n ?? liveRuns()} of ${LIVE_CAP()} running)`
      : g.gate === "day" ? `Day cap reached (${runsToday().length} of ${DAY_CAP()} runs in 24 hours)`
      : g.gate === "pause" ? "The factory is paused"
      : g.gate === "awaiting" ? `${n ?? ""} runs wait for Chris (cap ${AWAITING_CAP()})`
      : g.why;
    return { kind: "gate", gate: g.gate, text };
  }
  return { kind: "ready", text: "Starts at the next dispatch" };
}

/** The job name for a goal: its id, `aleph-28.1` for a goal under an issue, `aleph-28` for an old goal. */
/** The number of the issue a goal belongs to in this repo, or null. */
const issueNumber = (repo: Repo, item: issues.Issue): number | null => {
  const m = /^(.+)-(\d+)$/.exec(issueRefOf(item) ?? "");
  return m && m[1] === repo.key ? Number(m[2]) : null;
};

export const goalJob = (repo: Repo, id: number | string) => `${repo.key}-${id}`;

/** Agent runs live now, and those started whose unit has not written `pid` yet. */
export const liveEntries = (): Entry[] => allRuns().filter((e) => isBuild(e.run.kind) && (isLive(e.folder) || isStarting(e)));
export const liveRuns = (): number => liveEntries().length;

/** The gates, in the order `gates` checks them. */
export const GATES = ["pause", "hold", "probe", "live", "day", "awaiting"] as const;
export type Gate = (typeof GATES)[number];

/**
 * The first reason no run may start (or land), or null. The one place the
 * gates are checked, in the order of GATES: the pause, the hold, a failed
 * probe, the live cap, the day cap, the runs waiting for Chris. `only` limits
 * it to some of them (a caller whose other gates are met elsewhere or do not
 * apply); `jobs` and `except` are hold's and the waiting count's.
 */
export function gates(opts: { only?: readonly Gate[]; jobs?: Job[]; except?: string } = {}): { gate: Gate; why: string } | null {
  const on = (g: Gate) => !opts.only || opts.only.includes(g);
  if (on("pause") && paused()) return { gate: "pause", why: "paused" };
  if (on("hold")) {
    const h = hold(opts.jobs, opts.except);
    if (h) return { gate: "hold", why: h.line };
  }
  if (on("probe")) {
    const p = lastProbe();
    if (p && !p.ok) return { gate: "probe", why: `the sandbox probe at ${p.at} failed: ${p.failed.join("; ")}` };
  }
  if (on("live")) {
    const live = liveRuns();
    if (live >= LIVE_CAP()) return { gate: "live", why: `${live} agent runs are live` };
  }
  if (on("day") && runsToday().length >= DAY_CAP()) return { gate: "day", why: `cap of ${DAY_CAP()} runs in 24 hours` };
  if (on("awaiting")) {
    const waits = waiting(opts.jobs);
    if (waits >= AWAITING_CAP()) return { gate: "awaiting", why: `${waits} runs wait for Chris` };
  }
  return null;
}

/** Dispatch is off when `ALEPH_DISPATCH=off`: a run's end and `aleph issue` then start nothing; the tick still does. */
export const dispatchOn = () => process.env.ALEPH_DISPATCH !== "off";

/** `tier` is the router's rating when the dispatch has it already; undefined lets the start rate the spec itself. */
type Start = (repo: Repo, name: string, id: number | string, spec: string, tier?: Tier | null) => Promise<string | null>;
type Checks = (repo: Repo, commit: string, logs: string) => Promise<string | null>;
type Land = (name: string) => Promise<string | null>;
/** What a safe default action does to a run: both return the refusal, or null. */
export interface Rescue {
  /** Drop the job, with the reason; the factory writes the issue note and the news itself. */
  drop: (name: string, reason: string) => Promise<string | null>;
  /** Start a recheck of the job. */
  recheck: (name: string) => Promise<string | null>;
}

/** A file is busy when this many land runs of its repo conflicted on it in the last BUSY_MS. */
const BUSY_CONFLICTS = 3;
const BUSY_MS = 7 * 86_400_000;

/** The paths named in a goal's Edit surface. */
const surfaceOf = (body: string): string[] => section(body, "Edit surface").split(/[^\w./@-]+/).map((t) => t.replace(/\.+$/, "")).filter(Boolean);

/**
 * Why a goal waits for an open job: both name the same busy file in their Edit surface, so one
 * of the two lands would conflict. A job waiting for Chris does not count, as it can wait for hours.
 */
export function busyWait(repo: Repo, item: issues.Issue, jobs: Job[], now = Date.now()): string | null {
  const counts = new Map<string, number>();
  for (const j of jobs) for (const { run } of j) {
    if (run.kind !== "land" || run.repo !== repo.key || now - Date.parse(run.started) > BUSY_MS) continue;
    for (const f of run.conflicts ?? []) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  const mine = surfaceOf(item.body).filter((f) => (counts.get(f) ?? 0) >= BUSY_CONFLICTS);
  if (!mine.length) return null;
  const lists = reader({ fetch: false });
  for (const j of jobs) {
    const last = lastReal(j).run;
    const on = onOf(last);
    if (last.repo !== repo.key || on === undefined || !isOpen(j) || isAwaiting(last.state)) continue;
    const theirs = lists.item(repo.key, on);
    const shared = theirs && surfaceOf(theirs.body).find((f) => mine.includes(f));
    if (shared) return `waits for ${last.name}: both change the busy file ${shared}`;
  }
  return null;
}

/**
 * Start every ready goal, in order, until the live cap: an open goal item with
 * no open job, while the factory is not paused and the other gates allow. It
 * runs when a run ends, when a goal is added or edited, and from the tick as a
 * fallback. Each start holds a lock on its goal and re-reads the jobs under it,
 * so two dispatches at once start a goal once. `start` dispatches the run; it
 * is `aleph job`, in-process (transitions.ts). With `rate`, a large goal's
 * first run is a planner run on its issue instead (plan.ts). It starts goals
 * only: an issue is closed as done once its goals are all done (`closeIssues`).
 * `plan` starts an issue's planner detached; the dispatch does not wait for it.
 */
export async function dispatchGoals(start: Start, checks?: Checks, land?: Land, rescue?: Rescue, rate?: Rate, plan: (repo: Repo, id: number) => void = planDetached): Promise<{ started: string[]; skipped: string[]; paused?: true; held?: string; landed?: string[]; planned?: string[] }> {
  if (gates({ only: ["pause"] })) {
    factoryLog("paused");
    return { started: [], skipped: [], paused: true };
  }
  if (rescue) await rescueStuck(rescue, land, checks);
  const held = gates({ only: ["hold"] });
  if (held) {
    factoryLog(held.why);
    return { started: [], skipped: [held.why], held: held.why };
  }
  const startedProposals = startProposals(sandboxRepos());
  if (startedProposals.length) factoryLog(`standing: proposal: started ${startedProposals.join(", ")}`);
  const landed: string[] = [];
  if (land) {
    // All at once: the lands queue on the repo's lock, and the first takes the rest into one batch.
    const names = waitingToLand();
    const whys = await Promise.all(names.map((name) => land(name)));
    names.forEach((name, i) => { if (!whys[i]) landed.push(name); });
    if (landed.length) factoryLog(`landed ${landed.join(", ")}`);
  }
  await factsStep();
  if (checks) await acceptanceStep();
  const started: string[] = [];
  const skipped: string[] = [];
  const planned: string[] = [];
  const reds = new Map<string, string | null>();
  const done = doneChecker();
  // Baselines run for the repos in the list, then the list is read again, until every repo in it has one. The start loop
  // works from that last list, so a goal written during any baseline is in it: a dispatch that skipped with
  // `main baseline running` has its goal started by the one that held the baseline.
  let goals = openGoals();
  if (checks) {
    for (;;) {
      const missing = goals.filter(({ repo }) => !reds.has(repo.key));
      if (!missing.length) break;
      for (const { repo } of missing) if (!reds.has(repo.key)) reds.set(repo.key, await baseline(repo, checks));
      goals = openGoals();
    }
  }
  for (const repo of sandboxRepos()) if (!reds.get(repo.key)) for (const l of await closeIssues(repo, done)) skipped.push(l);
  for (const { repo, item: listed } of goals) {
    const ref = issues.idOf(listed);
    const name = goalJob(repo, ref);
    const red = reds.get(repo.key);
    if (red) { skipped.push(`${name}: ${red}`); continue; }
    if (done(`${repo.key}-${ref}`)) { skipped.push(`${name}: the item is already done`); continue; }
    const wait = notReady(listed, done);
    if (wait) { skipped.push(`${name}: ${wait}`); continue; }
    // Wait for a dispatch that holds the goal: it may skip it (an open job a drop is closing right now), and a
    // dispatch that skipped here too would leave the goal until the next tick. Under the lock all is read again.
    const release = await lock(`goal-${name}`);
    if (!release) { skipped.push(`${name}: another dispatch is starting it`); continue; }
    try {
      const jobs = allJobs();
      const open = openJob(name, null, jobs);
      if (open) { skipped.push(`${name}: ${open.at(-1)!.run.state}`); continue; }
      // Read after the jobs: a note added before the last run's drop is in the rerun's spec.
      const item = goal(repo, ref);
      if (!item) { skipped.push(`${name}: not a goal`); continue; }
      // The item may have gained an after or a due date since it was read, while the baseline ran or an earlier goal started.
      const waitNow = notReady(item, done);
      if (waitNow) { skipped.push(`${name}: ${waitNow}`); continue; }
      // A plan job runs detached: the goal gets no second planner and no worker while it does.
      const parent = issueNumber(repo, item);
      if (parent !== null && await planning(repo, parent)) { skipped.push(`${name}: planning`); continue; }
      const gated = gates({ only: ["live", "day", "awaiting"], jobs });
      if (gated) { skipped.push(`${name}: ${gated.why}`); continue; }
      // Read again just before the start: an item done or dropped since it was read starts no run, whatever the trigger.
      const latest = reader().item(repo.key, ref);
      if (!latest || issues.status(latest) === "done" || issues.status(latest) === "dropped") { skipped.push(`${name}: the item is ${latest ? issues.status(latest) : "gone"}`); continue; }
      const busy = busyWait(repo, latest, jobs);
      if (busy) { skipped.push(`${name}: ${busy}`); continue; }
      const marked = streakMark(name) !== null;
      if ((marked && askOf(item)) || noCommitStreak(repo.key, name) >= NO_COMMIT_LIMIT) {
        if (!askOf(item)) {
          writeStreakMark(name);
          const text = `the last ${NO_COMMIT_LIMIT} runs of this goal ended with no commit, so the factory stopped starting it; rewrite the goal or close the item.`;
          const bad = note(repo, ref, `asks Chris: ${text}`, { ask: plainAsk("no-commit", text) });
          if (bad) factoryLog(`${name}: no issue note: ${bad}`);
        }
        skipped.push(`${name}: ${NO_COMMIT_LIMIT} runs in a row with no commit`);
        continue;
      }
      // A cap mark with the label still on holds the goal until Chris reruns it; with the label gone he has, and the hour count is not applied.
      const capHeld = capMarked(name);
      if (capHeld && askOf(item)) { skipped.push(`${name}: the run cap holds it until Chris reruns it`); continue; }
      const started60 = capHeld ? 0 : agentStartsInHour(repo.key, name);
      if (started60 >= MAX_RUNS_PER_HOUR) {
        const text = `the factory started this goal ${started60} times in the last hour; it stops starting it until Chris reruns it.`;
        const bad = note(repo, ref, `asks Chris: ${text}`, { ask: plainAsk("run-cap", text) });
        if (bad) factoryLog(`${name}: no issue note: ${bad}`);
        else writeCapMark(name);
        skipped.push(`${name}: ${started60} runs in the last hour`);
        continue;
      }
      const again = rerunNote(name);
      const drops = jobsNamed(name, null, jobs).filter((j) => j.at(-1)!.run.state === "dropped" && j.at(-1)!.run.reason).map((j) => `- ${j.at(-1)!.run.reason}`).reverse();
      const spec = `# ${item.title}\n\n${item.body.trim()}\n${drops.length ? `\n## Reasons of the earlier drops, newest first\n\n${drops.join("\n")}\n` : ""}${item.notes.length ? `\n## Notes on the issue\n\n${item.notes.join("\n")}\n` : ""}${again ? `\n## Note on the last run\n\n${again}\n` : ""}`;
      let tier: Tier | null | undefined;
      if (rate) {
        const p = await needsPlan(repo, item, spec, rate);
        if ("plan" in p) { plan(repo, issueNumber(repo, item)!); planned.push(name); continue; }
        tier = p.tier;
      }
      const why = await start(repo, name, ref, spec, tier);
      if (why) skipped.push(`${name}: ${why}`);
      else { started.push(name); rmSync(capFile(name), { force: true }); if (again) rmSync(rerunFile(name), { force: true }); }
    } finally {
      release();
    }
  }
  factoryLog(`started ${started.join(", ") || "none"}${planned.length ? `; planning ${planned.join(", ")}` : ""}${skipped.length ? `; skipped ${skipped.join("; ")}` : ""}`);
  return { started, skipped, ...(landed.length ? { landed } : {}), ...(planned.length ? { planned } : {}) };
}

/**
 * An open issue whose goals are all done is closed as done, with a note naming the goals' commits. An issue whose goals
 * hold a dropped one and no open one is left alone: the drop set its Ask. Returns the lines for the dispatch's skipped list.
 */
async function closeIssues(repo: Repo, done: (ref: string) => boolean): Promise<string[]> {
  const lines: string[] = [];
  const doc = reader({ fetch: false }).list(repo.key);
  for (const listed of doc?.items ?? []) {
    const goalIds = goalsOf(listed);
    if (kindOf(listed) !== "issue" || issues.status(listed) !== "open" || !goalIds.length) continue;
    if (!goalIds.every((g) => done(g))) continue;
    const name = `${repo.key}-${listed.id}`;
    const release = await lock(`issue-${name}`, 0);
    if (!release) { lines.push(`${name}: another dispatch holds it`); continue; }
    try {
      const item = reader().item(repo.key, listed.id);
      if (!item || issues.status(item) !== "open" || kindOf(item) !== "issue" || !goalsOf(item).length || !goalsOf(item).every((g) => done(g))) continue;
      const commits = goalsOf(item).map((g) => {
        const r = issues.parseGoalRef(g);
        return `${g} (${(r && itemOnMain(r.repo === repo.key ? repo : undefined, r.id)) ?? "no commit"})`;
      });
      const bad = note(repo, item.id, `its goals are all done: ${commits.join(", ")}`, { done: true });
      lines.push(bad ? `${name}: not closed: ${bad}` : `${name}: closed as done`);
    } finally {
      release();
    }
  }
  return lines;
}

/** Done goals older than this many days are not accepted: the step starts with the goals closed lately. */
const ACCEPTANCE_DAYS = 2;

/**
 * The acceptance run: every done goal (one whose land is on origin/<main>, or a `planned` parent
 * closed as done) whose Oracle has not been run since it was done gets it run on origin/<main>,
 * under srt. Pass: a note; first failure: the goal reopens with the output as a note and the
 * dispatch starts it again; second: an Ask (input, acceptance-failed). See acceptance.ts.
 */
export async function acceptanceStep(run: Runner = sandboxRunner, now = issues.clock()): Promise<string[]> {
  const lines: string[] = [];
  const since = issues.today(new Date(now.getTime() - ACCEPTANCE_DAYS * 86_400_000));
  const lists = reader();
  for (const repo of sandboxRepos()) {
    const list = lists.list(repo.key)?.items ?? [];
    const due = list.filter((i) => kindOf(i) === "goal" && issues.status(i) === "done" && String(i.fm.updated ?? "") >= since && !final(readRecord(repo.key, issues.refOf(i))));
    if (!due.length) continue;
    if (!fetchOrigin(repo.path).ok) { lines.push(`${repo.key}: acceptance not run: fetch failed`); continue; }
    for (const listed of due) {
      const release = await lock(`acceptance-${repo.key}-${issues.refOf(listed)}`, 0);
      if (!release) continue;
      try {
        const item = reader().item(repo.key, issues.refOf(listed));
        if (!item || issues.status(item) !== "done" || final(readRecord(repo.key, issues.refOf(item)))) continue;
        if (kindOf(item) !== "issue" && !itemOnMain(repo, issues.idOf(item))) continue;
        lines.push(await accept(repo, item, run));
      } finally {
        release();
      }
    }
  }
  for (const l of lines) factoryLog(l);
  return lines;
}

/** The commit that made an acceptance infra error no result (9fd990c): goals reopened by a fail written before it are candidates. */
const INFRA_FIX = "9fd990c";

/**
 * `aleph accept <repo>`: the open goals whose last note is an `acceptance: fail` written before the infra
 * fix (or before `before`) and after `since`, and whose job landed, get their Oracle run again on origin/<main>.
 * See reaccept in acceptance.ts.
 */
export async function reacceptReopened(repoKey: string, o: { since?: string; before?: string; run?: Runner } = {}): Promise<string[]> {
  const repo = sandboxRepos().find((r) => r.key === repoKey) ?? loadRegistry()[repoKey];
  if (!repo) throw new Error(`no repo ${repoKey} in the registry`);
  if (!fetchOrigin(repo.path).ok) return [`${repo.key}: re-accept not run: fetch failed`];
  const ms = (s: string | undefined, what: string): number | undefined => {
    if (s === undefined) return undefined;
    const t = Date.parse(s);
    if (Number.isNaN(t)) throw new Error(`${what}: not a date: ${s}`);
    return t;
  };
  const fixed = Number(git(repo.path, "log", "-1", "--format=%ct", INFRA_FIX).out) * 1000;
  const before = ms(o.before, "--before") ?? (fixed || Infinity);
  const since = ms(o.since, "--reopened-since") ?? -Infinity;
  const lines: string[] = [];
  const list = reader().list(repo.key)?.items ?? [];
  for (const listed of list.filter((i) => kindOf(i) === "goal" && reopenedByAcceptance(i, since, before))) {
    const release = await lock(`acceptance-${repo.key}-${issues.refOf(listed)}`, 0);
    if (!release) continue;
    try {
      const item = reader().item(repo.key, issues.refOf(listed));
      if (!item || !reopenedByAcceptance(item, since, before) || !itemOnMain(repo, issues.idOf(item))) continue;
      lines.push(await reaccept(repo, item, o.run));
    } finally {
      release();
    }
  }
  for (const l of lines) factoryLog(l);
  return lines;
}

/** An Ask of input with no options: the factory's own stop on a goal, with the sentence Chris reads. */
export const plainAsk = (reason: string, question: string): Ask => ({ kind: "input", reason, question, options: [], why: [] });

/** Runs of one goal in a row, newest last, that may end with no commit before dispatch stops starting it. */
const NO_COMMIT_LIMIT = 3;

const streakFile = (name: string) => join(factoryDir(), "streak", `${name}.txt`);
/** When the streak last set an Ask on the goal's item (ms), or null. Runs before it no longer count. */
const streakMark = (name: string): number | null => {
  if (!existsSync(streakFile(name))) return null;
  const t = Date.parse(readFileSync(streakFile(name), "utf8").trim());
  return Number.isNaN(t) ? null : t;
};
const writeStreakMark = (name: string) => {
  mkdirSync(dirname(streakFile(name)), { recursive: true });
  writeFileSync(streakFile(name), new Date().toISOString() + "\n");
};

/** How many of the goal's newest agent runs since the streak's last Ask, in a row, ended with no commit. */
function noCommitStreak(repoKey: string, name: string): number {
  const mark = streakMark(name) ?? -Infinity;
  const runs = allRuns().filter((e) => e.run.repo === repoKey && e.run.name === name && isBuild(e.run.kind) && e.run.state !== "running" && Date.parse(e.run.started) > mark)
    .sort((a, b) => Date.parse(a.run.started) - Date.parse(b.run.started));
  let n = 0;
  for (const e of runs.reverse()) { if (e.run.reason !== "no commit" && !e.run.noCommit) break; n++; }
  return n;
}

/** A goal starts at most this many agent runs in any 60 minutes, whatever the trigger: a fourth start is skipped. */
export const MAX_RUNS_PER_HOUR = 3;

const capFile = (name: string) => join(factoryDir(), "cap", `${name}.txt`);
/** Whether the cap's Ask is set for the goal's current streak of skipped starts. */
const capMarked = (name: string): boolean => existsSync(capFile(name));
const writeCapMark = (name: string) => {
  mkdirSync(dirname(capFile(name)), { recursive: true });
  writeFileSync(capFile(name), new Date().toISOString() + "\n");
};

/** How many agent runs of the goal started in the last 60 minutes. */
function agentStartsInHour(repoKey: string, name: string, now = Date.now()): number {
  return allRuns().filter((e) => e.run.repo === repoKey && e.run.name === name && isBuild(e.run.kind) && now - Date.parse(e.run.started) < 3600_000).length;
}

const rerunFile = (name: string) => join(factoryDir(), "rerun", `${name}.md`);
/** The note the goal's next run reads, under "Note on the last run". */
export function writeRerun(name: string, note: string): void {
  mkdirSync(dirname(rerunFile(name)), { recursive: true });
  writeFileSync(rerunFile(name), note + "\n");
}
const rerunNote = (name: string): string => (existsSync(rerunFile(name)) ? readFileSync(rerunFile(name), "utf8").trim() : "");

const RERUN_OPTIONS = [
  { label: "Rerun", line: "Drop the stuck run and start the goal again as it is" },
  { label: "Another way", line: "Start the goal again, taking a different route than the run that failed" },
];

type Case = "killed" | "duplicate" | "no-commit" | "claimed" | "time-box" | "infra" | "land-checks" | "land-conflict";
const INFRA = /^(job lock busy|fetch failed|systemd-run failed|worktree gone|bundle failed)/;
/** A baseline that has not answered yet (see `baseline`): the claim is waited on, not decided. */
const UNCHECKED = /^main (is unchecked|baseline running)/;

/** Which safe case a stuck or failed run is in, or null: not safe. `claim` is the worker's "already met" reason, if it made one. */
function caseOf(r: Entry["run"], onMainOrDone: () => boolean, claim: string | null): Case | null {
  const why = r.reason ?? "";
  if (why === "no commit") return onMainOrDone() ? "duplicate" : claim !== null ? "claimed" : "no-commit";
  if (why === "time box" && r.kind !== "land") return "time-box";
  if (INFRA.test(why)) return "infra";
  if (r.kind === "land" && /^merge conflict/.test(why)) return "land-conflict";
  if (r.kind === "land" && !r.conflicts?.length && /^timed out: check |^[\w-]+ failed$/.test(why)) return "land-checks";
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
    return isOpen(j) && !!r.repo && keys.has(r.repo) && r.state === "running" && (isBuild(r.kind) || r.kind === "recheck" || r.kind === "land")
      && Date.parse(r.started) < booted && !isLive(last.folder) && !isStarting(last);
  });
};

/** How long a dispatch waits for a run's rescue lock before it skips the run. */
const RESCUE_WAIT_MS = () => Number(process.env.ALEPH_RESCUE_WAIT_MS ?? 60_000);

/**
 * The safe default actions for stuck and failed runs, taken by the dispatch that sees them: a duplicate
 * is dropped; a no-commit run whose worker says the goal is already met is checked on main, and closed when
 * the checks pass there; no commit, a time box and checks that fail after a land merge and a land that hits a merge conflict drop the run for one rerun
 * of the goal, with a note; an infrastructure failure is rechecked or landed again, once. Each action
 * writes its reason to the run, the issue note and the news. Anything else, or the second time one
 * case hits one goal, sets an Ask (input, rescue) on the issue; such a run holds nothing. A run that a host
 * restart killed comes first: it is dropped for a new run of the goal, or landed again, and uses up no rerun.
 */
async function rescueStuck(act: Rescue, land?: Land, checks?: Checks): Promise<void> {
  const pending = (jobs: Job[]) => [...killed(jobs), ...holders(jobs)];
  for (const first of pending(allJobs())) {
    const name = first[0].run.name;
    // Wait: the dispatch that holds it may have read the job before this run ended, and would not act on it.
    const release = await lock(`rescue-${first[0].run.repo}-${name}`, RESCUE_WAIT_MS());
    if (!release) { factoryLog(`rescue of ${name} skipped: the rescue lock stayed busy`); continue; }
    try {
      // Read again under the lock: another dispatch may have acted on it.
      const runs = pending(allJobs()).find((j) => j[0].run.job === first[0].run.job);
      if (runs) await rescueJob(runs, act, land, checks);
    } catch (e: any) {
      factoryLog(`rescue of ${name} failed: ${e?.message ?? e}`);
    } finally {
      release();
    }
  }
}

async function rescueJob(runs: Job, act: Rescue, land?: Land, checks?: Checks): Promise<void> {
  const last = lastReal(runs);
  const r = last.run;
  const repo = loadRegistry()[r.repo!];
  const name = r.name;
  const todo = issueOf(runs) ?? Number(name.match(/-(\d+)$/)?.[1]);
  const issue = Number.isInteger(todo) ? todo : undefined;
  const say = (line: string) => { factoryLog(`${name}: ${line}`); return tell(`${repo.key}/${name}: ${line}`); };
  const record = (text: string, opts: { done?: boolean; kind?: "issue"; ask?: Ask } = {}) => {
    const why = issue === undefined ? "no issue" : note(repo, issue, text, opts);
    if (why) factoryLog(`${name}: no issue note: ${why}`);
  };
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

  let onMain: string | null = null;
  const onMainOrDone = () => {
    fetchOrigin(repo.path);
    const mine = git(repo.path, "log", `origin/${repo.main}`, "-1", "--format=%H", "-E", `--grep=^Job: ${r.job}$`).out;
    if (mine) { onMain = mine.slice(0, 7); return true; }
    const there = itemOnMain(repo, issue);
    if (there) { onMain = there; return true; }
    const item = issue === undefined ? undefined : reader().item(repo.key, issue);
    return !!item && issues.status(item) !== "open";
  };
  const claim = r.reason === "no commit" ? alreadyMet(readFile(last, "result.md") ?? "") : null;
  const key = killed([runs]).length ? "killed" : caseOf(r, onMainOrDone, claim);
  const reason = key === "killed" ? "host restart" : r.reason ?? r.state;
  const choice = (question: string, why: string[]) => normalizeAsk({ question, options: RERUN_OPTIONS, recommended: "Rerun", why: [`Run: ${name}, ${r.state}`, `Reason: ${reason}`, ...why] }, { kind: "input", reason: "rescue" })!;
  if (!key) return chris(`${name} is ${r.state} (${reason}); drop it, recheck it, or edit the goal?`, choice(`${name} is ${r.state} (${reason}): how should the factory go on?`, ["No safe default covers this case"]));

  const tryDo = async (why: string | null, what: string) => {
    if (why) { rmSync(rerunFile(name), { force: true }); await chris(`${name}: ${what} failed (${why}); ${reason}. What now?`, choice(`${name}: ${what} failed: how should the factory go on?`, [`Failure: ${why}`])); return false; }
    return true;
  };
  // The goal did not cause this: no rescue mark, so the goal keeps its rerun.
  if (key === "killed") {
    const text = `a host restart killed ${r.kind} run ${last.id}`;
    if (r.kind === "land") {
      // The branch passed, and the land may have pushed: a new land finds that, and a new goal run would do the work twice.
      writeFileSync(join(last.folder, "exit"), "143");
      updateRun(last.folder, { state: "failed", reason, phase: undefined, told: true, ended: new Date().toISOString() });
      if (!await tryDo(land ? await land(name) : "no land", "land again")) return;
      record(`${text}: landed again`);
      await say(`${text}: landing again`);
      return;
    }
    if (!await tryDo(await act.drop(name, `${text}. The goal did not cause this. Run the goal again from the start.`), "drop")) return;
    record(`${text}: dropped, and the goal starts again`);
    await say(`${text}: the goal starts again`);
    return;
  }
  const rerun = (note: string) => writeRerun(name, note);
  const quoted = (file: "checks.log" | "result.md") => `\`\`\`\n${tailOf(last, file, 20) || "(empty)"}\n\`\`\``;
  const earlier = allRuns().some((e) => e.run.repo === r.repo && e.run.name === name && e.folder !== last.folder && rescued(e) === key);
  if (key !== "duplicate" && key !== "claimed") {
    const before = allRuns().filter((e) => e.run.repo === r.repo && e.run.name === name && e.folder !== last.folder && rescued(e) === key).length;
    // A no-commit run with no claim, twice: the goal is the likely fault, so the issue goes back to triage, once.
    const sentBack = allRuns().some((e) => e.run.repo === r.repo && e.run.name === name && e.folder !== last.folder && rescued(e) === "triaged");
    if (before && key === "no-commit" && !sentBack && issue !== undefined) {
      markRescued(last, "triaged");
      const text = `${r.kind} run ${last.id} ended with no commit again, and the worker did not say the goal is already met: dropped, and the issue went back to triage to rewrite the goal, close the issue, or ask Chris. The last 20 lines of its result.md (a note is one line, so lines are joined with " | "): ${tailOf(last, "result.md", 20).split("\n").map((l) => l.trim()).filter(Boolean).join(" | ") || "(empty)"}`;
      if (!await tryDo(await act.drop(name, text), "drop")) return;
      record(text, { kind: "issue" });
      await say(`no commit twice; the issue went back to triage`);
      return;
    }
    if (before) return chris(`${name} hit the same case again (${key}: ${reason}); a rerun did not clear it. Drop it, or change the goal?`, choice(`${name} hit the same case again (${key}): how should the factory go on?`, ["A rerun did not clear it"]));
  }
  if (key !== "claimed") markRescued(last, key);

  if (key === "claimed") {
    // The worker says the goal is met: the repo's checks on origin/<main> decide. Green closes the item; red reruns
    // the goal with the claim as its note. An unchecked main is waited on: the run stays for the next dispatch.
    const red = checks ? await baseline(repo, checks) : "main is unchecked: no checks";
    if (red && UNCHECKED.test(red)) { factoryLog(`${name}: the claim waits: ${red}`); return; }
    markRescued(last, key);
    if (!red) {
      const text = `${r.kind} run ${last.id} says the goal is already met (${claim}), and the checks pass on origin/${repo.main}: dropped, and the item is done`;
      if (!await tryDo(await act.drop(name, text), "drop")) return;
      record(text, { done: true });
      await say(text);
    } else if (earlier && issue !== undefined) {
      const text = `${r.kind} run ${last.id} says the goal is already met again (${claim}), but ${red}: dropped, and the issue went back to triage`;
      if (!await tryDo(await act.drop(name, text), "drop")) return;
      record(text, { kind: "issue" });
      await say(text);
    } else {
      rerun(`The last run said the goal is already met (${claim}), but the checks do not pass on origin/${repo.main} (${red}). Make the change the goal asks for.`);
      const text = `${r.kind} run ${last.id} says the goal is already met (${claim}), but ${red}; dropped, and the goal reruns once`;
      if (!await tryDo(await act.drop(name, text), "drop")) return;
      record(text);
      await say(text);
    }
  } else if (key === "duplicate") {
    const text = `${r.kind} run ${last.id} ended with no commit and the item is already ${onMain ? `on main as ${onMain}` : "done"}: dropped as a duplicate, and the item is closed`;
    if (!await tryDo(await act.drop(name, text), "drop")) return;
    record(text, { done: !!onMain });
    await say(text);
  } else if (key === "infra") {
    const text = `${r.kind} run ${last.id} failed for infrastructure (${reason}): `;
    const branch = !!r.branch && git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${r.branch}`).ok;
    if (r.kind === "land") {
      if (!await tryDo(land ? await land(name) : "no land", "land again")) return;
      record(`${text}landed again, once`);
      await say(`${text}landing again`);
    } else if (branch) {
      if (!await tryDo(await act.recheck(name), "recheck")) return;
      record(`${text}rechecked, once`);
      await say(`${text}rechecking`);
    } else {
      rerun(`The last run failed before it made a branch: ${reason}.`);
      if (!await tryDo(await act.drop(name, `${text}dropped for one rerun`), "drop")) return;
      record(`${text}dropped; the goal reruns once`);
      await say(`${text}the goal reruns`);
    }
  } else if (key === "land-conflict") {
    const files = r.conflicts?.length ? r.conflicts : (reason.split(": ")[1] ?? "").split(", ").filter(Boolean);
    fetchOrigin(repo.path);
    const touched = files.length ? git(repo.path, "log", `origin/${repo.main}`, "-1", "--format=%h %s", "--", ...files).out : "";
    const what = `${files.join(", ") || "unknown files"}${touched ? `, last changed on ${repo.main} by ${touched}` : ""}`;
    rerun(`The last land failed with a merge conflict in ${what}. Another goal landed on the same lines first; this run starts from the current ${repo.main}.`);
    const text = `${r.kind} run ${last.id}: merge conflict in ${what}; dropped, and the goal reruns once from current ${repo.main}`;
    if (!await tryDo(await act.drop(name, text), "drop")) return;
    record(text);
    await say(text);
  } else {
    const why = key === "no-commit" ? "the last run made no commit" : key === "time-box" ? "the time box ran out" : `the checks failed after the land merged main (${reason})`;
    rerun(`${why[0].toUpperCase()}${why.slice(1)}. The last 20 lines of its ${key === "land-checks" ? "checks.log" : "result.md"}:\n\n${quoted(key === "land-checks" ? "checks.log" : "result.md")}`);
    const text = `${r.kind} run ${last.id}: ${why}; dropped, and the goal reruns once`;
    if (!await tryDo(await act.drop(name, text), "drop")) return;
    record(text);
    await say(text);
  }
}

const localDay = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

/** True from 03:00 local, when the store has not been mined on this local date. */
export function correctionsDue(now = Date.now()): boolean {
  if (new Date(now).getHours() < 3) return false;
  const at = readStore().minedAt;
  const t = Date.parse(at);
  return !at || Number.isNaN(t) || localDay(t) !== localDay(now);
}

/** The tick's daily correction mining (corrections.ts), under the pause and probe gates. An error is logged, never thrown. */
export async function correctionsStep(now = Date.now()): Promise<{ signals: number; lessons: number; proposed: number } | null> {
  if (gates({ only: ["pause", "probe"] }) || !correctionsDue(now)) return null;
  try {
    const store = await mine(now);
    const r = {
      signals: store.lessons.reduce((n, l) => n + l.signals.length, 0),
      lessons: store.lessons.length,
      proposed: store.lessons.filter((l) => l.state === "proposed").length,
    };
    factoryLog(`corrections: ${r.signals} signals, ${r.lessons} lessons, ${r.proposed} proposed`);
    return r;
  } catch (e) {
    factoryLog(`corrections: failed: ${(e as Error).message}`);
    return null;
  }
}

/** The tick's triage of open issues that are not goals (triage.ts). */
export async function triageStep(): Promise<{ triaged: Counts; skipped: string[] }> {
  if (gates({ only: ["pause", "hold", "probe"] })) return { triaged: {}, skipped: [] };
  const t = await triageOpen(sandboxRepos(), doneChecker());
  factoryLog(`triaged ${countsLine(t.triaged)}${t.skipped.length ? `; skipped ${t.skipped.join("; ")}` : ""}`);
  if (t.triaged.goal) dispatchDetached();
  return t;
}

/**
 * The tick's firefighter (firefighter.ts): a snapshot every tick, and one run only when it holds
 * something new. Under the pause alone: the hold is what it clears. An error is logged, never thrown.
 */
export async function firefighterStep(ports?: Ports): Promise<Fired | null> {
  if (gates({ only: ["pause"] })) return null;
  try {
    const f = await firefight(ports);
    if (f.run) factoryLog(`firefighter ${f.run}: ${f.events.length} new events; ${f.applied.length} applied, ${f.refused.length} refused, ${f.chris.length} to Chris`);
    if (f.applied.length) dispatchDetached();
    return f;
  } catch (e: any) {
    factoryLog(`firefighter: failed: ${e?.message ?? e}`);
    return null;
  }
}

/** The firefighter's lines of the factory log in the last 24 hours, newest last, at most `n`: what the Status page shows. */
export function firefighterLines(now = Date.now(), n = 8): { at: string; line: string }[] {
  let text = "";
  try { text = readFileSync(join(factoryDir(), "tick.log"), "utf8"); } catch { return []; }
  return text.split("\n").flatMap((l) => {
    const m = /^(\S+) (firefighter[: ].*)$/.exec(l);
    return m && now - Date.parse(m[1]) < DAY ? [{ at: m[1], line: m[2] }] : [];
  }).slice(-n);
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

/** One tick of the timer: a dispatch, as the fallback. */
export const tick = dispatchGoals;

export interface Flake { repo: string; check: string; run: string; at: string }
const flakyFile = () => join(factoryDir(), "flaky.json");
export const flakes = (): Flake[] => {
  try { return JSON.parse(readFileSync(flakyFile(), "utf8")); } catch { return []; }
};
/** A check that failed, then passed on a rerun of the same tree. */
export function recordFlake(repo: string, check: string, run: string, now = Date.now()): void {
  mkdirSync(factoryDir(), { recursive: true });
  writeFileSync(flakyFile(), JSON.stringify([...flakes(), { repo, check, run, at: new Date(now).toISOString() }], null, 2) + "\n");
}

export interface Baseline { repo: string; commit: string; ok: boolean; failed?: string }
const baselineFile = () => join(factoryDir(), "baseline.json");
export const baselines = (): Record<string, Baseline> => {
  try { return JSON.parse(readFileSync(baselineFile(), "utf8")); } catch { return {}; }
};
/** The baselines that are red now, one per repo. */
export const redBaselines = (): Baseline[] => Object.values(baselines()).filter((b) => !b.ok);
/** The check that failed, from the gate's reason: `tests failed` is `tests`. */
const failedCheck = (why: string) => why.replace(/^timed out: check /, "").replace(/ failed$/, "");
export const redLine = (b: Baseline) => `main is red at ${b.commit.slice(0, 7)}: ${b.failed}`;

/** A baseline that could not run its checks, as against a check that failed: never recorded. */
const infraError = (why: string) => /^(checks did not start|bundle failed|baseline did not run|worktree gone)/.test(why);

/**
 * Whether the repo's checks pass on its current origin/<main>: run once per
 * commit, kept in baseline.json. Returns the red line, or null when green.
 * One baseline runs per repo at a time, under a lock; a dispatch that finds it
 * taken starts nothing. Only a failed check is recorded: an error that kept
 * the checks from running is reported but tried again by the next dispatch.
 */
async function baseline(repo: Repo, checks: (repo: Repo, commit: string, logs: string) => Promise<string | null>): Promise<string | null> {
  if (!fetchOrigin(repo.path).ok) return "main is unchecked: fetch failed";
  const commit = git(repo.path, "rev-parse", `origin/${repo.main}`).out;
  if (!commit) return `main is unchecked: no origin/${repo.main}`;
  const known = () => { const b = baselines()[repo.key]; return b && b.commit === commit ? b : undefined; };
  let b = known();
  if (!b) {
    const release = await lock(`baseline-${repo.key}`, 0);
    if (!release) return "main baseline running";
    try {
      // Another dispatch may have recorded this commit between the read and the lock.
      b = known();
      if (!b) {
        const why = await checks(repo, commit, join(factoryDir(), "baseline", repo.key));
        if (why && infraError(why)) return `main is unchecked: ${why}`;
        b = { repo: repo.key, commit, ok: !why, ...(why ? { failed: failedCheck(why) } : {}) };
        mkdirSync(factoryDir(), { recursive: true });
        writeFileSync(baselineFile(), JSON.stringify({ ...baselines(), [repo.key]: b }, null, 2) + "\n");
      }
    } finally {
      release();
    }
  }
  return b.ok ? null : redLine(b);
}

export interface Probe { at: string; ok: boolean; failed: string[] }
export const lastProbe = (): Probe | null => {
  try { return JSON.parse(readFileSync(probeFile(), "utf8")); } catch { return null; }
};
export function saveProbe(p: Probe): void {
  mkdirSync(factoryDir(), { recursive: true });
  writeFileSync(probeFile(), JSON.stringify(p, null, 2) + "\n");
}
export const probeDue = (now = Date.now()) => { const p = lastProbe(); return !p || now - Date.parse(p.at) > 20 * 3600_000; };

/** The factory's health line, or null: no run in 24 hours with a goal open, or a failed probe. */
export function health(now = Date.now()): string[] {
  const lines: string[] = [];
  const goals = openGoals();
  if (goals.length && !paused() && !runsToday(now).length) lines.push(`health: no factory run started in 24 hours, with ${goals.length} open goal${goals.length > 1 ? "s" : ""}`);
  const w = waiting();
  if (w >= AWAITING_CAP()) lines.push(`health: ${w} runs wait for Chris; no new run starts`);
  const p = lastProbe();
  if (p && !p.ok) lines.push(`health: the sandbox probe at ${p.at} failed: ${p.failed.join("; ")}`);
  for (const b of Object.values(baselines())) if (!b.ok) lines.push(`health: ${b.repo} ${redLine(b)}`);
  for (const c of redCi()) lines.push(`health: ${ciLine(c)}`);
  const counts = new Map<string, number>();
  for (const f of flakes()) if (now - Date.parse(f.at) < 7 * DAY) counts.set(`${f.repo} check ${f.check}`, (counts.get(`${f.repo} check ${f.check}`) ?? 0) + 1);
  for (const [k, n] of counts) if (n >= 2) lines.push(`health: ${k} passed on rerun ${n} times in 7 days`);
  const lists = reader();
  for (const repo of factoryRepos()) {
    const doc = lists.list(repo.key);
    const tracker = doc && flakeTracker(doc);
    if (!tracker) continue;
    const files = new Set<string>();
    let k = 0;
    for (const line of tracker.notes) {
      const m = /^- (\d{4}-\d\d-\d\d) (\d\d:\d\d): (.*)$/.exec(line);
      if (!m) continue;
      const at = Date.parse(`${m[1]}T${m[2]}`);
      if (!(now - at < 7 * DAY)) continue;
      k++;
      const cut = m[3].indexOf(" > ");
      // The caller's prefix ("job x: ", "firefighter: ") is not part of the file name.
      if (cut >= 0) files.add(m[3].slice(0, cut).split(": ").at(-1)!.trim());
    }
    if (k) lines.push(`health: ${repo.key}-${tracker.id} holds ${k} flake notes in 7 days, ${files.size} test files`);
  }
  return lines;
}

/** How far a checkout is behind origin/<main>, with the diff a pull would bring. */
export function behind(repo: Repo): string | null {
  const n = Number(git(repo.path, "rev-list", "--count", `HEAD..origin/${repo.main}`).out || 0);
  if (!n) return null;
  return `${repo.path} is ${n} commit${n > 1 ? "s" : ""} behind origin/${repo.main}; git pull brings:\n${git(repo.path, "diff", "--stat", "HEAD", `origin/${repo.main}`).out}`;
}

const money = (n: number) => (n > 0 && n < 0.005 ? "<$0.01" : `$${n.toFixed(2)}`);

/** The first source of the vault note titled `title`, or undefined. */
function noteSource(title: string): string | undefined {
  for (const d of ["gotchas", "concepts"]) {
    try {
      const m = /^sources:\s*\[([^\]]*)\]/m.exec(readFileSync(join(vaultDir(), "wiki", d, `${title}.md`), "utf8"));
      const first = m?.[1].split(",")[0].trim();
      if (first) return first;
    } catch {}
  }
  return undefined;
}

/** One run as the report gives it. */
function entry(e: Entry): string {
  const r = e.run;
  const needs = isAwaiting(r.state) ? needsOf(runAskOf(r)) : undefined;
  const head = `${r.repo}/${r.name} ${r.state}${needs ? ` (${needs})` : ""}${r.round && r.state !== "stuck" ? ` after ${r.round} fix rounds` : ""}`;
  const lines = [r.reason ? `${head}: ${r.reason}` : head];
  if (r.state === "landed" && r.commit) lines.push(`  commit ${r.commit.slice(0, 7)}`);
  if (needs === "held" || needs === "review") {
    if (r.stat) lines.push(...r.stat.split("\n").map((l) => `  ${l}`));
    lines.push(`  aleph land ${r.name}   (lands it, with Held-by: Chris)`, `  aleph drop ${r.name}   (drops it; the item stays open)`);
  }
  for (const d of r.defaults ?? []) lines.push(`  DEFAULT: ${d}`);
  const hidden = r.checks?.find((c) => c.name === "hidden" && c.total);
  if (hidden) lines.push(`  hidden ${hidden.passed}/${hidden.total}`);
  for (const c of r.checks ?? []) if (c.rerun) lines.push(`  ${c.name} passed on rerun`);
  if (r.kind === "facts") {
    for (const k of r.kept ?? []) {
      const src = noteSource(k);
      lines.push(`  kept: ${k}${src ? ` (${src})` : ""}`);
    }
    for (const x of r.rejected ?? []) lines.push(`  rejected: ${typeof x === "string" ? x : `${x.fact}: ${x.reason}`}`);
  }
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
  lines.push(...unshown());
  const eps = newEpisodes();
  if (eps.length) lines.push(["episodes:", ...eps.map((t) => `  ${t}`)].join("\n"));
  const proposed = takeFresh();
  if (proposed.length) lines.push(["proposed updates (relabel one `goal` to start it):", ...proposed.map((d) => `  ${d}`)].join("\n"));
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
 * The open items whose `due` is today or earlier, or whose waited-on item is
 * done, that no report has listed; each is then written to the seen file.
 * Comparing with today, not with yesterday, catches every item in a gap.
 */
function cameDue(): string[] {
  const seen = new Set(existsSync(seenFile()) ? readFileSync(seenFile(), "utf8").split("\n").filter(Boolean) : []);
  const day = issues.today(issues.clock());
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
      const due = item.fm.due;
      const waits = afterOf(item);
      if ((typeof due === "string" && issues.validDate(due) && due <= day) || (waits.length > 0 && !pendingWaits(waits, done).length)) {
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
  const fresh = allRuns().filter((e) => e.run.shown === false && e.run.kind !== "plain" && e.run.state !== "running" && !(isLive(e.folder) || isStarting(e)));
  const lines = fresh.map(entry);
  for (const e of fresh) updateRun(e.folder, { shown: true });
  const today = runsToday(now);
  if (lines.length) lines.push(`runs in the last 24 hours: ${today.length} of ${DAY_CAP()}, ${money(spentToday(now))} at the API price${paused() ? "; the factory is paused" : ""}`);
  return lines;
}

/**
 * Triage one issue at once, as `aleph issue add`, a note that answers an Ask, and a
 * worker's follow-ups do. The gates are the dispatch's: paused, the hold, a failed probe, the
 * day cap. A gated issue is left for the tick.
 */
export async function triageNow(repo: Repo, id: number): Promise<{ triaged: Counts; skipped: string[] }> {
  if (gates({ only: ["pause", "hold", "probe"] })) return { triaged: {}, skipped: [] };
  const t = await triageIssue(repo, id, doneChecker());
  factoryLog(`triaged ${repo.key}-${id}: ${countsLine(t.triaged)}${t.skipped.length ? `; skipped ${t.skipped.join("; ")}` : ""}`);
  if (t.triaged.goal) dispatchDetached();
  return t;
}

/**
 * Start `aleph dispatch` detached, for a transition that may free a slot, clear a hold or ready a
 * goal: the caller never waits for the baseline checks, and a failure never reaches it. Off when
 * `ALEPH_DISPATCH=off`; the tick still dispatches.
 */
export function dispatchDetached(): void {
  if (!dispatchOn()) return;
  detached(["dispatch"], join(factoryDir(), "dispatch.log"));
}

/** Start `aleph triage <repo>-<id>` detached, for a factory repo's issue; it never fails the caller. */
export function triageDetached(repo: Repo, id: number): void {
  if (!dispatchOn() || !repo.sandbox) return;
  detached(["triage", `${repo.key}-${id}`], join(factoryDir(), "dispatch.log"));
}

/** Start `aleph plan <repo>-<id>` detached, for a large goal; it never fails the caller. */
export function planDetached(repo: Repo, id: number): void {
  if (!dispatchOn() || !repo.sandbox) return;
  detached(["plan", `${repo.key}-${id}`], join(factoryDir(), "dispatch.log"));
}

/**
 * Plan one goal at once, as `aleph plan` does, under the dispatch's gates: not paused, no hold,
 * no failed probe, a factory repo. When it ends, the children or the fallback worker start from
 * a dispatch of their own.
 */
export async function planNow(repo: Repo, id: number): Promise<{ planned: string[] } | { why: string }> {
  const gated = gates({ only: ["pause", "hold", "probe"] });
  if (gated) return { why: gated.why };
  if (!repo.sandbox) return { why: `${repo.key} is not a factory repo` };
  const r = await runPlan(repo, id);
  factoryLog(`plan ${repo.key}-${id}: ${"planned" in r ? `into ${r.planned.join(",")}` : r.why}`);
  dispatchDetached();
  return r;
}
