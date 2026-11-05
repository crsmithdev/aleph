/**
 * `GET /api/gates`: what the Gates page shows. The gates now, the Asks that wait for Chris, one rule per
 * Ask reason, the held paths, and the log of who decided what. Each part comes from the module that
 * owns it; this file only gathers them.
 * `POST /api/gates/revoke/:reason`: `aleph always revoke <reason>`, the Ask-me side of a rule. The grant side is
 * `POST /api/standing/:reason` (standing.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ASK_REASONS, readAlways } from "../../jobs/lib/asks/ask.ts";
import { allHolds, baselines, factoryRepos, gates, redLine, stopsStart } from "../../jobs/lib/gates/factory-status.ts";
import { latestReport } from "../../jobs/lib/learning/monitor-table.ts";
import { allJobs } from "../../jobs/lib/records/job.ts";
import * as record from "../../jobs/lib/records/record.ts";
import { layout, readFactoryLog } from "../../jobs/lib/infra/layout.ts";
import { CAP_KEYS, LIVE_CAP, RUN_CAP, capEnvSet, writeCaps } from "../../jobs/lib/infra/settings.ts";
import { reader } from "../../issues/lib/store.ts";

import { runCli } from "../cli.ts";
import { sameSite, text } from "../http.ts";
import { loadState } from "../state-load.ts";
import type { State } from "../state.ts";
import type { Routes } from "../server.ts";

/** The log keeps the entries of the last LOG_DAYS days, newest first, at most LOG_MAX of each actor. */
export const LOG_DAYS = 7, LOG_MAX = 200;
const DAY = 86_400_000;
/** The windows that `?window=` takes. */
const WINDOWS: Record<string, number> = { hour: DAY / 24, day: DAY, week: 7 * DAY, month: 30 * DAY };
/** Whether `item` (`<repo>-<id>`) belongs to `project`; no project keeps every item. */
const inProject = (item: string, project?: string) => !project || item.startsWith(`${project}-`);

export type By = "You" | "Rule" | "Director" | "Firefighter" | "Gate";
export interface LogEntry { at: string; by: By; item: string; what: string; count?: number; first?: string }

/**
 * One row per raised Ask reason: its one automatic mode (`ASK_REASONS[reason].always`, "" for none) and what always.json grants.
 * A `proposal-<kind>` reason is granted per place (`proposal-<kind>:<place>`); its row lists those keys.
 */
export function rules(entries: LogEntry[] = [], records = record.all(), now = Date.now(), ms = LOG_DAYS * DAY) {
  const granted = readAlways();
  const from = now - ms, SLACK = 60_000;
  // An entry from before record.asks kept the reason takes the reason of the run's Ask: the record keeps it in rec.ask while rec.askRun awaits.
  const runReason = (rec: record.JobRecord, set: string) => rec.runs.some((x) => x.id === rec.askRun && x.condition === "awaiting" && Date.parse(x.started) <= Date.parse(set)) ? rec.ask?.reason : undefined;
  const asks = records.flatMap((rec) => (rec.asks ?? []).map((a) => ({ ...a, reason: a.reason ?? runReason(rec, a.set), issue: rec.issue, rec }))
    .filter((a) => a.reason && Date.parse(a.set) >= from));
  return Object.entries(ASK_REASONS).map(([reason, r]) => {
    const perPlace = reason.startsWith("proposal-");
    const g = granted[reason];
    const mine = asks.filter((a) => a.reason === reason);
    const decided = { rule: 0, director: 0, chris: 0 }, outcome = { fixed: 0, none: 0 };
    for (const a of mine) {
      if (!a.cleared) continue;
      const lo = Date.parse(a.set), hi = Date.parse(a.cleared) + SLACK;
      const by = entries.find((e) => e.item === a.issue && Date.parse(e.at) >= lo && Date.parse(e.at) <= hi
        && (e.by === "Rule" || e.by === "You" || (e.by === "Director" && /\bdecided:/.test(e.what))));
      if (by) decided[by.by === "Rule" ? "rule" : by.by === "You" ? "chris" : "director"]++;
      outcome[a.rec.runs.some((x) => x.kind === "build" && Date.parse(x.started) >= Date.parse(a.cleared!)) ? "fixed" : "none"]++;
    }
    return {
      reason, kind: r.kind, mode: r.always, fired: mine.length, decided, outcome,
      granted: g ? { action: g.action, at: g.at } : null,
      ...(perPlace ? { places: Object.keys(granted).filter((k) => k.startsWith(`${reason}:`)) } : {}),
    };
  });
}

/** The action of each answer note that the UI writes (ui/api/issues.ts): `retriage`, `rerun` and the approved recommendation of a prose question. */
const ANSWERS: [RegExp, string][] = [[/^Chris: run intake again$/, "retry"], [/^Chris: run it again$/, "rerun"], [/^Chris decided: My recommendation\b/i, "recommended"]];

/**
 * The answers that Chris gave 3 or more times to one Ask reason, in the window: his log entry inside an Ask's span on the same issue.
 * The answer is the action its note names (ANSWERS), else the note without `Chris: ` or `Chris decided: `.
 * `mode` is the answer when it is the reason's automatic mode, else "": only then can the answer become the rule.
 */
export function repeats(entries: LogEntry[], records = record.all(), now = Date.now(), ms = LOG_DAYS * DAY) {
  const from = now - ms, SLACK = 60_000;
  const counts = new Map<string, { reason: string; answer: string; count: number }>();
  for (const rec of records) for (const a of rec.asks ?? []) {
    if (!a.reason || !a.cleared || Date.parse(a.set) < from) continue;
    const lo = Date.parse(a.set), hi = Date.parse(a.cleared) + SLACK;
    const e = entries.find((x) => x.by === "You" && x.item === rec.issue && Date.parse(x.at) >= lo && Date.parse(x.at) <= hi);
    if (!e) continue;
    const answer = ANSWERS.find(([re]) => re.test(e.what))?.[1] ?? e.what.replace(/^Chris(?: decided)?: /, "");
    const k = `${a.reason}\n${answer}`;
    const c = counts.get(k) ?? { reason: a.reason, answer, count: 0 };
    c.count++;
    counts.set(k, c);
  }
  return [...counts.values()].filter((c) => c.count >= 3).map((c) => ({ ...c, mode: ASK_REASONS[c.reason]?.always === c.answer ? c.answer : "" }));
}

/** The held paths, from ui/security-facts.ts in a process of its own: the server imports no security path. */
export async function securityFacts(): Promise<{ held: string[] }> {
  const p = Bun.spawn([process.execPath, join(import.meta.dir, "..", "security-facts.ts")], { stdout: "pipe", stderr: "pipe", env: process.env });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`security-facts.ts exited ${code}: ${err.trim()}`);
  return JSON.parse(out);
}

const REF = /\b[a-z][\w.]*?-\d+(?:\.\d+)?\b/i;

/**
 * The Rule, Director and Firefighter lines of tick.log: the Always actions (`always:`, `<name>: always:`, `standing:`),
 * the director's decisions (`director: <ref>: <reason>: decided|escalated: …`, director.ts) and the firefighter's lines.
 */
function tickEntries(): LogEntry[] {
  const raw = readFactoryLog();
  const out: LogEntry[] = [];
  for (const l of raw.split("\n")) {
    const m = /^(\S+) (.*)$/.exec(l);
    if (!m) continue;
    const [, at, line] = m;
    let e: RegExpExecArray | null;
    if ((e = /^always: revoked (\S+)$/.exec(line))) out.push({ at, by: "You", item: "rule", what: `${e[1]}: set to Ask me` });
    else if ((e = /^always: (\S+): (\S+) on (\S+)$/.exec(line))) out.push({ at, by: "Rule", item: e[3], what: `${e[1]}: ${e[2]}` });
    else if ((e = /^(\S+): always: (.*)$/.exec(line))) out.push({ at, by: "Rule", item: e[1], what: e[2] });
    else if ((e = /^standing: (.*)$/.exec(line))) out.push({ at, by: "Rule", item: REF.exec(e[1])?.[0] ?? "", what: e[1] });
    else if ((e = /^director: (\S+): (.*)$/.exec(line))) out.push({ at, by: "Director", item: e[1], what: e[2] });
    else if ((e = /^firefighter[: ] ?(.*)$/.exec(line))) out.push({ at, by: "Firefighter", item: REF.exec(e[1])?.[0] ?? "", what: e[1] });
  }
  return out;
}

/** Chris's answers in the issue notes of the factory repos: the notes the UI and CLI write for him (`Chris: …`, `Chris decided: …`, `Chris approved it`). */
function noteEntries(): LogEntry[] {
  const lists = reader({ fetch: false });
  const out: LogEntry[] = [];
  for (const repo of factoryRepos()) {
    const doc = lists.list(repo.key);
    for (const item of doc?.items ?? []) {
      const ref = `${repo.key}-${item.sub === undefined ? item.id : `${item.id}.${item.sub}`}`;
      for (const n of item.notes) {
        const m = /^- (\d{4}-\d\d-\d\d) (\d\d:\d\d): (Chris(?::| decided:| approved| denied| dropped).*)$/.exec(n);
        if (m) out.push({ at: new Date(`${m[1]}T${m[2]}`).toISOString(), by: "You", item: ref, what: m[3] });
      }
    }
  }
  return out;
}

/** One entry for each run of Gate entries with the same item and what, in time order among the Gate entries: `at` is the last line's time, `first` the first's, `count` the lines. A single line gets neither. */
function collapse(entries: LogEntry[]): LogEntry[] {
  const out: LogEntry[] = [];
  for (const e of [...entries].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const last = out.at(-1);
    if (last && last.item === e.item && last.what === e.what) {
      last.first ??= last.at;
      last.count = (last.count ?? 1) + 1;
      last.at = e.at;
    } else out.push({ ...e });
  }
  return out;
}

/** The log: the gate holds, the Always rules Chris set, the Rule, Director and Firefighter lines and his answers; the last LOG_DAYS days, newest first, `max` of each actor at most, so a busy actor does not push the others out. */
export function log(now = Date.now(), max = LOG_MAX, ms = LOG_DAYS * DAY, project?: string): LogEntry[] {
  const holds = collapse(allHolds().filter((h) => h.kind !== "started").map((h): LogEntry => ({ at: h.at, by: "Gate", item: h.name, what: `${h.kind}: ${h.text}` })));
  const seen: Record<string, number> = {};
  const set: LogEntry[] = Object.entries(readAlways()).map(([reason, g]) => ({ at: g.at, by: "You", item: "rule", what: `${reason}: set to ${g.action}` }));
  return [...holds, ...set, ...tickEntries(), ...noteEntries()]
    .filter((e) => now - Date.parse(e.at) < ms && (!project || (e.item !== "rule" && inProject(e.item, project))))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .filter((e) => (seen[e.by] = (seen[e.by] ?? 0) + 1) <= max);
}

/**
 * The last baseline of each repo, red or green, as baseline.json holds it. It reads no git: whether it is still the
 * baseline of origin/<main> is the Queued lane's to say, in `goalGates.baseline`. GitHub CI does not gate, so it is not here.
 */
const baselineGate = () => Object.values(baselines()).map((b) => ({ repo: b.repo, state: b.ok ? "green" : "red", line: b.ok ? `${b.repo} ${b.commit.slice(0, 7)}` : `${b.repo} ${redLine(b)}` }));

/** How many queued goals each per-goal gate holds now, by the Queued lane's decision. */
const goalGates = (queued: State["queued"]) => ({
  baseline: queued.filter((q) => q.kind === "baseline").length,
  "not-ready": queued.filter((q) => q.kind === "not-ready").length,
  "busy-file": queued.filter((q) => q.kind === "busy-file").length,
  "loop-guard": queued.filter((q) => q.kind === "loop-guard").length,
});

/** The held globs each factory repo names in the registry (`repo.held`), repos with at least one, sorted by repo key. */
export function repoHeld(): { repo: string; held: string[] }[] {
  return factoryRepos().filter((r) => r.held.length > 0).map((r) => ({ repo: r.key, held: [...r.held] })).sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0));
}

/**
 * The tick, the hourly suite and the daily monitor, each with the time and result of its last run: the tick from
 * tick.json (its newest step time; the result is its missed keys), the suite from the newest `suite <repo>:` line of
 * tick.log for each repo, the monitor from the newest `monitor <day>:` line. A step with no record has null for both.
 */
export function schedules(): { name: string; last: string | null; result: string | null }[] {
  // tick.ts is not read here: it loads the factory's actions, which the server must not.
  let t: { last?: Record<string, string>; missed?: string[] } = {};
  try { t = JSON.parse(readFileSync(join(layout().factory, "tick.json"), "utf8")); } catch {}
  const missed = t.missed ?? [];
  const times = Object.values(t.last ?? {}).map((x) => Date.parse(x!)).filter((x) => !Number.isNaN(x));
  const suite: Record<string, { at: string; result: string }> = {};
  let monitor: { at: string; result: string } | null = null;
  for (const l of readFactoryLog().split("\n")) {
    const m = /^(\S+) (suite (\S+)|monitor \S+): (.*)$/.exec(l);
    if (!m) continue;
    if (m[3]) suite[m[3]] = { at: m[1], result: m[4] };
    else monitor = { at: m[1], result: m[4].replace(/^(\d+ findings?|no reading|failed).*$/, "$1").replace(/^0 findings$/, "nothing looks off") };
  }
  const runs = Object.entries(suite).sort(([a], [b]) => (a < b ? -1 : 1));
  return [
    { name: "tick", last: times.length ? new Date(Math.max(...times)).toISOString() : null, result: times.length ? (missed.length ? `${missed.length} missed` : "no key missed") : null },
    { name: "suite", last: runs.map(([, r]) => r.at).sort().at(-1) ?? null, result: runs.length ? runs.map(([k, r]) => `${k}: ${r.result}`).join("; ") : null },
    { name: "monitor", last: monitor?.at ?? null, result: monitor?.result ?? null },
  ];
}

/**
 * The three metrics over the last LOG_DAYS days. `rate`: of the Asks decided (from every log entry in the window, not the capped log), the share that a Rule or the Director decided
 * and not Chris (his answers; his rule changes do not count), null with none. `catches`: `fired`, the build runs started in the
 * window that a check or the reviewer sent back, against `fixed`, those of them that a later build run of the same job fixed:
 * it passed or landed. `held`: the goals held and the hours in a hold, from a hold record to the next `started` record, or to now.
 */
export function metrics(entries: LogEntry[], holds = allHolds(), now = Date.now(), records = record.all(), span = LOG_DAYS * DAY) {
  const from = now - span;
  const auto = entries.filter((e) => (e.by === "Rule" || (e.by === "Director" && /\bdecided:/.test(e.what)))).length;
  const chris = entries.filter((e) => e.by === "You" && e.item !== "rule").length;
  const open: Record<string, number> = {}, goals = new Set<string>();
  let ms = 0;
  const close = (name: string, end: number) => {
    const start = Math.max(open[name], from);
    delete open[name];
    if (end <= start) return;
    ms += end - start;
    goals.add(name);
  };
  for (const h of holds) {
    if (h.kind === "started") { if (h.name in open) close(h.name, Date.parse(h.at)); }
    else if (stopsStart(h) && !(h.name in open)) open[h.name] = Date.parse(h.at);
  }
  for (const name of Object.keys(open)) close(name, now);
  const sent = records.flatMap((r) => r.runs.flatMap((x, i) => x.kind === "build" && x.failed && Date.parse(x.started) >= from
    ? [r.runs.slice(i + 1).some((y) => y.job === x.job && y.kind === "build" && !y.failed && (y.condition === "passed" || y.condition === "landed"))]
    : []));
  return {
    days: span / DAY,
    rate: auto + chris ? { auto, total: auto + chris, percent: Math.round((100 * auto) / (auto + chris)) } : null,
    catches: {
      fired: sent.length,
      fixed: sent.filter(Boolean).length,
    },
    held: { goals: goals.size, hours: Math.round(ms / 360_000) / 10 },
  };
}

/** The page's data from the Status page's state (its factory snapshot, its asks and its Queued lane) and the security facts. */
export function gatesBody(state: Pick<State, "now" | "factory" | "asks" | "queued">, security: { held: string[] }, ms = LOG_DAYS * DAY, project?: string) {
  const jobs = allJobs(), entries = log(Date.now(), LOG_MAX, ms, project), all = log(Date.now(), Infinity, ms, project);
  const records = record.all().filter((r) => inProject(r.issue, project)), holds = allHolds().filter((h) => inProject(h.name, project));
  const f = state.factory;
  return {
    now: state.now,
    factory: { paused: f.paused, liveRuns: f.liveRuns, liveCap: f.liveCap, runCap: f.runCap, runStarts: f.runStarts, capEnv: { live: capEnvSet("ALEPH_LIVE_CAP"), run: capEnvSet("ALEPH_RUN_CAP") } },
    metrics: metrics(all, holds, Date.now(), records, ms),
    schedules: schedules(),
    monitor: latestReport() && (({ day, findings, text, error }) => ({ day, findings, text, error }))(latestReport()!),
    gated: gates({ jobs }),
    baseline: baselineGate(),
    goalGates: goalGates(state.queued ?? []),
    asks: state.asks,
    rules: rules(all, records, Date.now(), ms),
    repeats: repeats(all, records, Date.now(), ms),
    ...security,
    repoHeld: repoHeld(),
    log: { days: ms / DAY, max: LOG_MAX, entries },
  };
}

export const routes: Routes = {
  "GET /api/gates": async (req) => {
    const q = new URL(req.url).searchParams, w = q.get("window");
    if (w !== null && !(w in WINDOWS)) return Response.json({ error: `window must be one of ${Object.keys(WINDOWS).join(", ")}` }, { status: 400 });
    const [{ state }, security] = await Promise.all([loadState(), securityFacts()]);
    return Response.json(gatesBody(state, security, w === null ? undefined : WINDOWS[w], q.get("project") || undefined));
  },
  "POST /api/gates/caps": async (req) => {
    if (!sameSite(req)) return text("forbidden", 403);
    const body: any = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "body must be a JSON object" }, { status: 422 });
    const patch: Record<string, unknown> = {};
    for (const k of CAP_KEYS) if (k in body) patch[k] = body[k];
    try { writeCaps(patch); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 422 }); }
    return Response.json({ live: LIVE_CAP(), run: RUN_CAP() });
  },
  "POST /api/gates/revoke/:reason": async (req, params) => {
    if (!sameSite(req)) return text("forbidden", 403);
    const { stdout, stderr, code } = await runCli(["always", "revoke", params.reason]);
    if (code !== 0) return Response.json({ error: (stderr || stdout).trim() || `aleph exited ${code}` }, { status: 422 });
    try { return Response.json(JSON.parse(stdout)); } catch { return Response.json({ output: stdout.trim() }); }
  },
};
