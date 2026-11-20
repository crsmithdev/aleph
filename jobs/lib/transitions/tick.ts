/**
 * `aleph tick`, from its timer every minute. It starts only periodic work, each step on its own due rule: the
 * maintainer (dry vault maintenance, compile) and the monitor once a day, the housekeeper once a day and after a land (at most once an hour), the CI read and
 * the firefighter every 5 minutes (every minute while a CI run on a factory main is in progress or a land on it is under 15 minutes old), the probe of a held backend, the smoke test and the sweep at each tick. No transition waits for it (PRINCIPLES.md rule 7): a run's end, an issue write
 * and an Ask each start their next step at once. The sweep is the safety net: work that should have started and did
 * not is logged as a `missed` event on its issue or job, so the cause gets fixed, and is started. A tick that finds nothing due reads
 * only local files: no agent run and no fetch.
 */
import { resolve } from "node:path";
import { addDays, today, yesterday } from "../../../lib/day.ts";
import { vaultDir } from "../../../lib/paths.ts";
import { compiledDays, isVault, readRun, retryDays } from "../../../vault/lib/vault.ts";
import { maintain } from "../../../vault/lib/maintain.ts";
import { compileDay } from "../roles/maintainer.ts";
import { recheck } from "../roles/recheck.ts";
import { dedupe } from "../roles/dedupe.ts";
import { alias } from "../roles/alias.ts";
import { getJson, putJson, tx } from "../../../lib/db.ts";
import { holdsWork } from "../infra/process.ts";
import { fetchingOnce, reader, type Reader } from "../../../lib/store.ts";
import { status } from "../../../lib/todo.ts";
import { allIssueStates, answering, clearIssueState, getRun, keepingRuns, allRuns } from "../records/record.ts";
import { ciRunning, ciStep } from "../gates/ci.ts";
import { pendingCases, subjectOfCase } from "../roles/director.ts";
import { directIfNew } from "./factory.ts";
import { runDispatch } from "./dispatch.ts";
import { stalled } from "./stall.ts";
import { decider } from "../gates/decider.ts";
import { paused } from "../gates/pause.ts";
import { probeHold } from "../gates/holds.ts";
import { sandboxRepos } from "../gates/gpu.ts";
import { baselines, readStalls, setTick, tickMissed, tickRows, writeStalls } from "../gates/tables.ts";
import { firefight } from "../gates/firefighter.ts";
import { git } from "../../../lib/git.ts";
import { logEvent } from "../../../lib/layout.ts";
import { retain } from "../infra/retention.ts";
import { allJobs, loadRegistry, type Repo } from "../records/ledger.ts";
import { lock } from "../../../lib/locks.ts";
import { housekeeperDetached, intakeDetached, suiteDetached } from "./launch.ts";
import { housekeepDue } from "../roles/housekeeper.ts";
import { monitorStep } from "../roles/monitor.ts";
import { timeoutStep, type Waiting } from "../asks/timeout.ts";
import { actionsOn } from "../asks/ask.ts";
import { drop, land, refusal } from "./transitions.ts";
import * as verbs from "../../../issues/lib/issues.ts";
import { CLOSED, issueKey, missedOf, parseKey } from "../../../lib/naming.ts";
import { editedWaits, toRescue } from "../land/rescue.ts";
import { smokeStep } from "../gates/smoke.ts";
import { errText } from "../../../lib/errtext.ts";
import { DAILY_HOUR } from "../../../lib/schedule.ts";

/** How often each step with a fixed period runs. */
const EVERY_MS = { ci: 5 * 60_000, firefight: 5 * 60_000 } as const;
/** The period of the ci and firefight steps while a CI run on a factory main is in progress or a land on it ended within FRESH_MS. */
const FRESH_EVERY_MS = 60_000, FRESH_MS = 15 * 60_000;
type Periodic = keyof typeof EVERY_MS;

/**
 * The tick's own record: when each periodic step last ran (its `tick` row), the missed keys the sweep has acted on
 * (each is acted on once while it stays), and the main commit of each red repo that the sweep started a suite for
 * (both in `state`).
 */
interface TickState { last: Partial<Record<Periodic, string>>; missed: string[]; suite: Record<string, string> }

export function readTick(): TickState {
  const rows = tickRows(), last: TickState["last"] = {};
  for (const k of Object.keys(EVERY_MS) as Periodic[]) if (rows[k]?.last) last[k] = rows[k].last!;
  return { last, missed: tickMissed(), suite: getJson("state", "tick.suite", {}) };
}

/** Whether a CI run on a factory main is in progress by the last CI read, or a land on one ended in the last FRESH_MS. */
function fresh(now: number): boolean {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  return [...keys].some(ciRunning) || allRuns().some(({ run }) => run.role === "land" && run.state === "landed" && run.repo && keys.has(run.repo) && now - Date.parse(run.ended ?? run.started) < FRESH_MS);
}

/** Whether `step` is due at `now`: it never ran, or it ran EVERY_MS[step] or more ago (a minute for ci and firefight while `fresh`). */
export function due(s: TickState, step: Periodic, now: number): boolean {
  const t = Date.parse(s.last[step] ?? "");
  const every = (step === "ci" || step === "firefight") && fresh(now) ? FRESH_EVERY_MS : EVERY_MS[step];
  return Number.isNaN(t) || now - t >= every;
}

type Json = Record<string, any>;
/** Which parts of the maintainer a pass runs: the mechanical `maintain`, the compile of yesterday, the re-check of the stale notes, the overlap queue, the misses queue. */
export interface Parts { mech: boolean; compile: boolean; decay: boolean; overlap: boolean; misses: boolean }

/** `run`'s result, or `{ error }` when it throws: one failed part does not stop the next. */
const part = async <T>(run: () => Promise<T>): Promise<T | { error: string }> => {
  try { return await run(); } catch (e) { return { error: errText(e) }; }
};

/**
 * The whole maintainer at `root`, in order: the mechanical pass (`dry` or not), then
 * a compile again of each failed day of the 3 before yesterday (`retried`), then the compile of yesterday unless it ran
 * already (`dry` while the mechanical pass is dry), then the re-check of the stale notes, the overlap queue, the misses queue. One report: the mechanical fields, `retried`, `compile`, `recheck`, `dedupe`, `alias`, and `counts` with `notes`, `rechecked`, `resolved` and `aliased` added.
 */
export async function maintainAll(root: string, dry: boolean, now: number, parts: Parts): Promise<Json> {
  const mech = parts.mech ? await maintain(root, dry) : null;
  const report: Json = mech ? (mech.ok ? mech.value : { op: "maintain", dry, ok: false, error: mech.error }) : { op: "maintain", dry, ok: true };
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
  if (parts.misses) report.alias = await part(() => alias(root, dry, now));
  const notes = report.compile?.notes?.filter((n: Json) => !n.refused).length;
  const rechecked = report.recheck?.notes?.filter((n: Json) => !n.refused).length;
  const resolved = report.dedupe?.pairs?.filter((p: Json) => !p.refused).length;
  const aliased = report.alias?.misses?.filter((m: Json) => m.verdict === "alias" && !m.refused).length;
  report.counts = { ...report.counts, ...(notes !== undefined ? { notes } : {}), ...(rechecked !== undefined ? { rechecked } : {}), ...(resolved !== undefined ? { resolved } : {}), ...(aliased !== undefined ? { aliased } : {}) };
  return report;
}

/** The one-line result of a pass for the tick: the mechanical counts, then each other part's count or its error, and each retried day whose compile failed with its error. */
const summary = (r: Json): string => {
  const c = Object.entries(r.counts as Record<string, number>).filter(([k]) => k !== "notes" && k !== "rechecked" && k !== "resolved" && k !== "aliased").map(([k, v]) => `${v} ${k}`).join(", ");
  const tail = (k: string, what: string) => (r[k]?.error ? [`${k} failed: ${r[k].error}`] : r.counts[what] !== undefined ? [`${r.counts[what]} ${what}`] : []);
  const retried = ((r.retried ?? []) as Json[]).flatMap((x) => (x.error ? [`${x.day} ${x.error}`] : []));
  return [...(c ? [`${r.dry ? "dry: " : ""}${c}`] : []), ...(retried.length ? [`retried failed: ${retried.join(", ")}`] : []), ...tail("compile", "notes"), ...tail("recheck", "rechecked"), ...tail("dedupe", "resolved"), ...tail("alias", "aliased")].join(" · ");
};

/**
 * The daily maintainer, from 03:00 local, once per local date, under the pause gate. The mechanical pass stays dry and
 * its run record is its gate; the compile follows it.
 * Returns the report, or null when nothing is due or the vault is not there for the mechanical part.
 */
export async function maintainStep(now = Date.now()): Promise<Json | null> {
  const root = resolve(vaultDir()), at = readRun(root, "maintain")?.at;
  if (new Date(now).getHours() < DAILY_HOUR || paused()) return null;
  const mech = isVault(root) && !(at && today(new Date(at)) === today(new Date(now)));
  if (!mech) return null;
  const r = await maintainAll(root, true, now, { mech, compile: mech, decay: mech, overlap: mech, misses: mech });
  if (!r.ok) throw new Error("maintain failed; see its run record");
  return r;
}

/** What the sweep starts. Tests replace them. */
export interface SweepPorts { dispatch(): Promise<unknown>; suite(): void }
const sweepPorts: SweepPorts = { dispatch: runDispatch, suite: suiteDetached };


/** Delete the row of a closed issue, and the Ask of a job-keyed row whose job no longer waits: a close or an end that missed it leaves it. */
function clearDeadAsks(lists: Reader): void {
  const closed = new Set(sandboxRepos().flatMap((r) => (lists.list(r.key)?.items ?? []).filter((i) => CLOSED.includes(status(i))).map((i) => issueKey(i.id))));
  for (const [key, s] of allIssueStates()) {
    if (closed.has(key) || (s.ask && key.startsWith("job.") && getRun(key)?.state !== "waiting")) clearIssueState(key);
  }
}

/**
 * The safety net. It records what could move now and does not, each key with the time a tick first saw it: `stalled`
 * (land, issue, ingest), an Ask with no case text and no director run (`ask:`), and a job to rescue (`rescue:`). A key
 * that a tick saw before is missed. Each missed key is logged once as a `missed` event on its issue or job, its detail the step that did not move, and one dispatch starts them all:
 * its lands, rescues and issues, then the intake queue and the director. A red main that moved since its record (a fix
 * by hand) starts the suite once per commit. It reads the store and the repos as last fetched. Returns the missed keys.
 */
export async function sweep(now: number, s: TickState, p: SweepPorts = sweepPorts): Promise<string[]> {
  if (paused()) { writeStalls({}); s.missed = []; return []; }
  const jobs = allJobs(), runs = jobs.flat(), lists = reader({ fetch: false });
  clearDeadAsks(lists);
  const keys = await stalled(jobs, lists, decider({ fresh: false, jobs, lists }));
  for (const c of pendingCases(sandboxRepos(), runs, lists)) if (!holdsWork(runs, "director", subjectOfCase(c))) keys.push(`ask:${c.on}`);
  for (const j of toRescue(jobs)) keys.push(`rescue:${j[0].run.name}`);
  for (const j of editedWaits(jobs)) keys.push(`edited:${j[0].run.name}`);
  const seen = readStalls();
  writeStalls(Object.fromEntries(keys.map((k) => [k, seen[k] ?? new Date(now).toISOString()])));
  const over = keys.filter((k) => k in seen && !(k.startsWith("ingest:") && holdsWork(runs, "intake", k.slice("ingest:".length))));
  const missed = over.filter((k) => !s.missed.includes(k));
  s.missed = over;
  for (const k of missed) logEvent({ subject: "rule", action: "missed", ...missedOf(k) });
  if (missed.length) await p.dispatch();
  const reg = loadRegistry();
  for (const b of Object.values(baselines())) {
    const repo = reg[b.repo];
    if (b.ok || !repo?.sandbox) continue;
    const head = git(repo.path, "rev-parse", `origin/${repo.main}`).out;
    if (!head || head === b.commit || s.suite[b.repo] === head) continue;
    s.suite[b.repo] = head;
    logEvent({ subject: "rule", action: "started", object: b.repo, detail: `main moved to ${head.slice(0, 7)} while red at ${b.commit.slice(0, 7)}; the suite runs now` });
    p.suite();
  }
  return missed;
}

/**
 * The timeout's action on an Ask, as Chris's card takes it: approve lands the run; resolve on a run drops it with the
 * question as the reason, so it runs again; the reason's second verb drops the issue and its run; resolve or continue
 * on an issue is a decision with its intake. Any other action is refused. The refusal, or null.
 */
export async function takeOnTimeout(name: string, action: string, w: Waiting): Promise<string | null> {
  const said = `timeout: no answer to the ${w.ask.reason} Ask; ${w.ask.effects?.find((e) => e.action === action)?.text ?? action}`;
  const verb = action.split(":")[0];
  // The answer the timeout gives: the option's label of `resolve:<label>`, else the verb.
  const answer = { subject: "rule", answer: action.startsWith("resolve:") ? action.slice("resolve:".length) : verb };
  if (verb === "approve") return refusal(() => land(name, { lander: "timeout" }, { output: "ignore" }));
  if (w.run && verb === "resolve") return refusal(() => drop(name, { reason: `${said} (the question: "${w.ask.question}")`, quiet: true, answer }));
  // An issue's number is global: its repo is the one whose list holds it.
  const k = parseKey(w.key), id = k?.kind === "issue" ? k.n : undefined, lists = reader(), repo = id === undefined ? undefined : Object.values(loadRegistry()).find((r) => lists.item(r.key, id));
  if (!repo) return `no repo for ${w.key}`;
  // As `aleph issue drop`: the issue first, then its run, whose drop starts the dispatch.
  if (verb === actionsOn(w.ask.reason)[1]) return refusal(async () => { answering(w.key, answer, () => verbs.close(repo, id!, "drop", said)); if (w.run) await drop(name, { reason: said, quiet: true, answer }); });
  if (w.run || (verb !== "resolve" && verb !== "continue")) return `the timeout takes no ${action} on the ${w.ask.reason} Ask`;
  return refusal(async () => {
    const o = w.ask.options.find((x) => action === `resolve:${x.label}`);
    const d = verbs.decide(repo, id!, o ? `timeout decided: ${o.label}: ${o.line}` : said, o?.after ? { after: [o.after] } : {}, "rule", o?.label ?? verb);
    intakeDetached(repo, d.item.id);
  });
}

/** What the tick starts besides the sweep's ports: the intake of an issue the firefighter filed. */
export interface TickPorts extends SweepPorts { intake(repo: Repo, id: number): void }
const tickPorts: TickPorts = { ...sweepPorts, intake: intakeDetached };

/**
 * `aleph tick`: each step that is due at `now`. Returns what it did, for the tick's JSON. One tick holds the `tick`
 * lock from before it reads the tick state until after its write, so two ticks cannot run the same steps twice: a tick
 * that finds the lock busy runs no step, writes nothing and says so.
 */
export const runTick = (now = Date.now(), p: TickPorts = tickPorts): Promise<Record<string, unknown>> => keepingRuns(() => fetchingOnce(() => runLocked(now, p)));

async function runLocked(now: number, p: TickPorts): Promise<Record<string, unknown>> {
  const release = await lock("tick", 0);
  if (!release) return { tick: "lock busy" };
  try {
    const s = readTick();
    const at = new Date(now).toISOString();
    const out: Record<string, unknown> = {};
    // Each step's time and result, in its `tick` row; `say` gives the result, or null for a step that did not run.
    const ran: Record<string, { at: string; result: string }> = {};
    const step = async <T>(key: string, run: () => T | Promise<T>, say: (v: T) => string | null = () => "ok"): Promise<T | undefined> => {
      try {
        const v = await run(), result = say(v);
        if (result) ran[key] = { at, result };
        return v;
      } catch (e) {
        const note = errText(e);
        logEvent({ subject: "rule", action: "failed", object: key, detail: note });
        ran[key] = { at, result: `failed: ${note}` };
      }
    };
    // Before the sweep, so the issues a lifted hold frees are keys it starts this tick.
    const lifted = await step("hold", probeHold);
    if (lifted) out.hold = lifted;
    const m = await step("sweep", () => sweep(now, s, p), (k) => `${k.length} missed`);
    if (m?.length) out.missed = m;
    const mt = await step("maintain", () => maintainStep(now), (r) => r && summary(r));
    if (mt) out.maintain = mt.counts;
    if (due(s, "ci", now)) {
      s.last.ci = at;
      await step("ci", () => ciStep(sandboxRepos()), (r) => `${r.length} red`);
    }
    await step("smoke", () => smokeStep(undefined, now), (reason) => (reason ? `failed: ${reason}` : "ok"));
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
    // monitorStep records its own result; `say` gives null so `step` writes a row only for a failure.
    const mon = await step("monitor", () => monitorStep(new Date(now)), () => null);
    if (mon) out.monitor = mon.day;
    tx(() => {
      for (const [k, v] of Object.entries(s.last)) setTick(k, { last: v });
      for (const [k, v] of Object.entries(ran)) setTick(k, { last: v.at, result: v.result });
      putJson("state", "tick.missed", s.missed);
      putJson("state", "tick.suite", s.suite);
    });
    return out;
  } finally {
    release();
  }
}
