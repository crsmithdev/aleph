/**
 * `aleph tick`, from its timer every minute. It starts only periodic work, each step on its own due rule: the
 * corrections and the monitor once a day, the episodes, the CI read and the firefighter on a fixed period, the probe
 * of a held backend, the smoke test and the sweep at each tick. No transition waits for it (PRINCIPLES.md rule 7): a run's end, an issue write
 * and an Ask each start their next step at once. The sweep is the safety net: work that should have started and did
 * not is logged as `missed: <key>`, so the cause gets fixed, and is started. A tick that finds nothing due reads
 * only local files: no agent run and no fetch.
 */
import { join } from "node:path";
import { readJsonOr } from "../../../lib/json.ts";
import { holdsWork } from "../infra/process.ts";
import { reader } from "../../../issues/lib/store.ts";
import { ciStep } from "../gates/ci.ts";
import { escalatedAt, pendingCases, subjectOfCase } from "../roles/director.ts";
import { correctionsStep, directIfNew, episodeStep, runDispatch, stalled } from "./factory.ts";
import { editTick } from "../gates/factory-status.ts";
import { doneChecker } from "./filing.ts";
import { baselines, factoryDir, factoryRepos, gates, probeHold, readStalls, writeStalls } from "../gates/factory-status.ts";
import { logAlways, landWait } from "../asks/ask.ts";
import { land } from "./transitions.ts";
import { firefight } from "../gates/firefighter.ts";
import { git } from "../infra/git.ts";
import { logEvent, readEvents } from "../../../lib/layout.ts";
import { retain } from "../infra/retention.ts";
import { archiveOld } from "../records/record.ts";
import { allJobs, allRuns, isWaiting, loadRegistry, type Entry, type Repo } from "../records/ledger.ts";
import { lock } from "../infra/locks.ts";
import { intakeDetached, suiteDetached } from "./launch.ts";
import { monitorStep } from "../roles/monitor.ts";
import { editedWaits, toRescue } from "../land/rescue.ts";
import { smokeStep } from "../gates/smoke.ts";

/** How often each step with a fixed period runs. */
const EVERY_MS = { ci: 5 * 60_000, firefight: 5 * 60_000, episodes: 30 * 60_000 } as const;
type Periodic = keyof typeof EVERY_MS;

/**
 * The tick's own record in tick.json: when each periodic step last ran, the missed keys the sweep has acted on
 * (each is acted on once while it stays), and the main commit of each red repo that the sweep started a suite for.
 */
export interface TickState { last: Partial<Record<Periodic, string>>; missed: string[]; suite: Record<string, string> }

const stateFile = () => join(factoryDir(), "tick.json");

export function readTick(): TickState {
  const s = readJsonOr<Partial<TickState>>(stateFile(), {});
  return { last: s.last ?? {}, missed: s.missed ?? [], suite: s.suite ?? {} };
}

/** Whether `step` is due at `now`: it never ran, or it ran EVERY_MS[step] or more ago. */
export function due(s: TickState, step: Periodic, now: number): boolean {
  const t = Date.parse(s.last[step] ?? "");
  return Number.isNaN(t) || now - t >= EVERY_MS[step];
}

/** What the sweep starts. Tests replace them. */
export interface SweepPorts { dispatch(): Promise<unknown>; suite(): void }
const sweepPorts: SweepPorts = { dispatch: runDispatch, suite: suiteDetached };


/**
 * The safety net. It records what could move now and does not, each key with the time a tick first saw it: `stalled`
 * (land, issue, ingest), an Ask with no case text and no director run (`ask:`), and a job to rescue (`rescue:`). A key
 * that a tick saw before is missed. Each missed key is logged once as `missed: <key>` and one dispatch starts them all:
 * its lands, rescues and issues, then the intake queue and the director. A red main that moved since its record (a fix
 * by hand) starts the suite once per commit. It reads the store and the repos as last fetched. Returns the missed keys.
 */
export async function sweep(now: number, s: TickState, p: SweepPorts = sweepPorts): Promise<string[]> {
  if (gates({ only: ["pause"] })) { writeStalls({}); s.missed = []; return []; }
  const jobs = allJobs(), runs = jobs.flat(), lists = reader({ fetch: false });
  const keys = await stalled(jobs, lists, doneChecker(false));
  for (const c of pendingCases(factoryRepos(), runs, lists)) if (!holdsWork(runs, "director", subjectOfCase(c))) keys.push(`ask:${c.on}`);
  for (const j of toRescue(jobs)) keys.push(`rescue:${j[0].run.name}`);
  for (const j of editedWaits(jobs)) keys.push(`edited:${j[0].run.name}`);
  const seen = readStalls();
  writeStalls(Object.fromEntries(keys.map((k) => [k, seen[k] ?? new Date(now).toISOString()])));
  const over = keys.filter((k) => k in seen && !(k.startsWith("ingest:") && holdsWork(runs, "intake", k.slice("ingest:".length))));
  const missed = over.filter((k) => !s.missed.includes(k));
  s.missed = over;
  for (const k of missed) logEvent({ by: "rule", subject: k, action: "missed" });
  if (missed.length) await p.dispatch();
  const reg = loadRegistry();
  for (const b of Object.values(baselines())) {
    const repo = reg[b.repo];
    if (b.ok || !repo?.sandbox) continue;
    const head = git(repo.path, "rev-parse", `origin/${repo.main}`).out;
    if (!head || head === b.commit || s.suite[b.repo] === head) continue;
    s.suite[b.repo] = head;
    logEvent({ by: "rule", subject: b.repo, action: "started", sub: "check", note: `main moved to ${head.slice(0, 7)} while red at ${b.commit.slice(0, 7)}; the suite runs now` });
    p.suite();
  }
  return missed;
}

/** What the tick starts besides the sweep's ports: the intake of an issue the firefighter filed. */
export interface TickPorts extends SweepPorts { intake(repo: Repo, id: number): void; land(name: string): Promise<unknown> }
const tickPorts: TickPorts = { ...sweepPorts, intake: intakeDetached, land: (name) => land(name) };

/**
 * `aleph tick`: each step that is due at `now`. Returns what it did, for the tick's JSON. One tick holds the `tick`
 * lock from before it reads tick.json until after its write, so two ticks cannot run the same steps twice: a tick
 * that finds the lock busy runs no step, writes nothing and says so.
 */
export async function runTick(now = Date.now(), p: TickPorts = tickPorts): Promise<Record<string, unknown>> {
  const release = await lock("tick", 0);
  if (!release) return { tick: "lock busy" };
  try {
    const s = readTick();
    const at = new Date(now).toISOString();
    const out: Record<string, unknown> = {};
    const c = await correctionsStep(now);
    if (c) out.corrections = c;
    // Before the sweep, so the issues a lifted hold frees are keys it starts this tick.
    const lifted = await probeHold();
    if (lifted) out.hold = lifted;
    try {
      const m = await sweep(now, s, p);
      if (m.length) out.missed = m;
    } catch (e: any) { logEvent({ by: "rule", subject: "sweep", action: "failed", sub: "error", note: String(e?.message ?? e) }); }
    if (due(s, "episodes", now)) { s.last.episodes = at; out.episodes = await episodeStep(); }
    if (due(s, "ci", now)) {
      s.last.ci = at;
      try { ciStep(factoryRepos()); } catch (e: any) { logEvent({ by: "rule", subject: "ci", action: "failed", sub: "error", note: String(e?.message ?? e) }); }
    }
    await smokeStep(undefined, undefined, now);
    const old = archiveOld(now);
    if (old.length) out.archived = old;
    try { const gone = retain(now); if (gone) out.retained = gone; } catch (e: any) { logEvent({ by: "rule", subject: "retention", action: "failed", sub: "error", note: String(e?.message ?? e) }); }
    if (due(s, "firefight", now)) {
      s.last.firefight = at;
      const f = await firefight(undefined, now);
      // A filed red starts its own intake (its filing's effects); a slow land's rescue Ask is the director's.
      if (f?.asked.length) directIfNew();
      if (f && (f.filed.length || f.asked.length)) out.firefighter = f;
    }
    for (const { id, run } of allRuns()) {
      const wait = isWaiting(run.condition) && run.ask ? landWait(run.ask.reason) : null;
      const since = wait && run.ask ? escalatedAt({ id, run } as Entry) : null;
      if (!wait || since === null || now - since < wait * 60_000) continue;
      // One land per escalation: a land that is still running, or that failed, leaves the run waiting.
      const ref = run.on ?? run.name, said = `after waiting ${wait} min on Chris: ${run.ask!.reason}`;
      if (readEvents(since).some((e) => e.by === "rule" && e.subject === ref && e.note?.includes(" min on Chris: "))) continue;
      try {
        await p.land(run.name);
        logAlways(run.ask!.reason, ref, "started", { note: `landed ${said}` });
      } catch (e: any) { logAlways(run.ask!.reason, ref, "failed", { note: `land failed ${said}: ${String(e?.message ?? e)}` }); }
    }
    const m = await monitorStep(new Date(now));
    if (m) out.monitor = m.day;
    await editTick((t) => ({ ...t, ...s }));
    return out;
  } finally {
    release();
  }
}
