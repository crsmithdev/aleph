/**
 * `GET /api/automation`: what the Gates page shows. The gates now, the Asks that wait for the user, one rule per
 * Ask reason, the held paths, and the log of who decided what. Each part comes from the module that
 * owns it; this file only gathers them.
 * `POST /api/automation/rules/:reason/revoke`: `aleph always revoke <reason>`, the Ask-me side of a rule.
 * `POST /api/automation/rules/:reason/grant` (`{ "action": "<action>" }`): `aleph always grant`, the Always side.
 * `POST /api/automation/rules/:reason/timeout` (`{ "minutes": <n>, "then"?: "pick" | "drop" }`): `aleph always timeout`; 0 waits for the user.
 */
import { join } from "node:path";
import { ASK_REASONS, readAlways } from "../../jobs/lib/asks/ask.ts";
import { readTimeouts, TIMED } from "../../jobs/lib/asks/timeout.ts";
import { askHistory, type AskSpan } from "../asks.ts";
import { allHolds, backendHold, stopsStart } from "../../jobs/lib/gates/holds.ts";
import { sandboxRepos } from "../../jobs/lib/gates/gpu.ts";
import { baselines, redLine, tickMissed, tickRows } from "../../jobs/lib/gates/tables.ts";
import { latestReport } from "../../jobs/lib/learning/monitor-table.ts";
import { allJobs, loadRegistry } from "../../jobs/lib/records/ledger.ts";
import * as record from "../../jobs/lib/records/record.ts";
import { readEvents } from "../../lib/layout.ts";
import { eventIn, inProject, repoIn, scopeOf, withProjects } from "./scope.ts";
import { BACKENDS } from "../../jobs/lib/routing/models.ts";
import { issueKey, type EventRow } from "../../lib/naming.ts";
import { CAP_ENV, CAP_KEYS, INTAKE_TRIES, LIVE_CAP, RUN_CAP, capEnvSet, capMin, fixRounds, jobSeconds, landBatch, loadLimit, monitorHour, writeCaps, writeMonitorHour } from "../../jobs/lib/infra/settings.ts";
import { reader } from "../../lib/store.ts";
import { closed, noteOf } from "../../lib/issue-file.ts";
import { NOTE } from "../../jobs/lib/roles/recheck.ts";
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

/**
 * One row per raised Ask reason: its one automatic mode (`ASK_REASONS[reason].always`, "" for none) and what the `always` setting grants.
 * `decided` credits each answered Ask to the actor of the event that answered it; an Ask a gate cleared goes to no one.
 */
export function rules(asks = askHistory(), now = Date.now(), ms = LOG_DAYS * DAY) {
  const granted = readAlways(), timeouts = readTimeouts();
  const from = now - ms;
  const recent = asks.filter((a) => Date.parse(a.set) >= from);
  const builds = record.allRuns().filter(({ run: x }) => x.role === "build");
  return Object.entries(ASK_REASONS).map(([reason, r]) => {
    const g = granted[reason];
    const mine = recent.filter((a) => a.reason === reason);
    const decided = { rule: 0, director: 0, user: 0 }, outcome = { fixed: 0, none: 0 };
    for (const a of mine) {
      if (!a.cleared) continue;
      if (a.by === "rule" || a.by === "director") decided[a.by]++;
      else if (a.by === "human") decided.user++;
      outcome[builds.some(({ run: x }) => x.target === a.issue && Date.parse(x.started) >= Date.parse(a.cleared!)) ? "fixed" : "none"]++;
    }
    return {
      reason, ...reasonText(reason), mode: r.always, fired: mine.length, decided, outcome,
      granted: g ? { action: g.action, at: g.at } : null,
      ...(TIMED.includes(reason) ? { timeout: timeouts[reason]?.minutes ?? 0, noAnswer: timeouts[reason]?.then ?? "pick" } : {}),
      projects: Object.entries(granted).filter(([k]) => k.startsWith(`${reason}:`)).map(([k, x]) => ({ project: k.slice(reason.length + 1), action: x.action, at: x.at })),
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

/** The user's answers in the issue notes of the factory repos: the notes the UI and CLI write for them (`User: …`, `User decided: …`, `User approved it`, and the old `Chris…` leads). The note is the whole text. */
function noteEntries(): LogEntry[] {
  const lists = reader({ fetch: false });
  const out: LogEntry[] = [];
  for (const repo of sandboxRepos()) {
    const doc = lists.list(repo.key);
    for (const item of doc?.items ?? []) {
      const ref = `${repo.key}-${item.id}`;
      for (const { at, text: t } of item.notes.map(noteOf)) {
        const u = t.replace(/^Chris\b/, "User"); // notes stored before the rename lead with the old name
        if (!at || !Object.values(NOTE).some((lead) => u.startsWith(lead))) continue;
        const action = u === NOTE.rerun || u === NOTE.retriage ? "reran" : u.startsWith(NOTE.checked) ? "done" : [NOTE.denied, NOTE.dropped, NOTE.declined].some((lead) => u.startsWith(lead)) ? "dropped" : "answered";
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

/** The log: the gate holds, the Always rules the user set, the rule, director and firefighter events and their answers; the last LOG_DAYS days, newest first, `max` of each actor at most, so a busy actor does not push the others out. */
export function log(now = Date.now(), max = LOG_MAX, ms = LOG_DAYS * DAY, project?: string): LogEntry[] {
  const holds = collapse(allHolds().flatMap((h) => (h.event ? [h.event] : [])));
  const set: LogEntry[] = Object.entries(readAlways()).map(([reason, g]) => ({ time: g.at, subject: "human", action: "changed", object: reason, detail: `set to ${g.action}` }));
  return capped(withProjects([...holds, ...set, ...tickEntries(now - ms), ...noteEntries()])
    .filter((e) => now - Date.parse(e.time) < ms && eventIn(e.object, project, e.project))
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time)), max);
}

/** The first `max` entries of each actor, in the order given. */
function capped(entries: LogEntry[], max: number): LogEntry[] {
  const seen: Record<string, number> = {};
  return entries.filter((e) => (seen[e.subject] = (seen[e.subject] ?? 0) + 1) <= max);
}

/**
 * The last baseline of each repo, red or green, as the `baseline` row of `state` holds it. It reads no git: whether it is still the
 * baseline of origin/<main> is the Queued lane's to say. GitHub CI does not gate, so it is not here.
 */
const baselineGate = () => Object.values(baselines()).map((b) => ({ repo: b.repo, state: b.ok ? "green" : "red", line: b.ok ? `${b.repo} ${b.commit.slice(0, 7)}` : `${b.repo} ${redLine(b)}` }));

/** The held globs each factory repo names in the registry (`repo.held`), repos with at least one, sorted by repo key. */
function repoHeld(): { repo: string; held: string[] }[] {
  return sandboxRepos().filter((r) => r.held.length > 0).map((r) => ({ repo: r.key, held: [...r.held] })).sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0));
}

/**
 * The tick, the hourly suite and the daily monitor, each with the time and result of its last run: the tick from
 * the `tick` table (its newest step time; the result is its missed keys), the suite from
 * its row for each repo, the monitor from its row. A step with no record has null for both.
 */
/** The settings the Controls panel edits besides the two caps, as the factory reads them now. */
const settingsNow = () => ({ intakeTries: INTAKE_TRIES(), jobSeconds: jobSeconds(), fixRounds: fixRounds(), landBatch: landBatch(), loadLimit: loadLimit() });

function schedules(): { name: string; last: string | null; result: string | null; every: string | null; hour?: number }[] {
  // tick.ts is not read here: it loads the factory's actions, which the server must not.
  const rows = tickRows(), missed = tickMissed();
  const times = ["ci", "firefight"].map((k) => Date.parse(rows[k]?.last ?? "")).filter((x) => !Number.isNaN(x));
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
 * The three metrics over the last LOG_DAYS days. `rate`: of the Asks raised in the window and answered, the share that the user did not
 * answer (a `human` answered event; a rule, the director or a gate clearing it is automatic), null with none. `catches`: `fired`, the build runs started in the
 * window that a check or the reviewer sent back, against `fixed`, those of them that a later build run of the same job fixed:
 * it passed or landed. `held`: the issues held and the hours in a hold, from a hold record to the next `started` record, to the close of the issue, or to now.
 */
export function metrics(asks: AskSpan[], holds = allHolds(), now = Date.now(), jobs = allJobs(), span = LOG_DAYS * DAY, closedAt: ReadonlyMap<string, string> = new Map()) {
  const from = now - span;
  const answered = asks.filter((a) => a.cleared && Date.parse(a.set) >= from);
  const user = answered.filter((a) => a.by === "human").length, auto = answered.length - user;
  const open: Record<string, number> = {}, names = new Set<string>();
  let ms = 0;
  const close = (name: string, end: number) => {
    const start = Math.max(open[name], from);
    delete open[name];
    if (end <= start) return;
    ms += end - start;
    names.add(name);
  };
  // A hold record at or after its issue's close is no hold: the issue is done. The close ends an earlier hold.
  const ends = [...closedAt].map(([name, at]) => ({ at, name, kind: "started", text: "" }));
  const timeline = [...holds.filter((h) => !closedAt.has(h.name) || h.at < closedAt.get(h.name)!), ...ends].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const h of timeline) {
    if (h.kind === "started") { if (h.name in open) close(h.name, Date.parse(h.at)); }
    else if (stopsStart(h) && !(h.name in open)) open[h.name] = Date.parse(h.at);
  }
  for (const name of Object.keys(open)) close(name, now);
  const sent = jobs.flatMap((j) => j.flatMap(({ run: x }, i) => record.sentBack(x) && Date.parse(x.started) >= from
    ? [j.slice(i + 1).some(({ run: y }) => y.role === "build" && !y.failed && (y.state === "passed" || y.state === "landed"))]
    : []));
  return {
    days: span / DAY,
    rate: auto + user ? { auto, total: auto + user, percent: Math.round((100 * auto) / (auto + user)) } : null,
    catches: {
      fired: sent.length,
      fixed: sent.filter(Boolean).length,
    },
    held: { issues: names.size, hours: Math.round(ms / 360_000) / 10 },
  };
}

/** The close time of each closed issue of every repo, by issue key, as origin/main last fetched has it. */
function closedIssues(): Map<string, string> {
  const lists = reader({ fetch: false }), out = new Map<string, string>();
  for (const repo of Object.keys(loadRegistry())) for (const i of lists.list(repo)?.items ?? []) { const at = closed(i); if (at) out.set(issueKey(i.id), at); }
  return out;
}

/** The page's data and the security facts. The asks come from `/api/factory`, which the page also reads. */
export function gatesBody(security: { held: string[] }, ms = LOG_DAYS * DAY, project?: string) {
  const jobs = allJobs(), all = log(Date.now(), Infinity, ms, project), entries = capped(all, LOG_MAX);
  const asks = askHistory().filter((a) => inProject(a.issue, project)), holds = allHolds().filter((h) => inProject(h.name, project));
  const hold = backendHold();
  return {
    now: new Date().toISOString(),
    caps: Object.fromEntries(CAP_KEYS.map((k) => [k, { env: CAP_ENV[k], min: capMin(k), set: capEnvSet(CAP_ENV[k]) }])),
    settings: settingsNow(),
    metrics: metrics(asks, holds, Date.now(), jobs.filter((j) => repoIn(j[0].run.repo, project)), ms, closedIssues()),
    schedules: schedules(),
    monitor: latestReport() && (({ day, findings, text, error }) => ({ day, findings, text, error }))(latestReport()!),
    backend: hold ? { via: BACKENDS[hold.via], why: hold.why } : null,
    baseline: baselineGate(),
    rules: rules(asks, Date.now(), ms),
    ...security,
    repoHeld: repoHeld(),
    log: { days: ms / DAY, max: LOG_MAX, total: all.length, entries },
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
