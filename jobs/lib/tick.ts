/**
 * `aleph tick`, from its timer every minute. It starts only periodic work, each step on its own due rule: the
 * corrections and the monitor once a day, the episodes, the CI read and the firefighter on a fixed period, the smoke
 * test and the sweep at each tick. No transition waits for it (PRINCIPLES.md rule 7): a run's end, an issue write
 * and an Ask each start their next step at once. The sweep is the safety net: work that should have started and did
 * not is logged as `missed: <key>`, so the cause gets fixed, and is started. A tick that finds nothing due reads
 * only local files: no agent run and no fetch.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reader } from "../../issues/lib/store.ts";
import { ciStep } from "./ci.ts";
import { pendingCases } from "./director.ts";
import { correctionsStep, directIfNew, doneChecker, episodeStep, runDispatch, stalled } from "./factory.ts";
import { baselines, factoryDir, factoryRepos, gates, readStalls, writeStalls } from "./factory-status.ts";
import { firefight } from "./firefighter.ts";
import { git } from "./git.ts";
import { factoryLog } from "./layout.ts";
import { allJobs, loadRegistry, type Entry, type Repo } from "./ledger.ts";
import { intakeDetached, suiteDetached } from "./launch.ts";
import { monitorStep } from "./monitor.ts";
import { editedWaits, toRescue } from "./rescue.ts";
import { smokeStep } from "./smoke.ts";

/** How often each step with a fixed period runs. */
export const EVERY_MS = { ci: 5 * 60_000, firefight: 5 * 60_000, episodes: 30 * 60_000 } as const;
type Periodic = keyof typeof EVERY_MS;

/**
 * The tick's own record in tick.json: when each periodic step last ran, the missed keys the sweep has acted on
 * (each is acted on once while it stays), and the main commit of each red repo that the sweep started a suite for.
 */
export interface TickState { last: Partial<Record<Periodic, string>>; missed: string[]; suite: Record<string, string> }

const stateFile = () => join(factoryDir(), "tick.json");

export function readTick(): TickState {
  try {
    const s = JSON.parse(readFileSync(stateFile(), "utf8"));
    return { last: s.last ?? {}, missed: s.missed ?? [], suite: s.suite ?? {} };
  } catch {
    return { last: {}, missed: [], suite: {} };
  }
}

function writeTick(s: TickState): void {
  mkdirSync(factoryDir(), { recursive: true });
  writeFileSync(stateFile(), JSON.stringify(s));
}

/** Whether `step` is due at `now`: it never ran, or it ran EVERY_MS[step] or more ago. */
export function due(s: TickState, step: Periodic, now: number): boolean {
  const t = Date.parse(s.last[step] ?? "");
  return Number.isNaN(t) || now - t >= EVERY_MS[step];
}

/** What the sweep starts. Tests replace them. */
export interface SweepPorts { dispatch(): Promise<unknown>; suite(): void }
const sweepPorts: SweepPorts = { dispatch: runDispatch, suite: suiteDetached };

/** An intake or director run of `on` that has not ended: the work is in hand. */
const busy = (runs: Entry[], kind: string, on: string) => runs.some((e) => e.run.kind === kind && e.run.on === on && e.run.condition === "running");

/**
 * The safety net. It records what could move now and does not, each key with the time a tick first saw it: `stalled`
 * (land, goal, ingest), an Ask with no case text and no director run (`ask:`), and a job to rescue (`rescue:`). A key
 * that a tick saw before is missed. Each missed key is logged once as `missed: <key>` and one dispatch starts them all:
 * its lands, rescues and goals, then the intake queue and the director. A red main that moved since its record (a fix
 * by hand) starts the suite once per commit. It reads the store and the repos as last fetched. Returns the missed keys.
 */
export async function sweep(now: number, s: TickState, p: SweepPorts = sweepPorts): Promise<string[]> {
  if (gates({ only: ["pause"] })) { writeStalls({}); s.missed = []; return []; }
  const jobs = allJobs(), runs = jobs.flat(), lists = reader({ fetch: false });
  const keys = stalled(jobs, lists, doneChecker(false));
  for (const c of pendingCases(factoryRepos(), runs, lists)) if (!busy(runs, "director", c.on)) keys.push(`ask:${c.on}`);
  for (const j of toRescue(jobs)) keys.push(`rescue:${j[0].run.name}`);
  for (const j of editedWaits(jobs)) keys.push(`edited:${j[0].run.name}`);
  const seen = readStalls();
  writeStalls(Object.fromEntries(keys.map((k) => [k, seen[k] ?? new Date(now).toISOString()])));
  const over = keys.filter((k) => k in seen && !(k.startsWith("ingest:") && busy(runs, "intake", k.slice("ingest:".length))));
  const missed = over.filter((k) => !s.missed.includes(k));
  s.missed = over;
  for (const k of missed) factoryLog(`missed: ${k}`);
  if (missed.length) await p.dispatch();
  const reg = loadRegistry();
  for (const b of Object.values(baselines())) {
    const repo = reg[b.repo];
    if (b.ok || !repo?.sandbox) continue;
    const head = git(repo.path, "rev-parse", `origin/${repo.main}`).out;
    if (!head || head === b.commit || s.suite[b.repo] === head) continue;
    s.suite[b.repo] = head;
    factoryLog(`${b.repo}: main moved to ${head.slice(0, 7)} while red at ${b.commit.slice(0, 7)}; the suite runs now`);
    p.suite();
  }
  return missed;
}

/** What the tick starts besides the sweep's ports: the intake of an issue the firefighter filed. */
export interface TickPorts extends SweepPorts { intake(repo: Repo, id: number): void }
const tickPorts: TickPorts = { ...sweepPorts, intake: intakeDetached };

/** `aleph tick`: each step that is due at `now`. Returns what it did, for the tick's JSON. */
export async function runTick(now = Date.now(), p: TickPorts = tickPorts): Promise<Record<string, unknown>> {
  const s = readTick();
  const at = new Date(now).toISOString();
  const out: Record<string, unknown> = {};
  const c = await correctionsStep(now);
  if (c) out.corrections = c;
  try {
    const m = await sweep(now, s, p);
    if (m.length) out.missed = m;
  } catch (e: any) { factoryLog(`sweep: failed: ${e?.message ?? e}`); }
  if (due(s, "episodes", now)) { s.last.episodes = at; out.episodes = await episodeStep(); }
  if (due(s, "ci", now)) {
    s.last.ci = at;
    try { ciStep(factoryRepos()); } catch (e: any) { factoryLog(`ci: failed: ${e?.message ?? e}`); }
  }
  await smokeStep(undefined, undefined, now);
  if (due(s, "firefight", now)) {
    s.last.firefight = at;
    const f = await firefight(undefined, now);
    // A filed red is an issue for intake; a slow land's rescue Ask is the director's.
    const reg = loadRegistry();
    for (const x of f?.filed ?? []) if ("filed" in x && reg[x.repo]) p.intake(reg[x.repo]!, x.filed);
    if (f?.asked.length) directIfNew();
    if (f && (f.filed.length || f.asked.length)) out.firefighter = f;
  }
  const m = await monitorStep(new Date(now));
  if (m) out.monitor = m.day;
  writeTick(s);
  return out;
}
