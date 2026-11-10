/**
 * Why a run stopped. `cause` is a closed code on the run's state; `reason` is only its sentence, and a drop
 * replaces the sentence. Logic reads `causeOf`, never `reason`. The check runners return the cause themselves
 * (`ChecksStop` in checks.ts); the word migration (migrate.ts) gave each older run the cause its sentence states.
 */
import type { Run } from "./ledger.ts";

export type Cause =
  | "no-commit" | "timeout" | "stalled" | "infra" | "locked" | "credit"
  | "check" | "conflict" | "moved" | "review" | "unanswered" | "other";

/**
 * What a drop means, as a closed code on the run's state. `cause` is why the run stopped; `fate` is what the
 * drop means. A drop with no fate is valid and writes no `fate`.
 */
export type Fate = "duplicate" | "met" | "manual";

/** The cause on a run's state, and the check's name for the cause `check`. */
export type Stated = { cause: Cause; checkName?: string };

export const LOCK_BUSY = "job lock busy";

const statedOf = (run: Run): Stated | null =>
  run.cause ? { cause: run.cause, checkName: run.checkName }
  : run.noCommit ? { cause: "no-commit" }
  : null;

/** Why the run stopped, or undefined when no cause is known. */
export const causeOf = (run: Run): Cause | undefined => statedOf(run)?.cause;

/** The name of the check that stopped the run, if a check did. */
export const failedCheckOf = (run: Run): string | undefined => statedOf(run)?.checkName;
