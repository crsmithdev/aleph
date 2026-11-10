/**
 * The factory's status: what its files in ~/.aleph/factory and the ledger say
 * now. `factorySnapshot` is the one read the Status page needs; the rest are the
 * queries and the gates. It imports no transition, so aleph-ui can load it, and
 * a change to the actions does not restart aleph-ui. The actions are in factory.ts.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { areasOf, reader } from "../../../issues/lib/store.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { surfacePaths } from "../roles/issue-spec.ts";
import { ciLine, redCi } from "./ci.ts";
import { isOpen, lastReal, openJob, type Job } from "../records/job.ts";
import type { Bound, Gate, Hold } from "./issue-decision.ts";
import { event, type Event } from "../../../lib/naming.ts";
import { layout, logEvent, readEvents } from "../infra/layout.ts";
import * as record from "../records/record.ts";
import { allRuns, held, jobIdOf, isWaiting, isBuild, loadRegistry, lock, onOf, tell, type Entry, type Repo, type Run } from "../records/ledger.ts";
import { isLive, isStarting } from "../infra/process.ts";
import { causeOf } from "../records/outcome.ts";
import { smokeLine } from "./smoke.ts";
import { LIVE_CAP, LOCAL_CAP, RUN_CAP, suiteBudgetSeconds } from "../infra/settings.ts";
import { BACKENDS, probeBackend, readModels, viaOfRun, type Setting, type Tier, type Via } from "../routing/models.ts";

export const factoryDir = () => layout().factory;

const pauseFile = () => join(factoryDir(), "paused");

/** One record of why an issue waits: `kind` is the gate that bound, or `started`; `event` its log event, which a `started` record lacks. Records from before v6 name older kinds. */
export interface HoldRecord { at: string; name: string; kind: string; text: string; event?: Event }

/** The hold record kinds from before the 7 gates that did not stop a start: the issue was done, or its job was open. */
const OLD_NOT_HELD = new Set(["open", "start", "done"]);

/** Whether a record stopped an issue that could have started: not `started`, not a done issue, not an issue whose job is open. */
export const stopsStart = (r: HoldRecord): boolean =>
  r.kind !== "started" && !OLD_NOT_HELD.has(r.kind) && !(r.kind === "not-ready" && /^(its job is |the item is already done$)/.test(r.text));

/** The hold records of a job record: its `hold` and `started` events. */
const holdsOf = (r: record.JobRecord): HoldRecord[] =>
  r.events.filter((e) => e.kind === "hold" || e.kind === "started")
    .map((e) => {
      const d = e.data as { gate: string; event?: Event } | undefined;
      return { at: e.at, name: r.issue, kind: e.kind === "started" ? "started" : d!.gate, text: e.what, ...(d?.event ? { event: d.event } : {}) };
    });

/** Every hold record of every job, oldest first. */
export function allHolds(): HoldRecord[] {
  return record.all().flatMap(holdsOf).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** The hold records of the given issues, oldest first. */
export function readHolds(names: string[]): HoldRecord[] {
  return [...new Set(names)].flatMap((n) => { const r = record.read(n); return r ? holdsOf(r) : []; })
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/**
 * Records why an issue waits (or, with kind `started`, that it no longer does) in its job record: an event, unless it
 * repeats the last one, and `wait`, which a record that stops a start sets and any other clears. `ev` gives the hold's
 * log event, by `gate` on the issue.
 */
export function recordHold(name: string, kind: Gate | "started", text: string, ev?: Hold): void {
  const at = new Date().toISOString();
  const logged = ev && event({ at, by: "gate", subject: name, ...ev });
  record.update(name, (r) => {
    const last = holdsOf(r).at(-1);
    if (last && last.kind === kind && last.text === text) return;
    if (logged) logEvent(logged);
    r.events.push(kind === "started" ? { at, kind: "started", what: text } : { at, kind: "hold", what: text, data: { gate: kind, ...(logged ? { event: logged } : {}) } });
    r.wait = stopsStart({ at, name, kind, text }) ? { kind, reason: text, since: at } : null;
  });
}

const DAY = 24 * 3600_000;

export const paused = () => existsSync(pauseFile());

/** Pauses the factory (the `paused` file holds the time) or, with `on` false, resumes it. */
export function setPaused(on: boolean): void {
  mkdirSync(factoryDir(), { recursive: true });
  if (on) writeFileSync(pauseFile(), new Date().toISOString() + "\n");
  else rmSync(pauseFile(), { force: true });
}

/** The backend the factory holds after a run stopped with the credit cause: `via` is the backend, `why` the run's line. */
export interface BackendHold { via: Via; why: string; since: string }

const holdFile = () => join(factoryDir(), "backend-hold.json");

/** The backend the factory holds now, or null. */
export function backendHold(): BackendHold | null {
  try {
    const h = JSON.parse(readFileSync(holdFile(), "utf8"));
    return h && typeof h.via === "string" ? h : null;
  } catch { return null; }
}

/** The line the hold gives a run on its backend. */
const holdBound = (h: BackendHold): Bound =>
  ({ why: `waits for ${BACKENDS[h.via]}: ${h.why}`, text: `Waiting for ${BACKENDS[h.via]}: ${h.why}`, ev: { action: "waiting", count: `for ${BACKENDS[h.via]}` } });

/**
 * The backend hold of an issue with no run yet, whose backend only routing names: it binds when this hold already held
 * the issue, so the dispatch does not route the issue again while the hold lasts.
 */
export function heldGoal(name: string): Bound | null {
  const h = backendHold(), w = record.read(name)?.wait;
  return h && w?.kind === "backend" && w.since >= h.since ? holdBound(h) : null;
}

/**
 * Holds the backend of a run that stopped with the credit cause, and tells Chris once. A backend already held keeps
 * its line, so the jobs that follow it write no second alert.
 */
export async function holdBackend(via: Via, why: string): Promise<void> {
  if (backendHold()?.via === via) return;
  mkdirSync(factoryDir(), { recursive: true });
  writeFileSync(holdFile(), JSON.stringify({ via, why, since: new Date().toISOString() }) + "\n");
  logEvent({ by: "rule", subject: via, action: "paused", sub: "credit", note: `held ${BACKENDS[via]}: ${why}` });
  await tell(`the factory holds ${BACKENDS[via]}: ${why}`);
}

/** Probes the held backend and lifts the hold when it answers, with one line. Returns that line, or null. */
export async function probeHold(up: (via: Via) => Promise<boolean> = probeBackend): Promise<string | null> {
  const h = backendHold();
  if (!h || !(await up(h.via))) return null;
  rmSync(holdFile(), { force: true });
  const line = `${BACKENDS[h.via]} answers again: the hold is off`;
  logEvent({ by: "rule", subject: h.via, action: "reran", note: line });
  return line;
}

const sandboxRepos = () => Object.values(loadRegistry()).filter((r) => r.sandbox);

/** The registry's factory repos: those whose runs are sandboxed. */
export const factoryRepos = sandboxRepos;

/** Factory agent and intake runs (triage and planner runs before them) started in the last 24 hours. */
/** `runs` is every run, when the caller has read them already. */
export function runsToday(now = Date.now(), runs: Entry[] = allRuns()): Entry[] {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  return runs.filter((e) => (isBuild(e.run.kind) || e.run.kind === "intake") && e.run.repo && keys.has(e.run.repo) && now - Date.parse(e.run.started) < DAY);
}

/** The dollars of the runs started in the last 24 hours: `runsToday`, and the firefighter and director runs (and the explain runs from before the director), which `runsToday` does not count. A director run has no repo (its `on` is an item ref, a run folder or a lesson id), so it is not filtered by one, as a firefighter run is not. */
export function spentToday(now = Date.now(), runs: Entry[] = allRuns()): number {
  const others = runs.filter((e) => (e.run.kind === "director") && now - Date.parse(e.run.started) < DAY);
  return [...runsToday(now, runs), ...others].reduce((a, e) => a + (e.run.cost ?? 0), 0);
}

/** Agent runs live now, and those started whose unit has not written `pid` yet. */
export const liveEntries = (runs: Entry[] = allRuns()): Entry[] => runs.filter((e) => isBuild(e.run.kind) && (isLive(e.folder) || isStarting(e)));

/** Whether a build run is on the local backend: unit.ts sets its model to its tier's, and before that its tier's model is the local one. */
export const onLocal = (run: Pick<Run, "model" | "merge">, models: Record<Tier, Setting>): boolean => viaOfRun(run, models) === "local";

/** Live agent runs on Claude, the count the live cap checks: a local-backend run counts against LOCAL_CAP only. */
export const liveRuns = (runs?: Entry[]): number => { const models = readModels(); return liveEntries(runs).filter((e) => !onLocal(e.run, models)).length; };

/** Live agent runs on the local backend, the count LOCAL_CAP checks. */
export const liveLocal = (runs?: Entry[], models = readModels()): number => liveEntries(runs).filter((e) => onLocal(e.run, models)).length;

/**
 * Takes the GPU slot for one local call: no local agent run is live and the `gpu` lock is free. Waits up to `waitMs`;
 * null when the slot stays taken. The caller calls the release when its call ends.
 */
export async function gpuSlot(waitMs: number): Promise<(() => void) | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    // Take the lock first: a local run's start holds it from its cap check until its run record is written.
    const release = await lock("gpu", 0);
    if (release) {
      if (liveLocal() < LOCAL_CAP) return release;
      release();
    }
    if (Date.now() >= deadline) return null;
    await Bun.sleep(100);
  }
}

const PAUSED: Bound = { why: "paused", text: "The factory is paused", ev: { action: "paused" } };

/** The gates of the whole factory, in the order of GATES: the others are each issue's own. */
export const FACTORY_GATES = ["pause", "backend", "live-cap"] as const satisfies readonly Gate[];

export type FactoryGate = (typeof FACTORY_GATES)[number];

/**
 * Each factory gate that binds now, or null: the pause, the backend the factory holds, the live cap. `jobs`, when given,
 * hold every run. `run`, when given, is the run to start: the backend gate binds on the backend it runs on, and on the
 * local backend the live cap is LOCAL_CAP over the live local runs and a held `gpu` lock.
 */
export function factoryGates(jobs?: Job[], run?: Pick<Run, "model" | "merge">): Record<FactoryGate, Bound | null> {
  const models = readModels();
  const hold = backendHold();
  const local = run !== undefined && onLocal(run, models);
  // A title or judge call holds the `gpu` lock while it runs on the local backend: it takes the GPU slot as a local run does.
  const call = local && held("gpu");
  const live = local ? liveLocal(jobs?.flat(), models) + (call ? 1 : 0) : liveRuns(jobs?.flat());
  const bound: Bound = local
    ? { why: call ? "a local call holds the GPU" : `${live} local agent runs are live`, text: `Waiting for the GPU slot (${live} of ${LOCAL_CAP} running)`, ev: call ? { action: "gpu" } : { action: "full", sub: "local", count: `${live} / ${LOCAL_CAP}` } }
    : { why: `${live} agent runs are live`, text: `Waiting for a slot (${live} of ${LIVE_CAP()} running)`, ev: { action: "full", count: `${live} / ${LIVE_CAP()}` } };
  return {
    pause: paused() ? PAUSED : null,
    backend: hold && run !== undefined && viaOfRun(run, models) === hold.via ? holdBound(hold) : null,
    "live-cap": live >= (local ? LOCAL_CAP : LIVE_CAP()) ? bound : null,
  };
}

/**
 * The first factory gate that binds, in the order of FACTORY_GATES, or null. `only` limits it to some of them (a caller
 * whose other gates do not apply); `jobs` and `run` are factoryGates'.
 */
export function gates(opts: { only?: readonly FactoryGate[]; jobs?: Job[]; run?: Pick<Run, "model" | "merge"> } = {}): ({ gate: FactoryGate } & Bound) | null {
  const on = (g: FactoryGate) => !opts.only || opts.only.includes(g);
  // Each gate is read only when asked: the pause is one stat, and the dispatch asks it first.
  if (on("pause") && paused()) return { gate: "pause", ...PAUSED };
  const rest = FACTORY_GATES.filter((g) => g !== "pause" && on(g));
  if (!rest.length) return null;
  const all = factoryGates(opts.jobs, opts.run);
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

/** `config`: the setup and checks the record ran, as JSON; a record from before it has none. */
export interface Baseline { repo: string; commit: string; config?: string; ok: boolean; failed?: string }

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

/** One full suite run: the test counts of its bun test checks, and the tests that failed on the first run and passed on the rerun. */
export interface SuiteRecord { repo: string; commit: string; at: string; ran: number; passed: number; failed: number; skipped: number; rerunPassed: number }

const historyFile = () => join(factoryDir(), "suite-history.jsonl");

/** The suite records in the order they were appended, of `repo` when given. */
export const suiteHistory = (repo?: string): SuiteRecord[] => {
  try {
    const all: SuiteRecord[] = readFileSync(historyFile(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    return repo ? all.filter((r) => r.repo === repo) : all;
  } catch { return []; }
};

export const appendSuiteHistory = (r: SuiteRecord): void => {
  mkdirSync(factoryDir(), { recursive: true });
  appendFileSync(historyFile(), JSON.stringify(r) + "\n");
};

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
 * The red line that stops an issue start, per repo: its last baseline failed. The full suite runs on its own timer, so a
 * red record stays until a later suite run is green, also when main has moved since.
 */
export function mainRed(): (repo: Repo) => string | null {
  const base = baselines();
  return (repo) => {
    const b = base[repo.key];
    return b && !b.ok ? redLine(b) : null;
  };
}

/** How long work may wait with nothing moving before it is stalled: 15 minutes. */
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

/** A health line: its text, its kind, and for an alert the key the status sentence ranks it by (lib/status-words.ts). */
export interface Health { text: string; kind: "alert" | "warn"; key?: string }
const alert = (key: string, text: string): Health => ({ text, kind: "alert", key });

/** The health lines of work that stayed stalled for STALL_MS, and of land runs live past LAND_STUCK_MS. */
export function stallLines(now: number, jobs?: Job[]): Health[] {
  if (paused()) return [];
  const old = Object.entries(readStalls()).filter(([, at]) => now - Date.parse(at) >= STALL_MS).map(([k]) => k);
  const n = (kind: string) => old.filter((k) => k.startsWith(`${kind}:`)).length;
  const lines: Health[] = [];
  const slow = (jobs?.flat() ?? allRuns()).filter((e) => e.run.kind === "land" && isLive(e.folder) && now - Date.parse(e.run.started) >= LAND_STUCK_MS);
  if (n("land")) lines.push(alert("lands-stuck", `health: ${n("land")} passed run${n("land") > 1 ? "s" : ""} did not land in 15 minutes`));
  for (const e of slow) lines.push(alert("lands-stuck", `health: the land run of ${e.run.name} is live for over 30 minutes`));
  if (n("goal")) lines.push(alert("queue-stuck", `health: ${n("goal")} goal${n("goal") > 1 ? "s" : ""} can start, but no run started in 15 minutes`));
  if (n("ingest")) lines.push(alert("issues-stuck", `health: ${n("ingest")} new issue${n("ingest") > 1 ? "s" : ""} did not move to jobs in 15 minutes`));
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
export function suiteLines(runs: Entry[] = allRuns()): Health[] {
  const last = new Map<string, { at: string; seconds: number }>();
  for (const { run } of runs) {
    const c = run.repo && (run.checks ?? []).find((c) => /^tests?$/.test(c.name) && c.ok && !c.rerun && c.files === undefined);
    if (!c) continue;
    const at = run.ended ?? run.started;
    if (at >= (last.get(run.repo!)?.at ?? "")) last.set(run.repo!, { at, seconds: c.seconds });
  }
  const budget = suiteBudgetSeconds();
  return [...last].filter(([, s]) => s.seconds > budget).map(([repo, s]): Health => ({ text: `health: ${repo} full suite took ${s.seconds} s; the budget is ${budget} s`, kind: "warn" }));
}

/**
 * The factory's health lines: stalled work, a red main or CI and a slow
 * full suite. The flake counts are the monitor's (monitor-table.ts). `jobs` is the
 * caller's, when it has read them already.
 */
export function health(now = Date.now(), o: { jobs?: Job[] } = {}): Health[] {
  const lines: Health[] = [];
  lines.push(...stallLines(now, o.jobs));
  lines.push(...suiteLines(o.jobs?.flat()));
  const smoke = smokeLine();
  if (smoke) lines.push({ text: smoke, kind: "alert" });
  for (const r of redMains()) lines.push({ text: `health: ${r.line}`, kind: r.repo === "aleph" ? "alert" : "warn", key: r.source === "ci" ? "red-ci" : "red-main" });
  return lines;
}

/** The firefighter's lines of the factory log in the last 24 hours, newest last, at most `n`: what the Status page shows. An event shows its note. */
export function firefighterLines(now = Date.now(), n = 8): { at: string; line: string }[] {
  const events = readEvents(now - DAY).filter((e) => e.by === "firefighter").map((e) => ({ at: e.at, line: `firefighter: ${e.note ?? `${e.action} ${e.subject}`}` }));
  return events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).slice(-n);
}

/** Insertions plus deletions in a `git show --shortstat` line. */
export const changedLinesOf = (stat: string): number =>
  [...stat.matchAll(/(\d+) (?:insertion|deletion)/g)].reduce((a, m) => a + Number(m[1]), 0);

/** The job name for an issue: its id, `aleph-28` or `aleph-28.1`. */
export const issueJob = (repo: Repo, id: number | string) => `${repo.key}-${id}`;

/** A file is busy when this many land runs of its repo conflicted on it in the last BUSY_MS. */
const BUSY_CONFLICTS = 3;

const BUSY_MS = 7 * 86_400_000;

/** The first open job of the repo, not waiting for Chris, whose issue `shares` something with the issue; `file` says what. */
function openWait(repo: Repo, jobs: Job[], shares: (theirs: issues.Issue) => { file: string; what: string } | undefined): { why: string; on: string; file: string } | null {
  const lists = reader({ fetch: false });
  for (const j of jobs) {
    const last = lastReal(j).run;
    const on = onOf(last);
    if (last.repo !== repo.key || on === undefined || !isOpen(j) || isWaiting(last.condition)) continue;
    const theirs = lists.item(repo.key, on);
    const s = theirs && shares(theirs);
    if (s) return { why: `waits for ${last.name}: ${s.what}`, on: last.name, file: s.file };
  }
  return null;
}

/** Whether an issue uses the gpt-oss server: its spec names the server, or it carries the area local-model. */
const usesGptOss = (item: issues.Issue): boolean =>
  /aleph-gpt-oss|127\.0\.0\.1:8012/.test(item.spec) || areasOf(item).includes("local-model");

/**
 * Why an issue waits for an open job: both name the same busy file in their Edit surface, so one
 * of the two lands would conflict; or both use the gpt-oss server, which runs one build at a time.
 * A job waiting for Chris does not count, as it can wait for hours.
 */
function busyWait(repo: Repo, item: issues.Issue, jobs: Job[], now = Date.now()) {
  const counts = new Map<string, number>();
  for (const j of jobs) for (const { run } of j) {
    if (run.kind !== "land" || run.repo !== repo.key || now - Date.parse(run.started) > BUSY_MS) continue;
    for (const f of run.conflicts ?? []) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  const mine = surfacePaths(item.spec).filter((f) => (counts.get(f) ?? 0) >= BUSY_CONFLICTS);
  const busy = (f: string | undefined) => (f ? { file: f, what: `both change the busy file ${f}` } : undefined);
  const file = mine.length ? openWait(repo, jobs, (theirs) => busy(surfacePaths(theirs.spec).find((p) => mine.includes(p)))) : null;
  return file ?? (usesGptOss(item) ? openWait(repo, jobs, (theirs) => usesGptOss(theirs) ? { file: "gpt-oss", what: "both use the gpt-oss server" } : undefined) : null);
}

/**
 * The run an issue would start next: its newest build run, whose model says which backend the issue runs on. Null when the
 * issue has no run yet, so a gate that asks the run to start reads nothing.
 */
export function nextRun(repoKey: string, name: string, jobs: Job[]): Run | null {
  return jobs.flat().filter((e) => e.run.repo === repoKey && e.run.name === name && isBuild(e.run.kind))
    .sort((a, b) => Date.parse(a.run.started) - Date.parse(b.run.started)).at(-1)?.run ?? null;
}

/** The facts of an issue that the jobs and the factory's marks give; `issueDecision` takes them with the caller's own. */
export function issueFacts(repo: Repo, item: issues.Issue, jobs: Job[], now = Date.now()) {
  const name = issueJob(repo, issues.idOf(item)), runs = jobs.flat(), open = openJob(name, null, jobs);
  return {
    name, item,
    open: open?.at(-1)!.run.condition ?? null,
    job: open ? jobIdOf(open[0], runs) : null,
    busy: busyWait(repo, item, jobs, now),
    noCommits: noCommitStreak(repo.key, name, runs),
    capHeld: capMarked(name),
    startsInHour: agentStartsInHour(repo.key, name, jobs, now),
    creditWait: creditWait(repo.key, name, runs, now),
  };
}

/** Marks now as when the streak set an Ask on the issue's item: a `streak` event in its job record. */
export function markStreak(name: string): void {
  record.addEvent(name, { kind: "streak", what: "the no-commit streak set an Ask" });
}

/** When the streak last set an Ask on the issue's item (ms), or null. Runs before it no longer count. */
const streakMark = (name: string): number | null => {
  const e = record.lastEvent(name, "streak");
  return e ? Date.parse(e.at) : null;
};

/** How many of the issue's newest agent runs since the streak's last Ask, in a row, ended with no commit. */
function noCommitStreak(repoKey: string, name: string, all: Entry[]): number {
  const mark = streakMark(name) ?? -Infinity;
  const runs = all.filter((e) => e.run.repo === repoKey && e.run.name === name && isBuild(e.run.kind) && e.run.condition !== "running" && Date.parse(e.run.started) > mark)
    .sort((a, b) => Date.parse(a.run.started) - Date.parse(b.run.started));
  let n = 0;
  for (const e of runs.reverse()) { if (causeOf(e.run) !== "no-commit") break; n++; }
  return n;
}

/** Marks that the cap's Ask was set for the issue: a `cap` event in its job record. */
export function markCap(name: string): void {
  record.addEvent(name, { kind: "cap", what: "the run cap set an Ask" });
}

/** Clears the cap mark: a start has followed the Ask. */
export function clearCap(name: string): void {
  if (capMarked(name)) record.addEvent(name, { kind: "cap-cleared", what: "a start followed the Ask" });
}

/** Whether the cap's Ask was set for the issue and no start has followed: its newest `cap` event has no `cap-cleared` after it. */
const capMarked = (name: string): boolean =>
  record.read(name)?.events.findLast((e) => e.kind === "cap" || e.kind === "cap-cleared")?.kind === "cap";

/** How long ago the issue's newest build run that ended with the API credit error ended, or null when it has none. */
function creditWait(repoKey: string, name: string, all: Entry[], now: number): number | null {
  const last = all.filter((e) => e.run.repo === repoKey && e.run.name === name && isBuild(e.run.kind) && e.run.ended && causeOf(e.run) === "credit")
    .sort((a, b) => Date.parse(a.run.ended!) - Date.parse(b.run.ended!)).at(-1);
  return last ? now - Date.parse(last.run.ended!) : null;
}

/** How many jobs of the issue started in the last 60 minutes: a job counts by its first build run, so its fix rounds do not, and a first run that ended with the API credit error did no work, so it does not count. */
function agentStartsInHour(repoKey: string, name: string, jobs: Job[], now: number): number {
  return jobs.filter((j) => {
    const first = j.find((e) => e.run.repo === repoKey && e.run.name === name && isBuild(e.run.kind));
    return first !== undefined && now - Date.parse(first.run.started) < 3600_000 && causeOf(first.run) !== "credit";
  }).length;
}

/** The most job starts any one issue made in the last 60 minutes, by the rule the loop guard uses. */
function maxStartsInHour(now: number, jobs: Job[]): number {
  const issues = new Map<string, { repo: string; name: string }>();
  for (const e of jobs.flat()) if (e.run.repo && isBuild(e.run.kind) && now - Date.parse(e.run.started) < 3600_000) issues.set(`${e.run.repo}/${e.run.name}`, { repo: e.run.repo, name: e.run.name });
  return Math.max(0, ...[...issues.values()].map((g) => agentStartsInHour(g.repo, g.name, jobs, now)));
}

/** What the Status page shows of the factory, and the gate and the baselines its Queued lane reads. */
export function factorySnapshot(now: number, jobs: Job[]) {
  const runs = jobs.flat();
  return {
    paused: paused(),
    liveCap: LIVE_CAP(),
    liveRuns: liveRuns(runs),
    liveLocal: liveLocal(runs),
    localCap: LOCAL_CAP,
    runCap: RUN_CAP(),
    runStarts: maxStartsInHour(now, jobs),
    runsToday: runsToday(now, runs).length,
    costToday: spentToday(now, runs),
    health: health(now, { jobs }),
    firefighter: firefighterLines(now),
    gated: factoryGates(jobs),
    baselines: baselines(),
  };
}
