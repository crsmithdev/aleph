/**
 * The worker verdict: the policy for a branch after its worker. Two stations run on it. Verify: the checks
 * (the hidden check last), the doc claims, the keep-gate and the Oracle. Then the reviewer (a reviewer with
 * no verdict runs once more). A reviewer's pass on a diff that changes a security path or a held path waits
 * for Chris with a held-path Ask. A failure of a check, the keep-gate, the Oracle or the reviewer goes back to
 * the worker as a fix round while rounds are left. The ports run each step; unit.ts gives the git and sandbox
 * ones. This module does no IO.
 */
import { plainAsk, type AskReason } from "./ask.ts";
import { stopFields, type ChecksStop } from "./checks.ts";
import { verdict as reviewVerdict } from "./gate.ts";
import type { Run } from "./ledger.ts";

/** The fields of the run that a verdict sets. */
export type Outcome = Pick<Run, "condition" | "ask" | "reason" | "cause" | "checkName" | "question" | "say" | "commit" | "conflicts" | "checkItem" | "failed" | "round" | "cost" | "defaults" | "stat" | "checkedBase" | "checkedTip">;
export interface Verdict { outcome: Outcome; code: number }

/** One reviewer call: the reason to hold, or null on a pass. `none` is a call that gave no verdict. */
export interface ReviewCall { reason: string | null; cost?: number; none?: boolean }

/** What runs each step on the branch. */
export interface VerdictPorts {
  /** The repo's checks and the hidden check: why they stopped, or null, and the last check of the run that failed. */
  checks(): Promise<{ stop: ChecksStop | null; failed?: string }>;
  /** The Ask question when the hidden check failed the same way on the run before, else null. */
  repeatedHidden(): { question: string } | null;
  /** Why the worker's final message makes a doc claim that its transcript does not back, else null. */
  docClaims(): string | null;
  /** The keep-gate: why a new test case of the branch does not fail on its base, does not pass on its head, or earns no keep, else null. */
  keepGate(): Promise<string | null>;
  /** The diff stat, for an Ask. */
  stat(): string;
  /** The security path the diff changes, else null. */
  security(): string | null;
  /** The held rule the diff breaks, else null. */
  heldRule(): string | null;
  /** The reason of the first Oracle command that fails twice, else null. */
  oracle(): Promise<string | null>;
  review(): Promise<ReviewCall>;
}

/** The branch facts the policy reads besides the ports. */
export interface Branch {
  /** The job's runs that were sent back before this one. Absent for a recheck, which has no fix rounds. */
  earlier?: Run[];
  /** The most fix rounds a job gets. */
  rounds: number;
  /** What the run states already, such as its cost. */
  facts: Partial<Outcome>;
  /** The base and the tip that the checks ran on. The run states them once the checks pass. */
  checked: Pick<Outcome, "checkedBase" | "checkedTip">;
}

/** A verdict that waits for Chris: the condition `awaiting` and the Ask. */
export const awaiting = (reason: AskReason, question: string, why: string[] = []): Pick<Outcome, "condition" | "ask"> =>
  ({ condition: "awaiting", ask: plainAsk(reason, question, why.filter(Boolean)) });

const stopped = (why: ChecksStop, extra: Partial<Outcome> = {}): Verdict => ({ outcome: { condition: "stuck", ...stopFields(why), ...extra }, code: 1 });

/**
 * The check that the checks' stop sends back to the worker, or null. `check` is the last check of the run that failed.
 * A time-out does not go back, and neither does a stop that is not that check's own failure.
 */
function backCheck(stop: ChecksStop, check: string | undefined): string | null {
  if (!check || stop.timedOut) return null;
  const own = stop.cause === "check" ? stop.checkName === check : check === "hidden" && stop.cause === "hidden-check";
  return own ? check : null;
}

/**
 * What a failed check adds to the stuck run: `failed` and `round`, which send it back, while fewer than `cap`
 * rounds are done; after that, a reason that counts the rounds. A run with no fix rounds (a recheck) gets nothing.
 */
function checkBack(earlier: Run[] | undefined, check: string, reason: string, cap: number): Pick<Run, "failed" | "round"> | Pick<Run, "reason"> | Record<string, never> {
  if (!earlier) return {};
  const done = earlier.length;
  if (done < cap) return { failed: check, round: done };
  return cap > 0 ? { reason: `${reason} after ${done} fix rounds` } : {};
}

/** "once", "twice", "3 times". */
const times = (n: number) => n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;

/**
 * What follows a reviewer hold: a fix round (`round`) while fewer than `cap` rounds are done; else the run
 * waits for Chris with `reason`, which says how often the reviewer sent it back when it did.
 */
function reviewHold(earlier: Run[] | undefined, reason: string, cap: number): { round: number } | { reason: string } {
  if (earlier && earlier.length < cap) return { round: earlier.length };
  const back = earlier?.filter((r) => r.failed === "review").length ?? 0;
  return { reason: back ? `the reviewer sent it back ${times(back)}: ${reason.replace(/^reviewer:\s*/, "")}` : reason };
}

/** The verdict on a branch that its worker or a recheck left. */
export async function workerVerdict(b: Branch, p: VerdictPorts): Promise<Verdict> {
  const { earlier, rounds } = b;
  const facts = { ...b.facts };
  // Verify: the checks, the doc claims, the keep-gate and the Oracle.
  const { stop, failed } = await p.checks();
  if (stop) {
    const check = backCheck(stop, failed);
    if (!check) return stopped(stop, facts);
    const same = earlier && check === "hidden" && earlier.length < rounds ? p.repeatedHidden() : null;
    if (same) return { outcome: { ...awaiting("question", same.question), question: same.question, cause: "hidden-check", reason: stop.reason, ...facts }, code: 0 };
    return stopped(stop, { ...facts, ...checkBack(earlier, check, stop.reason, rounds) });
  }
  // After the checks, so a doc-claims failure leaves their runs and results as they were.
  const claims = p.docClaims();
  if (claims) return stopped({ cause: "check", checkName: "doc-claims", reason: claims }, { ...facts, ...checkBack(earlier, "doc-claims", claims, rounds) });
  const kept = await p.keepGate();
  if (kept) return stopped({ cause: "check", checkName: "keep-gate", reason: kept }, { ...facts, ...checkBack(earlier, "keep-gate", kept, rounds) });
  Object.assign(facts, b.checked);
  const bad = await p.oracle();
  if (bad) return stopped({ cause: "check", checkName: "oracle", reason: bad }, { ...facts, ...checkBack(earlier, "oracle", bad, rounds) });

  // The reviewer.
  const stat = p.stat();
  const call = async () => {
    const rv = await p.review();
    if (rv.cost !== undefined) facts.cost = (facts.cost ?? 0) + rv.cost;
    return rv;
  };
  let rv = await call();
  // A second miss is the reviewer's, not the worker's: it goes to Chris whatever fix rounds are left, since a fix round cannot cure it.
  if (rv.none) rv = await call();
  if (!rv.reason) {
    // A reviewed diff that changes a security path or a held path waits for Chris.
    const security = p.security();
    const rule = security ? `held path ${security}` : p.heldRule();
    if (rule) return { outcome: { ...awaiting("held-path", rule, [stat]), reason: rule, stat, ...facts }, code: 0 };
    return { outcome: { condition: "passed", ...facts }, code: 0 };
  }
  if (rv.none) return { outcome: { ...awaiting("review", rv.reason, [stat]), cause: "reviewer", reason: rv.reason, stat, ...facts }, code: 0 };
  const hold = reviewHold(earlier, rv.reason, rounds);
  if ("round" in hold) return { outcome: { condition: "stuck", cause: "reviewer", reason: rv.reason, stat, ...facts, failed: "review", round: hold.round }, code: 1 };
  return { outcome: { ...awaiting("review", hold.reason, [stat]), cause: "reviewer", reason: hold.reason, stat, ...facts }, code: 0 };
}

/** Why the reviewer does not let a held run land, or null: it has given a verdict (`review` is its review.md). */
export function landBlock(review: string | undefined): string | null {
  return reviewVerdict(review ?? "") ? null : "the reviewer has no verdict yet";
}
