/**
 * The one-shot `claude -p` call of the title writer and the judge: no settings, one turn, no tools.
 * A call on the local model whose GPU slot stays taken for its time box runs on haiku.
 */
import { readModels } from "./models.ts";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callAgent } from "../roles/agent-call.ts";

/** The reply to `input` under `system` on the tier's model, killed after `box` ms: its exit code, its stderr, its text and whether the box killed it. */
export async function oneShot(tier: "title" | "judge", cmd: string, system: string, input: string, box: number): Promise<{ code: number; stderr: string; result: string; timedOut: boolean }> {
  const env = {
    ...process.env, CLAUDECODE: undefined, CLAUDE_CODE_ENTRYPOINT: undefined,
    ANTHROPIC_API_KEY: undefined, // the call runs on the subscription, never the API
    MAX_THINKING_TOKENS: "0", // measured: 3 s without thinking, 15-45 s with it, same verdicts
  };
  const dir = mkdtempSync(join(tmpdir(), "aleph-one-shot-"));
  const [stdout, stderr] = [join(dir, "out"), join(dir, "err")];
  try {
    const r = await callAgent(tier, input, {
      model: readModels()[tier].model, cmd, flags: ["--setting-sources", "", "--max-turns", "1", "--tools", "", "--system-prompt", system],
      env, stdout, stderr, limit: Math.max(box, 0) / 1000, fallback: "haiku",
    });
    return { code: r.step.code, stderr: readFileSync(stderr, "utf8"), result: r.text, timedOut: r.step.timedOut };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
