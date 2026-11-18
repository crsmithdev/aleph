/** The doc-claim check of a finished worker run. */
import { existsSync, readFileSync } from "node:fs";
import { docClaimProblems } from "../../../hooks/lib/docclaims.ts";
import { logTo, runFile } from "../records/run-files.ts";
import { transcriptOf } from "./agent-call.ts";

/**
 * The Stop gate's doc-claim check (hooks/lib/docclaims.ts) on a finished worker run: the run's transcript
 * (output.log, stream-json) against its final message. A failure here goes back to the worker as a fix round. Null when the message makes no such claim or the transcript
 * backs it; else the reason, which also goes into checks.log for the next worker's fix note.
 */
export function docClaims(folder: string, result: string): string | null {
  const log = runFile(folder, "transcript.jsonl");
  if (!existsSync(log)) return null;
  const problems = docClaimProblems(transcriptOf(readFileSync(log, "utf8")).entries, result);
  if (!problems.length) return null;
  logTo(folder, "checks", `## doc-claims: exit 1\nThe final message says a doc matches the code, and the transcript does not back it:\n${problems.map((p) => `- ${p}`).join("\n")}\nRun a command after the last edit that shows both the doc text and the code values, or drop the claim.\n\n`);
  return `doc claims: ${problems.join("; ")}`;
}
