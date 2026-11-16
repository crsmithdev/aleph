/**
 * The factory's status: what its files in ~/.aleph/factory and the ledger say
 * now. `factorySnapshot` is the one read the Status page needs; the rest are the
 * queries and the gates. It imports no transition, so aleph-ui can load it, and
 * a change to the actions does not restart aleph-ui. The actions are in factory.ts.
 */
import { areasOf, parentIn, reader, type Reader } from "../../../issues/lib/store.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { surfacePaths } from "../roles/issue-spec.ts";
import { ciLine, redCi } from "./ci.ts";
import { isOpen, openJob, type Job } from "../records/job.ts";
import { heldEvent, type Bound, type Gate, type Hold } from "./issue-decision.ts";
import { event, type Event, issueKey, OLD_HOLDS, parseKey } from "../../../lib/naming.ts";
import { eventsOf, logEvent, logSetting, readEvents } from "../../../lib/layout.ts";
import { conn, getJson, putJson, tx } from "../../../lib/db.ts";
import * as record from "../records/record.ts";
import { allRuns, isWaiting, isBuild, loadRegistry, onOf, tell, type Entry, type Repo, type Run } from "../records/ledger.ts";
import { held, lock } from "../infra/locks.ts";
import { isLive, isRunning } from "../infra/process.ts";
import { causeOf, policyOf } from "../records/outcome.ts";
import { smokeLine } from "./smoke.ts";
import { LIVE_CAP, LOCAL_CAP, pausedAt, RUN_CAP, setPausedAt, suiteBudgetSeconds } from "../infra/settings.ts";
import type { Via } from "../../../lib/models.ts";
import { BACKENDS, probeBackend, readModels, viaOfRun, type Name, type Setting } from "../routing/models.ts";

/** One record of why an issue waits: `kind` is the hold word, or `started`; `event` its log event, which a `started` record lacks. */
export interface HoldRecord { at: string; name: string; kind: string; text: string; event?: Event }

/** The hold record kinds that did not stop a start: the issue was done or dropped, or its job was open. */
const NOT_HELD = new Set(["open", "start", "done", "dropped", "job"]);

/** Whether a record stopped an issue that could have started: not `started`, not a done issue, not an issue whose job is open. */
export const stopsStart = (r: HoldRecord): boolean => r.kind !== "started" && !NOT_HELD.has(r.kind);

/** The actions of the hold events of an issue: `held`, and the older actions and refusals each its own. */
const HOLD_ACTIONS = ["held", ...OLD_HOLDS, "gpu", "waiting", "parent", "parked", "starting", "done", "dropped"];

/** The hold of an event: a `started` event of the rule, or an event of the gate in HOLD_ACTIONS on an issue; else null. The text is the event's detail, and the kind the hold word: that of a `held` event is its detail before the first colon. */
function holdOf(e: Event): HoldRecord | null {
  if (parseKey(e.object)?.kind !== "issue") return null;
  if (e.subject === "rule" && e.action === "started") return { at: e.time, name: e.object, kind: "started", text: e.detail ?? "" };
  if (e.subject !== "gate" || !HOLD_ACTIONS.includes(e.action)) return null;
  return { at: e.time, name: e.object, kind: e.action === "held" ? (e.detail ?? "").split(":")[0] : e.action, text: e.detail ?? "", event: e };
}

/** Every hold record of every issue, oldest first. */
export function allHolds(): HoldRecord[] {
  return readEvents(0).map(holdOf).filter((h): h is HoldRecord => h !== null);
}

/** The hold records of the given issues, oldest first. */
export function readHolds(names: string[]): HoldRecord[] {
  return [...new Set(names)].flatMap((n) => eventsOf(n).map(holdOf).filter((h): h is HoldRecord => h !== null));
}

/**
 * Records why an issue waits (or, with kind `started`, that it no longer does): its hold event by `gate` on the issue, unless it
 * repeats the last one. A `started` record logs
 * nothing: the start logs its own event. `ev` gives the hold's log event. A done or dropped issue has no hold to record.
 */
export function recordHold(name: string, kind: Gate | "started", ev?: Hold): void {
  const at = new Date().toISOString();
  tx(() => {
    if (kind !== "started") {
      const last = eventsOf(name).filter((e) => (e.subject === "gate" && e.action !== "question" && e.action !== "answered") || (e.subject === "rule" && e.action === "started")).at(-1);
      const e = ev && event({ time: at, subject: "gate", object: name, ...ev });
      if (last && e && last.subject === "gate" && last.object === e.object && last.action === e.action && (last.detail ?? "") === (e.detail ?? "")) return;
      if (e) logEvent(e);
    }
  });
}

const DAY = 24 * 3600_000;

export const paused = () => pausedAt() !== null;

/** Pauses the factory (the `paused` setting holds the time) or, with `on` false, resumes it; a pause that stays logs nothing. */
export function setPaused(on: boolean): void {
  const was = paused();
  setPausedAt(on ? new Date().toISOString() : null);
  if (was !== on) logSetting(`pause: ${on ? "on" : "off"}`);
}

/** Logs the live cap turning on (`full`: its `N / M jobs`) or off (null); a cap that stays as it is logs nothing. */
export function logCap(full: string | null): void {
  if ((full !== null) === getJson("state", "cap-on", false)) return;
  putJson("state", "cap-on", full !== null);
  logEvent({ subject: "gate", action: "changed", object: "settings", detail: full === null ? "cap: off" : `cap: on: ${full}` });
}

/** The backend the factory holds after a call on it ended with the API credit error: `via` is the backend, `why` the call's line, `goals` the issues with no run that it held. */
export interface BackendHold { via: Via; why: string; since: string; goals?: string[] }

/** The backend the factory holds now, or null. */
export function backendHold(): BackendHold | null {
  const h = getJson<BackendHold | null>("state", "backend-hold", null);
  return h && typeof h.via === "string" ? h : null;
}

/** The line the hold gives a run on its backend. */
const holdBound = (h: BackendHold): Bound =>
  ({ why: `waits for ${BACKENDS[h.via]}: ${h.why}`, text: `Waiting for ${BACKENDS[h.via]}: ${h.why}`, ev: heldEvent("waiting", `for ${BACKENDS[h.via]}`) });

/**
 * The backend hold of an issue with no run yet, whose backend only routing names: it binds when this hold already held
 * the issue (`holdGoal`), so the dispatch does not route the issue again while the hold lasts.
 */
export function heldGoal(name: string): Bound | null {
  const h = backendHold();
  return h?.goals?.includes(name) ? holdBound(h) : null;
}

/** Remembers in the backend hold that it held the issue. The hold lifts with its issues. */
export function holdGoal(name: string): void {
  const h = backendHold();
  if (h && !h.goals?.includes(name)) putJson("state", "backend-hold", { ...h, goals: [...(h.goals ?? []), name] });
}

/**
 * Holds the backend of a call that ended with the API credit error, and tells Chris once. A backend already held keeps
 * its line, so the jobs that follow it write no second alert.
 */
export async function holdBackend(via: Via, why: string): Promise<void> {
  if (backendHold()?.via === via) return;
  putJson("state", "backend-hold", { via, why, since: new Date().toISOString() });
  logEvent({ subject: "gate", action: "changed", object: "settings", detail: `credit: on: ${via}: ${why}` });
  await tell(`the factory holds ${BACKENDS[via]}: ${why}`);
}

/** Probes the held backend and lifts the hold when it answers, with one line. Returns that line, or null. */
export async function probeHold(up: (via: Via) => Promise<boolean> = probeBackend): Promise<string | null> {
  const h = backendHold();
  if (!h || !(await up(h.via))) return null;
  putJson("state", "backend-hold", null);
  const line = `${BACKENDS[h.via]} answers again: the hold is off`;
  logEvent({ subject: "gate", action: "changed", object: "settings", detail: "credit: off" });
  return line;
}

/** The registry's factory repos: those whose runs are sandboxed. */
export const sandboxRepos = () => Object.values(loadRegistry()).filter((r) => r.sandbox);

/** Factory agent and intake runs (triage and planner runs before them) started in the last 24 hours. */
/** `runs` is every run, when the caller has read them already. */
export function runsToday(now = Date.now(), runs: Entry[] = allRuns()): Entry[] {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  return runs.filter((e) => (isBuild(e.run.role) || e.run.role === "intake") && e.run.repo && keys.has(e.run.repo) && now - Date.parse(e.run.started) < DAY);
}

/** The dollars of the runs started in the last 24 hours: `runsToday`, and the firefighter and director runs (and the explain runs from before the director), which `runsToday` does not count. A director run has no repo (its `on` is an item ref, a run folder or a lesson id), so it is not filtered by one, as a firefighter run is not. */
export function spentToday(now = Date.now(), runs: Entry[] = allRuns()): number {
  const others = runs.filter((e) => (e.run.role === "director") && now - Date.parse(e.run.started) < DAY);
  return [...runsToday(now, runs), ...others].reduce((a, e) => a + (e.run.cost ?? 0), 0);
}

/** Agent runs live now, and those started whose unit has not written `pid` yet. */
export const liveEntries = (runs: Entry[] = allRuns()): Entry[] => runs.filter((e) => isBuild(e.run.role) && isRunning(e));

/** Whether a build run is on the local backend: unit.ts sets its model to its size's, and before that its size's model is the local one. */
export const onLocal = (run: Pick<Run, "model" | "merge">, models: Record<Name, Setting>): boolean => viaOfRun(run, models) === "local";

/** Live agent runs on Claude, the count the live cap checks: a local-backend run counts against LOCAL_CAP only. */
export const liveRuns = (runs?: Entry[]): number => { const models = readModels(); return liveEntries(runs).filter((e) => !onLocal(e.run, models)).length; };

/** Live agent runs on the local backend, the count LOCAL_CAP checks. */
const liveLocal = (runs?: Entry[], models = readModels()): number => liveEntries(runs).filter((e) => onLocal(e.run, models)).length;

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

const PAUSED: Bound = { why: "paused", text: "The factory is paused", ev: heldEvent("paused") };

/** The gates of the whole factory, in the order of GATES: the others are each issue's own. */
const FACTORY_GATES = ["paused", "waiting", "full"] as const satisfies readonly Gate[];

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
    ? { why: call ? "a local call holds the GPU" : `${live} local agent runs are live`, text: `Waiting for the GPU slot (${live} of ${LOCAL_CAP} running)`, ev: heldEvent(call ? "gpu" : "full", `${live} / ${LOCAL_CAP} local jobs`) }
    : { why: `${live} agent runs are live`, text: `Waiting for a slot (${live} of ${LIVE_CAP()} running)`, ev: heldEvent("full", `${live} / ${LIVE_CAP()} jobs`) };
  return {
    paused: paused() ? PAUSED : null,
    waiting: hold && run !== undefined && viaOfRun(run, models) === hold.via ? holdBound(hold) : null,
    full: live >= (local ? LOCAL_CAP : LIVE_CAP()) ? bound : null,
  };
}

/**
 * The first factory gate that binds, in the order of FACTORY_GATES, or null. `only` limits it to some of them (a caller
 * whose other gates do not apply); `jobs` and `run` are factoryGates'.
 */
export function gates(opts: { only?: readonly FactoryGate[]; jobs?: Job[]; run?: Pick<Run, "model" | "merge"> } = {}): ({ gate: FactoryGate } & Bound) | null {
  const on = (g: FactoryGate) => !opts.only || opts.only.includes(g);
  // Each gate is read only when asked: the pause is one stat, and the dispatch asks it first.
  if (on("paused") && paused()) return { gate: "paused", ...PAUSED };
  const rest = FACTORY_GATES.filter((g) => g !== "paused" && on(g));
  if (!rest.length) return null;
  const all = factoryGates(opts.jobs, opts.run);
  for (const g of rest) if (all[g]) return { gate: g, ...all[g]! };
  return null;
}

/** Add a row to the `flaky` table. */
export const recordFlake = (row: Flake): void => {
  conn().query("INSERT INTO flaky (time, repo, check_name, run, tests) VALUES (?, ?, ?, ?, ?)").run(row.at, row.repo, row.check, row.run, row.tests ? JSON.stringify(row.tests) : null);
};

export interface Flake { repo: string; check: string; run: string; at: string; tests?: string[] }
export const flakes = (): Flake[] =>
  (conn().query("SELECT time AS at, repo, check_name AS `check`, run, tests FROM flaky ORDER BY seq").all() as (Omit<Flake, "tests"> & { tests: string | null })[])
    .map(({ tests, ...r }) => ({ ...r, ...(tests ? { tests: JSON.parse(tests) } : {}) }));

/** `config`: the setup and checks the record ran, as JSON; a record from before it has none. */
export interface Baseline { repo: string; commit: string; config?: string; ok: boolean; failed?: string }

export const baselines = (): Record<string, Baseline> => getJson("state", "baseline", {});

/**
 * The one write of the `baseline` row. In one transaction it reads the entries, lets `decide` turn the repo's old
 * entry into its new one (null leaves the row alone), and writes them back. Returns whether it wrote.
 */
export const writeBaseline = (key: string, decide: (old: Baseline | undefined) => Baseline | null): boolean => tx(() => {
  const all = baselines();
  const next = decide(all[key]);
  if (!next) return false;
  putJson("state", "baseline", { ...all, [key]: next });
  return true;
});

/** One full suite run: the test counts of its bun test checks, and the tests that failed on the first run and passed on the rerun. */
export interface SuiteRecord { repo: string; commit: string; at: string; ran: number; passed: number; failed: number; skipped: number; rerunPassed: number }

/** The suite records in the order they were added, of `repo` when given. */
export const suiteHistory = (repo?: string): SuiteRecord[] =>
  conn().query(`SELECT repo, commit_sha AS \`commit\`, time AS at, ran, passed, failed, skipped, rerun_passed AS rerunPassed FROM suite_history${repo ? " WHERE repo = ?" : ""} ORDER BY seq`).all(...(repo ? [repo] : [])) as SuiteRecord[];

export const appendSuiteHistory = (r: SuiteRecord): void => {
  conn().query("INSERT INTO suite_history (time, repo, commit_sha, ran, passed, failed, skipped, rerun_passed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(r.at, r.repo, r.commit, r.ran, r.passed, r.failed, r.skipped, r.rerunPassed);
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

/** The tick's record of stalled work: each key with the time a tick first saw it. */
export function writeStalls(stalls: Record<string, string>): void {
  putJson("state", "stalls", stalls);
}

export const readStalls = (): Record<string, string> => getJson("state", "stalls", {});

/** A health line: its text, its kind, and for an alert the key the status sentence ranks it by (lib/status-words.ts). */
export interface Health { text: string; kind: "alert" | "warn"; key?: string }
const alert = (key: string, text: string): Health => ({ text, kind: "alert", key });

/** The health lines of work that stayed stalled for STALL_MS, and of land runs live past LAND_STUCK_MS. */
export function stallLines(now: number, jobs?: Job[]): Health[] {
  if (paused()) return [];
  const old = Object.entries(readStalls()).filter(([, at]) => now - Date.parse(at) >= STALL_MS).map(([k]) => k);
  const n = (kind: string) => old.filter((k) => k.startsWith(`${kind}:`)).length;
  const lines: Health[] = [];
  const slow = (jobs?.flat() ?? allRuns()).filter((e) => e.run.role === "land" && isLive(e.folder) && now - Date.parse(e.run.started) >= LAND_STUCK_MS);
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
function suiteLines(runs: Entry[] = allRuns()): Health[] {
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

/** The firefighter's lines of the factory log in the last 24 hours, newest last, at most `n`: what the Status page shows. An event shows its detail. */
export function firefighterLines(now = Date.now(), n = 8): { at: string; line: string }[] {
  const events = readEvents(now - DAY).filter((e) => e.subject === "firefighter").map((e) => ({ at: e.time, line: `firefighter: ${e.detail ?? `${e.action} ${e.object}`}` }));
  return events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).slice(-n);
}

/** Insertions plus deletions in a `git show --shortstat` line. */
export const changedLinesOf = (stat: string): number =>
  [...stat.matchAll(/(\d+) (?:insertion|deletion)/g)].reduce((a, m) => a + Number(m[1]), 0);

/** The work's name for an issue: its key, `issue.28`. */
export const issueJob = (_repo: Repo, id: number | string) => issueKey(id);

/** A file is busy when this many land runs of its repo conflicted on it in the last BUSY_MS. */
const BUSY_CONFLICTS = 3;

const BUSY_MS = 7 * 86_400_000;

/** The first open job of the repo, not waiting for Chris, whose issue `shares` something with the issue; `file` says what. */
function openWait(repo: Repo, jobs: Job[], shares: (theirs: issues.Issue) => { file: string; what: string } | undefined): { why: string; on: string; job: string; file: string } | null {
  const lists = reader({ fetch: false });
  for (const j of jobs) {
    const last = record.counting(j).run;
    const on = onOf(last);
    if (last.repo !== repo.key || on === undefined || !isOpen(j) || isWaiting(last.state)) continue;
    const theirs = lists.item(repo.key, on);
    const s = theirs && shares(theirs);
    if (s) return { why: `waits for ${last.name}: ${s.what}`, on: last.name, job: record.counting(j).id, file: s.file };
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
    if (run.role !== "land" || run.repo !== repo.key || now - Date.parse(run.started) > BUSY_MS) continue;
    for (const f of run.conflicts ?? []) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  const mine = surfacePaths(item.spec).filter((f) => (counts.get(f) ?? 0) >= BUSY_CONFLICTS);
  const busy = (f: string | undefined) => (f ? { file: f, what: `both change the busy file ${f}` } : undefined);
  const file = mine.length ? openWait(repo, jobs, (theirs) => busy(surfacePaths(theirs.spec).find((p) => mine.includes(p)))) : null;
  return file ?? (usesGptOss(item) ? openWait(repo, jobs, (theirs) => usesGptOss(theirs) ? { file: "gpt-oss", what: "both use the gpt-oss server" } : undefined) : null);
}

/** Orders entries by run ID, the order of `allRunRecords`: a clock step back leaves `started` out of order. */
const byId = (a: Entry, b: Entry): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The run an issue would start next: its newest build run, whose model says which backend the issue runs on. Null when the
 * issue has no run yet, so a gate that asks the run to start reads nothing.
 */
export function nextRun(repoKey: string, name: string, jobs: Job[]): Run | null {
  return jobs.flat().filter((e) => e.run.repo === repoKey && e.run.name === name && isBuild(e.run.role))
    .sort(byId).at(-1)?.run ?? null;
}

/** The facts of an issue that the jobs and the factory's marks give; `issueDecision` takes them with the caller's own. */
export function issueFacts(repo: Repo, item: issues.Issue, jobs: Job[], now = Date.now(), lists: Reader = reader()) {
  const name = issueJob(repo, issues.idOf(item)), runs = jobs.flat();
  // A job whose last run ended with the API credit error is not open work: the credit hold keeps the issue for its wait, then it starts again.
  const found = openJob(name, null, jobs), open = found && policyOf(causeOf(record.counting(found).run)).waitMs > 0 ? null : found;
  return {
    name, ref: `${repo.key}-${issues.idOf(item)}`, item, parent: parentIn(repo.key, item, lists),
    open: open ? record.counting(open).run.state : null,
    job: open ? record.counting(open).id : null,
    busy: busyWait(repo, item, jobs, now),
    noCommits: noCommitStreak(repo.key, name, runs),
    capHeld: capMarked(name),
    startsInHour: agentStartsInHour(repo.key, name, jobs, now),
    creditWait: creditWait(repo.key, name, runs, now),
  };
}

/** The reason of a `question` event's detail: the detail before its facts (`no-commit: 3 / 3 jobs with no commit`). */
export const askReason = (detail?: string | null): string => (detail ?? "").split(": ")[0];

/** When an Ask of `reason` was last set on the issue (ms), or null: the time of its latest `question` event. Setting the no-commit streak's Ask is what marks the streak. */
const askedAt = (name: string, reason: string): number | null => {
  const e = eventsOf(name, "question").findLast((x) => askReason(x.detail) === reason);
  return e ? Date.parse(e.time) : null;
};

/** When the streak last set an Ask on the issue's item (ms), or null. Runs before it no longer count. */
const streakMark = (name: string): number | null => askedAt(name, "no-commit");

/** How many of the issue's newest agent runs since the streak's last Ask, in a row, ended with no commit. */
function noCommitStreak(repoKey: string, name: string, all: Entry[]): number {
  const mark = streakMark(name) ?? -Infinity;
  const runs = all.filter((e) => e.run.repo === repoKey && e.run.name === name && isBuild(e.run.role) && e.run.state !== "running" && Date.parse(e.run.started) > mark)
    .sort(byId);
  let n = 0;
  for (const e of runs.reverse()) { if (causeOf(e.run) !== "no-commit") break; n++; }
  return n;
}

/** Whether the cap's Ask was set for the issue and no start has followed: its latest `run-cap` question has no `started` event after it. */
const capMarked = (name: string): boolean => {
  const at = askedAt(name, "run-cap");
  return at !== null && !eventsOf(name, "started").some((e) => Date.parse(e.time) > at);
};

/** The issue's newest build run whose cause has a wait (`waitMs`: the API credit error): its key, and how long ago it ended; null when it has none. */
function creditWait(repoKey: string, name: string, all: Entry[], now: number): { job: string; ago: number } | null {
  const last = all.filter((e) => e.run.repo === repoKey && e.run.name === name && isBuild(e.run.role) && e.run.ended && policyOf(causeOf(e.run)).waitMs > 0)
    .sort(byId).at(-1);
  return last ? { job: last.id, ago: now - Date.parse(last.run.ended!) } : null;
}

/** How many jobs of the issue started in the last 60 minutes: a job counts by its first build run, so its fix rounds do not, and a first run whose cause does not count to the cap (`countsToCap`: the API credit error) does not count. */
function agentStartsInHour(repoKey: string, name: string, jobs: Job[], now: number): number {
  return jobs.filter((j) => {
    const first = j.find((e) => e.run.repo === repoKey && e.run.name === name && isBuild(e.run.role));
    return first !== undefined && now - Date.parse(first.run.started) < 3600_000 && policyOf(causeOf(first.run)).countsToCap;
  }).length;
}

/** The most job starts any one issue made in the last 60 minutes, by the rule the loop guard uses. */
function maxStartsInHour(now: number, jobs: Job[]): number {
  const issues = new Map<string, { repo: string; name: string }>();
  for (const e of jobs.flat()) if (e.run.repo && isBuild(e.run.role) && now - Date.parse(e.run.started) < 3600_000) issues.set(`${e.run.repo}/${e.run.name}`, { repo: e.run.repo, name: e.run.name });
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

/** The state of a factory repo's main: green, or red, unchecked or running with its line. */
export type MainState = { state: "green" } | { state: "red" | "unchecked" | "running"; line: string };

/** A row of `tick`: when a step last ran and what it said; a column is null until a write gives it. */
export interface TickRow { last: string | null; result: string | null }

export const tickRows = (): Record<string, TickRow> =>
  Object.fromEntries((conn().query("SELECT * FROM tick").all() as (TickRow & { step: string })[]).map(({ step, ...row }) => [step, row]));

/** The tick keys the sweep has acted on and that are still missed (tick.ts writes them). */
export const tickMissed = (): string[] => getJson("state", "tick.missed", []);

/** Sets the columns that `row` gives for `step`; the other column keeps its value. */
export const setTick = (step: string, row: Partial<TickRow>): void => {
  conn().query("INSERT INTO tick (step, last, result) VALUES (?1, ?2, ?3) ON CONFLICT (step) DO UPDATE SET last = coalesce(?2, last), result = coalesce(?3, result)")
    .run(step, row.last ?? null, row.result ?? null);
};

/** The result of a scheduled step (`suite <repo>`, `monitor`) and its time, in its row of `tick`. */
export const recordRan = (key: string, result: string): void => setTick(key, { last: new Date().toISOString(), result });
