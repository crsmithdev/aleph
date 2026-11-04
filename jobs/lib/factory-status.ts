/**
 * The factory's status: what its files in ~/.aleph/factory and the ledger say
 * now. `factorySnapshot` is the one read the Status page needs; the rest are the
 * queries and the gates. It imports no transition, so aleph-ui can load it, and
 * a change to the actions does not restart aleph-ui. The actions are in factory.ts.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { reader } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { surfacePaths } from "./goal-spec.ts";
import { ciLine, redCi } from "./ci.ts";
import { git } from "./git.ts";
import { isOpen, lastReal, openJob, type Job } from "./job.ts";
import type { Bound, Gate } from "./goal-decision.ts";
import { layout, readFactoryLog } from "./layout.ts";
import { allRuns, isAwaiting, isBuild, loadRegistry, lock, onOf, type Entry, type Repo } from "./ledger.ts";
import { isLive, isStarting } from "./process.ts";
import { causeOf } from "./outcome.ts";
import { smokeLine } from "./smoke.ts";
import { LIVE_CAP, suiteBudgetSeconds } from "./settings.ts";

export const factoryDir = () => layout().factory;

const pauseFile = () => join(factoryDir(), "paused");

export const probeFile = () => join(factoryDir(), "probe.json");

export const holdsFile = () => join(factoryDir(), "holds.jsonl");

/** One record of why a goal waits: `kind` is the gate that bound, or `started`. Records from before v6 name older kinds. */
export interface HoldRecord { at: string; name: string; kind: string; text: string }

/** The hold record kinds from before the 7 gates that did not stop a start: the goal was done, or its job was open. */
const OLD_NOT_HELD = new Set(["open", "start", "done"]);

/** Whether a record stopped a goal that could have started: not `started`, not a done goal, not a goal whose job is open. */
export const stopsStart = (r: HoldRecord): boolean =>
  r.kind !== "started" && !OLD_NOT_HELD.has(r.kind) && !(r.kind === "not-ready" && /^(its job is |the item is already done$)/.test(r.text));

/** Every record of the holds file, oldest first; a line that does not parse is skipped. */
export function allHolds(): HoldRecord[] {
  let raw: string;
  try { raw = readFileSync(holdsFile(), "utf8"); } catch { return []; }
  const out: HoldRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as HoldRecord); } catch { /* skip */ }
  }
  return out;
}

/** The records of the given goals, oldest first. */
export function readHolds(names: string[]): HoldRecord[] {
  const set = new Set(names);
  return allHolds().filter((r) => set.has(r.name));
}

/** Appends one record of why a goal waits (or, with kind `started`, that it no longer does), unless it repeats the name's last record. */
export function recordHold(name: string, kind: Gate | "started", text: string): void {
  const last = readHolds([name]).at(-1);
  if (last && last.kind === kind && last.text === text) return;
  mkdirSync(factoryDir(), { recursive: true });
  appendFileSync(holdsFile(), JSON.stringify({ at: new Date().toISOString(), name, kind, text }) + "\n");
}

const DAY = 24 * 3600_000;

export const paused = () => existsSync(pauseFile());

/** Pauses the factory (the `paused` file holds the time) or, with `on` false, resumes it. */
export function setPaused(on: boolean): void {
  mkdirSync(factoryDir(), { recursive: true });
  if (on) writeFileSync(pauseFile(), new Date().toISOString() + "\n");
  else rmSync(pauseFile(), { force: true });
}

const sandboxRepos = () => Object.values(loadRegistry()).filter((r) => r.sandbox);

/** The registry's factory repos: those whose runs are sandboxed. */
export const factoryRepos = sandboxRepos;

/** Factory agent and triage runs started in the last 24 hours. */
/** `runs` is every run, when the caller has read them already. */
export function runsToday(now = Date.now(), runs: Entry[] = allRuns()): Entry[] {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  return runs.filter((e) => (isBuild(e.run.kind) || e.run.kind === "triage" || e.run.kind === "plan") && e.run.repo && keys.has(e.run.repo) && now - Date.parse(e.run.started) < DAY);
}

/** The spec checks' spend: one line per check that reported a cost. A spec check is no run, so it has no run folder to hold its cost. */
const specCostsFile = () => join(factoryDir(), "spec-checks.jsonl");

/** Records the dollars of one spec check of goal `name`, which `spentToday` counts and `runsToday` does not. */
export function recordSpecCost(name: string, cost: number): void {
  mkdirSync(factoryDir(), { recursive: true });
  appendFileSync(specCostsFile(), JSON.stringify({ at: new Date().toISOString(), name, cost }) + "\n");
}

/** The dollars of the spec checks recorded in the 24 hours before `now`. */
function specSpent(now: number): number {
  let raw: string;
  try { raw = readFileSync(specCostsFile(), "utf8"); } catch { return 0; }
  let sum = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      const at = Date.parse(r.at);
      if (typeof r.cost === "number" && at <= now && now - at < DAY) sum += r.cost;
    } catch {}
  }
  return sum;
}

/** The dollars of the runs started in the last 24 hours: `runsToday`, and the firefighter and director runs (and the explain runs from before the director), which `runsToday` does not count, and the spec checks. A director run has no repo (its `on` is an item ref, a run folder or a lesson id), so it is not filtered by one, as a firefighter run is not. */
export function spentToday(now = Date.now(), runs: Entry[] = allRuns()): number {
  const others = runs.filter((e) => (e.run.kind === "firefighter" || e.run.kind === "director" || e.run.kind === "explain") && now - Date.parse(e.run.started) < DAY);
  return [...runsToday(now, runs), ...others].reduce((a, e) => a + (e.run.cost ?? 0), 0) + specSpent(now);
}

/** Agent runs live now, and those started whose unit has not written `pid` yet. */
export const liveEntries = (runs: Entry[] = allRuns()): Entry[] => runs.filter((e) => isBuild(e.run.kind) && (isLive(e.folder) || isStarting(e)));

export const liveRuns = (runs?: Entry[]): number => liveEntries(runs).length;

/** The gates of the whole factory, in the order of GATES: the others are each goal's own. */
export const FACTORY_GATES = ["pause", "probe", "live-cap"] as const satisfies readonly Gate[];

export type FactoryGate = (typeof FACTORY_GATES)[number];

/** The probe gate: binds while the last sandbox probe failed. One file read. */
export function probeGate(): Bound | null {
  const p = lastProbe();
  if (!p || p.ok) return null;
  const why = `the sandbox probe at ${p.at} failed: ${p.failed.join("; ")}`;
  return { why, text: why };
}

/** Each factory gate that binds now, or null: the pause, a failed probe, the live cap. `jobs`, when given, hold every run. */
export function factoryGates(jobs?: Job[]): Record<FactoryGate, Bound | null> {
  const live = liveRuns(jobs?.flat());
  return {
    pause: paused() ? { why: "paused", text: "The factory is paused" } : null,
    probe: probeGate(),
    "live-cap": live >= LIVE_CAP() ? { why: `${live} agent runs are live`, text: `Waiting for a slot (${live} of ${LIVE_CAP()} running)` } : null,
  };
}

/**
 * The first factory gate that binds, in the order of FACTORY_GATES, or null. `only` limits it to some of them (a caller
 * whose other gates do not apply); `jobs` are factoryGates'.
 */
export function gates(opts: { only?: readonly FactoryGate[]; jobs?: Job[] } = {}): ({ gate: FactoryGate } & Bound) | null {
  const on = (g: FactoryGate) => !opts.only || opts.only.includes(g);
  // Each gate is read only when asked: the pause is one stat, and the dispatch asks it first.
  if (on("pause") && paused()) return { gate: "pause", why: "paused", text: "The factory is paused" };
  const rest = FACTORY_GATES.filter((g) => g !== "pause" && on(g));
  if (!rest.length) return null;
  const all = factoryGates(opts.jobs);
  for (const g of rest) if (all[g]) return { gate: g, ...all[g]! };
  return null;
}

/** Add a row to flaky.json under a lock, because runs in other processes add rows too. Returns false when the lock stays busy. */
export async function recordFlake(row: Flake): Promise<boolean> {
  const release = await lock("flaky");
  if (!release) return false;
  try {
    mkdirSync(factoryDir(), { recursive: true });
    const tmp = `${flakyFile()}.tmp`;
    writeFileSync(tmp, JSON.stringify([...flakes(), row], null, 2) + "\n");
    renameSync(tmp, flakyFile());
    return true;
  } finally {
    release();
  }
}

export interface Flake { repo: string; check: string; run: string; at: string; tests?: string[] }
const flakyFile = () => join(factoryDir(), "flaky.json");
export const flakes = (): Flake[] => {
  try { return JSON.parse(readFileSync(flakyFile(), "utf8")); } catch { return []; }
};

export interface Baseline { repo: string; commit: string; ok: boolean; failed?: string }

const baselineFile = () => join(factoryDir(), "baseline.json");

export const baselines = (): Record<string, Baseline> => {
  try { return JSON.parse(readFileSync(baselineFile(), "utf8")); } catch { return {}; }
};

/**
 * The one write of baseline.json. Under one lock for the whole file, it reads the entries, lets `decide` turn the
 * repo's old entry into its new one (null leaves the file alone), and writes a temp file that it renames over
 * baseline.json, so a reader never sees a half-written file. Returns whether it wrote.
 */
export async function writeBaseline(key: string, decide: (old: Baseline | undefined) => Baseline | null): Promise<boolean> {
  const release = await lock("baseline-file");
  if (!release) throw new Error("baseline.json lock busy");
  try {
    const all = baselines();
    const next = decide(all[key]);
    if (!next) return false;
    mkdirSync(factoryDir(), { recursive: true });
    const tmp = `${baselineFile()}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...all, [key]: next }, null, 2) + "\n");
    renameSync(tmp, baselineFile());
    return true;
  } finally {
    release();
  }
}

export const redLine = (b: Baseline) => `main is red at ${b.commit.slice(0, 7)}: ${b.failed}`;

/** A red main: a failed baseline or a red GitHub CI streak. `id` names the red commit or streak; `line` says it with the repo. */
export interface RedMain { repo: string; source: "baseline" | "ci"; id: string; line: string }

/** Every red main now, the baselines first: what the health lines and the Gates page report, and the firefighter files. */
export function redMains(): RedMain[] {
  const base = Object.values(baselines()).filter((b) => !b.ok)
    .map((b): RedMain => ({ repo: b.repo, source: "baseline", id: `red:${b.repo}:${b.commit}`, line: `${b.repo} ${redLine(b)}` }));
  const ci = redCi().map((c): RedMain => ({ repo: c.repo, source: "ci", id: `ci:${c.repo}:${c.sinceSha}:${c.sha}`, line: ciLine(c) }));
  return [...base, ...ci];
}

/**
 * The red line that stops a goal start, per repo: its baseline failed and origin/<main> is still that commit. A red
 * record for an older commit no longer counts; the next baseline checks the new one. One rev-parse per repo per query.
 */
export function mainRed(): (repo: Repo) => string | null {
  const base = baselines(), reds = new Map<string, string | null>();
  return (repo) => {
    if (!reds.has(repo.key)) {
      const b = base[repo.key];
      reds.set(repo.key, b && !b.ok && git(repo.path, "rev-parse", `origin/${repo.main}`).out === b.commit ? redLine(b) : null);
    }
    return reds.get(repo.key)!;
  };
}

/** `repo` and `commit` say what the probe ran on: origin/<main> of that repo. Older records lack them. */
export interface Probe { at: string; ok: boolean; failed: string[]; repo?: string; commit?: string }

export function saveProbe(p: Probe): void {
  mkdirSync(factoryDir(), { recursive: true });
  writeFileSync(probeFile(), JSON.stringify(p, null, 2) + "\n");
}

export const lastProbe = (): Probe | null => {
  try { return JSON.parse(readFileSync(probeFile(), "utf8")); } catch { return null; }
};

/** How long work may wait with nothing moving before it is stalled: three ticks. */
const STALL_MS = 15 * 60_000;

/** A land run live for longer than this is stuck: 99% of land runs end within 20 minutes. */
export const LAND_STUCK_MS = 30 * 60_000;

const stallFile = () => join(factoryDir(), "stalls.json");

/** The tick's record of stalled work: each key with the time a tick first saw it. */
export function writeStalls(stalls: Record<string, string>): void {
  mkdirSync(factoryDir(), { recursive: true });
  writeFileSync(stallFile(), JSON.stringify(stalls));
}

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

/** The names a flake row stands for: one per test it names, or its check when it names none. */
export function flakeNames(f: Flake): { kind: "test" | "check"; name: string }[] {
  const tests = [...new Set(f.tests ?? [])];
  return tests.length ? tests.map((name) => ({ kind: "test" as const, name })) : [{ kind: "check", name: f.check }];
}

/**
 * A health line for each repo whose last full suite took more than the budget. The full suite is
 * the check named `tests` or `test`. Only a pass on the first try counts: a rerun doubles the time.
 */
export function suiteLines(runs: Entry[] = allRuns()): string[] {
  const last = new Map<string, { at: string; seconds: number }>();
  for (const { run } of runs) {
    const c = run.repo && (run.checks ?? []).find((c) => /^tests?$/.test(c.name) && c.ok && !c.rerun);
    if (!c) continue;
    const at = run.ended ?? run.started;
    if (at >= (last.get(run.repo!)?.at ?? "")) last.set(run.repo!, { at, seconds: c.seconds });
  }
  const budget = suiteBudgetSeconds();
  return [...last].filter(([, s]) => s.seconds > budget).map(([repo, s]) => `health: ${repo} full suite took ${s.seconds} s; the budget is ${budget} s`);
}

/**
 * The factory's health lines: stalled work, a failed probe, a red main or CI and a slow
 * full suite. The flake counts are the monitor's (monitor-table.ts). `jobs` is the
 * caller's, when it has read them already.
 */
export function health(now = Date.now(), o: { jobs?: Job[] } = {}): string[] {
  const lines: string[] = [];
  lines.push(...stallLines(now, o.jobs));
  lines.push(...suiteLines(o.jobs?.flat()));
  const smoke = smokeLine();
  if (smoke) lines.push(smoke);
  const p = lastProbe();
  if (p && !p.ok) lines.push(`health: the sandbox probe at ${p.at} failed: ${p.failed.join("; ")}`);
  for (const r of redMains()) lines.push(`health: ${r.line}`);
  return lines;
}

/** The firefighter's lines of the factory log in the last 24 hours, newest last, at most `n`: what the Status page shows. */
export function firefighterLines(now = Date.now(), n = 8): { at: string; line: string }[] {
  const text = readFactoryLog();
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
  const mine = surfacePaths(item.spec).filter((f) => (counts.get(f) ?? 0) >= BUSY_CONFLICTS);
  if (!mine.length) return null;
  const lists = reader({ fetch: false });
  for (const j of jobs) {
    const last = lastReal(j).run;
    const on = onOf(last);
    if (last.repo !== repo.key || on === undefined || !isOpen(j) || isAwaiting(last.condition)) continue;
    const theirs = lists.item(repo.key, on);
    const shared = theirs && surfacePaths(theirs.spec).find((f) => mine.includes(f));
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

const streakFile = (name: string) => join(factoryDir(), "streak", `${name}.txt`);
/** Marks now as when the streak set an Ask on the goal's item. */
export function markStreak(name: string): void {
  mkdirSync(dirname(streakFile(name)), { recursive: true });
  writeFileSync(streakFile(name), new Date().toISOString() + "\n");
}

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

const capFile = (name: string) => join(factoryDir(), "cap", `${name}.txt`);

/** Marks that the cap's Ask was set for the goal. */
export function markCap(name: string): void {
  mkdirSync(dirname(capFile(name)), { recursive: true });
  writeFileSync(capFile(name), new Date().toISOString() + "\n");
}

/** Clears the cap mark: a start has followed the Ask. */
export function clearCap(name: string): void {
  rmSync(capFile(name), { force: true });
}

/** Whether the cap's Ask was set for the goal and no start has followed. */
const capMarked = (name: string): boolean => existsSync(capFile(name));

/** How many agent runs of the goal started in the last 60 minutes. */
function agentStartsInHour(repoKey: string, name: string, runs: Entry[], now: number): number {
  return runs.filter((e) => e.run.repo === repoKey && e.run.name === name && isBuild(e.run.kind) && now - Date.parse(e.run.started) < 3600_000).length;
}

/** What the Status page shows of the factory, and the gate and the baselines its Queued lane reads. */
export function factorySnapshot(now: number, jobs: Job[]) {
  const runs = jobs.flat();
  return {
    paused: paused(),
    liveCap: LIVE_CAP(),
    liveRuns: liveRuns(runs),
    runsToday: runsToday(now, runs).length,
    costToday: spentToday(now, runs),
    probe: lastProbe(),
    health: health(now, { jobs }),
    firefighter: firefighterLines(now),
    gated: factoryGates(jobs),
    baselines: baselines(),
  };
}
