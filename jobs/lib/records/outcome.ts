/**
 * Why a run stopped. `cause` is a closed code on the run's state; `reason` is only its sentence, and a drop
 * replaces the sentence. Logic reads `causeOf`, never `reason`. The check runners return the cause themselves
 * (`ChecksStop` in checks.ts); the word migration (migrate.ts) gave each older run the cause its sentence states.
 */
import type { CAUSES } from "../../../lib/naming.ts";
import type { Run } from "./ledger.ts";

export type Cause = (typeof CAUSES)[number];

/**
 * What a cause means to the factory. `countsToCap`: the run counts toward the run cap. `rescuable`: a returned or
 * failed run goes to the rescue. `holdsBackend`: the call's backend is held until a probe succeeds. `waitMs`: the
 * issue waits this long after the run before it starts again.
 */
export interface Policy { countsToCap: boolean; rescuable: boolean; holdsBackend: boolean; waitMs: number }

// A run the API refused for credit did no work: it counts to no cap, no rescue case covers it, its backend is held,
// and the issue waits 10 minutes instead of starting again at once.
// prettier-ignore
export const POLICY: Record<Cause, Policy> = {
  "no-commit":  { countsToCap: true,  rescuable: true,  holdsBackend: false, waitMs: 0 },
  timeout:      { countsToCap: true,  rescuable: true,  holdsBackend: false, waitMs: 0 },
  stalled:      { countsToCap: true,  rescuable: true,  holdsBackend: false, waitMs: 0 },
  infra:        { countsToCap: true,  rescuable: true,  holdsBackend: false, waitMs: 0 },
  locked:       { countsToCap: true,  rescuable: true,  holdsBackend: false, waitMs: 0 },
  credit:       { countsToCap: false, rescuable: false, holdsBackend: true,  waitMs: 10 * 60_000 },
  check:        { countsToCap: true,  rescuable: true,  holdsBackend: false, waitMs: 0 },
  conflict:     { countsToCap: true,  rescuable: true,  holdsBackend: false, waitMs: 0 },
  moved:        { countsToCap: true,  rescuable: true,  holdsBackend: false, waitMs: 0 },
  review:       { countsToCap: true,  rescuable: true,  holdsBackend: false, waitMs: 0 },
  unanswered:   { countsToCap: true,  rescuable: true,  holdsBackend: false, waitMs: 0 },
  other:        { countsToCap: true,  rescuable: true,  holdsBackend: false, waitMs: 0 },
};

/** The policy of `cause`; a run with no known cause has the policy of `other`. */
export const policyOf = (cause?: Cause): Policy => POLICY[cause ?? "other"];

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
