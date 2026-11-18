/**
 * The factory's status: what its files in ~/.aleph/factory and the ledger say
 * now. `factorySnapshot` is the one read the Status page needs; the rest are the
 * queries and the gates. It imports no transition, so aleph-ui can load it, and
 * a change to the actions does not restart aleph-ui. The actions are in factory.ts.
 */
import { areasOf, parentIn, reader, type Reader } from "../../../lib/store.ts";
import * as issues from "../../../lib/todo.ts";
import { surfacePaths } from "../roles/issue-spec.ts";
import { openJob, stateOf, type Job } from "../records/job.ts";
import { allRuns } from "../records/record.ts";
import { isOpen, isWaiting, isBuild, onOf, type Entry, type Repo, type Run } from "../records/ledger.ts";
import { heldEvent, type Bound, type Gate } from "./issue-decision.ts";
import { issueKey, wordOf } from "../../../lib/naming.ts";
import { eventsOf, readEvents } from "../../../lib/layout.ts";
import * as record from "../records/record.ts";
import { held } from "../../../lib/locks.ts";
import { isLive } from "../infra/process.ts";
import { causeOf, policyOf } from "../records/outcome.ts";
import { smokeLine } from "./smoke.ts";
import { backendHold, holdBound } from "./holds.ts";
import { paused } from "./pause.ts";
import { DAY, liveLocal, liveRuns, onLocal, runsToday, spentToday } from "./gpu.ts";
import { baselines, readStalls, redMains } from "./tables.ts";
import { LIVE_CAP, LOCAL_CAP, RUN_CAP, suiteBudgetSeconds } from "../infra/settings.ts";
import { readModels, viaOfRun } from "../routing/models.ts";





const PAUSED: Bound = { why: "paused", text: "The factory is paused", ev: heldEvent("paused") };

/** The gates of the whole factory, in the order of GATES: the others are each issue's own. */
const FACTORY_GATES = ["paused", "waiting", "full"] as const satisfies readonly Gate[];

type FactoryGate = (typeof FACTORY_GATES)[number];

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


/** How long work may wait with nothing moving before it is stalled: 15 minutes. */
const STALL_MS = 15 * 60_000;

/** A land run live for longer than this is stuck: 99% of land runs end within 20 minutes. */
export const LAND_STUCK_MS = 30 * 60_000;


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

/** Orders entries by run ID, the order of `allRuns`: a clock step back leaves `started` out of order. */
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
  const name = issueKey(issues.idOf(item)), runs = jobs.flat();
  // A job whose last run ended with the API credit error is not open work: the credit hold keeps the issue for its wait, then it starts again.
  const found = openJob(name, null, jobs), open = found && policyOf(causeOf(record.counting(found).run)).waitMs > 0 ? null : found;
  return {
    name, ref: `${repo.key}-${issues.idOf(item)}`, item, parent: parentIn(repo.key, item, lists),
    open: open ? stateOf(open) : null,
    job: open ? record.counting(open).id : null,
    busy: busyWait(repo, item, jobs, now),
    noCommits: noCommitStreak(repo.key, name, runs),
    capHeld: capMarked(name),
    startsInHour: agentStartsInHour(repo.key, name, jobs, now),
    creditWait: creditWait(repo.key, name, runs, now),
  };
}

/** The reason of a `question` event's detail: the detail before its facts (`no-commit: 3 / 3 jobs with no commit`). */
export const askReason = (detail?: string | null): string => wordOf({ detail });

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

