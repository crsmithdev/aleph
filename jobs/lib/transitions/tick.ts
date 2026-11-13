/**
 * `aleph tick`, from its timer every minute. It starts only periodic work, each step on its own due rule: the
 * maintainer (dry vault maintenance, corrections, compile) and the monitor once a day, the housekeeper once a day and after a land, the episodes, the CI read and
 * the firefighter on a fixed period, the probe of a held backend, the smoke test and the sweep at each tick. No transition waits for it (PRINCIPLES.md rule 7): a run's end, an issue write
 * and an Ask each start their next step at once. The sweep is the safety net: work that should have started and did
 * not is logged as `missed: <key>`, so the cause gets fixed, and is started. A tick that finds nothing due reads
 * only local files: no agent run and no fetch.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { today } from "../../../lib/day.ts";
import { vaultDir } from "../../../lib/paths.ts";
import { compiledDays, readRun, retryDays } from "../../../vault/lib/vault.ts";
import { sub } from "../../../vault/lib/maintain.ts";
import { compileDay, yesterday } from "../roles/maintainer.ts";
import { recheck } from "../roles/recheck.ts";
import { dedupe } from "../roles/dedupe.ts";
import { addDays } from "../learning/monitor-table.ts";
import { readJsonOr } from "../../../lib/json.ts";
import { holdsWork } from "../infra/process.ts";
import { reader } from "../../../issues/lib/store.ts";
import { ciStep } from "../gates/ci.ts";
import { pendingCases, subjectOfCase } from "../roles/director.ts";
import { correctionsDue, directIfNew, episodeStep, mineCorrections, runDispatch, stalled } from "./factory.ts";
import { editTick } from "../gates/factory-status.ts";
import { doneChecker } from "./filing.ts";
import { baselines, factoryDir, sandboxRepos, gates, probeHold, readStalls, writeStalls } from "../gates/factory-status.ts";
import { firefight } from "../gates/firefighter.ts";
import { git } from "../infra/git.ts";
import { logEvent } from "../../../lib/layout.ts";
import { retain } from "../infra/retention.ts";
import { archiveOld } from "../records/record.ts";
import { allJobs, loadRegistry, type Repo } from "../records/ledger.ts";
import { lock } from "../infra/locks.ts";
import { housekeeperDetached, intakeDetached, suiteDetached } from "./launch.ts";
import { housekeepDue } from "../roles/housekeeper.ts";
import { monitorStep } from "../roles/monitor.ts";
import { chatLock, endLost } from "../roles/agent-run.ts";
import { timeoutStep, type Waiting } from "../asks/timeout.ts";
import { drop, land, refusal } from "./transitions.ts";
import * as verbs from "../../../issues/lib/issues.ts";
import { parseIssueRef } from "../../../issues/lib/todo.ts";
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

type Json = Record<string, any>;
/** Which parts of the maintainer a pass runs: the mechanical `maintain`, the corrections mining, the compile of yesterday, the re-check of the stale notes. */
export interface Parts { mech: boolean; corr: boolean; compile: boolean; decay: boolean; overlap: boolean }

/** `run`'s result, or `{ error }` when it throws: one failed part does not stop the next. */
const part = async <T>(run: () => Promise<T>): Promise<T | { error: string }> => {
  try { return await run(); } catch (e: any) { return { error: String(e?.message ?? e) }; }
};

/**
 * The whole maintainer at `root`, in order: the mechanical pass (`dry` or not), the corrections mining (always live), then
 * a compile again of each failed day of the 3 before yesterday (`retried`), then the compile of yesterday unless it ran
 * already (`dry` while the mechanical pass is dry), then the re-check of the stale notes, the overlap queue. One report: the mechanical fields, `corrections`, `retried`, `compile`, `recheck`, `dedupe`, and `counts` with `lessons`, `notes`, `rechecked` and `resolved` added.
 */
export async function maintainAll(root: string, dry: boolean, now: number, parts: Parts): Promise<Json> {
  const mech = parts.mech ? await sub(["maintain", ...(dry ? ["--dry"] : [])]) : null;
  const report: Json = mech ? (mech.json ?? { op: "maintain", dry, ok: false, error: mech.err.trim() }) : { op: "maintain", dry, ok: true };
  if (parts.corr) report.corrections = await part(() => mineCorrections(now));
  const day = yesterday(now);
  if (parts.compile) {
    // Each day whose compile failed, within 3 days of yesterday and not compiled since, again before yesterday.
    const retry = retryDays(root).filter((d) => d < day && d >= addDays(day, -3) && !compiledDays(root).includes(d));
    if (retry.length) {
      report.retried = [];
      for (const d of retry) report.retried.push(await part(() => compileDay(root, d, dry)));
    }
  }
  if (parts.compile) report.compile = compiledDays(root).includes(day) ? { day, dry, notes: [], skipped: "already compiled" } : await part(() => compileDay(root, day, dry));
  if (parts.decay) report.recheck = await part(() => recheck(root, dry));
  if (parts.overlap) report.dedupe = await part(() => dedupe(root, dry));
  const notes = report.compile?.notes?.filter((n: Json) => !n.refused).length;
  const rechecked = report.recheck?.notes?.filter((n: Json) => !n.refused).length;
  const resolved = report.dedupe?.pairs?.filter((p: Json) => !p.refused).length;
  report.counts = { ...report.counts, ...(report.corrections?.lessons !== undefined ? { lessons: report.corrections.lessons } : {}), ...(notes !== undefined ? { notes } : {}), ...(rechecked !== undefined ? { rechecked } : {}), ...(resolved !== undefined ? { resolved } : {}) };
  return report;
}

/** The one-line result of a pass for the tick: the mechanical counts, then each other part's count or its error. */
const summary = (r: Json): string => {
  const c = Object.entries(r.counts as Record<string, number>).filter(([k]) => k !== "lessons" && k !== "notes" && k !== "rechecked" && k !== "resolved").map(([k, v]) => `${v} ${k}`).join(", ");
  const tail = (k: string, what: string) => (r[k]?.error ? [`${k} failed: ${r[k].error}`] : r.counts[what] !== undefined ? [`${r.counts[what]} ${what}`] : []);
  return [...(c ? [`${r.dry ? "dry: " : ""}${c}`] : []), ...tail("corrections", "lessons"), ...tail("compile", "notes"), ...tail("recheck", "rechecked"), ...tail("dedupe", "resolved")].join(" · ");
};

/**
 * The daily maintainer, from 03:00 local, once per local date, under the pause gate. The mechanical pass stays dry and
 * its run record is its gate; the compile follows it. The corrections mining has its own gate, the store's `minedAt`.
 * Returns the report, or null when nothing is due or the vault is not there for the mechanical part.
 */
export async function maintainStep(now = Date.now()): Promise<Json | null> {
  const root = resolve(vaultDir()), at = readRun(root, "maintain")?.at;
  if (new Date(now).getHours() < 3 || gates({ only: ["pause"] })) return null;
  const mech = existsSync(join(root, "Home.md")) && !(at && today(new Date(at)) === today(new Date(now)));
  const corr = correctionsDue(now);
  if (!mech && !corr) return null;
  const r = await maintainAll(root, true, now, { mech, corr, compile: mech, decay: mech, overlap: mech });
  if (!r.ok) throw new Error("maintain failed; see its run record");
  return r;
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
  for (const c of pendingCases(sandboxRepos(), runs, lists)) if (!holdsWork(runs, "director", subjectOfCase(c))) keys.push(`ask:${c.on}`);
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

/**
 * The timeout's action on an Ask, as Chris's card takes it: a land or a drop of the run (its answer is the drop's
 * reason), else on the issue a drop, a decision with its intake, or intake again. The refusal, or null.
 */
async function takeOnTimeout(name: string, action: string, w: Waiting): Promise<string | null> {
  const said = `timeout: no answer to the ${w.ask.reason} Ask; ${w.ask.effects?.find((e) => e.action === action)?.text ?? action}`;
  if (action === "land") return refusal(() => land(name, { lander: "timeout" }, { output: "ignore" }));
  if (w.run && (action === "drop" || action === "answer")) return refusal(() => drop(name, { reason: action === "answer" ? `${said} (the question: "${w.ask.question}")` : said, quiet: true }));
  const p = parseIssueRef(w.key), repo = p && loadRegistry()[p.repo];
  if (!repo) return `no repo for ${w.key}`;
  return refusal(async () => {
    if (action === "drop" || action === "close" || action === "deny") verbs.close(repo, p.id, "drop", said);
    else if (action === "retry") { const n = verbs.note(repo, p.id, said, true); if (n.answered) intakeDetached(repo, n.result.id); }
    else {
      const o = w.ask.options.find((x) => action === `decide:${x.label}`);
      const d = verbs.decide(repo, p.id, o ? `timeout decided: ${o.label}: ${o.line}` : said, o?.after ? { after: [o.after] } : {});
      intakeDetached(repo, d.item.id);
    }
  });
}

/** What the tick starts besides the sweep's ports: the intake of an issue the firefighter filed. */
export interface TickPorts extends SweepPorts { intake(repo: Repo, id: number): void }
const tickPorts: TickPorts = { ...sweepPorts, intake: intakeDetached };

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
    // Paused or not: a chat turn whose server died holds no lock.
    await endLost("chat", (run) => chatLock(run.job));
    // Each step's time and result, in `ran` of tick.json; `say` gives the result, or null for a step that did not run.
    const ran: Record<string, { at: string; result: string }> = {};
    const step = async <T>(key: string, run: () => T | Promise<T>, say: (v: T) => string | null = () => "ok"): Promise<T | undefined> => {
      try {
        const v = await run(), result = say(v);
        if (result) ran[key] = { at, result };
        return v;
      } catch (e: any) {
        const note = String(e?.message ?? e);
        logEvent({ by: "rule", subject: key, action: "failed", sub: "error", note });
        ran[key] = { at, result: `failed: ${note}` };
      }
    };
    // Before the sweep, so the issues a lifted hold frees are keys it starts this tick.
    const lifted = await step("hold", probeHold);
    if (lifted) out.hold = lifted;
    const m = await step("sweep", () => sweep(now, s, p), (k) => `${k.length} missed`);
    if (m?.length) out.missed = m;
    if (due(s, "episodes", now)) {
      s.last.episodes = at;
      // A page that failed to write makes the step's result a failure.
      const e = await step("episodes", episodeStep, (r) => r.failed.length
        ? `failed: ${r.failed.length} of ${r.written.length + r.failed.length} pages, ${r.failed[0]}`
        : `${r.written.length} written`);
      out.episodes = e?.written ?? [];
    }
    const mt = await step("maintain", () => maintainStep(now), (r) => r && summary(r));
    if (mt) out.maintain = mt.counts;
    if (due(s, "ci", now)) {
      s.last.ci = at;
      await step("ci", () => ciStep(sandboxRepos()), (r) => `${r.length} red`);
    }
    await step("smoke", () => smokeStep(undefined, undefined, now), (reason) => (reason ? `failed: ${reason}` : "ok"));
    const old = (await step("archive", () => archiveOld(now), (o) => `${o.length} archived`)) ?? [];
    if (old.length) out.archived = old;
    const gone = await step("retention", () => retain(now), (n) => `${n} removed`);
    if (gone) out.retained = gone;
    if (due(s, "firefight", now)) {
      s.last.firefight = at;
      const f = await step("firefighter", async () => {
        const r = await firefight(undefined, now);
        // A filed red starts its own intake (its filing's effects); a slow land's rescue Ask is the director's.
        if (r?.asked.length) directIfNew();
        return r;
      }, (r) => r && `${r.filed.length} filed, ${r.asked.length} asked`);
      if (f && (f.filed.length || f.asked.length)) out.firefighter = f;
    }
    const t = await step("timeout", () => timeoutStep(takeOnTimeout, now), (n) => `${n.length} taken`);
    if (t?.length) out.timedOut = t;
    await step("housekeep", () => housekeepDue(now) && (housekeeperDetached(), true), (on) => (on ? "started" : null));
    const mon = await monitorStep(new Date(now));
    if (mon) out.monitor = mon.day;
    await editTick((t) => ({ ...t, ...s, ran: { ...t.ran, ...ran } }));
    return out;
  } finally {
    release();
  }
}
