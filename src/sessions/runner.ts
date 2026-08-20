/**
 * The agent-execution boundary. One interface, two implementations:
 * sdk-runner (real Claude Agent SDK) and echo-runner (deterministic, offline).
 *
 * Integration tests use echo so they are hermetic; live tests use sdk. The
 * boundary exists so that "the daemon works" and "the model answers" are two
 * separate claims with two separate proofs.
 */
export interface RunRequest {
  prompt: string;
  systemPrompt?: string;
  model: string;
  /** SDK session id to resume, when the resume window allows it. */
  resume?: string;
  maxTurns?: number;
  cwd?: string;
  signal?: AbortSignal;
}

export interface RunUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number | null;
}

export interface RunResult {
  text: string;
  sdk_session_id: string;
  usage: RunUsage;
  model: string;
  stop_reason?: string;
}

export interface AgentRunner {
  readonly name: "sdk" | "echo";
  run(req: RunRequest): Promise<RunResult>;
}

export const ZERO_USAGE: RunUsage = {
  input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: null,
};
