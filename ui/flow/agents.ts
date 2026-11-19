import { isBuild, type Entry } from "../../jobs/lib/records/ledger.ts";
import { roundsByJob } from "../../jobs/lib/records/record.ts";
import { isRunning } from "../../jobs/lib/infra/process.ts";
import { causeOf } from "../../jobs/lib/records/outcome.ts";
import { OFFERS, readModels } from "../../jobs/lib/routing/models.ts";
import { bare, isLocal } from "../../lib/models.ts";
import { NAMES } from "../../lib/naming.ts";
import { quantile } from "../../lib/windows.ts";
import { HOUR, MAX_RUN, passedState, round } from "./phases.ts";

/** One role of the factory's agents. `live` is the runs live now; `runs` started in the window; `hours` is their agent time inside it; `p50` and `p95` are their times in seconds. The Reviewer's are those of its own `review` jobs. */
export interface AgentRole { key: AgentKey; name: string; live: number; runs: number; hours: number; p50: number | null; p95: number | null; models: string[] }
/**
 * One role and model of the window with how its runs ended. `ended` is succeeded + failed + error (a running run counts in `runs` only). `rate` is succeeded over `ended` (null with none); `baseline` is the same rate over the baseline's spans (null with no data). `cost` is the recorded cost of the runs; `p50` and `p95` are their times in seconds; `from` and `to` are the first and last start of its runs in the window (ISO, null with no runs).
 * Worker rows are one per size and model: they add `size` (small, medium or large; a build with no size, or another size, is in no worker row and counts only toward the reviewer's verdicts), `built` (succeeded runs of a landed job), `perBuilt` (`cost` over `built`, null with none built), `firstPass` (those whose job, and the jobs it retries, had no run sent back) and `reviewPass` (the reviewer's pass share of the verdicts on their builds, null with none); Reviewer rows add `pass` and `fail`, and their `rate` is the verdicts (`pass` + `fail`) over `ended`.
 */
interface OutcomeRow {
  role: AgentKey; model: string; runs: number; succeeded: number; failed: number; error: number; ended: number;
  rate: number | null; p50: number | null; p95: number | null; cost: number; baseline: number | null; from: string | null; to: string | null;
  size?: string | null;
  firstPass?: number; built?: number; perBuilt?: number | null; reviewPass?: number | null; pass?: number; fail?: number;
}
/** The agents over the window. `workers` and `cap` are the runs the live cap counts, now. `mean` and `peak` count all timed roles, and each point holds each role's mean live in its step. */
export interface Agents {
  live: number; workers: number; cap: number; mean: number; peak: number;
  roles: AgentRole[];
  outcomes: OutcomeRow[];
  /** Over the window, 0 to 1, null with no data: `success` is succeeded over ended runs of all roles but the reviewer, `baseline` the same over the baseline's spans, `firstPass` the share of landed worker builds whose job, and the jobs it retries, had no run sent back, `local` the share of runs on gpt-oss-20b. */
  rates: { success: number | null; baseline: number | null; firstPass: number | null; local: number | null };
  points: ({ at: string } & Partial<Record<AgentKey, number>>)[];
}

// The roles with their run kind. A land and a recheck run only checks and git, so they are not agents.
const AGENT_ROLES = ([["worker", "build"], ["intake", "intake"], ["director", "director"], ["monitor", "monitor"], ["housekeeper", "housekeeper"], ["maintainer", "maintainer"], ["lens", "lens"], ["title", "title"], ["judge", "judge"], ["reviewer", "review"]] as const).map(([key, kind]) => [key, NAMES[key], kind] as const);
type AgentKey = (typeof AGENT_ROLES)[number][0];

/** "claude-opus-5-5" as "opus"; "sonnet" stays. */
const modelName = (m: string) => /^claude-([a-z]+)-/.exec(bare(m))?.[1] ?? bare(m);

/** The model a size (small, medium or large) is set to now, or undefined for any other size. */
const sizeModel = (size: string | undefined): string | undefined => (size && size in OFFERS ? readModels()[size as keyof typeof OFFERS].model : undefined);

/**
 * The rows of OutcomeRow for the runs that started in `since`..`now`, without `baseline`.
 * What "succeeded" means, from what each role's run records:
 * - Worker (build, older "agent"): the run ends `passed`, `waiting` or `landed`: its checks passed and the reviewer did not send it back. A run that a reviewer or a check sent back is `returned`: that is a fail, not an error.
 * - Intake, Triage, Planner, Director: the run ends `passed` or `done`: the role applied its route or wrote its answer. These roles set no `failed`.
 * - Housekeeper, Maintainer: like Intake, the run ends `passed` or `done`.
 * - Reviewer: its runs, model, cost, times and ends are those of its own `review` jobs, and it succeeded when the job ended `passed` or `done`. Its pass and fail counts (and so `rate`) are read from the verdicts on the builds: a succeeded build is a pass; `failed: "review"` (or an older `review.call` of `returned`) is a fail; `review.call` of `passed` is a pass. A build with no verdict counts as neither. A verdict's model is the build's `review.model`, else that of the review run whose `prev` is the build's job, else "unset".
 * - A model counts under its name without a provider prefix, and a build with no model under its size's model, so the rows match the names the models setting carries.
 * Error is a run that ended `failed` with no `failed` field, or with the cause `timeout` or `stalled`. Failed is any other end that is not running. A running run counts in `runs` only.
 */
function outcomeRows(entries: Entry[], since: number, now: number): OutcomeRow[] {
  const order = (k: string) => AGENT_ROLES.findIndex(([r]) => r === k) + 1 || AGENT_ROLES.length + 1;
  const rows = new Map<string, OutcomeRow & { secs: number[]; starts: number[]; verdicts: number; landed: number }>();
  const row = (role: OutcomeRow["role"], model: string, size?: string | null) => {
    const k = `${role}\0${model}\0${size}`;
    if (!rows.has(k)) rows.set(k, { role, model, ...(size === undefined ? {} : { size }), runs: 0, succeeded: 0, failed: 0, error: 0, ended: 0, rate: null, p50: null, p95: null, cost: 0, baseline: null, from: null, to: null, secs: [], starts: [], verdicts: 0, landed: 0 });
    return rows.get(k)!;
  };
  const runs = entries.map((e) => e.run);
  // The review run of a build: the one whose `prev` is the build's job. Its model serves a verdict that has none.
  const reviews = new Map<string, string>();
  for (const e of entries) if (e.run.role === "review" && e.run.prev && e.run.model) reviews.set(e.run.prev, e.run.model);
  // A job landed when a land run of it landed; a fix round is the rule of roundsByJob.
  const landedJobs = new Set(runs.filter((r) => r.role === "land" && r.state === "landed").map((r) => r.job));
  const rounds = roundsByJob(entries);
  for (const e of entries) {
    const r = e.run;
    const a = Date.parse(r.started);
    if (!(a >= since && a < now)) continue;
    const ok = passedState(r.state) || r.state === "waiting";
    const cause = causeOf(r);
    const error = !ok && r.state !== "running" && (cause === "timeout" || cause === "stalled" || (r.state === "failed" && !r.failed));
    const fail = !ok && !error && r.state !== "running";
    const build = isBuild(r.role);
    const role = build ? "worker" : AGENT_ROLES.find(([, , kind]) => kind === r.role)?.[0];
    const model = bare(r.model) || (build ? sizeModel(r.size) : undefined) || "unset";
    const size = build ? (["small", "medium", "large"].includes(r.size ?? "") ? r.size! : null) : undefined;
    if (role && size !== null) {
      const w = row(role, model, size);
      w.runs++; w.cost += r.cost ?? 0; w.starts.push(a);
      if (ok) w.succeeded++; else if (error) w.error++; else if (fail) w.failed++;
      const b = Date.parse(r.ended ?? "");
      if (b >= a && b - a <= MAX_RUN) w.secs.push((b - a) / 1000);
      if (ok && build && landedJobs.has(r.job)) {
        w.built = (w.built ?? 0) + 1;
        if (!rounds.get(r.job)) w.firstPass = (w.firstPass ?? 0) + 1;
      }
    }
    if (build) {
      const back = r.failed === "review" || r.review?.call === "returned", land = ok || r.review?.call === "passed";
      if (back || land) {
        const v = row("reviewer", bare(r.review?.model) || bare(reviews.get(e.id)) || "unset");
        if (back) v.fail = (v.fail ?? 0) + 1; else v.pass = (v.pass ?? 0) + 1;
        if (size) { const w = row("worker", model, size); w.verdicts++; w.landed += back ? 0 : 1; }
      }
    }
  }
  return [...rows.values()].map(({ secs, starts, verdicts, landed, ...x }) => {
    const ended = x.succeeded + x.failed + x.error, cost = round(x.cost, 2), done = x.role === "reviewer" ? (x.pass ?? 0) + (x.fail ?? 0) : x.succeeded;
    const iso = (t: number) => (starts.length ? new Date(t).toISOString() : null);
    return {
      ...x, ended, cost, from: iso(Math.min(...starts)), to: iso(Math.max(...starts)), rate: ended ? round(done / ended, 4) : null, p50: secs.length ? round(quantile(secs, 0.5)!) : null, p95: secs.length ? round(quantile(secs, 0.95)!) : null,
      ...(x.role === "worker" ? { firstPass: x.firstPass ?? 0, built: x.built ?? 0, perBuilt: x.built ? round(cost / x.built, 2) : null, reviewPass: verdicts ? round(landed / verdicts, 4) : null } : {}),
      ...(x.role === "reviewer" ? { pass: x.pass ?? 0, fail: x.fail ?? 0 } : {}),
    };
  }).sort((p, q) => order(p.role) - order(q.role) || q.runs - p.runs || p.model.localeCompare(q.model));
}

/** The agents by role over `since`..`now`. `before` are the baseline's spans, each a [since, now] before the window. A run with the state running ends at `now` when `alive` says so, and does not count when not. `step` is the width of a point in ms. */
export function agentStats(entries: Entry[], since: number, now: number, step: number, cap: number, alive: (e: Entry) => boolean = isRunning, before: [number, number][] = []): Agents {
  const length = Math.ceil((now - since) / step);
  const edges: [number, number][] = [];
  const points: Agents["points"] = Array.from({ length }, (_, i) => ({ at: new Date(since + i * step).toISOString() }));
  const roles: AgentRole[] = AGENT_ROLES.map(([key, name, kind]) => {
    let live = 0, ms = 0;
    const times: number[] = [], models = new Map<string, number>();
    let runs = 0;
    for (const e of entries) {
      const r = e.run;
      if (r.role !== kind) continue;
      const running = r.state === "running" && alive(e);
      if (running) live++;
      const a = Date.parse(r.started), b = r.ended ? Date.parse(r.ended) : running ? now : NaN;
      if (a >= since && a < now) {
        runs++;
        if (r.model) models.set(modelName(r.model), (models.get(modelName(r.model)) ?? 0) + 1);
        if (r.ended && b >= a && b - a <= MAX_RUN) times.push((b - a) / 1000);
      }
      if (!(b >= a) || b - a > MAX_RUN || b <= since || a >= now) continue;
      const from = Math.max(a, since), to = Math.min(b, now);
      ms += to - from;
      edges.push([from, 1], [to, -1]);
      for (let i = Math.floor((from - since) / step); i < length && since + i * step < to; i++) {
        const lo = since + i * step, part = Math.min(to, lo + step) - Math.max(from, lo);
        points[i][key] = (points[i][key] ?? 0) + part / step;
      }
    }
    return { key, name, live, runs, hours: round(ms / HOUR, 1), p50: times.length ? round(quantile(times, 0.5)!) : null, p95: times.length ? round(quantile(times, 0.95)!) : null, models: [...models].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([m]) => m) };
  });
  // An end before a start at the same moment: a run that follows another does not add one.
  edges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let up = 0, peak = 0;
  for (const [, d] of edges) { up += d; if (up > peak) peak = up; }
  for (const p of points) for (const [key] of AGENT_ROLES) if (p[key] !== undefined) p[key] = round(p[key]!, 2);
  // The baseline rate of a role and model: the mean of its rate over the spans that have data, as averageFigures takes it.
  const prior = before.map(([a, b]) => outcomeRows(entries, a, b));
  const outcomes = outcomeRows(entries, since, now).map((o) => {
    const v = prior.map((p) => p.find((x) => x.role === o.role && x.model === o.model && x.size === o.size)?.rate).filter((n): n is number => n != null);
    return { ...o, baseline: v.length ? round(v.reduce((x, y) => x + y, 0) / v.length, 4) : null };
  });
  const success = (rows: OutcomeRow[]) => {
    const w = rows.filter((o) => o.role !== "reviewer"), ended = w.reduce((n, o) => n + o.ended, 0);
    return ended ? round(w.reduce((n, o) => n + o.succeeded, 0) / ended, 4) : null;
  };
  const base = prior.map(success).filter((n): n is number => n != null);
  const own = outcomes.filter((o) => o.role !== "reviewer"), total = own.reduce((n, o) => n + o.runs, 0), built = outcomes.reduce((n, o) => n + (o.built ?? 0), 0);
  const rates = {
    success: success(outcomes), baseline: base.length ? round(base.reduce((x, y) => x + y, 0) / base.length, 4) : null,
    firstPass: built ? round(outcomes.reduce((n, o) => n + (o.firstPass ?? 0), 0) / built, 4) : null,
    local: total ? round(own.filter((o) => isLocal(o.model)).reduce((n, o) => n + o.runs, 0) / total, 4) : null,
  };
  const span = now - since, hours = roles.reduce((n, r) => n + r.hours, 0);
  return {
    live: roles.reduce((n, r) => n + r.live, 0), workers: roles[0].live, cap,
    mean: span ? round((hours * HOUR) / span, 1) : 0, peak,
    outcomes, rates,
    roles,
    points,
  };
}
