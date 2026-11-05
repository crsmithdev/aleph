/**
 * The worker verdict: the policy for a branch after its worker. Two stations run on it. Verify: the checks,
 * the doc claims, the keep-gate and the Oracle. A keep-gate or Oracle with no verdict stops the run as `infra`, never as a pass. Then the reviewer (a reviewer with
 * no verdict runs once more). A reviewer's pass on a diff that changes a security path or a held path waits
 * for Chris with a held-path Ask. A failure of a check, the keep-gate, the Oracle or the reviewer goes back to
 * the worker as a fix round while rounds are left. The ports run each step; unit.ts gives the git and worktree
 * ones. This module does no IO.
 */
import { plainAsk, type AskReason } from "../asks/ask.ts";
import { stopFields, type ChecksStop } from "./checks.ts";
import type { Run } from "../records/ledger.ts";

/** The fields of the run that a verdict sets. */
export type Outcome = Pick<Run, "condition" | "ask" | "reason" | "cause" | "checkName" | "question" | "say" | "commit" | "conflicts" | "checkItem" | "failed" | "round" | "cost" | "defaults" | "followups" | "alreadyMet" | "stat" | "checkedBase" | "checkedTip">;
export interface Verdict { outcome: Outcome; code: number }

/** One reviewer call: the reason to hold, or null on a pass. `none` is a call that gave no verdict. */
export interface ReviewCall { reason: string | null; cost?: number; none?: boolean }

/** What runs each step on the branch. */
export interface VerdictPorts {
  /** The repo's checks: why they stopped, or null, and the last check of the run that failed. */
  checks(): Promise<{ stop: ChecksStop | null; failed?: string }>;
  /** The Ask question when `check` failed with the same failing tests on the run before, else null. */
  repeatedFailure(check: string): { question: string } | null;
  /** Why the worker's final message makes a doc claim that its transcript does not back, else null. */
  docClaims(): string | null;
  /** The keep-gate: why a new test case of the branch does not fail on its base, does not pass on its head, or earns no keep, else null. */
  keepGate(): Promise<string | NoVerdict | null>;
  /** The diff stat, for an Ask. */
  stat(): string;
  /** The security path the diff changes, else null. */
  security(): string | null;
  /** The held rule the diff breaks, else null. */
  heldRule(): string | null;
  /** The reason of the first Oracle command that fails twice, else null. */
  oracle(): Promise<string | NoVerdict | null>;
  review(): Promise<ReviewCall>;
}

/** A step that could not run to a verdict (its setup failed, a clock or a signal ended it): neither a pass nor a failure. */
export interface NoVerdict { noVerdict: string }

/** The branch facts the policy reads besides the ports. */
export interface Branch {
  /** The job's runs that were sent back before this one, for what they failed. */
  earlier?: Run[];
  /** The job's fix rounds so far: `rounds` of its job record. Absent for a recheck, which has no fix rounds. */
  done?: number;
  /** The most fix rounds a job gets. */
  rounds: number;
  /** What the run states already, such as its cost. */
  facts: Partial<Outcome>;
  /** The base and the tip that the checks ran on. The run states them once the checks pass. */
  checked: Pick<Outcome, "checkedBase" | "checkedTip">;
}

/** A verdict that waits for Chris: the condition `waiting` and the Ask. */
export const waiting = (reason: AskReason, question: string, why: string[] = []): Pick<Outcome, "condition" | "ask"> =>
  ({ condition: "waiting", ask: plainAsk(reason, question, why.filter(Boolean)) });

/** A stop: `returned` when it goes back to the worker (`failed` is set), else `failed`. */
const stopped = (why: ChecksStop, extra: Partial<Outcome> = {}): Verdict =>
  ({ outcome: { condition: extra.failed ? "returned" : "failed", ...stopFields(why), ...extra }, code: 1 });

/**
 * The check that the checks' stop sends back to the worker, or null. `check` is the last check of the run that failed.
 * A time-out does not go back, and neither does a stop that is not that check's own failure.
 */
function backCheck(stop: ChecksStop, check: string | undefined): string | null {
  if (!check || stop.timedOut) return null;
  return stop.cause === "check" && stop.checkName === check ? check : null;
}

/**
 * What a failed check adds to the stopped run: `failed` and `round`, which send it back, while fewer than `cap`
 * rounds are done; after that, a reason that counts the rounds. A run with no fix rounds (a recheck) gets nothing.
 */
function checkBack(done: number | undefined, check: string, reason: string, cap: number): Pick<Run, "failed" | "round"> | Pick<Run, "reason"> | Record<string, never> {
  if (done === undefined) return {};
  if (done < cap) return { failed: check, round: done };
  return cap > 0 ? { reason: `${reason} after ${done} fix rounds` } : {};
}

/** "once", "twice", "3 times". */
const times = (n: number) => n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;

/**
 * What follows a reviewer hold: a fix round (`round`) while fewer than `cap` rounds are done; else the run
 * waits for Chris with `reason`, which says how often the reviewer sent it back when it did.
 */
function reviewHold(done: number | undefined, earlier: Run[] | undefined, reason: string, cap: number): { round: number } | { reason: string } {
  if (done !== undefined && done < cap) return { round: done };
  const back = earlier?.filter((r) => r.failed === "review").length ?? 0;
  return { reason: back ? `the reviewer sent it back ${times(back)}: ${reason.replace(/^reviewer:\s*/, "")}` : reason };
}

/** The verdict on a branch that its worker or a recheck left. */
export async function workerVerdict(b: Branch, p: VerdictPorts): Promise<Verdict> {
  const { earlier, done, rounds } = b;
  const facts = { ...b.facts };
  // Verify: the checks, the doc claims, the keep-gate and the Oracle.
  const { stop, failed } = await p.checks();
  if (stop) {
    const check = backCheck(stop, failed);
    if (!check) return stopped(stop, facts);
    const same = done !== undefined && done < rounds ? p.repeatedFailure(check) : null;
    if (same) return { outcome: { ...waiting("question", same.question), question: same.question, ...stopFields(stop), ...facts }, code: 0 };
    return stopped(stop, { ...facts, ...checkBack(done, check, stop.reason, rounds) });
  }
  // After the checks, so a doc-claims failure leaves their runs and results as they were.
  const claims = p.docClaims();
  if (claims) return stopped({ cause: "check", checkName: "doc-claims", reason: claims }, { ...facts, ...checkBack(done, "doc-claims", claims, rounds) });
  // A step with no verdict fails as `infra`: not a fix round; the rescue checks the branch again once, then asks.
  const kept = await p.keepGate();
  if (typeof kept === "object" && kept) return stopped({ cause: "infra", checkName: "keep-gate", reason: kept.noVerdict }, facts);
  if (kept) return stopped({ cause: "check", checkName: "keep-gate", reason: kept }, { ...facts, ...checkBack(done, "keep-gate", kept, rounds) });
  Object.assign(facts, b.checked);
  const bad = await p.oracle();
  if (typeof bad === "object" && bad) return stopped({ cause: "infra", checkName: "oracle", reason: bad.noVerdict }, facts);
  if (bad) return stopped({ cause: "check", checkName: "oracle", reason: bad }, { ...facts, ...checkBack(done, "oracle", bad, rounds) });

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
    if (rule) return { outcome: { ...waiting("held-path", rule, [stat]), reason: rule, stat, ...facts }, code: 0 };
    return { outcome: { condition: "passed", ...facts }, code: 0 };
  }
  if (rv.none) return { outcome: { ...waiting("review", rv.reason, [stat]), cause: "review", reason: rv.reason, stat, ...facts }, code: 0 };
  const hold = reviewHold(done, earlier, rv.reason, rounds);
  if ("round" in hold) return { outcome: { condition: "returned", cause: "review", reason: rv.reason, stat, ...facts, failed: "review", round: hold.round }, code: 1 };
  return { outcome: { ...waiting("review", hold.reason, [stat]), cause: "review", reason: hold.reason, stat, ...facts }, code: 0 };
}

/** Why a held run cannot land yet: the reviewer has given no verdict; null once it has (`review` is its review.json). */
export function missingVerdict(review: string | undefined): string | null {
  return review && JSON.parse(review).verdict ? null : "the reviewer has no verdict yet";
}
