/**
 * The one answer to "does this goal start now, and if not, why": the dispatch, the
 * stall check and the Queued lane all read it. It reads no store and takes no lock:
 * the caller reads the facts, and holds the locks and does the writes.
 */
import { afterOf } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import type { Gate } from "./factory.ts";

/** Runs of one goal in a row that may end with no commit before the dispatch stops starting it. */
export const NO_COMMIT_LIMIT = 3;
/** A goal starts at most this many agent runs in any 60 minutes, whatever the trigger: a fourth start is skipped. */
export const MAX_RUNS_PER_HOUR = 3;

/** A fact left out is not read yet and stops nothing, so a caller can decide from the cheap facts first. */
export interface GoalFacts {
  name: string;
  item: issues.Issue;
  done: (ref: string) => boolean;
  /** The line of the repo's red baseline. */
  red?: string | null;
  /** The condition of the goal's open job. */
  open?: string | null;
  /** A planner run is going on the goal. */
  planning?: boolean;
  gate?: { gate: Gate; why: string; text: string } | null;
  /** Why the goal waits for an open job on a busy file. */
  busy?: string | null;
  /** The goal's newest runs in a row with no commit. */
  noCommits?: number;
  /** The run cap's Ask was set and answered, so the hour count does not apply. */
  capHeld?: boolean;
  startsInHour?: number;
}

/** `why` is the line in the dispatch's skipped list; `text` is the line Chris reads on the Queued lane. */
export type GoalDecision = { why: string; text: string } & (
  | { kind: "ready" | "red" | "done" | "open" | "planning" | "busy" | "no-commit" }
  | { kind: "waits_on"; ids: string[] }
  | { kind: "gate"; gate: Gate }
  | { kind: "run-cap"; starts: number }
);

/** The goals of `after` (a list of ids) that are not done. */
export function pendingWaits(after: string[], done: (ref: string) => boolean): string[] {
  return after.filter((w) => !done(w));
}

/**
 * Whether a goal ref is done: the item is done, or its stage is, or the list was read and lacks it
 * (closed work that was not copied). A list not read blocks: nothing there counts as done.
 */
export const refDone = (item: issues.Issue | undefined, listRead: boolean, stage: string | undefined): boolean =>
  (item !== undefined && issues.status(item) === "done") || stage === "done" || (listRead && item === undefined);

/** The first thing that stops the goal, in the order the dispatch meets them, or `ready`. */
export function goalDecision(f: GoalFacts): GoalDecision {
  if (f.red) return { kind: "red", why: f.red, text: f.red };
  if (f.done(f.name)) return { kind: "done", why: "the item is already done", text: "The item is already done" };
  const ids = pendingWaits(afterOf(f.item), f.done);
  if (ids.length) return { kind: "waits_on", ids, why: `blocked: after ${ids.join(",")}`, text: `Waits on ${ids.join(", ")}` };
  if (f.open) return { kind: "open", why: f.open, text: `Its job is ${f.open}` };
  if (f.planning) return { kind: "planning", why: "planning", text: "A planner run is splitting it" };
  if (f.gate) return { kind: "gate", gate: f.gate.gate, why: f.gate.why, text: f.gate.text };
  if (f.busy) return { kind: "busy", why: f.busy, text: f.busy[0].toUpperCase() + f.busy.slice(1) };
  if ((f.noCommits ?? 0) >= NO_COMMIT_LIMIT) return { kind: "no-commit", why: `${NO_COMMIT_LIMIT} runs in a row with no commit`, text: `The last ${NO_COMMIT_LIMIT} runs ended with no commit; the next dispatch asks you` };
  const starts = f.capHeld ? 0 : f.startsInHour ?? 0;
  if (starts >= MAX_RUNS_PER_HOUR) return { kind: "run-cap", starts, why: `${starts} runs in the last hour`, text: `It started ${starts} times in the last hour; the next dispatch asks you` };
  return { kind: "ready", why: "ready", text: "Starts at the next dispatch" };
}
