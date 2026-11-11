/**
 * The Ask timeout: when Chris does not answer an escalated land Ask in the minutes `timeouts.json` sets for its reason,
 * the tick lands the run. It acts only where the director's case text recommends `land`. It acts on the escalation
 * list too (a security path or bun.lock): Chris sets the minutes, so the land is his.
 *
 * `timeouts.json` in the factory dir maps a reason to its minutes. A reason with no entry waits for Chris.
 */
import { join } from "node:path";
import { layout } from "../../../lib/layout.ts";
import { readJsonOr, writeJson } from "../../../lib/json.ts";
import { allRuns, type Entry } from "../records/ledger.ts";
import * as record from "../records/record.ts";
import { logAlways } from "./ask.ts";

/** The reasons a timeout may act on: the two that hold a land. */
export const TIMED = ["held-path", "review"];

const file = () => join(layout().factory, "timeouts.json");

/** timeouts.json. A missing file is empty; an entry for a reason not in TIMED is ignored. */
export const readTimeouts = (): Record<string, number> =>
  Object.fromEntries(Object.entries(readJsonOr<Record<string, number>>(file(), {})).filter(([r, m]) => TIMED.includes(r) && Number.isInteger(m) && m > 0));

/** Set the minutes of `reason`; 0 removes its timeout. Returns why it could not, or null. */
export function setTimeoutOf(reason: string, minutes: number): string | null {
  if (!TIMED.includes(reason)) return `${reason} has no timeout; reasons: ${TIMED.join(", ")}`;
  if (!Number.isInteger(minutes) || minutes < 0) return `minutes must be a whole number of at least 0, not ${minutes}`;
  const { [reason]: _, ...rest } = readTimeouts();
  writeJson(file(), minutes ? { ...rest, [reason]: minutes } : rest);
  return null;
}

/** The key of a run's job record: its issue, else its job. */
const keyOf = (e: Entry) => record.keyOf(e.run);

/**
 * When the timeout lands this waiting run (ms), or null: its reason has minutes, its Ask has case text that recommends
 * `land`, the director escalated it, and no timeout tried it before.
 */
export function dueAt(e: Entry, minutes = readTimeouts()): number | null {
  const ask = e.run.condition === "waiting" ? e.run.ask : null;
  const m = ask && minutes[ask.reason];
  if (!m || !ask.situation?.trim() || ask.recommend?.action !== "land") return null;
  const evs = record.read(keyOf(e))?.events ?? [];
  if (evs.some((x) => x.kind === "timeout" && x.run === e.id)) return null;
  const up = evs.findLast((x) => x.kind === "director" && (x.data as { on?: string; outcome?: string })?.on === e.id && (x.data as { outcome?: string }).outcome === "escalated");
  return up ? Date.parse(up.at) + m * 60_000 : null;
}

/**
 * The tick's step: `start` a land of each waiting run whose timeout is due; it returns the refusal, or null. The names
 * it started a land for. The tick passes `start`, so the UI server, which reads dueAt, loads no factory action.
 */
export async function timeoutStep(start: (name: string) => Promise<string | null>, now = Date.now(), runs: Entry[] = allRuns(true)): Promise<string[]> {
  const minutes = readTimeouts();
  if (!Object.keys(minutes).length) return [];
  const out: string[] = [];
  for (const e of runs) {
    const at = dueAt(e, minutes);
    if (at === null || at > now) continue;
    const reason = e.run.ask!.reason, ref = e.run.on ?? e.run.name;
    // One try per Ask: a refused land does not try again each tick.
    record.addEvent(keyOf(e), { kind: "timeout", run: e.id, what: `${reason}: no answer in ${minutes[reason]} min` });
    const why = await start(e.run.name);
    logAlways(reason, ref, why ? "failed" : "landed", { note: why ? `the timeout could not land it: ${why}` : `no answer in ${minutes[reason]} min` });
    if (!why) out.push(e.run.name);
  }
  return out;
}
