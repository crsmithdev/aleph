/**
 * `GET /api/automation`: what the Gates page shows. The gates now, the Asks that wait for Chris, one rule per
 * Ask reason, the held paths, and the log of who decided what. Each part comes from the module that
 * owns it; this file only gathers them.
 * `POST /api/automation/rules/:reason/revoke`: `aleph always revoke <reason>`, the Ask-me side of a rule.
 * `POST /api/automation/rules/:reason/grant` (`{ "action": "<action>" }`): `aleph always grant`, the Always side.
 * `POST /api/automation/rules/:reason/timeout` (`{ "minutes": <n>, "then"?: "pick" | "drop" }`): `aleph always timeout`; 0 waits for Chris.
 */
import { join } from "node:path";
import { ASK_REASONS, readAlways } from "../../jobs/lib/asks/ask.ts";
import { readTimeouts, TIMED } from "../../jobs/lib/asks/timeout.ts";
import { allHolds, askReason, backendHold, baselines, sandboxRepos, redLine, stopsStart, tickMissed, tickRows } from "../../jobs/lib/gates/factory-status.ts";
import { latestReport } from "../../jobs/lib/learning/monitor-table.ts";
import { allJobs } from "../../jobs/lib/records/job.ts";
import * as record from "../../jobs/lib/records/record.ts";
import { readEvents } from "../../lib/layout.ts";
import { eventIn, inProject, repoIn, scopeOf, withProjects } from "./scope.ts";
import { BACKENDS } from "../../jobs/lib/routing/models.ts";
import { parseKey, type EventRow } from "../../lib/naming.ts";
import { CAP_ENV, CAP_KEYS, INTAKE_TRIES, LIVE_CAP, RUN_CAP, capEnvSet, capMin, fixRounds, jobSeconds, landBatch, loadLimit, monitorHour, writeCaps, writeMonitorHour } from "../../jobs/lib/infra/settings.ts";
import { reader } from "../../issues/lib/store.ts";
import { noteOf } from "../../issues/lib/todo.ts";
import { intervalOf, setTimerInterval, TIMERS } from "../../jobs/lib/infra/systemd.ts";

import { aleph, fail, post } from "../action.ts";
import { reasonText } from "../asks.ts";
import type { Routes } from "../server.ts";

/** The log keeps the entries of the last LOG_DAYS days, newest first, at most LOG_MAX of each actor. */
const LOG_DAYS = 7; export const LOG_MAX = 200;
const DAY = 86_400_000;
/** Whether `item` (`<repo>-<id>`) belongs to `project`; no project keeps every item. */

/** One log row: an event. A run of equal gate events is one row: `times` is how many, `first` the first one's time. */
type LogEntry = EventRow & { times?: number; first?: string };
/** Whether an entry is a decision on an Ask that a rule or the director made, not Chris. */
const automatic = (e: LogEntry) => e.subject === "rule" || (e.subject === "director" && e.action !== "escalated");
/** Whether an entry is Chris's answer to an Ask: his rule changes are not. */
const answer = (e: LogEntry) => e.subject === "human" && e.action !== "changed";

/** One Ask of an issue: the reason, when it came and, once decided, when it went. From the `question` and `answered` events of the issue. */
export interface AskSpan { issue: string; reason: string; set: string; cleared?: string }

/** Every Ask of every issue, oldest first. */
export function askHistory(): AskSpan[] {
  const out: AskSpan[] = [], open = new Map<string, AskSpan>();
  for (const e of readEvents(0)) {
    if (e.subject !== "gate" || parseKey(e.object)?.kind !== "issue") continue;
    if (e.action === "question" && e.detail) { const a = { issue: e.object, reason: askReason(e.detail), set: e.time }; open.set(e.object, a); out.push(a); }
    else if (e.action === "answered") { const a = open.get(e.object); if (a) { a.cleared = e.time; open.delete(e.object); } }
  }
  return out;
}

/**
 * One row per raised Ask reason: its one automatic mode (`ASK_REASONS[reason].always`, "" for none) and what the `always` setting grants.
 * A `proposal-<kind>` reason is granted per place (`proposal-<kind>:<place>`); its row lists those keys.
 */
export function rules(entries: LogEntry[] = [], asks = askHistory(), now = Date.now(), ms = LOG_DAYS * DAY) {
  const granted = readAlways(), timeouts = readTimeouts();
  const from = now - ms, SLACK = 60_000;
  const recent = asks.filter((a) => Date.parse(a.set) >= from);
  return Object.entries(ASK_REASONS).map(([reason, r]) => {
    const perPlace = reason.startsWith("proposal-");
    const g = granted[reason];
    const mine = recent.filter((a) => a.reason === reason);
    const decided = { rule: 0, director: 0, chris: 0 }, outcome = { fixed: 0, none: 0 };
    for (const a of mine) {
      if (!a.cleared) continue;
      const lo = Date.parse(a.set), hi = Date.parse(a.cleared) + SLACK;
      const by = entries.find((e) => e.object === a.issue && Date.parse(e.time) >= lo && Date.parse(e.time) <= hi && (automatic(e) || answer(e)));
      if (by) decided[by.subject === "rule" ? "rule" : by.subject === "human" ? "chris" : "director"]++;
      outcome[record.allRunRecords().some((x) => x.target === a.issue && x.role === "build" && Date.parse(x.started) >= Date.parse(a.cleared!)) ? "fixed" : "none"]++;
    }
    return {
      reason, ...reasonText(reason), mode: r.always, fired: mine.length, decided, outcome,
      granted: g ? { action: g.action, at: g.at } : null,
      ...(TIMED.includes(reason) ? { timeout: timeouts[reason]?.minutes ?? 0, noAnswer: timeouts[reason]?.then ?? "pick" } : {}),
      ...(perPlace ? { places: Object.keys(granted).filter((k) => k.startsWith(`${reason}:`)) }
        : { projects: Object.entries(granted).filter(([k]) => k.startsWith(`${reason}:`)).map(([k, x]) => ({ project: k.slice(reason.length + 1), action: x.action, at: x.at })) }),
    };
  });
}

/** The held paths, from ui/security-facts.ts in a process of its own: the server imports no security path. */
export async function securityFacts(): Promise<{ held: string[] }> {
  const p = Bun.spawn([process.execPath, join(import.meta.dir, "..", "security-facts.ts")], { stdout: "pipe", stderr: "pipe", env: process.env });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`security-facts.ts exited ${code}: ${err.trim()}`);
  return JSON.parse(out);
}

/** The events of the event table from `since` (ms). A run's state changes are the gate's and the reviewer's events, and settings events are the Herald's: the log lists neither. */
function tickEntries(since: number): LogEntry[] {
  return readEvents(since).filter((e) => e.subject !== "gate" && e.subject !== "reviewer" && e.object !== "settings");
}

/** Chris's answers in the issue notes of the factory repos: the notes the UI and CLI write for him (`Chris: …`, `Chris decided: …`, `Chris approved it`). The note is the whole text. */
function noteEntries(): LogEntry[] {
  const lists = reader({ fetch: false });
  const out: LogEntry[] = [];
  for (const repo of sandboxRepos()) {
    const doc = lists.list(repo.key);
    for (const item of doc?.items ?? []) {
      const ref = `${repo.key}-${item.id}`;
      for (const { at, text: t } of item.notes.map(noteOf)) {
        if (!at || !/^Chris(?::| decided:| approved| denied| dropped)/.test(t)) continue;
        const action = /^Chris: run (it|intake) again$/.test(t) ? "reran" : /^Chris: checked/.test(t) ? "done" : /^Chris (denied|dropped)/.test(t) ? "dropped" : "answered";
        out.push({ time: at, subject: "human", action, object: ref, detail: t });
      }
    }
  }
  return out;
}

/** One entry for each run of equal gate events, in time order: `at` is the last one's time, `first` the first's, `times` the events. A single event gets neither. */
function collapse(entries: LogEntry[]): LogEntry[] {
  const out: LogEntry[] = [];
  const key = ({ time, times, first, seq, ...e }: LogEntry) => JSON.stringify(e);
  for (const e of [...entries].sort((a, b) => Date.parse(a.time) - Date.parse(b.time))) {
    const last = out.at(-1);
    if (last && key(last) === key(e)) {
      last.first ??= last.time;
      last.times = (last.times ?? 1) + 1;
      last.time = e.time;
    } else out.push({ ...e });
  }
  return out;
}

/** The log: the gate holds, the Always rules Chris set, the rule, director and firefighter events and his answers; the last LOG_DAYS days, newest first, `max` of each actor at most, so a busy actor does not push the others out. */
export function log(now = Date.now(), max = LOG_MAX, ms = LOG_DAYS * DAY, project?: string): LogEntry[] {
  const holds = collapse(allHolds().flatMap((h) => (h.event ? [h.event] : [])));
  const seen: Record<string, number> = {};
  const set: LogEntry[] = Object.entries(readAlways()).map(([reason, g]) => ({ time: g.at, subject: "human", action: "changed", object: reason, detail: `set to ${g.action}` }));
  return withProjects([...holds, ...set, ...tickEntries(now - ms), ...noteEntries()])
    .filter((e) => now - Date.parse(e.time) < ms && eventIn(e.object, project, e.project))
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
    .filter((e) => (seen[e.subject] = (seen[e.subject] ?? 0) + 1) <= max);
}

/**
 * The last baseline of each repo, red or green, as the `baseline` row of `state` holds it. It reads no git: whether it is still the
 * baseline of origin/<main> is the Queued lane's to say. GitHub CI does not gate, so it is not here.
 */
const baselineGate = () => Object.values(baselines()).map((b) => ({ repo: b.repo, state: b.ok ? "green" : "red", line: b.ok ? `${b.repo} ${b.commit.slice(0, 7)}` : `${b.repo} ${redLine(b)}` }));

/** The held globs each factory repo names in the registry (`repo.held`), repos with at least one, sorted by repo key. */
export function repoHeld(): { repo: string; held: string[] }[] {
  return sandboxRepos().filter((r) => r.held.length > 0).map((r) => ({ repo: r.key, held: [...r.held] })).sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0));
}

/**
 * The tick, the hourly suite and the daily monitor, each with the time and result of its last run: the tick from
 * the `tick` table (its newest step time; the result is its missed keys), the suite from
 * its row for each repo, the monitor from its row. A step with no record has null for both.
 */
/** The settings the Controls panel edits besides the two caps, as the factory reads them now. */
const settingsNow = () => ({ intakeTries: INTAKE_TRIES(), jobSeconds: jobSeconds(), fixRounds: fixRounds(), landBatch: landBatch(), loadLimit: loadLimit() });

export function schedules(): { name: string; last: string | null; result: string | null; every: string | null; hour?: number }[] {
  // tick.ts is not read here: it loads the factory's actions, which the server must not.
  const rows = tickRows(), missed = tickMissed();
  const times = ["ci", "firefight", "episodes"].map((k) => Date.parse(rows[k]?.last ?? "")).filter((x) => !Number.isNaN(x));
  const suite: Record<string, { at: string; result: string }> = {};
  for (const [k, v] of Object.entries(rows)) if (k.startsWith("suite ") && v.last) suite[k.slice(6)] = { at: v.last, result: v.result ?? "" };
  const monitor = rows.monitor?.last ? { at: rows.monitor.last, result: rows.monitor.result } : null;
  const runs = Object.entries(suite).sort(([a], [b]) => (a < b ? -1 : 1));
  return [
    { name: "tick", last: times.length ? new Date(Math.max(...times)).toISOString() : null, result: times.length ? (missed.length ? `${missed.length} missed` : "no key missed") : null, every: intervalOf(TIMERS.tick) },
    { name: "suite", last: runs.map(([, r]) => r.at).sort().at(-1) ?? null, result: runs.length ? runs.map(([k, r]) => `${k}: ${r.result}`).join("; ") : null, every: intervalOf(TIMERS.suite) },
    { name: "monitor", last: monitor?.at ?? null, result: monitor?.result ?? null, every: "1d", hour: monitorHour() },
  ];
}

/**
 * The three metrics over the last LOG_DAYS days. `rate`: of the Asks decided (from every log entry in the window, not the capped log), the share that a Rule or the Director decided
 * and not Chris (his answers; his rule changes do not count), null with none. `catches`: `fired`, the build runs started in the
 * window that a check or the reviewer sent back, against `fixed`, those of them that a later build run of the same job fixed:
 * it passed or landed. `held`: the issues held and the hours in a hold, from a hold record to the next `started` record, or to now.
 */
export function metrics(entries: LogEntry[], holds = allHolds(), now = Date.now(), jobs = allJobs(), span = LOG_DAYS * DAY) {
  const from = now - span;
  // A decision that applied several actions writes one event each, at one time: it counts once.
  const auto = new Set(entries.filter(automatic).map((e) => `${e.subject} ${e.object} ${e.time}`)).size;
  const chris = entries.filter(answer).length;
  const open: Record<string, number> = {}, names = new Set<string>();
  let ms = 0;
  const close = (name: string, end: number) => {
    const start = Math.max(open[name], from);
    delete open[name];
    if (end <= start) return;
    ms += end - start;
    names.add(name);
  };
  for (const h of holds) {
    if (h.kind === "started") { if (h.name in open) close(h.name, Date.parse(h.at)); }
    else if (stopsStart(h) && !(h.name in open)) open[h.name] = Date.parse(h.at);
  }
  for (const name of Object.keys(open)) close(name, now);
  const sent = jobs.flatMap((j) => j.flatMap(({ run: x }, i) => x.role === "build" && x.failed && Date.parse(x.started) >= from
    ? [j.slice(i + 1).some(({ run: y }) => y.role === "build" && !y.failed && (y.state === "passed" || y.state === "landed"))]
    : []));
  return {
    days: span / DAY,
    rate: auto + chris ? { auto, total: auto + chris, percent: Math.round((100 * auto) / (auto + chris)) } : null,
    catches: {
      fired: sent.length,
      fixed: sent.filter(Boolean).length,
    },
    held: { goals: names.size, hours: Math.round(ms / 360_000) / 10 },
  };
}

/** The page's data and the security facts. The asks come from `/api/factory`, which the page also reads. */
export function gatesBody(security: { held: string[] }, ms = LOG_DAYS * DAY, project?: string) {
  const jobs = allJobs(), entries = log(Date.now(), LOG_MAX, ms, project), all = log(Date.now(), Infinity, ms, project);
  const asks = askHistory().filter((a) => inProject(a.issue, project)), holds = allHolds().filter((h) => inProject(h.name, project));
  const hold = backendHold();
  return {
    now: new Date().toISOString(),
    caps: Object.fromEntries(CAP_KEYS.map((k) => [k, { env: CAP_ENV[k], min: capMin(k), set: capEnvSet(CAP_ENV[k]) }])),
    settings: settingsNow(),
    metrics: metrics(all, holds, Date.now(), jobs.filter((j) => repoIn(j[0].run.repo, project)), ms),
    schedules: schedules(),
    monitor: latestReport() && (({ day, findings, text, error }) => ({ day, findings, text, error }))(latestReport()!),
    backend: hold ? { via: BACKENDS[hold.via], why: hold.why } : null,
    baseline: baselineGate(),
    rules: rules(all, asks, Date.now(), ms),
    ...security,
    repoHeld: repoHeld(),
    log: { days: ms / DAY, max: LOG_MAX, entries },
  };
}

export const routes: Routes = {
  "GET /api/automation": async (_req, _params, url) => {
    const sc = scopeOf(url);
    if (sc instanceof Response) return sc;
    return Response.json(gatesBody(await securityFacts(), sc.ms, sc.project ?? undefined));
  },
  "POST /api/automation/caps": post((body) => {
    if (typeof body !== "object" || Array.isArray(body)) fail(422, "body must be a JSON object");
    const patch: Record<string, unknown> = {};
    for (const k of CAP_KEYS) if (k in body) patch[k] = body[k];
    try { writeCaps(patch); } catch (e) { fail(422, (e as Error).message); }
    return { live: LIVE_CAP(), run: RUN_CAP(), ...settingsNow() };
  }),
  "POST /api/automation/schedules": post((body) => {
    if (body.name === "monitor") {
      try { writeMonitorHour(body.hour); } catch (e) { fail(422, (e as Error).message); }
      return { hour: monitorHour() };
    }
    const e = setTimerInterval(String(body.name), String(body.every));
    if (e) fail(422, e);
    return { every: intervalOf(TIMERS[body.name]) };
  }),
  "POST /api/automation/rules/:reason/grant": post((body, { reason }) => {
    if (typeof body.action !== "string" || !body.action) fail(400, "send an action");
    return aleph(["always", "grant", "--", reason, body.action]);
  }),
  "POST /api/automation/rules/:reason/timeout": post((body, { reason }) => {
    if (!Number.isInteger(body.minutes) || body.minutes < 0) fail(400, "send minutes, a whole number of at least 0");
    if (body.then !== undefined && body.then !== "pick" && body.then !== "drop") fail(400, "then is pick or drop");
    return aleph(["always", "timeout", "--", reason, String(body.minutes), ...(body.then ? [body.then] : [])]);
  }),
  "POST /api/automation/rules/:reason/revoke": post((_body, { reason }) => aleph(["always", "revoke", "--", reason])),
};
