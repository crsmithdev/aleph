/**
 * The one-shot `claude -p` call of the title writer and the judge: no settings, one turn, no tools.
 * It lives apart from models.ts, which factory-status.ts imports.
 */
import { modelArgv, modelEnv, onGpu, readModels, type Tier } from "./models.ts";
import { gpuSlot } from "../gates/factory-status.ts";
import { logEvent } from "../infra/layout.ts";

export type Ask = (system: string, input: string, box: number) => Promise<{ code: number; stderr: string; result: string }>;

/**
 * Runs `use` with an `ask` on the tier's model. A local model holds one GPU slot across all the asks of `use`.
 * The wait for the slot lasts `wait` ms (`waited` names it in the log); when it ends, the asks fall back to haiku.
 * `ask` kills the call after `box` ms; its `result` is the text of the reply.
 */
export async function oneShot<T>(tier: Tier, cmd: string, label: string, wait: number, waited: string, use: (ask: Ask) => Promise<T>): Promise<T> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.ANTHROPIC_API_KEY; // the call runs on the subscription, never the API
  env.MAX_THINKING_TOKENS = "0"; // measured: 3 s without thinking, 15-45 s with it, same verdicts
  const pick = readModels()[tier].model;
  let release: (() => void) | null = null;
  if (onGpu(pick)) {
    release = await gpuSlot(wait);
    if (!release) logEvent({ by: "rule", subject: label, action: "gpu", note: `the GPU slot stayed taken for ${waited}; the call falls back to Claude` });
  }
  const model = onGpu(pick) && !release ? "haiku" : pick;
  Object.assign(env, modelEnv(model));
  try {
    return await use(async (system, input, box) => {
      const proc = Bun.spawn(modelArgv(cmd, model, ["--setting-sources", "", "--max-turns", "1", "--tools", "", "--output-format", "json", "--system-prompt", system, input]), { env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
      const timer = setTimeout(() => proc.kill(), Math.max(box, 0));
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      const code = await proc.exited;
      clearTimeout(timer);
      let result = stdout;
      try { result = JSON.parse(stdout).result ?? stdout; } catch { /* plain text */ }
      return { code, stderr, result: String(result) };
    });
  } finally {
    release?.();
  }
}
