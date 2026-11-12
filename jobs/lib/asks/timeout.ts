/**
 * The Ask timeout: when Chris does not answer an escalated Ask in the minutes `timeouts.json` sets for its reason, the
 * tick takes the reason's no-answer action once, on a waiting run's Ask or an issue's: `pick` takes the action the
 * director's case text recommends (it keeps waiting when there is none), `drop` takes the reason's drop, close or deny.
 * A land acts on the escalation list too (a security path or bun.lock): Chris sets the minutes, so the land is his.
 *
 * `timeouts.json` in the factory dir maps a reason to `{ minutes, then }`; a bare number is minutes with `pick`. A
 * reason with no entry waits for Chris.
 */
import { join } from "node:path";
import { layout } from "../../../lib/layout.ts";
import { readJsonOr, writeJson } from "../../../lib/json.ts";
import { allRuns, type Entry } from "../records/ledger.ts";
import * as record from "../records/record.ts";
import { actionsOn, ASK_REASONS, logAlways, type Ask } from "./ask.ts";

/** What a timeout does when its minutes pass: take the recommended action, or the reason's drop. */
export type NoAnswer = "pick" | "drop";
export interface Timeout { minutes: number; then: NoAnswer }
const THEN: NoAnswer[] = ["pick", "drop"];
/** The actions that end an Ask with no work done, one per reason. */
const DROPS = ["drop", "close", "deny"];

/** The reasons a timeout may act on: every Ask reason but the memory proposals, which are Chris's. */
export const TIMED = Object.keys(ASK_REASONS).filter((r) => !r.startsWith("proposal-"));

const file = () => join(layout().factory, "timeouts.json");

/** timeouts.json. A missing file is empty; an entry for a reason not in TIMED is ignored. */
export const readTimeouts = (): Record<string, Timeout> =>
  Object.fromEntries(Object.entries(readJsonOr<Record<string, number | Timeout>>(file(), {}))
    .map(([r, t]) => [r, typeof t === "number" ? { minutes: t, then: "pick" } : t] as [string, Timeout])
    .filter(([r, t]) => TIMED.includes(r) && Number.isInteger(t?.minutes) && t.minutes > 0 && THEN.includes(t.then)));

/** Set the minutes of `reason` and what it does then, by default what it did; 0 removes its timeout. Returns why it could not, or null. */
export function setTimeoutOf(reason: string, minutes: number, then: string = readTimeouts()[reason]?.then ?? "pick"): string | null {
  if (!TIMED.includes(reason)) return `${reason} has no timeout; reasons: ${TIMED.join(", ")}`;
  if (!Number.isInteger(minutes) || minutes < 0) return `minutes must be a whole number of at least 0, not ${minutes}`;
  if (!THEN.includes(then as NoAnswer)) return `the no-answer action is pick or drop, not ${then}`;
  const { [reason]: _, ...rest } = readTimeouts();
  writeJson(file(), minutes ? { ...rest, [reason]: { minutes, then } } : rest);
  return null;
}

/**
 * An Ask the timeout may act on. `key` is its job record, `on` what the director's events name it (the run's id, or
 * the issue's ref), and `name` what its action takes (the run's job, or the issue's ref).
 */
export interface Waiting { key: string; on: string; name: string; ask: Ask; run: boolean }

const ofRun = (e: Entry): Waiting | null =>
  e.run.condition === "waiting" && e.run.ask ? { key: record.keyOf(e.run), on: e.id, name: e.run.name, ask: e.run.ask, run: true } : null;

/** The Ask of each issue that no run owns. */
export const issueAsks = (records = record.all(true)): Waiting[] =>
  records.flatMap((r) => { const ask = record.issueAsk(r); return ask ? [{ key: r.issue, on: r.issue, name: r.issue, ask, run: false }] : []; });

/** The action `then` takes on the Ask, or null to keep waiting. */
function actionOf(w: Waiting, then: NoAnswer): string | null {
  if (then === "pick") return w.ask.recommend?.action ?? null;
  return actionsOn(w.ask.reason, { run: w.run, decision: w.ask.options.length > 0 }).find((a) => DROPS.includes(a)) ?? null;
}

/**
 * When the timeout acts on the Ask (ms) and its action, or null: its reason has a timeout, it has case text and an
 * action for the timeout to take, the director escalated it, and no timeout acted on it since.
 */
function due(w: Waiting, timeouts: Record<string, Timeout>): { at: number; action: string } | null {
  const t = timeouts[w.ask.reason];
  const action = t && w.ask.situation?.trim() ? actionOf(w, t.then) : null;
  if (!action) return null;
  const evs = record.read(w.key)?.events ?? [];
  const up = evs.findLast((x) => x.kind === "director" && (x.data as { on?: string; outcome?: string })?.on === w.on && (x.data as { outcome?: string }).outcome === "escalated");
  if (!up || evs.some((x) => x.kind === "timeout" && x.run === w.on && x.at >= up.at)) return null;
  return { at: Date.parse(up.at) + t.minutes * 60_000, action };
}

/** When the timeout acts on this waiting run (ms), or null. */
export const dueAt = (e: Entry, timeouts = readTimeouts()): number | null => {
  const w = ofRun(e);
  return w ? due(w, timeouts)?.at ?? null : null;
};

/** The log word of what an action did. */
const DID: Record<string, string> = { land: "landed", drop: "dropped", close: "dropped", deny: "dropped", rerun: "reran", retry: "reran" };

/**
 * The tick's step: `take` the action of each waiting run's and issue's Ask whose timeout is due; it returns the
 * refusal, or null. The names it took an action on. The tick passes `take`, so the UI server, which reads dueAt, loads
 * no factory action.
 */
export async function timeoutStep(take: (name: string, action: string, w: Waiting) => Promise<string | null>, now = Date.now(), runs: Entry[] = allRuns(true), asks: Waiting[] = issueAsks()): Promise<string[]> {
  const timeouts = readTimeouts();
  if (!Object.keys(timeouts).length) return [];
  const out: string[] = [];
  for (const w of [...runs.map(ofRun).filter((x): x is Waiting => !!x), ...asks]) {
    const d = due(w, timeouts);
    if (!d || d.at > now) continue;
    const reason = w.ask.reason, after = `no answer in ${timeouts[reason].minutes} min`;
    // One try per Ask: a refused action does not try again each tick.
    record.addEvent(w.key, { at: new Date(now).toISOString(), kind: "timeout", run: w.on, what: `${reason}: ${after}: ${d.action}` });
    const why = await take(w.name, d.action, w);
    logAlways(reason, w.key, why ? "failed" : DID[d.action] ?? "answered", { note: why ? `the timeout could not take ${d.action}: ${why}` : `${after}: ${d.action}` });
    if (!why) out.push(w.name);
  }
  return out;
}
