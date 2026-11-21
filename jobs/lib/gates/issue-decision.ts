/**
 * The one answer to "does this issue start now, and if not, why": the dispatch, the
 * stall check and the Queued lane all read it. It reads no store and takes no lock:
 * the caller reads the facts, and holds the locks and does the writes.
 *
 * The dispatch asks the gates in the order of GATES; the first that binds skips the issue,
 * and its word is the kind of the decision and of the hold record.
 */
import { afterOf, isRedMain } from "../../../lib/issue-file.ts";
import { NO_COMMIT_LIMIT, RUN_CAP } from "../infra/settings.ts";
import * as issues from "../../../lib/issue-file.ts";
import { detailOf, type Event } from "../../../lib/naming.ts";
import { POLICY } from "../records/outcome.ts";
import { askDetail } from "../asks/ask.ts";

/** The dispatch's gates, in the order it asks them. Loop guard is last, so it counts only issues that would start. */
export const GATES = ["paused", "waiting", "red", "done", "after", "job", "full", "file", "credit", "ask"] as const;

/** The kind of a decision and of a hold record: a gate of GATES, or a reason a start was refused (`parked`, `parent`, `starting`). */
export type Gate = (typeof GATES)[number] | "parked" | "parent" | "starting";

/** The fields of a hold's log event that the hold sets: the gate is the subject and the issue the object. An issue's hold is a `held` event, its detail the hold word and then its facts: `after: issue.2985 issue.2993`. */
export type Hold = Pick<Event, "action"> & Partial<Pick<Event, "detail">>;

/** The `held` event of a hold word and its facts. */
export const heldEvent = (word: string, facts?: string): Hold => ({ action: "held", detail: detailOf("held", word, facts) });

/** A gate that binds: `why` is the line in the dispatch's skipped list; `text` is the line Chris reads; `ev` is the log event. */
export interface Bound { why: string; text: string; ev?: Hold }

/** A fact left out is not read yet and stops nothing, so a caller can decide from the cheap facts first. */
export interface IssueFacts {
  /** The work's name: the issue's key. */
  name: string;
  /** The issue as the store names it (`<repo>-<n>`), for `done`; the name when absent. */
  ref?: string;
  item: issues.Issue;
  /** The parent of a sub-issue: its `after` holds the sub-issue as its own does. */
  parent?: issues.Issue;
  done: (ref: string) => boolean;
  paused?: Bound | null;
  /** The backend hold, when the run the issue would start is on the backend the factory holds. */
  waiting?: Bound | null;
  /** The line of the repo's baseline when it is red, still running or unchecked. */
  red?: string | null;
  /** The state of the issue's open job. */
  open?: string | null;
  /** The key of the issue's open job, `job.6`. */
  job?: string | null;
  full?: Bound | null;
  /** Why the issue waits for an open job on a busy file: `on` is that job's issue, `job` its key, `file` the busy file or `gpt-oss`. */
  busy?: { why: string; on: string; job: string; file: string } | null;
  /** The issue's newest runs in a row with no commit. */
  noCommits?: number;
  /** The run cap's Ask was set and answered, so the hour count does not apply. */
  capHeld?: boolean;
  startsInHour?: number;
  /** The issue's newest build run that ended with the API credit error: its key, and how long ago it ended in milliseconds. */
  creditWait?: { job: string; ago: number } | null;
}

/** `why` is the line in the dispatch's skipped list; `text` is the line Chris reads on the Queued lane. */
export type IssueDecision = Bound & (
  | { kind: "ready" | "paused" | "waiting" | "red" | "done" | "job" | "full" | "credit" }
  /** `on`: the id of the issue whose open job holds the busy file. */
  | { kind: "file"; on?: string }
  /** `ids`: the refs of `after` that are not done, when that is why. */
  | { kind: "after"; ids?: string[] }
  /** `ask`: the Ask the dispatch sets in place of a start; `facts` go in its `question` event. */
  | { kind: "ask"; ask: "no-commit" | "run-cap"; facts: string; starts?: number }
);

/** The refs an issue waits for: its own `after` and its parent's. */
export const waitsOf = (item: issues.Issue, parent?: issues.Issue): string[] => [...new Set([...afterOf(item), ...(parent ? afterOf(parent) : [])])];

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

/** Why the issue is not ready: it is done, waits on an `after` ref of its own or its parent, or has an open job; else null. A done issue gets no hold. */
function notReady(f: IssueFacts): IssueDecision | null {
  if (f.done(f.ref ?? f.name)) return { kind: "done", why: "the item is already done", text: "The item is already done" };
  const ids = pendingWaits(waitsOf(f.item, f.parent), f.done);
  if (ids.length) return { kind: "after", ids, why: `after ${ids.join(",")}`, text: `Waits on ${ids.join(", ")}`, ev: heldEvent("after", ids.join(" ")) };
  if (f.open) return { kind: "job", why: `its job is ${f.open}`, text: `Its job is ${f.open}`, ev: heldEvent("job", f.job ?? f.open) };
  return null;
}

/** The first gate that binds, in the order of GATES, or `ready`. */
export function issueDecision(f: IssueFacts): IssueDecision {
  if (f.paused) return { kind: "paused", ...f.paused };
  if (f.waiting) return { kind: "waiting", ...f.waiting };
  // The fix of a red main is the one issue a red baseline lets through: it is how main gets green again.
  if (f.red && !isRedMain(f.item)) return { kind: "red", why: f.red, text: f.red, ev: heldEvent("red") };
  const not = notReady(f);
  if (not) return not;
  if (f.full) return { kind: "full", ...f.full };
  if (f.busy) return { kind: "file", on: f.busy.on, why: f.busy.why, text: f.busy.why[0].toUpperCase() + f.busy.why.slice(1), ev: heldEvent("file", `${f.busy.file}: ${f.busy.job}`) };
  // A run the API refused for credit did no work, so the issue waits instead of starting again at once, and no run-cap Ask goes out.
  if (f.creditWait && f.creditWait.ago < POLICY.credit.waitMs) return { kind: "credit", why: "waits for API credit", text: `Waits for API credit: the last run ended with the API credit error, so it starts again ${POLICY.credit.waitMs / 60_000} minutes later`, ev: heldEvent("credit", `${f.creditWait.job} hit the API credit error`) };
  if ((f.noCommits ?? 0) >= NO_COMMIT_LIMIT) {
    const facts = `${f.noCommits} / ${NO_COMMIT_LIMIT} jobs with no commit`;
    return { kind: "ask", ask: "no-commit", facts, why: `${NO_COMMIT_LIMIT} runs in a row with no commit`, text: `The last ${NO_COMMIT_LIMIT} runs ended with no commit; the next dispatch asks the director`, ev: { action: "question", detail: askDetail({ reason: "no-commit", facts }) } };
  }
  const starts = f.capHeld ? 0 : f.startsInHour ?? 0;
  if (starts >= RUN_CAP()) {
    const facts = `${starts} starts in 1h`;
    return { kind: "ask", ask: "run-cap", starts, facts, why: `${starts} runs in the last hour`, text: `It started ${starts} times in the last hour; the next dispatch asks the director`, ev: { action: "question", detail: askDetail({ reason: "run-cap", facts }) } };
  }
  return { kind: "ready", why: "ready", text: "Starts at the next dispatch" };
}
