/**
 * `GET /api/gates`: what the Gates page shows. The gates now, the Asks that wait for Chris, one rule per
 * Ask reason, the held paths, and the log of who decided what. Each part comes from the module that
 * owns it; this file only gathers them.
 * `POST /api/gates/revoke/:reason`: `aleph always revoke <reason>`, the Ask-me side of a rule. The grant side is
 * `POST /api/standing/:reason` (standing.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ASK_REASONS, askSub, readAlways } from "../../jobs/lib/asks/ask.ts";
import { allHolds, baselines, type HoldRecord, factoryRepos, gates, redLine, stopsStart } from "../../jobs/lib/gates/factory-status.ts";
import { latestReport } from "../../jobs/lib/learning/monitor-table.ts";
import { allJobs } from "../../jobs/lib/records/job.ts";
import * as record from "../../jobs/lib/records/record.ts";
import { eventOf, layout, readFactoryLog } from "../../jobs/lib/infra/layout.ts";
import { loadRegistry } from "../../jobs/lib/records/ledger.ts";
import { ACTIONS, refs, word, type Event } from "../../lib/naming.ts";
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

/** One log row: an event. A run of equal gate events is one row: `times` is how many, `first` the first one's time. */
export type LogEntry = Event & { times?: number; first?: string };
/** Whether an entry is a decision on an Ask that a rule or the director made, not Chris. */
const automatic = (e: LogEntry) => e.by === "rule" || (e.by === "director" && e.action !== "escalated");
/** Whether an entry is Chris's answer to an Ask: his rule changes are not. */
const answer = (e: LogEntry) => e.by === "human" && e.action !== "changed";

/**
 * One row per raised Ask reason: its one automatic mode (`ASK_REASONS[reason].always`, "" for none) and what always.json grants.
 * A `proposal-<kind>` reason is granted per place (`proposal-<kind>:<place>`); its row lists those keys.
 */
export function rules(entries: LogEntry[] = [], records = record.all(), now = Date.now(), ms = LOG_DAYS * DAY) {
  const granted = readAlways();
  const from = now - ms, SLACK = 60_000;
  // An entry from before record.asks kept the reason takes the reason of the run's Ask: the record keeps it in rec.ask while rec.askRun waits.
  const runReason = (rec: record.JobRecord, set: string) => rec.runs.some((x) => x.id === rec.askRun && x.condition === "waiting" && Date.parse(x.started) <= Date.parse(set)) ? rec.ask?.reason : undefined;
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
      const by = entries.find((e) => e.subject === a.issue && Date.parse(e.at) >= lo && Date.parse(e.at) <= hi && (automatic(e) || answer(e)));
      if (by) decided[by.by === "rule" ? "rule" : by.by === "human" ? "chris" : "director"]++;
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
    const e = entries.find((x) => answer(x) && x.subject === rec.issue && Date.parse(x.at) >= lo && Date.parse(x.at) <= hi);
    if (!e) continue;
    const note = e.note ?? "";
    const said = ANSWERS.find(([re]) => re.test(note))?.[1] ?? note.replace(/^Chris(?: decided)?: /, "");
    const k = `${a.reason}\n${said}`;
    const c = counts.get(k) ?? { reason: a.reason, answer: said, count: 0 };
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

type Fields = Omit<Event, "at" | "by" | "subject">;

/** The verb of an old director action or rule line as an action: `land` is `landed`. */
const act = (verb: string) => word("act", verb);

/** The decisions of an old `director: <ref>: <reason>: decided: …` line: one event per action; a `note` or a `refused` part is the first event's note. */
function oldDecided(reason: string, text: string): Fields[] {
  const parts = text.split(/; (?=(?:land|drop|drop-issue|answer|rerun|close|edit-goal|add|note|refused)\b)/);
  const evs: Fields[] = [], notes: string[] = [];
  for (const p of parts) {
    const [, verb, rest = ""] = /^([\w-]+)(?::? ([\s\S]*))?$/.exec(p) ?? [, p];
    if (verb === "note" || verb === "refused" || !ACTIONS.includes(act(verb!))) { notes.push(verb === "note" ? rest : p); continue; }
    const dup = verb === "drop" && /\bduplicate\b/.test(rest);
    evs.push({
      action: act(verb!), sub: verb === "land" && reason === "review" ? "override" : dup ? "duplicate" : verb === "add" ? undefined : askSub(reason),
      ...(dup || verb === "add" ? { on: refs(rest).slice(-1) } : {}), ...(rest ? { note: rest } : {}),
    });
  }
  const out = evs.length ? evs : [{ action: "answered", sub: askSub(reason) }];
  if (notes.length) out[0] = { ...out[0], note: [out[0].note, ...notes].filter(Boolean).join("; ") };
  return out;
}

/**
 * The log events of an old text line of tick.log, as near as its text gives them: the Always actions (`always:`, `standing:`),
 * the director's decisions (`director: <ref>: <reason>: decided|escalated: …`) and the firefighter's lines. A line of
 * another kind is no log entry. A director or firefighter line of no known form takes the word before its first `: ` as
 * its action, and the rest as its note.
 */
function oldLine(at: string, line: string): LogEntry[] {
  let m: RegExpExecArray | null;
  const one = (by: string, subject: string, f: Fields): LogEntry[] => [{ at, by, subject, ...f }];
  if ((m = /^always: revoked (\S+)$/.exec(line))) return one("human", m[1], { action: "changed", sub: askSub(m[1]), to: "human", note: "set to Ask me" });
  // A rescue rule dropped the run and the issue reran; its second line, `<name>: always: Rerun; …`, is the same act.
  if ((m = /^(?:always|standing): (\S+): (\S+) on (\S+)$/.exec(line))) return one("rule", m[3], m[1] === "rescue" ? { action: "reran", sub: "rescue", result: "dropped" } : { action: act(m[2]), sub: askSub(m[1]) });
  if ((m = /^director: (\S+): (\S+): decided: ([\s\S]*)$/.exec(line))) { const [, ref, reason, text] = m; return oldDecided(reason, text).map((f) => ({ at, by: "director", subject: ref, ...f })); }
  if ((m = /^director: (\S+): (\S+): escalated: ([\s\S]*)$/.exec(line))) {
    const [, ref, reason, why] = m, file = /^the run changes (\S+), a security path/.exec(why)?.[1];
    return one("director", ref, { action: "escalated", sub: /^its (run failed|reply was malformed)/.test(why) ? "error" : file ? "protected" : askSub(reason), ...(file ? { file } : {}), to: "human", note: why });
  }
  if ((m = /^firefighter: filed (\S+) \(critical\)/.exec(line))) return one("firefighter", m[1], { action: "filed", note: line.slice(13) });
  if ((m = /^firefighter: noted (\S+): also red at (\w+)/.exec(line))) return one("firefighter", m[1], { action: "red", on: [m[2]], note: line.slice(13) });
  if ((m = /^firefighter: (\S+): its land is live for/.exec(line))) return one("firefighter", m[1], { action: "waiting", sub: "rescue", to: "director", note: line.slice(13) });
  if ((m = /^firefighter: did ([\w-]+) ([\s\S]*)$/.exec(line))) return one("firefighter", refs(m[2])[0] ?? "", { action: act(m[1]), note: m[2] });
  if ((m = /^(director|firefighter|standing)[: ] ?([\s\S]*)$/.exec(line))) {
    const by = m[1] === "standing" ? "rule" : m[1], subject = refs(m[2])[0] ?? "";
    const rest = subject && m[2].startsWith(`${subject}: `) ? m[2].slice(subject.length + 2) : m[2];
    const w = /^([\w-]+): /.exec(rest)?.[1];
    return one(by, subject, { action: w ? act(word("state", w)) : "", note: w ? rest.slice(w.length + 2) : rest });
  }
  return [];
}

/** The log events of tick.log: each event line, and the old text lines that `oldLine` reads. */
function tickEntries(): LogEntry[] {
  return readFactoryLog().split("\n").flatMap((l) => {
    const m = /^(\S+) (.*)$/.exec(l);
    if (!m) return [];
    const e = eventOf(m[2]);
    return e ? [e] : oldLine(m[1], m[2]);
  });
}

/** The event of an old hold record, as near as its text gives it; the text is the note when no form fits. */
function oldHold(h: HoldRecord): LogEntry {
  const t = h.text;
  let m: RegExpExecArray | null;
  const f: Fields = (m = /^after (\S+)$/.exec(t)) ? { action: "after", on: m[1].split(",") }
    : (m = /^its job is (\w+)$/.exec(t)) ? { action: word("state", m[1]) }
    : /already (done|landed)/.test(t) ? { action: "done" }
    : (m = /^the item is (\w+)$/.exec(t)) ? { action: m[1] === "gone" ? "dropped" : m[1] }
    : /starting it$/.test(t) ? { action: "starting" }
    : t === "not a goal" ? { action: "parent" }
    : /holds the GPU$/.test(t) ? { action: "gpu" }
    : (m = /^\d+ (local )?agent runs are live$/.exec(t)) ? { action: "full", ...(m[1] ? { sub: "local" } : {}) }
    : (m = /^waits for (\S+): both (?:change the busy file (\S+)|use the (gpt-oss) server)$/.exec(t)) ? { action: "busy", on: [m[1]], file: m[2] ?? m[3] }
    : (m = /^(\d+) runs in a row with no commit$/.exec(t)) ? { action: "looping", sub: "no-commit", count: `${m[1]} / ${m[1]}` }
    : (m = /^(\d+) runs in the last hour$/.exec(t)) ? { action: "looping", sub: "starts", count: `${m[1]} / 1h` }
    : (m = /^main is red at (\w+): ([\s\S]*)$/.exec(t)) ? { action: "red", on: [m[1]], note: m[2] }
    : t === "paused" ? { action: "paused" }
    : { action: word("gate", h.kind), note: t };
  return { at: h.at, by: "gate", subject: h.name, ...f };
}

/** Chris's answers in the issue notes of the factory repos: the notes the UI and CLI write for him (`Chris: …`, `Chris decided: …`, `Chris approved it`). The note is the whole text. */
function noteEntries(): LogEntry[] {
  const lists = reader({ fetch: false });
  const out: LogEntry[] = [];
  for (const repo of factoryRepos()) {
    const doc = lists.list(repo.key);
    for (const item of doc?.items ?? []) {
      const ref = `${repo.key}-${item.sub === undefined ? item.id : `${item.id}.${item.sub}`}`;
      for (const n of item.notes) {
        const m = /^- (\d{4}-\d\d-\d\d) (\d\d:\d\d): (Chris(?::| decided:| approved| denied| dropped).*)$/.exec(n);
        if (!m) continue;
        const t = m[3];
        const action = /^Chris: run (it|intake) again$/.test(t) ? "reran" : /^Chris: checked/.test(t) ? "done" : /^Chris (denied|dropped)/.test(t) ? "dropped" : "answered";
        out.push({ at: new Date(`${m[1]}T${m[2]}`).toISOString(), by: "human", subject: ref, action, ...(/intake again$/.test(t) ? { sub: "intake" } : {}), note: t });
      }
    }
  }
  return out;
}

/** One entry for each run of equal gate events, in time order: `at` is the last one's time, `first` the first's, `times` the events. A single event gets neither. */
function collapse(entries: LogEntry[]): LogEntry[] {
  const out: LogEntry[] = [];
  const key = ({ at, times, first, ...e }: LogEntry) => JSON.stringify(e);
  for (const e of [...entries].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const last = out.at(-1);
    if (last && key(last) === key(e)) {
      last.first ??= last.at;
      last.times = (last.times ?? 1) + 1;
      last.at = e.at;
    } else out.push({ ...e });
  }
  return out;
}

/** The log: the gate holds, the Always rules Chris set, the rule, director and firefighter events and his answers; the last LOG_DAYS days, newest first, `max` of each actor at most, so a busy actor does not push the others out. */
export function log(now = Date.now(), max = LOG_MAX, ms = LOG_DAYS * DAY, project?: string): LogEntry[] {
  const holds = collapse(allHolds().filter((h) => h.kind !== "started").map((h) => h.event ?? oldHold(h)));
  const seen: Record<string, number> = {};
  const set: LogEntry[] = Object.entries(readAlways()).map(([reason, g]) => ({ at: g.at, by: "human", subject: reason, action: "changed", ...(askSub(reason) ? { sub: askSub(reason) } : {}), note: `set to ${g.action}` }));
  return [...holds, ...set, ...tickEntries(), ...noteEntries()]
    .filter((e) => now - Date.parse(e.at) < ms && (!project || inProject(e.subject, project)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .filter((e) => (seen[e.by] = (seen[e.by] ?? 0) + 1) <= max);
}

/**
 * The last baseline of each repo, red or green, as baseline.json holds it. It reads no git: whether it is still the
 * baseline of origin/<main> is the Queued lane's to say, in `goalGates.baseline`. GitHub CI does not gate, so it is not here.
 */
const baselineGate = () => Object.values(baselines()).map((b) => ({ repo: b.repo, state: b.ok ? "green" : "red", line: b.ok ? `${b.repo} ${b.commit.slice(0, 7)}` : `${b.repo} ${redLine(b)}` }));

/** How many queued parts each per-part gate holds now, by the Queued lane's decision. */
const issueGates = (queued: State["queued"]) => ({
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
 * it passed or landed. `held`: the issues held and the hours in a hold, from a hold record to the next `started` record, or to now.
 */
export function metrics(entries: LogEntry[], holds = allHolds(), now = Date.now(), records = record.all(), span = LOG_DAYS * DAY) {
  const from = now - span;
  // A decision that applied several actions writes one event each, at one time: it counts once.
  const auto = new Set(entries.filter(automatic).map((e) => `${e.by} ${e.subject} ${e.at}`)).size;
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
    held: { goals: names.size, hours: Math.round(ms / 360_000) / 10 },
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
    goalGates: issueGates(state.queued ?? []),
    asks: state.asks,
    rules: rules(all, records, Date.now(), ms),
    repeats: repeats(all, records, Date.now(), ms),
    ...security,
    repoHeld: repoHeld(),
    log: { days: ms / DAY, max: LOG_MAX, entries },
    codes: Object.fromEntries(Object.values(loadRegistry()).filter((r) => r.code).map((r) => [r.key, r.code])),
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
