/**
 * The factory around the runs: the pause file, the 24-hour cap, the timer's
 * tick, the report and its health line. Its state lives in ~/.aleph/factory,
 * which no sandbox can see. See docs/specs/2026-10-26-seed-factory.md.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as todos from "../../todo/lib/todo.ts";
import { goal, goals, hasLabel, note, readLists, reader } from "../../todo/lib/store.ts";
import { fetchOrigin, git } from "./git.ts";
import { takeFresh } from "./deps.ts";
import { normalizeDecision, type Decision } from "./decision.ts";
import { itemOnMain, itemStates, type ItemState } from "./status.ts";
import { firefight, type Fired, type Ports } from "./firefighter.ts";
import { countsLine, triageIssue, triageOpen, type Counts } from "./triage.ts";
import { allRuns, expand, isLive, loadRegistry, lock, tell, updateRun, type Entry, type Repo } from "./ledger.ts";
import { allJobs, isOpen, issue as issueOf, jobsNamed, lastReal, markNeedsChris, markRescued, needsChris, openJob, readFile, rescued, tailOf, type Job } from "./job.ts";
import { accept, final, readRecord, reaccept, reopenedByAcceptance, sandboxRunner, unshown, type Runner } from "./acceptance.ts";
import { mine, proposals, readStore } from "./corrections.ts";
import { writeEpisodes } from "./episode.ts";
import { vaultDir } from "../../vault/lib/vault.ts";
import { readdirSync } from "node:fs";
import { alreadyMet } from "./gate.ts";
import { logStanding, standing } from "./standing.ts";
import { detached } from "./launch.ts";
import { PLANNED, needsPlan, planning, runPlan, type Rate } from "./plan.ts";
import type { Tier } from "./route.ts";

export const factoryDir = () => expand(process.env.ALEPH_FACTORY_DIR ?? "~/.aleph/factory");
const pauseFile = () => join(factoryDir(), "paused");
const probeFile = () => join(factoryDir(), "probe.json");

/** `caps.json` in the factory directory: `{ "day", "live", "waiting" }`. A missing or bad file is empty. */
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
  const f = capsFile()[key];
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

export const WAITING_CAP = () => cap("ALEPH_WAITING_CAP", "waiting", 5);

const sandboxRepos = () => Object.values(loadRegistry()).filter((r) => r.sandbox);
/** The registry's factory repos: those whose runs are sandboxed. */
export const factoryRepos = sandboxRepos;

/** Factory agent and triage runs started in the last 24 hours. */
export function runsToday(now = Date.now()): Entry[] {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  return allRuns().filter((e) => (e.run.kind === "agent" || e.run.kind === "triage" || e.run.kind === "plan") && e.run.repo && keys.has(e.run.repo) && now - Date.parse(e.run.started) < DAY);
}

/** Open jobs in factory repos waiting for Chris (`needs-you`; a stuck run needs no answer). */
export function waiting(jobs = allJobs()): number {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  return jobs.filter((j) => isOpen(j) && j.at(-1)!.run.repo && keys.has(j.at(-1)!.run.repo!) && j.at(-1)!.run.state === "needs-you").length;
}

export interface Hold { name: string; state: string; reason?: string; line: string }

/** Whether an open job holds the factory: its last real run is stuck or failed, with no next run pending and no `needs-chris` label. */
function holds(j: Job, keys: Set<string>, except?: string): boolean {
  const last = lastReal(j);
  const r = last.run;
  return isOpen(j) && !!r.repo && keys.has(r.repo) && (r.state === "stuck" || r.state === "failed") && r.job !== except
    && !r.next && !isLive(last.folder) && !needsChris(last);
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
 * A run the factory labelled `needs-chris` does not count: Chris answers it when he can.
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
    return isOpen(j) && (r.kind === "agent" || r.kind === "recheck") && r.state === "passed" && !isLive(last.folder) && (r.land || (r.repo && repos[r.repo]?.autoland));
  }).sort((a, b) => Date.parse(a[0].run.started) - Date.parse(b[0].run.started)).map((j) => j.at(-1)!.run.name);
}

/** The open items labelled `goal` in each factory repo. */
export const openGoals = (): { repo: Repo; item: todos.Item }[] => goals(sandboxRepos());

/**
 * Whether `<repo>-<n>` is done, by the derived state `aleph status` gives. A
 * repo outside the registry, or an item the store lacks, is not done.
 */
export function doneChecker(): (ref: string) => boolean {
  const reg = loadRegistry();
  const known = new Map<string, ItemState[]>();
  return (ref) => {
    const r = todos.parseRef(ref);
    const repo = r && reg[r.repo];
    if (!r || !repo) return false;
    if (!known.has(r.repo)) {
      try { known.set(r.repo, itemStates(repo, { fetch: true })); } catch { known.set(r.repo, []); }
    }
    return known.get(r.repo)!.find((s) => s.item === `${r.repo}-${r.id}`)?.state === "done";
  };
}

/** Why an item is not ready to start today, or null: its `due` is after today, or what it waits on is not done. */
export function notReady(item: todos.Item, done: (ref: string) => boolean, now = todos.clock()): string | null {
  const due = item.fm.due;
  if (typeof due === "string" && todos.validDate(due) && due > todos.today(now)) return `due ${due}`;
  const waits = item.fm.waiting_on;
  const open = pendingWaits(waits, done);
  if (open.length) return `waiting on ${open.join(",")}`;
  return null;
}

/** The parts of a `waiting_on` (a ref or a comma list of refs) that are not done; none for an absent one. */
export function pendingWaits(waits: unknown, done: (ref: string) => boolean): string[] {
  return typeof waits === "string" ? todos.waitParts(waits).filter((w) => !done(w)) : [];
}

/** The job name for a goal item: its store id, as `aleph-28`. */
export const goalJob = (repo: Repo, id: number) => `${repo.key}-${id}`;

/** Agent runs live now. */
export const liveEntries = (): Entry[] => allRuns().filter((e) => e.run.kind === "agent" && isLive(e.folder));
export const liveRuns = (): number => liveEntries().length;

/** The gates, in the order `gates` checks them. */
export const GATES = ["pause", "hold", "probe", "live", "day", "waiting"] as const;
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
  if (on("waiting")) {
    const waits = waiting(opts.jobs);
    if (waits >= WAITING_CAP()) return { gate: "waiting", why: `${waits} runs wait for Chris` };
  }
  return null;
}

/** Dispatch is off when `ALEPH_DISPATCH=off`: a run's end and `aleph issue` then start nothing; the tick still does. */
export const dispatchOn = () => process.env.ALEPH_DISPATCH !== "off";

/** `tier` is the router's rating when the dispatch has it already; undefined lets the start rate the spec itself. */
type Start = (repo: Repo, name: string, id: number, spec: string, tier?: Tier | null) => Promise<string | null>;
type Checks = (repo: Repo, commit: string, logs: string) => Promise<string | null>;
type Land = (name: string) => Promise<string | null>;
/** What a safe default action does to a run: both return the refusal, or null. */
export interface Rescue {
  /** Drop the job, with the reason; the factory writes the issue note and the news itself. */
  drop: (name: string, reason: string) => Promise<string | null>;
  /** Start a recheck of the job. */
  recheck: (name: string) => Promise<string | null>;
}

/**
 * Start every ready goal, in order, until the live cap: an open goal item with
 * no open job, while the factory is not paused and the other gates allow. It
 * runs when a run ends, when a goal is added or edited, and from the tick as a
 * fallback. Each start holds a lock on its goal and re-reads the jobs under it,
 * so two dispatches at once start a goal once. `start` dispatches the run; it
 * is `aleph job`, in-process (transitions.ts). With `rate`, a large goal's
 * first run is a planner run instead (plan.ts), and a goal labelled `planned`
 * is never started: it is closed once its children are all done. `plan`
 * starts a large goal's planner detached; the dispatch does not wait for it.
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
  const landed: string[] = [];
  if (land) {
    // All at once: the lands queue on the repo's lock, and the first takes the rest into one batch.
    const names = waitingToLand();
    const whys = await Promise.all(names.map((name) => land(name)));
    names.forEach((name, i) => { if (!whys[i]) landed.push(name); });
    if (landed.length) factoryLog(`landed ${landed.join(", ")}`);
  }
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
  for (const { repo, item: listed } of goals) {
    const name = goalJob(repo, listed.id);
    const red = reds.get(repo.key);
    if (red) { skipped.push(`${name}: ${red}`); continue; }
    if (hasLabel(listed, PLANNED)) { skipped.push(`${name}: ${await closePlanned(repo, listed.id, done)}`); continue; }
    if (done(`${repo.key}-${listed.id}`)) { skipped.push(`${name}: the item is already done`); continue; }
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
      const item = goal(repo, listed.id);
      if (!item) { skipped.push(`${name}: not a goal`); continue; }
      // The item may have gained a waiting_on or a due date since it was read, while the baseline ran or an earlier goal started.
      const waitNow = notReady(item, done);
      if (waitNow) { skipped.push(`${name}: ${waitNow}`); continue; }
      // A plan job runs detached: the goal gets no second planner and no worker while it does.
      if (await planning(repo, item.id)) { skipped.push(`${name}: planning`); continue; }
      const gated = gates({ only: ["live", "day", "waiting"], jobs });
      if (gated) { skipped.push(`${name}: ${gated.why}`); continue; }
      const marked = streakMark(name) !== null;
      if ((marked && hasLabel(item, "needs-chris")) || noCommitStreak(repo.key, name) >= NO_COMMIT_LIMIT) {
        if (!hasLabel(item, "needs-chris")) {
          writeStreakMark(name);
          const text = `needs-chris: the last ${NO_COMMIT_LIMIT} runs of this goal ended with no commit, so the factory stopped starting it; rewrite the goal or close the item.`;
          const bad = note(repo, item.id, text, { label: "needs-chris", reason: "no-commit" });
          if (bad) factoryLog(`${name}: no issue note: ${bad}`);
        }
        skipped.push(`${name}: ${NO_COMMIT_LIMIT} runs in a row with no commit`);
        continue;
      }
      const again = rerunNote(name);
      const drops = jobsNamed(name, null, jobs).filter((j) => j.at(-1)!.run.state === "dropped" && j.at(-1)!.run.reason).map((j) => `- ${j.at(-1)!.run.reason}`).reverse();
      const spec = `# ${item.title}\n\n${item.body.trim()}\n${drops.length ? `\n## Reasons of the earlier drops, newest first\n\n${drops.join("\n")}\n` : ""}${item.notes.length ? `\n## Notes on the issue\n\n${item.notes.join("\n")}\n` : ""}${again ? `\n## Note on the last run\n\n${again}\n` : ""}`;
      let tier: Tier | null | undefined;
      if (rate) {
        const p = await needsPlan(repo, item, spec, rate);
        if ("plan" in p) { plan(repo, item.id); planned.push(name); continue; }
        tier = p.tier;
      }
      const why = await start(repo, name, item.id, spec, tier);
      if (why) skipped.push(`${name}: ${why}`);
      else { started.push(name); if (again) rmSync(rerunFile(name), { force: true }); }
    } finally {
      release();
    }
  }
  factoryLog(`started ${started.join(", ") || "none"}${planned.length ? `; planning ${planned.join(", ")}` : ""}${skipped.length ? `; skipped ${skipped.join("; ")}` : ""}`);
  return { started, skipped, ...(landed.length ? { landed } : {}), ...(planned.length ? { planned } : {}) };
}

/**
 * A goal labelled `planned` is never started. Once every child it waits on is
 * done, it is closed as done with a note naming the children's commits.
 * Returns the line for the dispatch's skipped list.
 */
async function closePlanned(repo: Repo, id: number, done: (ref: string) => boolean): Promise<string> {
  const release = await lock(`goal-${goalJob(repo, id)}`, 0);
  if (!release) return "planned; another dispatch holds it";
  try {
    const item = goal(repo, id);
    if (!item || !hasLabel(item, PLANNED)) return "planned; no longer an open goal";
    const waits = typeof item.fm.waiting_on === "string" ? todos.waitParts(item.fm.waiting_on) : [];
    const open = waits.filter((w) => !done(w));
    if (open.length) return `planned; waiting on ${open.join(",")}`;
    const reg = loadRegistry();
    const commits = waits.map((w) => {
      const r = todos.parseRef(w);
      const sha = r ? itemOnMain(reg[r.repo] ?? (r.repo === repo.key ? repo : undefined), r.id) : null;
      return `${w} (${sha ?? "no commit"})`;
    });
    const bad = note(repo, id, `planned: its children are all done: ${commits.join(", ") || "none"}`, { done: true });
    return bad ? `planned; not closed: ${bad}` : "planned; closed as done";
  } finally {
    release();
  }
}

/** Done goals older than this many days are not accepted: the step starts with the goals closed lately. */
const ACCEPTANCE_DAYS = 2;

/**
 * The acceptance run: every done goal (one whose land is on origin/<main>, or a `planned` parent
 * closed as done) whose Oracle has not been run since it was done gets it run on origin/<main>,
 * under srt. Pass: a note; first failure: the goal reopens with the output as a note and the
 * dispatch starts it again; second: `needs-chris`. See acceptance.ts.
 */
export async function acceptanceStep(run: Runner = sandboxRunner, now = todos.clock()): Promise<string[]> {
  const lines: string[] = [];
  const since = todos.today(new Date(now.getTime() - ACCEPTANCE_DAYS * 86_400_000));
  for (const repo of sandboxRepos()) {
    const list = reader().list(repo.key)?.items ?? [];
    const due = list.filter((i) => hasLabel(i, "goal") && todos.status(i) === "done" && String(i.fm.updated ?? "") >= since && !final(readRecord(repo.key, i.id)));
    if (!due.length) continue;
    if (!fetchOrigin(repo.path).ok) { lines.push(`${repo.key}: acceptance not run: fetch failed`); continue; }
    for (const listed of due) {
      const release = await lock(`acceptance-${repo.key}-${listed.id}`, 0);
      if (!release) continue;
      try {
        const item = reader().item(repo.key, listed.id);
        if (!item || todos.status(item) !== "done" || final(readRecord(repo.key, item.id))) continue;
        if (!hasLabel(item, PLANNED) && !itemOnMain(repo, item.id)) continue;
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
  for (const listed of list.filter((i) => hasLabel(i, "goal") && reopenedByAcceptance(i, since, before))) {
    const release = await lock(`acceptance-${repo.key}-${listed.id}`, 0);
    if (!release) continue;
    try {
      const item = reader().item(repo.key, listed.id);
      if (!item || !reopenedByAcceptance(item, since, before) || !itemOnMain(repo, item.id)) continue;
      lines.push(await reaccept(repo, item, o.run));
    } finally {
      release();
    }
  }
  for (const l of lines) factoryLog(l);
  return lines;
}

/** Runs of one goal in a row, newest last, that may end with no commit before dispatch stops starting it. */
const NO_COMMIT_LIMIT = 3;

const streakFile = (name: string) => join(factoryDir(), "streak", `${name}.txt`);
/** When the streak last labelled the goal's item `needs-chris` (ms), or null. Runs before it no longer count. */
const streakMark = (name: string): number | null => {
  if (!existsSync(streakFile(name))) return null;
  const t = Date.parse(readFileSync(streakFile(name), "utf8").trim());
  return Number.isNaN(t) ? null : t;
};
const writeStreakMark = (name: string) => {
  mkdirSync(dirname(streakFile(name)), { recursive: true });
  writeFileSync(streakFile(name), new Date().toISOString() + "\n");
};

/** How many of the goal's newest agent runs since the streak's last needs-chris mark, in a row, ended with no commit. */
function noCommitStreak(repoKey: string, name: string): number {
  const mark = streakMark(name) ?? -Infinity;
  const runs = allRuns().filter((e) => e.run.repo === repoKey && e.run.name === name && e.run.kind === "agent" && e.run.state !== "running" && Date.parse(e.run.started) > mark)
    .sort((a, b) => Date.parse(a.run.started) - Date.parse(b.run.started));
  let n = 0;
  for (const e of runs.reverse()) { if (e.run.reason !== "no commit" && !e.run.noCommit) break; n++; }
  return n;
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

type Case = "duplicate" | "no-commit" | "claimed" | "time-box" | "infra" | "land-checks" | "land-conflict";
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

/** How long a dispatch waits for a run's rescue lock before it skips the run. */
const RESCUE_WAIT_MS = () => Number(process.env.ALEPH_RESCUE_WAIT_MS ?? 60_000);

/**
 * The safe default actions for stuck and failed runs, taken by the dispatch that sees them: a duplicate
 * is dropped; a no-commit run whose worker says the goal is already met is checked on main, and closed when
 * the checks pass there; no commit, a time box and checks that fail after a land merge and a land that hits a merge conflict drop the run for one rerun
 * of the goal, with a note; an infrastructure failure is rechecked or landed again, once. Each action
 * writes its reason to the run, the issue note and the news. Anything else, or the second time one
 * case hits one goal, labels the issue `needs-chris` with a one-line question; such a run holds nothing.
 */
async function rescueStuck(act: Rescue, land?: Land, checks?: Checks): Promise<void> {
  const pending = (jobs: Job[]) => holders(jobs);
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
  const record = (text: string, opts: { done?: boolean; label?: string; unlabel?: string; decision?: Decision; reason?: string } = {}) => {
    const why = issue === undefined ? "no issue" : note(repo, issue, text, opts);
    if (why) factoryLog(`${name}: no issue note: ${why}`);
  };
  const chris = async (question: string, decision?: Decision) => {
    // A standing permission to take the recommendation: Rerun drops the run, and the goal reruns.
    if (decision && decision.recommended === "Rerun" && standing("rescue")?.action === "recommended") {
      const why = await act.drop(name, question);
      if (!why) {
        logStanding("rescue", "recommended", `${repo.key}-${issue ?? name}`);
        record("standing: Rerun");
        await say(`standing: Rerun; dropped, and the goal reruns`);
        return;
      }
      factoryLog(`${name}: standing Rerun failed (${why})`);
    }
    markNeedsChris(last, question);
    record(`needs-chris: ${question}`, { label: "needs-chris", decision, reason: "rescue" });
    await say(`needs-chris: ${question}`);
  };

  let onMain: string | null = null;
  const onMainOrDone = () => {
    fetchOrigin(repo.path);
    const mine = git(repo.path, "log", `origin/${repo.main}`, "-1", "--format=%H", "-E", `--grep=^Job: ${r.job}$`).out;
    if (mine) { onMain = mine.slice(0, 7); return true; }
    const there = itemOnMain(repo, issue);
    if (there) { onMain = there; return true; }
    const item = issue === undefined ? undefined : reader().item(repo.key, issue);
    return !!item && todos.status(item) !== "open";
  };
  const claim = r.reason === "no commit" ? alreadyMet(readFile(last, "result.md") ?? "") : null;
  const key = caseOf(r, onMainOrDone, claim);
  const reason = r.reason ?? r.state;
  const choice = (question: string, why: string[]) => normalizeDecision({ question, options: RERUN_OPTIONS, recommended: "Rerun", why: [`Run: ${name}, ${r.state}`, `Reason: ${reason}`, ...why] })!;
  if (!key) return chris(`${name} is ${r.state} (${reason}); drop it, recheck it, or edit the goal?`, choice(`${name} is ${r.state} (${reason}): how should the factory go on?`, ["No safe default covers this case"]));

  const tryDo = async (why: string | null, what: string) => {
    if (why) { rmSync(rerunFile(name), { force: true }); await chris(`${name}: ${what} failed (${why}); ${reason}. What now?`, choice(`${name}: ${what} failed: how should the factory go on?`, [`Failure: ${why}`])); return false; }
    return true;
  };
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
      record(text, { unlabel: "goal" });
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
      record(text, { unlabel: "goal" });
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
const baselines = (): Record<string, Baseline> => {
  try { return JSON.parse(readFileSync(baselineFile(), "utf8")); } catch { return {}; }
};
/** The baselines that are red now, one per repo. */
export const redBaselines = (): Baseline[] => Object.values(baselines()).filter((b) => !b.ok);
/** The check that failed, from the gate's reason: `tests failed` is `tests`. */
const failedCheck = (why: string) => why.replace(/^timed out: check /, "").replace(/ failed$/, "");
const redLine = (b: Baseline) => `main is red at ${b.commit.slice(0, 7)}: ${b.failed}`;

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
  if (w >= WAITING_CAP()) lines.push(`health: ${w} runs wait for Chris; no new run starts`);
  const p = lastProbe();
  if (p && !p.ok) lines.push(`health: the sandbox probe at ${p.at} failed: ${p.failed.join("; ")}`);
  for (const b of Object.values(baselines())) if (!b.ok) lines.push(`health: ${b.repo} ${redLine(b)}`);
  const counts = new Map<string, number>();
  for (const f of flakes()) if (now - Date.parse(f.at) < 7 * DAY) counts.set(`${f.repo} check ${f.check}`, (counts.get(`${f.repo} check ${f.check}`) ?? 0) + 1);
  for (const [k, n] of counts) if (n >= 2) lines.push(`health: ${k} passed on rerun ${n} times in 7 days`);
  return lines;
}

/** How far a checkout is behind origin/<main>, with the diff a pull would bring. */
export function behind(repo: Repo): string | null {
  const n = Number(git(repo.path, "rev-list", "--count", `HEAD..origin/${repo.main}`).out || 0);
  if (!n) return null;
  return `${repo.path} is ${n} commit${n > 1 ? "s" : ""} behind origin/${repo.main}; git pull brings:\n${git(repo.path, "diff", "--stat", "HEAD", `origin/${repo.main}`).out}`;
}

const money = (n: number) => (n > 0 && n < 0.005 ? "<$0.01" : `$${n.toFixed(2)}`);

/** One run as the report gives it. */
function entry(e: Entry): string {
  const r = e.run;
  const head = `${r.repo}/${r.name} ${r.state}${r.needs ? ` (${r.needs})` : ""}${r.round && r.state !== "stuck" ? ` after ${r.round} fix rounds` : ""}`;
  const lines = [r.reason ? `${head}: ${r.reason}` : head];
  if (r.state === "landed" && r.commit) lines.push(`  commit ${r.commit.slice(0, 7)}`);
  if (r.state === "needs-you" && (r.needs === "held" || r.needs === "review")) {
    if (r.stat) lines.push(...r.stat.split("\n").map((l) => `  ${l}`));
    lines.push(`  aleph land ${r.name}   (lands it, with Held-by: Chris)`, `  aleph drop ${r.name}   (drops it; the item stays open)`);
  }
  for (const d of r.defaults ?? []) lines.push(`  DEFAULT: ${d}`);
  const hidden = r.checks?.find((c) => c.name === "hidden" && c.total);
  if (hidden) lines.push(`  hidden ${hidden.passed}/${hidden.total}`);
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
  const day = todos.today(todos.clock());
  const done = doneChecker();
  const lines: string[] = [];
  const ids: string[] = [];
  const repos = Object.values(loadRegistry());
  let docs: (todos.Doc | null)[] = [];
  try { docs = readLists(repos); } catch {}
  for (const [n, repo] of docs.map((_, n) => [n, repos[n]] as const)) {
    for (const item of docs[n]?.items ?? []) {
      const id = `${repo.key}-${item.id}`;
      if (todos.status(item) !== "open" || seen.has(id)) continue;
      const due = item.fm.due;
      const waits = item.fm.waiting_on;
      if ((typeof due === "string" && todos.validDate(due) && due <= day) || (typeof waits === "string" && todos.waitParts(waits).length > 0 && !pendingWaits(waits, done).length)) {
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
  const fresh = allRuns().filter((e) => e.run.shown === false && e.run.kind !== "plain" && e.run.state !== "running" && !isLive(e.folder));
  const lines = fresh.map(entry);
  for (const e of fresh) updateRun(e.folder, { shown: true });
  const today = runsToday(now);
  const cost = today.reduce((a, e) => a + (e.run.cost ?? 0), 0);
  if (lines.length) lines.push(`runs in the last 24 hours: ${today.length} of ${DAY_CAP()}, ${money(cost)} at the API price${paused() ? "; the factory is paused" : ""}`);
  return lines;
}

/**
 * Triage one issue at once, as `aleph issue add`, a note that answers `needs-chris`, and a
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
