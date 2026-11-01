/**
 * Why a run stopped. `cause` is a closed code on the run's state; `reason` is only its sentence, and a drop
 * replaces the sentence. Logic reads `causeOf`, never `reason`. A run from before this field has only the
 * sentence, so `causeOf` reads the exact sentences that the unit wrote.
 */
import type { Run } from "./ledger.ts";

export type Cause =
  | "no-commit" | "time-box" | "stalled" | "infra" | "lock-busy"
  | "check" | "hidden-check" | "conflict" | "moved" | "own-list" | "reviewer" | "other";

/** The cause on a run's state, and the check's name for the cause `check`. */
export type Stated = { cause: Cause; checkName?: string };

export const LOCK_BUSY = "job lock busy";

const SENTENCES: [RegExp, Cause][] = [
  [/^no commit$/, "no-commit"],
  [/^time box$/, "time-box"],
  [/^job lock busy$/, "lock-busy"],
  [/^(fetch failed|systemd-run failed|worktree gone|bundle failed|hidden checks unreadable)/, "infra"],
  [/^merge conflict/, "conflict"],
  [/^main moved during the land; land again$/, "moved"],
  [/^the branch changes docs\/todo\.md;/, "own-list"],
  [/^hidden check failed/, "hidden-check"],
];

/** What an exact sentence of the unit states, or null. A drop's sentence is free prose and states nothing. */
function fromSentence(reason: string): Stated | null {
  const row = SENTENCES.find(([re]) => re.test(reason));
  if (row) return { cause: row[1] };
  const check = reason.match(/^timed out: check (.+)$/) ?? reason.match(/^([\w-]+) failed$/);
  return check ? { cause: "check", checkName: check[1] } : null;
}

const statedOf = (run: Run): Stated | null =>
  run.cause ? { cause: run.cause, checkName: run.checkName }
  : run.noCommit ? { cause: "no-commit" }
  : fromSentence(run.reason ?? "");

/** Why the run stopped, or undefined when no cause is known. */
export const causeOf = (run: Run): Cause | undefined => statedOf(run)?.cause;

/** The name of the check that stopped the run, if a check did. */
export const failedCheckOf = (run: Run): string | undefined => statedOf(run)?.checkName;

/** The fields of a run that the check runners stopped. The runners return a sentence: this is the one place that reads it. */
export const checksStopped = (why: string): Stated & { reason: string } => ({ cause: "other", ...fromSentence(why), reason: why });
