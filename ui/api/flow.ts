/**
 * `GET /api/flow?window=hour|day|week|month` (default week)[&project=<repo>]: how fast the factory's runs are, read from the run folders'
 * state.json (no Langfuse). Runs with a `started` and an `ended` count; one longer than 4 hours
 * is a broken clock and is skipped. Hour is the last 60 minutes in 1-minute buckets, day the last 24 hours in hourly ones, week and
 * month the last 7 and 30 local days (today included) in daily ones. A percentile is the nearest rank.
 * The phases also read when each issue file first came into the work store's git history.
 */
import { flakes } from "../../jobs/lib/gates/tables.ts";
import { decisions, roundsByJob, allRuns } from "../../jobs/lib/records/record.ts";
import { askHistory, type AskSpan } from "./gates.ts";
import { isAgentRun, type Entry, type Run } from "../../jobs/lib/records/ledger.ts";
import { activeEnd, duration } from "../../jobs/lib/infra/process.ts";
import { type StageRow, stageRows, stageRuns } from "../../jobs/lib/learning/monitor-table.ts";
import type { Routes } from "../server.ts";
import { everyFetched, filed, headOnMain, reader, type Filed } from "../../lib/store.ts";
import { status, sourceOf } from "../../lib/todo.ts";
import { currentFit, type Fit } from "../usage.ts";
import { LIVE_CAP } from "../../jobs/lib/infra/settings.ts";
// @ts-ignore plain JS, shared with the page
import { MIN_LANDED, shortModel } from "../views/lib/format.js";
import { issueHref, parseId, parseKey, type EventRow } from "../../lib/naming.ts";
import { eventIn, inProject, repoIn, scopeOf } from "./scope.ts";
import { readEvents } from "../../lib/layout.ts";
import { BUCKETS, buckets, quantile, WINDOWS, type Window } from "../../lib/windows.ts";
import { activeIssues, issueOf, MAX_RUN, phaseTimes, PHASE_KEYS, phaseStat, round, splitId, stat, type Active, type IssueTimes, type Pct, type Phase, type PhaseStat } from "../flow/phases.ts";
import { classify, GONE, type ClassStat } from "../flow/classes.ts";
import { agentStats, type Agents } from "../flow/agents.ts";
import { BASELINE, averageFigures, figures, type Baseline } from "../flow/baseline.ts";

/** The subjects of an event that file a follow-up: the factory's own actors, not claude and not human. */
const FOLLOWUPS = ["worker", "intake", "gate", "rule", "director", "housekeeper", "maintainer"];
/** 2026-11-13T18:09:00Z (10:09 PST): from then a filed event names the filer in its subject. Before it the subject is always `rule`, so only the issue's own `source: worker` makes the filing a follow-up. */
const NAMED_FILER = Date.parse("2026-11-13T18:09:00Z");

/** The numbers of the store's issues whose front matter says `source: worker`. */
const workerIssues = (): Set<number> => new Set(everyFetched().filter(({ item }) => sourceOf(item) === "worker").map(({ item }) => item.id));
export const KINDS = ["land", "intake"] as const;

export interface Speed {
  window: Window;
  /** Issues that landed in the window: one per issue, however many land runs it had. Land runs with no issue count as one. */
  done: number;
  kinds: Record<(typeof KINDS)[number], Pct>;
  /** Intake: issue created to its first intake (or triage) end. Queue: that end, or the filing with none, to the issue's first agent start. Implement: job's first agent start to its last finish. Land: finish to landed. Lead: issue created to its last land. Each counts in the window where it ends. */
  phases: Record<Phase, PhaseStat>;
  /** Asks set in the window: `count` all of them, `manual` those that came to Chris (a director event "escalated" from the set time until the Ask cleared). */
  asks: { count: number; manual: number };
  checks: { name: string; count: number; p50: number; p90: number }[];
  /** hour: 60 buckets of 1 minute; day: 24 hourly; week: 7 and month: 30 local days; `at` is its local start as an ISO string; `cost` is the recorded cost of the agent runs that started in it, per model, and `tokens` their saved tokens (0 for a run with none). */
  /** Issues in each stage per bucket, for the Status page's chart. */
  active: Active[];
  buckets: ({ at: string; runs: number; cost: Record<string, number>; tokens: Record<string, number>; p90: Record<Phase, number | null> } & Record<Phase, number | null>)[];
  /** Every issue with a phase that ended in the window. `size` is the size of its last build run, null when that run has none or the issue has no build. */
  times: (IssueTimes & { size: string | null })[];
  /** Queue seconds over lead seconds, over the issues that landed in the window: how many, and their p50 (0 to 1; null with none). */
  wait: { count: number; p50: number | null };
  /** Every build run that started in the window, in start order. `issue` is its issue key, null for a run on no issue; `model` is the short name; `secs` its time; `landed` says its issue landed in the window. */
  builds: { issue: string | null; model: string; size: string | null; secs: number; landed: boolean }[];
  slowest: { name: string; state: string; model: string; tests: number | null; cost: number; took: number }[];
  /** The stages of the window, as the monitor counts them, and each Pipeline stage's issues: failed first, then most seconds. */
  stages: { rows: StageRow[]; issues: Record<(typeof PIPELINE)[number], StageIssue[]> };
  /** Issues filed in the window by an event of the event table: `all` of them, `followups` those the factory's own actors filed (not claude, not human). Before 2026-11-13T18:09:00Z the filer is not in the subject, so there only an issue with `source: worker` counts. */
  filed: { followups: number; all: number };
  /** Issues closed as dropped in the window: a `dropped` event on an issue key. A job's drop is not one. */
  dropped: number;
  /** Landed issues (one per issue that landed in the window) and what they cost to get there. */
  issues: {
    landed: number;
    /** Share of landed issues whose landing jobs, and the jobs they retry, had no run sent back, 0 to 1; null with none landed. */
    firstPass: number | null;
    /** Median fix rounds per landed issue; null with none landed. */
    fixRounds: number | null;
  };
  classes: ClassStat[];
  notCounted: { runs: number; issues: number; hours: number };
  lost: { hours: number; share: number };
  agents: Agents;
}

const isTests = (name: string) => /^tests?$/.test(name);

/** `project` names one repo: then only its runs, Asks and flakes count. */
/** What `speed` reads: the Asks and the director's decisions, the store's lists and history at origin/main, and the flakes. A baseline reads them once for all its spans. */
interface Inputs { asks: AskSpan[]; decisions: { at: string; ref: string; outcome?: string }[]; head: string; lists: ReturnType<typeof reader>; filed: Filed; flakes: ReturnType<typeof flakes> }
export function inputs(): Inputs {
  const head = headOnMain();
  return { asks: askHistory(), decisions: decisions<{ at: string; ref: string; outcome?: string }>(), head, lists: reader({ fetch: false, rev: head || undefined }), filed: filed(undefined, head), flakes: flakes() };
}

export function speed(window: Window, now = new Date(), fit: Fit | null = null, project?: string, inp = inputs()): Speed {
  const b = buckets(window, now.getTime()), n = b.starts.length, since = new Date(b.since);
  const times: Record<string, number[]> = { land: [], intake: [] };
  const checks = new Map<string, number[]>();
  const agents: { name: string; state: string; model: string; tests: number | null; cost: number; took: number }[] = [];
  const built: { r: Run; secs: number }[] = [];

  const { lists } = inp;
  const entries = allRuns().filter((e) => repoIn(e.run.repo, project));
  const all = entries.map((x) => x.run);
  const landed: Run[] = [];
  for (const e of entries) {
    const r = e.run, t0 = Date.parse(r.started), secs = duration(e);
    if (!(t0 >= since.getTime()) || t0 > now.getTime() || secs === null || secs * 1000 > MAX_RUN) continue;
    const kind = isAgentRun(r.role) ? "agent" : r.role;
    if (kind in times) times[kind].push(secs);
    for (const c of r.checks ?? []) {
      if (!checks.has(c.name)) checks.set(c.name, []);
      checks.get(c.name)!.push(c.seconds);
    }
    if (kind === "land" && r.state === "landed") landed.push(r);
    if (kind !== "agent") continue;
    const model = r.model || "unset";
    if (r.role === "build") built.push({ r, secs });
    agents.push({ name: r.name, state: r.state, model, tests: (r.checks ?? []).find((c) => isTests(c.name))?.seconds ?? null, cost: round(r.cost ?? 0, 2), took: round(secs) });
  }
  // A fix round is the rule of roundsByJob: first pass and `fixRounds` both read it.
  const rounds = roundsByJob(entries);
  // Landed issues: a land run of an issue with no number all share the one key "none". An issue's fix rounds are the most any of its landing runs' jobs needed.
  const landedBy = new Map<string, Run[]>();
  for (const r of landed) {
    const k = issueOf(r) ?? "none";
    landedBy.set(k, [...(landedBy.get(k) ?? []), r]);
  }
  const issuesLanded = landedBy.size;
  const perIssue = [...landedBy.values()];
  const fixes = perIssue.map((rs) => Math.max(...rs.map((r) => rounds.get(r.job) ?? 0)));
  const issues: Speed["issues"] = {
    landed: issuesLanded,
    firstPass: issuesLanded ? round(perIssue.filter((rs) => rs.every((r) => !rounds.get(r.job))).length / issuesLanded, 4) : null,
    fixRounds: quantile(fixes, 0.5),
  };
  const statusOf = (ref: string): string | undefined => {
    const [repo, n] = splitId(ref);
    const item = repo ? lists.item(repo, n) : undefined;
    if (item) return status(item);
    // An issue that is not in a readable list left the store.
    return repo && lists.list(repo) ? GONE : undefined;
  };
  const cls = classify(entries.map(activeEnd), statusOf, since.getTime(), now.getTime(), fit);
  const ended = phaseTimes(all, inp.filed, since.getTime(), now.getTime());
  const stages = { rows: stageRows({ runs: entries }, since.getTime(), now.getTime()), issues: stageIssues(entries, ended.issues, since.getTime(), now.getTime()) };
  for (const t of [...cls.classes.flatMap((c) => c.top), ...Object.values(stages.issues).flat()]) {
    const [repo, n] = splitId(t.issue);
    const item = lists.item(repo, n);
    t.title = item?.title;
    // The link would be a 404 for an issue that left the store.
    if (!item && lists.list(repo)) delete t.href;
  }
  // The size of an issue is the size of its last build run, in all the records.
  const sizeOf = new Map<string, { at: number; size: string | null }>();
  for (const r of all) {
    const key = r.role === "build" ? issueOf(r) : undefined, at = Date.parse(r.started);
    if (key !== undefined && at >= (sizeOf.get(key)?.at ?? -Infinity)) sizeOf.set(key, { at, size: r.size ?? null });
  }
  const timed = ended.issues.map((i) => ({ ...i, size: sizeOf.get(i.id)?.size ?? null }));
  const shares = timed.filter((i) => i.outcome === "landed" && i.queue !== null && i.lead).map((i) => i.queue! / i.lead!);
  const med = (xs: { at: number; secs: number }[], i: number, q = 0.5) => {
    const inBucket = xs.filter((x) => b.slotOf(x.at) === i).map((x) => x.secs);
    return inBucket.length ? round(quantile(inBucket, q)!) : null;
  };
  const started = Array.from({ length: n }, () => 0);
  const costs = Array.from({ length: n }, () => ({} as Record<string, number>));
  const tokens = Array.from({ length: n }, () => ({} as Record<string, number>));
  for (const e of entries) {
    const t = Date.parse(e.run.started);
    if (t >= since.getTime() && t < now.getTime()) started[b.slotOf(t)]++;
    if (!isAgentRun(e.run.role) || !(t >= since.getTime() && t < now.getTime())) continue;
    const spent = costs[b.slotOf(t)], model = e.run.model || "unset";
    spent[model] = round((spent[model] ?? 0) + (e.run.cost ?? 0), 4);
    const used = tokens[b.slotOf(t)];
    used[model] = (used[model] ?? 0) + (e.run.tokens ?? 0);
  }
  const events = readEvents(since.getTime()).filter((e) => Date.parse(e.time) <= now.getTime() && eventIn(e.object, project, e.project));
  const filings = events.filter((e) => e.action === "filed");
  // The filer is named in the subject only from NAMED_FILER on; before that the issue's source decides.
  let workers: Set<number> | undefined;
  const followup = (e: EventRow) => {
    if (Date.parse(e.time) >= NAMED_FILER) return FOLLOWUPS.includes(e.subject);
    const n = numOf(e.object);
    return n !== undefined && (workers ??= workerIssues()).has(n);
  };
  return {
    window,
    done: issuesLanded,
    kinds: Object.fromEntries(KINDS.map((k) => [k, stat(times[k])])) as Speed["kinds"],
    phases: Object.fromEntries(PHASE_KEYS.map((k) => [k, phaseStat(ended[k].map((x) => x.secs))])) as Speed["phases"],
    asks: asksOf(inp, project, since.getTime(), now.getTime()),
    checks: [...checks].map(([name, xs]) => ({ name, ...stat(xs) })).sort((a, b) => a.name.localeCompare(b.name)),
    buckets: b.starts.map((at, i) => ({ at: new Date(at).toISOString(), runs: started[i], cost: costs[i], tokens: tokens[i], p90: Object.fromEntries(PHASE_KEYS.map((k) => [k, med(ended[k], i, 0.9)])), ...Object.fromEntries(PHASE_KEYS.map((k) => [k, med(ended[k], i)])) }) as Speed["buckets"][number]),
    times: timed,
    wait: { count: shares.length, p50: shares.length ? round(quantile(shares, 0.5)!, 4) : null },
    builds: built.map(({ r, secs }) => ({ issue: issueOf(r) ?? null, model: shortModel(r.model || "unset"), size: r.size ?? null, secs: round(secs), landed: landedBy.has(issueOf(r) ?? "") })),
    active: activeIssues(all, inp.filed, b, now.getTime(), (k) => inProject(k, project) && statusOf(k) === "open"),
    slowest: agents.sort((a, b) => b.took - a.took).slice(0, 6),
    stages,
    issues,
    classes: cls.classes,
    notCounted: cls.notCounted,
    lost: cls.lost,
    agents: agentStats(entries, since.getTime(), now.getTime(), BUCKETS[window].fine, LIVE_CAP(), undefined, Array.from({ length: BASELINE[window].n }, (_, i): [number, number] => [since.getTime() - (i + 1) * WINDOWS[window], now.getTime() - (i + 1) * WINDOWS[window]])),
    filed: { followups: filings.filter(followup).length, all: filings.length },
    dropped: events.filter((e) => e.action === "dropped" && parseKey(e.object)?.kind === "issue").length,
  };
}

/** The Pipeline's stages. Queue is the wait before an issue's first agent run, so its rows have no runs. */
const PIPELINE = ["intake", "queue", "build", "review", "recheck", "land"] as const;
/** One issue in one stage: `secs` sums its runs' seconds there (a Queue row's is its wait); `failed` says a run gave nothing usable. */
type StageIssue = { issue: string; title?: string; href?: string; runs: number; secs: number; failed: boolean };

/** Each Pipeline stage's issues in `since`..`now`, failed first, then most seconds. A run on no issue is in no row. */
function stageIssues(entries: Entry[], times: IssueTimes[], since: number, now: number): Speed["stages"]["issues"] {
  const by = new Map<string, Map<string, StageIssue>>(PIPELINE.map((k) => [k, new Map()]));
  for (const x of stageRuns(entries, since, now)) {
    const key = issueOf(x.run), rows = by.get(x.stage);
    if (!key || !rows) continue;
    const row = rows.get(key) ?? { issue: key, runs: 0, secs: 0, failed: false };
    rows.set(key, { ...row, runs: row.runs + 1, secs: row.secs + (x.secs ?? 0), failed: row.failed || x.unusable });
  }
  for (const t of times) if (t.queue !== null) by.get("queue")!.set(t.id, { issue: t.id, runs: 0, secs: t.queue, failed: false });
  const sorted = (rows: Map<string, StageIssue>) => [...rows.values()].map((r) => ({ ...r, secs: round(r.secs), href: issueHref(r.issue) })).sort((a, b) => Number(b.failed) - Number(a.failed) || b.secs - a.secs);
  return Object.fromEntries(PIPELINE.map((k) => [k, sorted(by.get(k)!)])) as Speed["stages"]["issues"];
}

/** The number of an issue, from its key or its old `<repo>-<n>` ID. */
const numOf = (s: string): number | undefined => parseKey(s)?.n ?? parseId(s)?.n;

function asksOf(inp: Inputs, project: string | undefined, since: number, now: number): Speed["asks"] {
  const asks = inp.asks.filter((a) => inProject(a.issue, project) && Date.parse(a.set) >= since && Date.parse(a.set) <= now);
  const escalated = (a: AskSpan) => inp.decisions.some((d) => d.outcome === "escalated" && numOf(d.ref) === numOf(a.issue) && d.at >= a.set && (!a.cleared || d.at < a.cleared));
  return { count: asks.length, manual: asks.filter(escalated).length };
}

/** The open and parked issues now, of `project` or of all projects. */
export function openNow(project?: string): { open: number; parked: number } {
  const states = everyFetched().filter(({ repo }) => repoIn(repo, project)).map(({ item }) => status(item));
  return { open: states.filter((x) => x === "open").length, parked: states.filter((x) => x === "parked").length };
}

/** The baseline in one read of its inputs: each span is computed from the same records and store. */
export function baseline(window: Window, now = new Date(), fit: Fit | null = null, project?: string, inp = inputs()): Baseline {
  const b = BASELINE[window];
  const spans = Array.from({ length: b.n }, (_, i) => figures(speed(window, new Date(now.getTime() - (i + 1) * WINDOWS[window]), fit, project, inp)));
  return { prev: spans[0], base: b.avg ? averageFigures(spans) : spans[0], basis: b.basis };
}

export const routes: Routes = {
  "GET /api/flow": async (_req, _params, url) => {
    const sc = scopeOf(url);
    if (sc instanceof Response) return sc;
    // `project`: only the runs and issues of that repo count.
    const w = sc.window as Window, project = sc.project ?? undefined;
    const fit = await currentFit(), inp = inputs(), now = new Date(), d = speed(w, now, fit, project, inp);
    // `baseline=1`: the trend baseline of the window in the same answer, so the Status page makes one request.
    // `figures`: what the Status cards show for the window, the same function the baseline's spans use. `open`: the counts now, for the Pipeline card.
    const out = { ...d, figures: figures(d), open: openNow(project) };
    if (url.searchParams.get("baseline") !== "1") return Response.json(out);
    return Response.json({ ...out, baseline: baseline(w, now, fit, project, inp) });
  },
};
