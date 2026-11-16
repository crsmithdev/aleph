/** Why an issue waits: its hold records in the log, and the backend the factory holds after the API credit error. */
import { heldEvent, type Bound, type Gate, type Hold } from "./issue-decision.ts";
import { detailOf, event, type Event, OLD_HOLDS, parseKey, wordOf } from "../../../lib/naming.ts";
import { eventsOf, logEvent, readEvents } from "../../../lib/layout.ts";
import { getJson, putJson, tx } from "../../../lib/db.ts";
import { tell } from "../records/ledger.ts";
import type { Via } from "../../../lib/models.ts";
import { BACKENDS, probeBackend } from "../routing/models.ts";

/** One record of why an issue waits: `kind` is the hold word, or `started`; `event` its log event, which a `started` record lacks. */
export interface HoldRecord { at: string; name: string; kind: string; text: string; event?: Event }

/** The hold record kinds that did not stop a start: the issue was done or dropped, or its job was open. */
const NOT_HELD = new Set(["open", "start", "done", "dropped", "job"]);

/** Whether a record stopped an issue that could have started: not `started`, not a done issue, not an issue whose job is open. */
export const stopsStart = (r: HoldRecord): boolean => r.kind !== "started" && !NOT_HELD.has(r.kind);

/** The actions of the hold events of an issue: `held`, and the older actions and refusals each its own. */
const HOLD_ACTIONS = ["held", ...OLD_HOLDS, "gpu", "waiting", "parent", "parked", "starting", "done", "dropped"];

/** The hold of an event: a `started` event of the rule, or an event of the gate in HOLD_ACTIONS on an issue; else null. The text is the event's detail, and the kind the hold word: that of a `held` event is its detail before the first colon. */
function holdOf(e: Event): HoldRecord | null {
  if (parseKey(e.object)?.kind !== "issue") return null;
  if (e.subject === "rule" && e.action === "started") return { at: e.time, name: e.object, kind: "started", text: e.detail ?? "" };
  if (e.subject !== "gate" || !HOLD_ACTIONS.includes(e.action)) return null;
  return { at: e.time, name: e.object, kind: e.action === "held" ? wordOf(e) : e.action, text: e.detail ?? "", event: e };
}

/** Every hold record of every issue, oldest first. */
export function allHolds(): HoldRecord[] {
  return readEvents(0).map(holdOf).filter((h): h is HoldRecord => h !== null);
}

/** The hold records of the given issues, oldest first. */
export function readHolds(names: string[]): HoldRecord[] {
  return [...new Set(names)].flatMap((n) => eventsOf(n).map(holdOf).filter((h): h is HoldRecord => h !== null));
}

/**
 * Records why an issue waits (or, with kind `started`, that it no longer does): its hold event by `gate` on the issue, unless it
 * repeats the last one. A `started` record logs
 * nothing: the start logs its own event. `ev` gives the hold's log event. A done or dropped issue has no hold to record.
 */
export function recordHold(name: string, kind: Gate | "started", ev?: Hold): void {
  const at = new Date().toISOString();
  tx(() => {
    if (kind !== "started") {
      const last = eventsOf(name).filter((e) => (e.subject === "gate" && e.action !== "question" && e.action !== "answered") || (e.subject === "rule" && e.action === "started")).at(-1);
      const e = ev && event({ time: at, subject: "gate", object: name, ...ev });
      if (last && e && last.subject === "gate" && last.object === e.object && last.action === e.action && (last.detail ?? "") === (e.detail ?? "")) return;
      if (e) logEvent(e);
    }
  });
}

/** The backend the factory holds after a call on it ended with the API credit error: `via` is the backend, `why` the call's line, `goals` the issues with no run that it held. */
interface BackendHold { via: Via; why: string; since: string; goals?: string[] }

/** The backend the factory holds now, or null. */
export function backendHold(): BackendHold | null {
  const h = getJson<BackendHold | null>("state", "backend-hold", null);
  return h && typeof h.via === "string" ? h : null;
}

/** The line the hold gives a run on its backend. */
export const holdBound = (h: BackendHold): Bound =>
  ({ why: `waits for ${BACKENDS[h.via]}: ${h.why}`, text: `Waiting for ${BACKENDS[h.via]}: ${h.why}`, ev: heldEvent("waiting", `for ${BACKENDS[h.via]}`) });

/**
 * The backend hold of an issue with no run yet, whose backend only routing names: it binds when this hold already held
 * the issue (`holdGoal`), so the dispatch does not route the issue again while the hold lasts.
 */
export function heldGoal(name: string): Bound | null {
  const h = backendHold();
  return h?.goals?.includes(name) ? holdBound(h) : null;
}

/** Remembers in the backend hold that it held the issue. The hold lifts with its issues. */
export function holdGoal(name: string): void {
  const h = backendHold();
  if (h && !h.goals?.includes(name)) putJson("state", "backend-hold", { ...h, goals: [...(h.goals ?? []), name] });
}

/**
 * Holds the backend of a call that ended with the API credit error, and tells Chris once. A backend already held keeps
 * its line, so the jobs that follow it write no second alert.
 */
export async function holdBackend(via: Via, why: string): Promise<void> {
  if (backendHold()?.via === via) return;
  putJson("state", "backend-hold", { via, why, since: new Date().toISOString() });
  logEvent({ subject: "gate", action: "changed", object: "settings", detail: detailOf("changed", "credit", `on: ${via}: ${why}`) });
  await tell(`the factory holds ${BACKENDS[via]}: ${why}`);
}

/** Probes the held backend and lifts the hold when it answers, with one line. Returns that line, or null. */
export async function probeHold(up: (via: Via) => Promise<boolean> = probeBackend): Promise<string | null> {
  const h = backendHold();
  if (!h || !(await up(h.via))) return null;
  putJson("state", "backend-hold", null);
  const line = `${BACKENDS[h.via]} answers again: the hold is off`;
  logEvent({ subject: "gate", action: "changed", object: "settings", detail: detailOf("changed", "credit", "off") });
  return line;
}
