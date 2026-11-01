/**
 * The factory's status: what its files in ~/.aleph/factory and the ledger say
 * now. `factorySnapshot` is the one read the Status page needs; the rest are the
 * queries and the gates. It imports no transition, so aleph-ui can load it, and
 * a change to the actions does not restart aleph-ui. The actions are in factory.ts.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { flakeTracker, reader, type Reader } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { section } from "../../todo/lib/todo.ts";
import { ciLine, redCi } from "./ci.ts";
import { asked, allJobs, isOpen, lastReal, openJob, type Job } from "./job.ts";
import { layout } from "./layout.ts";
import { allRuns, isAwaiting, isBuild, isLive, isStarting, loadRegistry, onOf, type Entry, type Repo } from "./ledger.ts";
import { causeOf } from "./outcome.ts";
import { smokeLine } from "./smoke.ts";

export const factoryDir = () => layout().factory;

export const pauseFile = () => join(factoryDir(), "paused");

export const probeFile = () => join(factoryDir(), "probe.json");

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

/** The most open jobs awaiting Chris before no new run starts. */
export const AWAITING_CAP = () => cap("ALEPH_AWAITING_CAP", "awaiting", 5);

const sandboxRepos = () => Object.values(loadRegistry()).filter((r) => r.sandbox);

/** The registry's factory repos: those whose runs are sandboxed. */
export const factoryRepos = sandboxRepos;

/** Factory agent and triage runs started in the last 24 hours. */
/** `runs` is every run, when the caller has read them already. */
export function runsToday(now = Date.now(), runs: Entry[] = allRuns()): Entry[] {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  return runs.filter((e) => (isBuild(e.run.kind) || e.run.kind === "triage" || e.run.kind === "plan") && e.run.repo && keys.has(e.run.repo) && now - Date.parse(e.run.started) < DAY);
}

/** The dollars of the runs started in the last 24 hours: `runsToday`, and the facts, firefighter and explain runs, which the day cap does not count. An explain run has no repo (its `on` is an item ref or a run folder), so it is not filtered by one, as a firefighter run is not. */
export function spentToday(now = Date.now(), runs: Entry[] = allRuns()): number {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  const others = runs.filter((e) => (e.run.kind === "firefighter" || e.run.kind === "explain" || (e.run.kind === "facts" && e.run.repo && keys.has(e.run.repo))) && now - Date.parse(e.run.started) < DAY);
  return [...runsToday(now, runs), ...others].reduce((a, e) => a + (e.run.cost ?? 0), 0);
}

/** Open jobs in factory repos whose last run awaits Chris (a stuck run needs no answer). */
export function waiting(jobs = allJobs()): number {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  return jobs.filter((j) => isOpen(j) && j.at(-1)!.run.repo && keys.has(j.at(-1)!.run.repo!) && isAwaiting(j.at(-1)!.run.condition)).length;
}

export interface Hold { name: string; condition: string; reason?: string; line: string }

/** Whether an open job holds the factory: its last real run is stuck or failed, with no next run pending and no Ask on its run. */
function holds(j: Job, keys: Set<string>, except?: string): boolean {
  const last = lastReal(j);
  const r = last.run;
  return isOpen(j) && !!r.repo && keys.has(r.repo) && (r.condition === "stuck" || r.condition === "failed") && r.job !== except
    && !r.next && !isLive(last.folder) && !asked(last);
}

/** The open jobs that hold the factory, in the order given: hold's filter, which rescueStuck uses too. */
export const holders = (jobs: Job[], except?: string): Job[] => {
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
  return { name: r.name, condition: r.condition, reason: r.reason, line: `Held: ${r.name}${more} ${bad.length > 1 ? "are" : "is"} ${r.condition}${r.reason ? ` (${r.reason})` : ""}. No run starts or lands until ${bad.length > 1 ? "they are" : "it is"} cleared.` };
}

/** Agent runs live now, and those started whose unit has not written `pid` yet. */
export const liveEntries = (runs: Entry[] = allRuns()): Entry[] => runs.filter((e) => isBuild(e.run.kind) && (isLive(e.folder) || isStarting(e)));

export const liveRuns = (runs?: Entry[]): number => liveEntries(runs).length;

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
export function gates(opts: { only?: readonly Gate[]; jobs?: Job[]; except?: string } = {}): { gate: Gate; why: string; text: string } | null {
  const on = (g: Gate) => !opts.only || opts.only.includes(g);
  if (on("pause") && paused()) return { gate: "pause", why: "paused", text: "The factory is paused" };
  if (on("hold")) {
    const h = hold(opts.jobs, opts.except);
    if (h) return { gate: "hold", why: h.line, text: h.line };
  }
  if (on("probe")) {
    const p = lastProbe();
    if (p && !p.ok) {
      const why = `the sandbox probe at ${p.at} failed: ${p.failed.join("; ")}`;
      return { gate: "probe", why, text: why };
    }
  }
  // The jobs, when given, hold every run: the live and day gates count from them and read no run again.
  const runs = opts.jobs?.flat();
  if (on("live")) {
    const live = liveRuns(runs);
    if (live >= LIVE_CAP()) return { gate: "live", why: `${live} agent runs are live`, text: `Waiting for a slot (${live} of ${LIVE_CAP()} running)` };
  }
  if (on("day")) {
    const today = runsToday(Date.now(), runs).length;
    if (today >= DAY_CAP()) return { gate: "day", why: `cap of ${DAY_CAP()} runs in 24 hours`, text: `Day cap reached (${today} of ${DAY_CAP()} runs in 24 hours)` };
  }
  if (on("awaiting")) {
    const waits = waiting(opts.jobs);
    if (waits >= AWAITING_CAP()) return { gate: "awaiting", why: `${waits} runs wait for Chris`, text: `${waits} runs wait for Chris (cap ${AWAITING_CAP()})` };
  }
  return null;
}

export interface Flake { repo: string; check: string; run: string; at: string; tests?: string[] }
export const flakyFile = () => join(factoryDir(), "flaky.json");
export const flakes = (): Flake[] => {
  try { return JSON.parse(readFileSync(flakyFile(), "utf8")); } catch { return []; }
};

export interface Baseline { repo: string; commit: string; ok: boolean; failed?: string }

export const baselineFile = () => join(factoryDir(), "baseline.json");

export const baselines = (): Record<string, Baseline> => {
  try { return JSON.parse(readFileSync(baselineFile(), "utf8")); } catch { return {}; }
};

/** The baselines that are red now, one per repo. */
export const redBaselines = (): Baseline[] => Object.values(baselines()).filter((b) => !b.ok);

export const redLine = (b: Baseline) => `main is red at ${b.commit.slice(0, 7)}: ${b.failed}`;

export interface Probe { at: string; ok: boolean; failed: string[] }

export const lastProbe = (): Probe | null => {
  try { return JSON.parse(readFileSync(probeFile(), "utf8")); } catch { return null; }
};

/** How long work may wait with nothing moving before it is stalled: three ticks. */
const STALL_MS = 15 * 60_000;

/** A land run live for longer than this is stuck: 99% of land runs end within 20 minutes. */
const LAND_STUCK_MS = 30 * 60_000;

export const stallFile = () => join(factoryDir(), "stalls.json");

export const smokeFile = () => join(factoryDir(), "smoke.json");

export const readStalls = (): Record<string, string> => {
  try { return JSON.parse(readFileSync(stallFile(), "utf8")); } catch { return {}; }
};

/** The health lines of work that stayed stalled for STALL_MS, and of land runs live past LAND_STUCK_MS. */
function stallLines(now: number, jobs?: Job[]): string[] {
  if (paused()) return [];
  const old = Object.entries(readStalls()).filter(([, at]) => now - Date.parse(at) >= STALL_MS).map(([k]) => k);
  const n = (kind: string) => old.filter((k) => k.startsWith(`${kind}:`)).length;
  const lines: string[] = [];
  const slow = (jobs?.flat() ?? allRuns()).filter((e) => e.run.kind === "land" && isLive(e.folder) && now - Date.parse(e.run.started) >= LAND_STUCK_MS);
  if (n("land")) lines.push(`health: ${n("land")} passed run${n("land") > 1 ? "s" : ""} did not land in 15 minutes`);
  for (const e of slow) lines.push(`health: the land run of ${e.run.name} is live for over 30 minutes`);
  if (n("goal")) lines.push(`health: ${n("goal")} goal${n("goal") > 1 ? "s" : ""} can start, but no run started in 15 minutes`);
  if (n("ingest")) lines.push(`health: ${n("ingest")} new issue${n("ingest") > 1 ? "s" : ""} did not move to jobs in 15 minutes`);
  return lines;
}

/** The factory's health lines: stalled work, too many runs waiting for Chris, a failed probe, a red main or CI, and flakes. `jobs` and `lists` are the caller's, when it has read them already. */
export function health(now = Date.now(), o: { jobs?: Job[]; lists?: Reader } = {}): string[] {
  const lines: string[] = [];
  const lists = o.lists ?? reader();
  lines.push(...stallLines(now, o.jobs));
  const smoke = smokeLine(smokeFile());
  if (smoke) lines.push(smoke);
  const w = waiting(o.jobs);
  if (w >= AWAITING_CAP()) lines.push(`health: ${w} runs wait for Chris; no new run starts`);
  const p = lastProbe();
  if (p && !p.ok) lines.push(`health: the sandbox probe at ${p.at} failed: ${p.failed.join("; ")}`);
  for (const b of Object.values(baselines())) if (!b.ok) lines.push(`health: ${b.repo} ${redLine(b)}`);
  for (const c of redCi()) lines.push(`health: ${ciLine(c)}`);
  const counts = new Map<string, number>();
  for (const f of flakes()) if (now - Date.parse(f.at) < 7 * DAY) counts.set(`${f.repo} check ${f.check}`, (counts.get(`${f.repo} check ${f.check}`) ?? 0) + 1);
  for (const [k, n] of counts) if (n >= 2) lines.push(`health: ${k} passed on rerun ${n} times in 7 days`);
  for (const repo of factoryRepos()) {
    const doc = lists.list(repo.key);
    const tracker = doc && flakeTracker(doc);
    if (!tracker) continue;
    const files = new Set<string>();
    const tests = new Map<string, number>();
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
      const a = /^acceptance \S+: (.+?): failed/.exec(m[3]);
      if (a) tests.set(a[1], (tests.get(a[1]) ?? 0) + 1);
    }
    if (k) lines.push(`health: ${repo.key}-${tracker.id} holds ${k} flake notes in 7 days, ${files.size} test files`);
    const top = [...tests].sort((x, y) => y[1] - x[1])[0];
    if (top) lines.push(`health: most flaked in acceptance in 7 days: ${top[0]} (${top[1]} times)`);
  }
  return lines;
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

/** Insertions plus deletions in a `git show --shortstat` line. */
export const changedLinesOf = (stat: string): number =>
  [...stat.matchAll(/(\d+) (?:insertion|deletion)/g)].reduce((a, m) => a + Number(m[1]), 0);

/** The job name for an issue: its id, `aleph-28` or `aleph-28.1`. */
export const issueJob = (repo: Repo, id: number | string) => `${repo.key}-${id}`;

/** A file is busy when this many land runs of its repo conflicted on it in the last BUSY_MS. */
const BUSY_CONFLICTS = 3;

const BUSY_MS = 7 * 86_400_000;

/** The paths named in a goal's Edit surface. */
const surfaceOf = (body: string): string[] => section(body, "Edit surface").split(/[^\w./@-]+/).map((t) => t.replace(/\.+$/, "")).filter(Boolean);

/**
 * Why a goal waits for an open job: both name the same busy file in their Edit surface, so one
 * of the two lands would conflict. A job waiting for Chris does not count, as it can wait for hours.
 */
function busyWait(repo: Repo, item: issues.Issue, jobs: Job[], now = Date.now()): string | null {
  const counts = new Map<string, number>();
  for (const j of jobs) for (const { run } of j) {
    if (run.kind !== "land" || run.repo !== repo.key || now - Date.parse(run.started) > BUSY_MS) continue;
    for (const f of run.conflicts ?? []) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  const mine = surfaceOf(item.spec).filter((f) => (counts.get(f) ?? 0) >= BUSY_CONFLICTS);
  if (!mine.length) return null;
  const lists = reader({ fetch: false });
  for (const j of jobs) {
    const last = lastReal(j).run;
    const on = onOf(last);
    if (last.repo !== repo.key || on === undefined || !isOpen(j) || isAwaiting(last.condition)) continue;
    const theirs = lists.item(repo.key, on);
    const shared = theirs && surfaceOf(theirs.spec).find((f) => mine.includes(f));
    if (shared) return `waits for ${last.name}: both change the busy file ${shared}`;
  }
  return null;
}

/** The facts of a goal that the jobs and the factory's marks give; `goalDecision` takes them with the caller's own. */
export function goalFacts(repo: Repo, item: issues.Issue, jobs: Job[], now = Date.now()) {
  const name = issueJob(repo, issues.idOf(item)), runs = jobs.flat();
  return {
    name, item,
    open: openJob(name, null, jobs)?.at(-1)!.run.condition ?? null,
    busy: busyWait(repo, item, jobs, now),
    noCommits: noCommitStreak(repo.key, name, runs),
    capHeld: capMarked(name),
    startsInHour: agentStartsInHour(repo.key, name, runs, now),
  };
}

export const streakFile = (name: string) => join(factoryDir(), "streak", `${name}.txt`);
/** When the streak last set an Ask on the goal's item (ms), or null. Runs before it no longer count. */
const streakMark = (name: string): number | null => {
  if (!existsSync(streakFile(name))) return null;
  const t = Date.parse(readFileSync(streakFile(name), "utf8").trim());
  return Number.isNaN(t) ? null : t;
};

/** How many of the goal's newest agent runs since the streak's last Ask, in a row, ended with no commit. */
function noCommitStreak(repoKey: string, name: string, all: Entry[]): number {
  const mark = streakMark(name) ?? -Infinity;
  const runs = all.filter((e) => e.run.repo === repoKey && e.run.name === name && isBuild(e.run.kind) && e.run.condition !== "running" && Date.parse(e.run.started) > mark)
    .sort((a, b) => Date.parse(a.run.started) - Date.parse(b.run.started));
  let n = 0;
  for (const e of runs.reverse()) { if (causeOf(e.run) !== "no-commit") break; n++; }
  return n;
}

export const capFile = (name: string) => join(factoryDir(), "cap", `${name}.txt`);

/** Whether the cap's Ask was set for the goal and no start has followed. */
const capMarked = (name: string): boolean => existsSync(capFile(name));

/** How many agent runs of the goal started in the last 60 minutes. */
function agentStartsInHour(repoKey: string, name: string, runs: Entry[], now: number): number {
  return runs.filter((e) => e.run.repo === repoKey && e.run.name === name && isBuild(e.run.kind) && now - Date.parse(e.run.started) < 3600_000).length;
}

/** What the Status page shows of the factory, and the gate and the baselines its Queued lane reads. */
export function factorySnapshot(now: number, jobs: Job[], lists: Reader) {
  const runs = jobs.flat();
  return {
    paused: paused(),
    dayCap: DAY_CAP(),
    liveCap: LIVE_CAP(),
    liveRuns: liveRuns(runs),
    awaitingCap: AWAITING_CAP(),
    runsToday: runsToday(now, runs).length,
    costToday: spentToday(now, runs),
    probe: lastProbe(),
    health: health(now, { jobs, lists }),
    hold: hold(jobs)?.line ?? null,
    firefighter: firefighterLines(now),
    gated: gates({ jobs }),
    baselines: baselines(),
  };
}
