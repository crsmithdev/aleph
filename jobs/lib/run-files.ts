// The layout of a run folder: the name of every file a run keeps, and the job's spec in its first run's folder.
// A leaf module: every module that reads or writes a run folder can import it without a cycle.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The files and folders a run folder holds. `state.json` belongs to ledger.ts and `pid`/`exit` to process.ts;
 * they are listed so that the names stay in one place.
 */
export type RunFile =
  | "state.json" | "pid" | "exit"
  | "spec.md" | "command.txt" | "prompt.md" | "review-prompt.md" | "call-prompt.md"
  | "output.log" | "stderr.log" | "setup.log" | "next.log" | "dispatch.log" | "trace.log" | "checks.log" | "hidden.log" | "land.log"
  | "result.md" | "review.md" | "call.md" | "review.log" | "review.err"
  | "asked" | "asked-spec" | "rescued" | "paused-next" | "batch.json"
  | "gh";

/** The path of `file` in the run folder `folder`. */
export const runFile = (folder: string, file: RunFile): string => join(folder, file);

/** The path of the job's spec: `spec.md` in the folder of the job's first run, a sibling of any of its runs' folders. */
export const jobSpecFile = (folder: string, run: { job: string }): string => join(folder, "..", run.job, "spec.md");

/** The job's spec, trimmed. Throws when the first run has none: only a build's job has one. */
export const jobSpec = (folder: string, run: { job: string }): string => readFileSync(jobSpecFile(folder, run), "utf8").trim();
