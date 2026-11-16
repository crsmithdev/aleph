/**
 * The one-shot `claude -p` call of the title writer and the judge: no settings, one turn, no tools.
 * A call on the local model whose GPU slot stays taken for its time box runs on haiku.
 * Each call is a run of its role in the job store, so the Agents page counts it; the Jobs list leaves it out, and `shown` keeps it out of the report.
 * Like every role's run it ends `done`; a call that gave no reply says why in `reason` and has the cause `unanswered`.
 */
import { readModels } from "./models.ts";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callAgent, type Reply } from "../roles/agent-call.ts";
import { makeJob, setState } from "../records/record.ts";
import type { Run } from "../records/ledger.ts";

const FALLBACK = "haiku";

/** The reply to `input` under `system` on its role model, killed after `box` ms: its exit code, its stderr, its text and whether the box killed it. */
export async function oneShot(role: "title" | "judge", cmd: string, system: string, input: string, box: number): Promise<{ code: number; stderr: string; result: string; timedOut: boolean }> {
  const env = {
    ...process.env, CLAUDECODE: undefined, CLAUDE_CODE_ENTRYPOINT: undefined,
    ANTHROPIC_API_KEY: undefined, // the call runs on the subscription, never the API
    MAX_THINKING_TOKENS: "0", // measured: 3 s without thinking, 15-45 s with it, same verdicts
  };
  const model = readModels()[role].model;
  const run = makeJob({ role: role as Run["role"], name: role, model, state: "running", told: true, shown: true }).id;
  let r: Reply | undefined;
  const dir = mkdtempSync(join(tmpdir(), "aleph-one-shot-"));
  const [stdout, stderr] = [join(dir, "out"), join(dir, "err")];
  try {
    r = await callAgent(role, input, {
      model, cmd, flags: ["--setting-sources", "", "--max-turns", "1", "--tools", "", "--system-prompt", system],
      env, stdout, stderr, limit: Math.max(box, 0) / 1000, fallback: FALLBACK,
    });
    return { code: r.step.code, stderr: readFileSync(stderr, "utf8"), result: r.text, timedOut: r.step.timedOut };
  } finally {
    const ok = r?.step.code === 0 && !r.step.timedOut;
    setState(run, "done", { ...(r?.model === FALLBACK ? { model: FALLBACK } : {}), cost: r?.cost, tokens: r?.tokens, ended: new Date().toISOString(), ...(ok ? {} : { reason: `failed: ${r?.cause?.reason ?? "no reply"}`, cause: "unanswered" }) });
    rmSync(dir, { recursive: true, force: true });
  }
}
