/**
 * `GET /api/gates`: what the Gates page shows. The gates now, the Asks that wait for Chris, the host chores, one rule per
 * Ask reason, the held paths, the worker sandbox, and the log of who decided what. Each part comes from the module that
 * owns it; this file only gathers them.
 * `POST /api/gates/revoke/:reason`: `aleph always revoke <reason>`, the Ask-me side of a rule. The grant side is
 * `POST /api/standing/:reason` (standing.ts).
 */
import { join } from "node:path";
import { ASK_REASONS, readAlways, routeOf } from "../../jobs/lib/ask.ts";
import { ciLine, redCi } from "../../jobs/lib/ci.ts";
import { allHolds, baselines, factoryRepos, gates, redLine, waiting } from "../../jobs/lib/factory-status.ts";
import { allJobs } from "../../jobs/lib/job.ts";
import { readFactoryLog } from "../../jobs/lib/layout.ts";
import { AWAITING_CAP, CAP_KEYS, DAY_CAP, LIVE_CAP, capEnvSet, writeCaps } from "../../jobs/lib/settings.ts";
import { reader } from "../../todo/lib/store.ts";
import type { AskItem } from "../asks.ts";
import { runCli } from "../cli.ts";
import { sameSite, text } from "../http.ts";
import { loadState } from "../state-load.ts";
import type { State } from "../state.ts";
import type { Routes } from "../server.ts";

/** The log keeps the entries of the last LOG_DAYS days, newest first, at most LOG_MAX of each actor. */
export const LOG_DAYS = 7, LOG_MAX = 200;
const DAY = 86_400_000;

/** The Ask reasons whose Asks are host chores: a step on this machine that Chris marks checked. */
const CHORES = new Set(["host-check", "manual"]);

export type By = "You" | "Rule" | "Firefighter" | "Gate";
export interface LogEntry { at: string; by: By; item: string; what: string; count?: number; first?: string }

/** The Asks routed to Chris, split into the ones to decide and the host chores. */
export function splitAsks(items: AskItem[]): { asks: AskItem[]; chores: AskItem[] } {
  const mine = items.filter((a) => routeOf(a.reason) === "chris");
  return { asks: mine.filter((a) => !CHORES.has(a.reason)), chores: mine.filter((a) => CHORES.has(a.reason)) };
}

/**
 * One row per Ask reason: its one automatic mode (`ASK_REASONS[reason].always`, "" for none) and what always.json grants.
 * A `proposal-<kind>` reason is granted per place (`proposal-<kind>:<place>`); its row lists those keys.
 */
export function rules() {
  const granted = readAlways();
  return Object.entries(ASK_REASONS).map(([reason, r]) => {
    const perPlace = reason.startsWith("proposal-");
    const g = granted[reason];
    return {
      reason, kind: r.kind, mode: r.always,
      granted: g ? { action: g.action, at: g.at } : null,
      ...(perPlace ? { places: Object.keys(granted).filter((k) => k.startsWith(`${reason}:`)) } : {}),
    };
  });
}

/** The held paths and the worker sandbox, from ui/security-facts.ts in a process of its own: the server imports no security path. */
export async function securityFacts(): Promise<{ held: string[]; sandbox: unknown }> {
  const p = Bun.spawn([process.execPath, join(import.meta.dir, "..", "security-facts.ts")], { stdout: "pipe", stderr: "pipe", env: process.env });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`security-facts.ts exited ${code}: ${err.trim()}`);
  return JSON.parse(out);
}

const REF = /\b[a-z][\w.]*?-\d+(?:\.\d+)?\b/i;

/** The Rule and Firefighter lines of tick.log: the Always actions (`always:`, `<name>: always:`, `standing:`) and the firefighter's lines. */
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

/** The log: the gate holds, the Always rules Chris set, the Rule and Firefighter lines and his answers; the last LOG_DAYS days, newest first, LOG_MAX of each actor at most, so a busy actor does not push the others out. */
export function log(now = Date.now()): LogEntry[] {
  const holds = collapse(allHolds().filter((h) => h.kind !== "started").map((h): LogEntry => ({ at: h.at, by: "Gate", item: h.name, what: `${h.kind}: ${h.text}` })));
  const seen: Record<string, number> = {};
  const set: LogEntry[] = Object.entries(readAlways()).map(([reason, g]) => ({ at: g.at, by: "You", item: "rule", what: `${reason}: set to ${g.action}` }));
  return [...holds, ...set, ...tickEntries(), ...noteEntries()]
    .filter((e) => now - Date.parse(e.at) < LOG_DAYS * DAY)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .filter((e) => (seen[e.by] = (seen[e.by] ?? 0) + 1) <= LOG_MAX);
}

/** Main CI: the red baselines and the red GitHub CI runs, as the health lines say them; the count of repos with a baseline. */
function mainCi() {
  const base = baselines();
  return {
    repos: Object.keys(base).length,
    red: [...Object.values(base).filter((b) => !b.ok).map((b) => `${b.repo} ${redLine(b)}`), ...redCi().map(ciLine)],
    commits: Object.values(base).map((b) => `${b.repo} ${b.commit.slice(0, 7)}`),
  };
}

/** The held globs each factory repo names in the registry (`repo.held`), repos with at least one, sorted by repo key. */
export function repoHeld(): { repo: string; held: string[] }[] {
  return factoryRepos().filter((r) => r.held.length > 0).map((r) => ({ repo: r.key, held: [...r.held] })).sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0));
}

/** The page's data from the Status page's state (its factory snapshot and its asks) and the security facts. */
export function gatesBody(state: Pick<State, "now" | "factory" | "asks">, security: { held: string[]; sandbox: unknown }) {
  const jobs = allJobs();
  const f = state.factory;
  return {
    now: state.now,
    factory: { paused: f.paused, hold: f.hold, probe: f.probe, liveRuns: f.liveRuns, liveCap: f.liveCap, runsToday: f.runsToday, dayCap: f.dayCap, awaiting: waiting(jobs), awaitingCap: f.awaitingCap, capEnv: { day: capEnvSet("ALEPH_DAY_CAP"), live: capEnvSet("ALEPH_LIVE_CAP"), awaiting: capEnvSet("ALEPH_AWAITING_CAP") } },
    gated: gates({ jobs }),
    main: mainCi(),
    ...splitAsks(state.asks),
    rules: rules(),
    ...security,
    repoHeld: repoHeld(),
    log: { days: LOG_DAYS, max: LOG_MAX, entries: log() },
  };
}

export const routes: Routes = {
  "GET /api/gates": async () => {
    const [{ state }, security] = await Promise.all([loadState(), securityFacts()]);
    return Response.json(gatesBody(state, security));
  },
  "POST /api/gates/caps": async (req) => {
    if (!sameSite(req)) return text("forbidden", 403);
    const body: any = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "body must be a JSON object" }, { status: 422 });
    const patch: Record<string, unknown> = {};
    for (const k of CAP_KEYS) if (k in body) patch[k] = body[k];
    try { writeCaps(patch); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 422 }); }
    return Response.json({ day: DAY_CAP(), live: LIVE_CAP(), awaiting: AWAITING_CAP() });
  },
  "POST /api/gates/revoke/:reason": async (req, params) => {
    if (!sameSite(req)) return text("forbidden", 403);
    const { stdout, stderr, code } = await runCli(["always", "revoke", params.reason]);
    if (code !== 0) return Response.json({ error: (stderr || stdout).trim() || `aleph exited ${code}` }, { status: 422 });
    try { return Response.json(JSON.parse(stdout)); } catch { return Response.json({ output: stdout.trim() }); }
  },
};
