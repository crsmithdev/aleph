/**
 * The one-shot `claude -p` call of the judge: no settings, one turn, no tools.
 * A call on the local model whose GPU slot stays taken for its time box runs on haiku.
 * Each call is a run of its role in the job store, so the Agents page counts it; the Jobs list leaves it out, and `shown` keeps it out of the report.
 * Like every role's run it ends `done`; a call that gave no reply says why in `reason` and has the cause `unanswered`.
 */
import { readModels } from "../routing/models.ts";
import { readSection } from "../records/run-files.ts";
import { openRun } from "./agent-run.ts";

const FALLBACK = "haiku";

/** The reply to `input` under `system` on its role model, killed after `box` ms: its exit code, its stderr, its text and whether the box killed it. */
export async function oneShot(role: "judge", cmd: string, system: string, input: string, box: number): Promise<{ code: number; stderr: string; result: string; timedOut: boolean }> {
  const run = openRun({
    role, who: role, name: role, command: role, shown: true, model: readModels()[role].model, cmd, fallback: FALLBACK, seconds: Math.max(box, 0) / 1000,
    // Effort high keeps Haiku thinking whatever MAX_THINKING_TOKENS says (measured on 2.1.331: 66 thinking tokens at high, 0 at low, 2 s a verdict).
    flags: ["--setting-sources", "", "--effort", "low", "--max-turns", "1", "--tools", "", "--system-prompt", system],
    env: { CLAUDE_CODE_ENTRYPOINT: undefined },
  });
  let r;
  try {
    r = await run.reply(input);
    return { code: r.step.code, stderr: readSection(run.folder, "stderr") ?? "", result: r.text, timedOut: r.step.timedOut };
  } finally {
    const ok = r?.step.code === 0 && !r.step.timedOut;
    run.end(ok ? "replied" : `failed: ${r?.cause?.reason ?? "no reply"}`, ok ? {} : { cause: "unanswered" });
  }
}
