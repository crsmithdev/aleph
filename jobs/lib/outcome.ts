/**
 * Why a run stopped. `cause` is a closed code on the run's state; `reason` is only its sentence, and a drop
 * replaces the sentence. Logic reads `causeOf`, never `reason`. A run from before this field has only the
 * sentence, so `causeOf` reads the exact sentences that the unit wrote. The check runners return the cause
 * themselves (`ChecksStop` in checks.ts); `fromSentence` stays for those old runs.
 */
import type { Run } from "./ledger.ts";

export type Cause =
  | "no-commit" | "time-box" | "stalled" | "infra" | "lock-busy"
  | "check" | "hidden-check" | "conflict" | "moved" | "own-list" | "reviewer" | "no-answer" | "other";

/**
 * What a drop means, as a closed code on the run's state. `cause` is why the run stopped; `fate` is what the
 * drop means. A drop with no fate is valid and writes no `fate`.
 */
export type Fate = "duplicate" | "already-met" | "by-hand";

/** The cause on a run's state, and the check's name for the cause `check`. */
export type Stated = { cause: Cause; checkName?: string };

export const LOCK_BUSY = "job lock busy";

const SENTENCES: [RegExp, Cause][] = [
  [/^no commit$/, "no-commit"],
  [/^time box$/, "time-box"],
  [/^job lock busy$/, "lock-busy"],
  [/^(fetch failed|systemd-run failed|worktree gone|checkout failed|bundle failed|hidden checks unreadable)/, "infra"],
  [/^merge conflict/, "conflict"],
  [/^main moved during the land; land again$/, "moved"],
  [/^the branch changes docs\/todo\.md;/, "own-list"],
  [/^hidden check failed/, "hidden-check"],
  [/^(malformed (verdict|plan)|failed):/, "no-answer"],
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

/** What a baseline runner's sentence says: the checks could not run (`infra`, never recorded), or the name of the check that failed. */
export type BaselineReading = { infra: true } | { infra?: false; failed: string };
export function readBaseline(why: string): BaselineReading {
  if (/^(checks did not start|bundle failed|baseline did not run|worktree gone)/.test(why)) return { infra: true };
  return { failed: why.replace(/^timed out: check /, "").replace(/ failed$/, "") };
}
