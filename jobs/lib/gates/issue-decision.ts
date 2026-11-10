/**
 * The one answer to "does this issue start now, and if not, why": the dispatch, the
 * stall check and the Queued lane all read it. It reads no store and takes no lock:
 * the caller reads the facts, and holds the locks and does the writes.
 *
 * The dispatch asks the gates in the order of GATES; the first that binds skips the issue,
 * and its name is the kind of the hold record.
 */
import { afterOf, areasOf, labels } from "../../../issues/lib/store.ts";
import { RUN_CAP } from "../infra/settings.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { word, type Event } from "../../../lib/naming.ts";
import { POLICY } from "../records/outcome.ts";

/** Runs of one issue in a row that may end with no commit before the dispatch stops starting it. */
export const NO_COMMIT_LIMIT = 3;

/** The dispatch's gates, in the order it asks them. Loop guard is last, so it counts only issues that would start. */
export const GATES = ["pause", "backend", "baseline", "not-ready", "live-cap", "busy-file", "loop-guard"] as const;

/** The kind of a hold record: a gate of GATES, or `credit-wait`, which the issue's own last run decides. */
export type Gate = (typeof GATES)[number] | "credit-wait";

/** The fields of a hold's log event, after `by` and `subject`. */
export type Hold = Omit<Event, "at" | "by" | "subject">;

/** A gate that binds: `why` is the line in the dispatch's skipped list; `text` is the line Chris reads; `ev` is the log event. */
export interface Bound { why: string; text: string; ev?: Hold }

/** A fact left out is not read yet and stops nothing, so a caller can decide from the cheap facts first. */
export interface IssueFacts {
  name: string;
  item: issues.Issue;
  done: (ref: string) => boolean;
  pause?: Bound | null;
  /** The backend hold, when the run the issue would start is on the backend the factory holds. */
  backend?: Bound | null;
  /** The line of the repo's baseline when it is red, still running or unchecked. */
  red?: string | null;
  /** The condition of the issue's open job. */
  open?: string | null;
  /** The ID of the issue's open job, `a1421#6` (`jobIdOf`). */
  job?: string | null;
  "live-cap"?: Bound | null;
  /** Why the issue waits for an open job on a busy file: `on` is that job's issue, `file` the busy file or `gpt-oss`. */
  busy?: { why: string; on: string; file: string } | null;
  /** The issue's newest runs in a row with no commit. */
  noCommits?: number;
  /** The run cap's Ask was set and answered, so the hour count does not apply. */
  capHeld?: boolean;
  startsInHour?: number;
  /** How long ago the issue's newest build run that ended with the API credit error ended, in milliseconds. */
  creditWait?: number | null;
}

/** `why` is the line in the dispatch's skipped list; `text` is the line Chris reads on the Queued lane. */
export type IssueDecision = Bound & (
  | { kind: "ready" | "pause" | "backend" | "baseline" | "live-cap" | "credit-wait" }
  /** `on`: the id of the issue whose open job holds the busy file. */
  | { kind: "busy-file"; on?: string }
  /** `ids`: the refs of `after` that are not done, when that is why. */
  | { kind: "not-ready"; ids?: string[] }
  /** `ask`: the Ask the dispatch sets in place of a start. */
  | { kind: "loop-guard"; ask: "no-commit" | "run-cap"; starts?: number }
);

/** The issues of `after` (a list of ids) that are not done. */
export function pendingWaits(after: string[], done: (ref: string) => boolean): string[] {
  return after.filter((w) => !done(w));
}

/**
 * Whether an issue ref is done: the item is done, or its stage is, or the list was read and lacks it
 * (closed work that was not copied). A list not read blocks: nothing there counts as done.
 */
export const refDone = (item: issues.Issue | undefined, listRead: boolean, stage: string | undefined): boolean =>
  (item !== undefined && issues.status(item) === "done") || stage === "done" || (listRead && item === undefined);

/** Why the issue is not ready: it is done, waits on an `after` ref, or has an open job; else null. */
function notReady(f: IssueFacts): Extract<IssueDecision, { kind: "not-ready" }> | null {
  const not = (why: string, text: string, ev: Hold) => ({ kind: "not-ready" as const, why, text, ev });
  if (f.done(f.name)) return not("the item is already done", "The item is already done", { action: "done" });
  const ids = pendingWaits(afterOf(f.item), f.done);
  if (ids.length) return { ...not(`after ${ids.join(",")}`, `Waits on ${ids.join(", ")}`, { action: "after", on: ids }), ids };
  if (f.open) return not(`its job is ${f.open}`, `Its job is ${f.open}`, { action: word("state", f.open), on: f.job ? [f.job] : undefined });
  return null;
}

/** The first gate that binds, in the order of GATES, or `ready`. */
export function issueDecision(f: IssueFacts): IssueDecision {
  if (f.pause) return { kind: "pause", ...f.pause };
  if (f.backend) return { kind: "backend", ...f.backend };
  // The fix of a red main is the one issue a red baseline lets through: it is how main gets green again.
  // `add` writes the label into `areas`; an older issue may carry it in `labels`, as the firefighter's isRedMain reads.
  if (f.red && !areasOf(f.item).includes("red-main") && !labels(f.item).includes("red-main")) return { kind: "baseline", why: f.red, text: f.red, ev: { action: "red" } };
  const not = notReady(f);
  if (not) return not;
  if (f["live-cap"]) return { kind: "live-cap", ...f["live-cap"] };
  if (f.busy) return { kind: "busy-file", on: f.busy.on, why: f.busy.why, text: f.busy.why[0].toUpperCase() + f.busy.why.slice(1), ev: { action: "busy", on: [f.busy.on], file: f.busy.file } };
  // A run the API refused for credit did no work, so the issue waits instead of starting again at once, and no run-cap Ask goes out.
  if ((f.creditWait ?? Infinity) < POLICY.credit.waitMs) return { kind: "credit-wait", why: "waits for API credit", text: `Waits for API credit: the last run ended with the API credit error, so it starts again ${POLICY.credit.waitMs / 60_000} minutes later`, ev: { action: "credit" } };
  if ((f.noCommits ?? 0) >= NO_COMMIT_LIMIT) return { kind: "loop-guard", ask: "no-commit", why: `${NO_COMMIT_LIMIT} runs in a row with no commit`, text: `The last ${NO_COMMIT_LIMIT} runs ended with no commit; the next dispatch asks the director`, ev: { action: "looping", sub: "no-commit", count: `${f.noCommits} / ${NO_COMMIT_LIMIT}` } };
  const starts = f.capHeld ? 0 : f.startsInHour ?? 0;
  if (starts >= RUN_CAP()) return { kind: "loop-guard", ask: "run-cap", starts, why: `${starts} runs in the last hour`, text: `It started ${starts} times in the last hour; the next dispatch asks the director`, ev: { action: "looping", sub: "starts", count: `${starts} / 1h` } };
  return { kind: "ready", why: "ready", text: "Starts at the next dispatch" };
}
