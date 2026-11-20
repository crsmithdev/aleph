/**
 * The Ask timeout: when Chris does not answer an escalated Ask in the minutes the `timeouts` setting gives for its reason, the
 * tick takes the reason's no-answer action once, on a waiting run's Ask or an issue's: `pick` takes the action the
 * director's case text recommends (it keeps waiting when there is none), `drop` takes the reason's second verb, the one that drops it.
 * A land acts on the escalation list too: Chris sets the minutes, so the land is his. A held-path Ask has no timeout,
 * so a timeout never lands a held change, and a core-change Ask has none, so a timeout never applies or declines a
 * core note change.
 *
 * The `timeouts` setting maps a reason to `{ minutes, then }`; a bare number is minutes with `pick`. A
 * reason with no entry waits for Chris.
 */
import { eventsOf } from "../../../lib/layout.ts";
import { setTimeoutsRow, timeoutsRow } from "../infra/settings.ts";
import { type Entry } from "../records/ledger.ts";
import { allRuns } from "../records/record.ts";
import * as record from "../records/record.ts";
import { actionsOn, ASK_REASONS, logAlways, type Ask } from "./ask.ts";

/** What a timeout does when its minutes pass: take the recommended action, or the reason's drop. */
type NoAnswer = "pick" | "drop";
export interface Timeout { minutes: number; then: NoAnswer }
const THEN: NoAnswer[] = ["pick", "drop"];
/** The reasons a timeout may act on: every Ask reason but held-path and core-change, which never time out. */
export const TIMED = Object.keys(ASK_REASONS).filter((r) => r !== "held-path" && r !== "core-change");

/** The `timeouts` setting. A missing row is empty; an entry for a reason not in TIMED is ignored. */
export const readTimeouts = (): Record<string, Timeout> =>
  Object.fromEntries(Object.entries(timeoutsRow<number | Timeout>())
    .map(([r, t]) => [r, typeof t === "number" ? { minutes: t, then: "pick" } : t] as [string, Timeout])
    .filter(([r, t]) => TIMED.includes(r) && Number.isInteger(t?.minutes) && t.minutes > 0 && THEN.includes(t.then)));

/** Set the minutes of `reason` and what it does then, by default what it did; 0 removes its timeout. Returns why it could not, or null. */
export function setTimeoutOf(reason: string, minutes: number, then: string = readTimeouts()[reason]?.then ?? "pick"): string | null {
  if (!TIMED.includes(reason)) return `${reason} has no timeout; reasons: ${TIMED.join(", ")}`;
  if (!Number.isInteger(minutes) || minutes < 0) return `minutes must be a whole number of at least 0, not ${minutes}`;
  if (!THEN.includes(then as NoAnswer)) return `the no-answer action is pick or drop, not ${then}`;
  const { [reason]: _, ...rest } = readTimeouts();
  setTimeoutsRow(minutes ? { ...rest, [reason]: { minutes, then } } : rest);
  return null;
}

/**
 * An Ask the timeout may act on. `key` is its row in `issue_state`, `on` what the director's decisions name it (the run's
 * key, or the issue's key), and `name` what its action takes (the run's name, or the issue's key).
 */
export interface Waiting { key: string; on: string; name: string; ask: Ask; run: boolean }

const ofRun = (e: Entry): Waiting | null =>
  e.run.state === "waiting" && e.run.ask ? { key: e.run.target ?? e.id, on: e.id, name: e.run.name, ask: e.run.ask, run: true } : null;

/** The Ask of each issue that no run owns. */
export const issueAsks = (states = record.allIssueStates()): Waiting[] =>
  [...states].flatMap(([key, s]) => { const ask = record.issueAsk(s); return ask ? [{ key, on: key, name: key, ask, run: false }] : []; });

/** The detail of the event a timeout logs after it acts: the minutes it waited, or why it could not act. */
const ACTED = /^(no answer in \d+ min|the timeout could not take)/;

/** The old words a stored recommend may name, each read as the reason's first verb (0) or its second (1). */
const OLD: Record<string, 0 | 1> = { land: 0, answer: 0, decide: 0, rerun: 0, retry: 0, drop: 1, close: 1, deny: 1, decline: 1 };

/**
 * The action `then` takes on the Ask, or null to keep waiting: one of the reason's two verbs, or `resolve:<label>` of
 * one of its options. A recommend of an old word reads as its verb; any other recommend is not taken.
 */
function actionOf(w: Waiting, then: NoAnswer): string | null {
  const acts: string[] = actionsOn(w.ask.reason);
  if (then === "drop") return acts[1];
  const rec = w.ask.recommend?.action ?? "", at = rec.indexOf(":");
  const said = at < 0 ? rec : rec.slice(0, at), label = at < 0 ? "" : rec.slice(at + 1);
  const verb = acts.includes(said) ? said : Object.hasOwn(OLD, said) ? acts[OLD[said]] : null;
  if (!verb || !label) return verb;
  return verb === "resolve" && w.ask.options.some((o) => o.label === label) ? `resolve:${label}` : null;
}

/**
 * When the timeout acts on the Ask (ms) and its action, or null: its reason has a timeout, it has case text and an
 * action for the timeout to take, the director escalated it, and no timeout acted on it since.
 */
function due(w: Waiting, timeouts: Record<string, Timeout>): { at: number; action: string } | null {
  const t = timeouts[w.ask.reason];
  const action = t && w.ask.situation?.trim() ? actionOf(w, t.then) : null;
  if (!action) return null;
  const up = record.decisions<{ on: string; outcome: string; at: string }>().findLast((x) => x.on === w.on && x.outcome === "escalated");
  if (!up || eventsOf(w.key).some((x) => x.subject === "rule" && ACTED.test(x.detail ?? "") && x.time >= up.at)) return null;
  return { at: Date.parse(up.at) + t.minutes * 60_000, action };
}

/** When the timeout acts on this waiting run (ms) and its action, or null. */
export const dueAt = (e: Entry, timeouts = readTimeouts()): { at: number; action: string } | null => {
  const w = ofRun(e);
  return w ? due(w, timeouts) : null;
};

/** The log word of what an action did. */
const DID: Record<string, string> = { approve: "landed", disapprove: "dropped", dismiss: "dropped", discontinue: "dropped", continue: "reran" };

/**
 * The tick's step: `take` the action of each waiting run's and issue's Ask whose timeout is due; it returns the
 * refusal, or null. The names it took an action on. The tick passes `take`, so the UI server, which reads dueAt, loads
 * no factory action.
 */
export async function timeoutStep(take: (name: string, action: string, w: Waiting) => Promise<string | null>, now = Date.now(), runs: Entry[] = allRuns(), asks: Waiting[] = issueAsks()): Promise<string[]> {
  const timeouts = readTimeouts();
  if (!Object.keys(timeouts).length) return [];
  const out: string[] = [];
  for (const w of [...runs.map(ofRun).filter((x): x is Waiting => !!x), ...asks]) {
    const d = due(w, timeouts);
    if (!d || d.at > now) continue;
    const reason = w.ask.reason, after = `no answer in ${timeouts[reason].minutes} min`;
    // One try per Ask: the event below, whether the action worked or not, ends it, so a refused action does not try again each tick.
    const why = await take(w.name, d.action, w);
    logAlways(reason, w.key, why ? "failed" : DID[d.action] ?? "answered", { time: new Date(now).toISOString(), detail: why ? `the timeout could not take ${d.action}: ${why}` : `${after}: ${d.action}` });
    if (!why) out.push(w.name);
  }
  return out;
}
