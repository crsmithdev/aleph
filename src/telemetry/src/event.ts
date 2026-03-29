/**
 * Telemetry v2 event envelope and kind-specific payload types.
 *
 * The envelope is the universal shape for all telemetry events.
 * Each `kind` has a typed `data` payload defined below.
 */

export interface TelemetryEvent {
  ts: string;              // ISO 8601 timestamp
  sid: string;             // session ID (correlation key)
  kind: string;            // event kind — indexes into the schema catalog
  name: string;            // human-readable identifier within kind
  ms?: number;             // duration in milliseconds
  err?: string;            // error message
  data?: Record<string, unknown>;
}

// -- Kind-specific payload types --

export interface HookPayload {
  event: string;
  command?: string;
  exitCode?: number;
  output?: string;
}

export interface ToolPayload {
  tool: string;
  params?: Record<string, unknown>;
  useId?: string;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface ToolResultPayload {
  useId: string;
  tool?: string;
  isError?: boolean;
  errorMessage?: string;
}

export interface TokensPayload {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface SkillPayload {
  skill: string;
  trigger?: string;
  success?: boolean;
  userRequest?: string;
}

export interface GitPayload {
  op: string;
  branch?: string;
  ref?: string;
  message?: string;
  files?: number;
}

export interface MetricPayload {
  key: string;
  value: number;
  unit?: string;
}

export interface TurnPayload {
  durationMs: number;
}

export interface CompactPayload {
  trigger: string;
  preTokens?: number;
}

export interface MessagePayload {
  text: string;
  role: "user";
}

export interface DirectivePayload {
  directive: string;
  followed: boolean;
}

export interface SubagentPayload {
  description?: string;
  subagentType?: string;
  runInBackground?: boolean;
  model?: string;
  childSessionId?: string;
}

export interface RatingPayload {
  score: number;
}

// -- Helpers --

export function isKind<T extends Record<string, unknown>>(
  event: TelemetryEvent,
  kind: string,
): event is TelemetryEvent & { data: T } {
  return event.kind === kind && event.data !== undefined;
}
