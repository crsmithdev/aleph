/**
 * Deterministic runner for hermetic tests. It maintains its own tiny memory so
 * that resume-vs-rehydrate can be asserted without spending plan usage: a
 * resumed session sees prior turns, a fresh one does not.
 */
import type { AgentRunner, RunRequest, RunResult } from "./runner.ts";

export class EchoRunner implements AgentRunner {
  readonly name = "echo" as const;
  private history = new Map<string, string[]>();
  private counter = 0;

  async run(req: RunRequest): Promise<RunResult> {
    const sid = req.resume ?? `echo-${++this.counter}`;
    const prior = this.history.get(sid) ?? [];
    const seen = prior.length;
    prior.push(req.prompt);
    this.history.set(sid, prior);

    const seededMemory = req.systemPrompt?.includes("<brief>") ? "brief" : "none";
    const text = `echo[${seen} prior turns, seed=${seededMemory}]: ${req.prompt}`;
    return {
      text,
      sdk_session_id: sid,
      model: req.model,
      stop_reason: "end_turn",
      usage: {
        input_tokens: Math.ceil(req.prompt.length / 4),
        output_tokens: Math.ceil(text.length / 4),
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        cost_usd: 0,
      },
    };
  }
}
