/**
 * The one answer to "does this goal start now, and if not, why": the dispatch, the
 * stall check and the Queued lane all read it. It reads no store and takes no lock:
 * the caller reads the facts, and holds the locks and does the writes.
 *
 * The dispatch asks the 7 gates in the order of GATES; the first that binds skips the goal,
 * and its name is the kind of the hold record.
 */
import { afterOf, areasOf, labels } from "../../todo/lib/store.ts";
import { RUN_CAP } from "./settings.ts";
import * as issues from "../../todo/lib/todo.ts";

/** Runs of one goal in a row that may end with no commit before the dispatch stops starting it. */
export const NO_COMMIT_LIMIT = 3;

/** The dispatch's gates, in the order it asks them. Loop guard is last, so it counts only goals that would start. */
export const GATES = ["pause", "baseline", "not-ready", "live-cap", "busy-file", "loop-guard"] as const;

export type Gate = (typeof GATES)[number];

/** A gate that binds: `why` is the line in the dispatch's skipped list; `text` is the line Chris reads. */
export interface Bound { why: string; text: string }

/** A fact left out is not read yet and stops nothing, so a caller can decide from the cheap facts first. */
export interface GoalFacts {
  name: string;
  item: issues.Issue;
  done: (ref: string) => boolean;
  pause?: Bound | null;
  /** The line of the repo's baseline when it is red, still running or unchecked. */
  red?: string | null;
  /** The condition of the goal's open job. */
  open?: string | null;
  "live-cap"?: Bound | null;
  /** Why the goal waits for an open job on a busy file. */
  busy?: string | null;
  /** The goal's newest runs in a row with no commit. */
  noCommits?: number;
  /** The run cap's Ask was set and answered, so the hour count does not apply. */
  capHeld?: boolean;
  startsInHour?: number;
}

/** `why` is the line in the dispatch's skipped list; `text` is the line Chris reads on the Queued lane. */
export type GoalDecision = Bound & (
  | { kind: "ready" | "pause" | "baseline" | "live-cap" }
  /** `on`: the id of the issue whose open job holds the busy file. */
  | { kind: "busy-file"; on?: string }
  /** `ids`: the refs of `after` that are not done, when that is why. */
  | { kind: "not-ready"; ids?: string[] }
  /** `ask`: the Ask the dispatch sets in place of a start. */
  | { kind: "loop-guard"; ask: "no-commit" | "run-cap"; starts?: number }
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

/** Why the goal is not ready: it is done, waits on an `after` ref, or has an open job; else null. */
function notReady(f: GoalFacts): Extract<GoalDecision, { kind: "not-ready" }> | null {
  const not = (why: string, text: string) => ({ kind: "not-ready" as const, why, text });
  if (f.done(f.name)) return not("the item is already done", "The item is already done");
  const ids = pendingWaits(afterOf(f.item), f.done);
  if (ids.length) return { ...not(`after ${ids.join(",")}`, `Waits on ${ids.join(", ")}`), ids };
  if (f.open) return not(`its job is ${f.open}`, `Its job is ${f.open}`);
  return null;
}

/** The first gate that binds, in the order of GATES, or `ready`. */
export function goalDecision(f: GoalFacts): GoalDecision {
  if (f.pause) return { kind: "pause", ...f.pause };
  // The fix of a red main is the one goal a red baseline lets through: it is how main gets green again.
  // `add` writes the label into `areas`; an older issue may carry it in `labels`, as the firefighter's isRedMain reads.
  if (f.red && !areasOf(f.item).includes("red-main") && !labels(f.item).includes("red-main")) return { kind: "baseline", why: f.red, text: f.red };
  const not = notReady(f);
  if (not) return not;
  if (f["live-cap"]) return { kind: "live-cap", ...f["live-cap"] };
  if (f.busy) return { kind: "busy-file", on: f.busy.match(/^waits for (\S+):/)?.[1], why: f.busy, text: f.busy[0].toUpperCase() + f.busy.slice(1) };
  if ((f.noCommits ?? 0) >= NO_COMMIT_LIMIT) return { kind: "loop-guard", ask: "no-commit", why: `${NO_COMMIT_LIMIT} runs in a row with no commit`, text: `The last ${NO_COMMIT_LIMIT} runs ended with no commit; the next dispatch asks the director` };
  const starts = f.capHeld ? 0 : f.startsInHour ?? 0;
  if (starts >= RUN_CAP()) return { kind: "loop-guard", ask: "run-cap", starts, why: `${starts} runs in the last hour`, text: `It started ${starts} times in the last hour; the next dispatch asks the director` };
  return { kind: "ready", why: "ready", text: "Starts at the next dispatch" };
}
