/**
 * Claude Agent SDK runner.
 *
 * Phase 1 posture (docs/design/phase-1.md §13): the agent has NO tools. It reads
 * what the daemon puts in the prompt and returns text; the daemon performs every
 * side effect. That is what makes deferring the approval broker to Phase 2a safe
 * rather than convenient.
 *
 * Environment hygiene: the SDK inherits CLAUDE_CODE_* from its parent, including
 * session identity — measured, not assumed (§7.5). The daemon strips those so
 * every session gets a fresh SDK id and a known auth path.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentRunner, RunRequest, RunResult, RunUsage } from "./runner.ts";

// "CLAUDE" without the underscore is deliberate: CLAUDECODE=1 is set by the
// Claude Code harness and would otherwise survive the filter.
const STRIP_PREFIXES = ["CLAUDE", "ANTHROPIC"];
const KEEP = new Set(["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"]);

export function sanitizedEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if (STRIP_PREFIXES.some((p) => k.startsWith(p)) && !KEEP.has(k)) continue;
    out[k] = v;
  }
  return out;
}

function usageFrom(raw: any): RunUsage {
  return {
    input_tokens: raw?.input_tokens ?? 0,
    output_tokens: raw?.output_tokens ?? 0,
    cache_read_tokens: raw?.cache_read_input_tokens ?? 0,
    cache_creation_tokens: raw?.cache_creation_input_tokens ?? 0,
    cost_usd: null,
  };
}

export class SdkRunner implements AgentRunner {
  readonly name = "sdk" as const;

  constructor(private readonly opts: { cwd?: string } = {}) {}

  async run(req: RunRequest): Promise<RunResult> {
    const stream = query({
      prompt: req.prompt,
      options: {
        model: req.model,
        resume: req.resume,
        maxTurns: req.maxTurns ?? 1,
        cwd: req.cwd ?? this.opts.cwd,
        systemPrompt: req.systemPrompt,
        allowedTools: [],
        settingSources: [],
        env: sanitizedEnv(),
        abortController: req.signal ? abortControllerFor(req.signal) : undefined,
      } as Record<string, unknown>,
    });

    let text = "";
    let sdkSessionId = "";
    let usage: RunUsage = usageFrom(undefined);
    let cost: number | null = null;
    let stopReason: string | undefined;

    for await (const message of stream as AsyncIterable<any>) {
      if (message.type === "system" && message.subtype === "init") sdkSessionId = message.session_id;
      if (message.type === "assistant") {
        for (const block of message.message?.content ?? []) if (block.type === "text") text += block.text;
        stopReason = message.message?.stop_reason ?? stopReason;
      }
      if (message.type === "result") {
        sdkSessionId = message.session_id ?? sdkSessionId;
        usage = usageFrom(message.usage);
        cost = typeof message.total_cost_usd === "number" ? message.total_cost_usd : null;
        if (message.subtype && message.subtype !== "success" && !text) {
          throw new Error(`sdk result ${message.subtype}: ${message.result ?? "no detail"}`);
        }
      }
    }

    if (!sdkSessionId) throw new Error("sdk returned no session id — cannot resume this session later");
    return { text: text.trim(), sdk_session_id: sdkSessionId, usage: { ...usage, cost_usd: cost }, model: req.model, stop_reason: stopReason };
  }
}

function abortControllerFor(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", () => controller.abort(), { once: true });
  return controller;
}
