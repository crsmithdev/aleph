#!/usr/bin/env bun
/**
 * Every observability hook is this one script. It reads the event from stdin,
 * turns it into one OTLP span, and posts it to Langfuse. Wired with
 * `async: true`, so it never blocks a turn and its stdout is ignored.
 *
 * Tree per session:  session (root) → turn (per prompt) → tool | agent → tool
 */
import { basename } from "node:path";
import { langfuseConfig } from "./lib/env.ts";
import { peek, put, take } from "./lib/handshake.ts";
import { attrs, nano, postSpans, spanId, traceIdFor, truncate, type AttrValue, type Span } from "./lib/otlp.ts";

type Payload = Record<string, any>;

const input: Payload = JSON.parse(await Bun.stdin.text());
const cfg = langfuseConfig();
const sessionId: string | undefined = input.session_id;
if (!cfg || !sessionId) process.exit(0);

const now = Date.now();
const event: string = input.hook_event_name ?? "unknown";
const traceId = traceIdFor(sessionId);
const turnKey = input.prompt_id ? `turn:${input.prompt_id}` : null;
const agentKey = input.agent_id ? `agent:${input.agent_id}` : null;

/** Tool spans inside a subagent hang off the agent span; everything else off the turn. */
function parentForChild(): string | undefined {
  if (agentKey) return peek(agentKey)?.spanId;
  if (turnKey) return peek(turnKey)?.spanId;
  return undefined;
}

function scalars(payload: Payload, skip: string[]): Record<string, AttrValue> {
  const out: Record<string, AttrValue> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (skip.includes(key) || value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[`langfuse.observation.metadata.${key}`] = value;
  }
  return out;
}

const base: Record<string, AttrValue | undefined> = {
  "langfuse.session.id": sessionId,
  "langfuse.user.id": "chris",
  "langfuse.trace.name": input.cwd ? basename(input.cwd) : undefined,
  "aleph.event": event,
};

function span(name: string, type: string, start: number, extra: Record<string, AttrValue | undefined | null>, opts: { id?: string; parent?: string; error?: string } = {}): Span {
  const s: Span = {
    traceId,
    spanId: opts.id ?? spanId(),
    parentSpanId: opts.parent,
    name,
    kind: 1,
    startTimeUnixNano: nano(start),
    endTimeUnixNano: nano(Math.max(now, start)),
    attributes: attrs({ ...base, "langfuse.observation.type": type, ...extra }),
  };
  if (opts.error) s.status = { code: 2, message: opts.error.slice(0, 200) };
  return s;
}

const spans: Span[] = [];

switch (event) {
  case "SessionStart":
    spans.push(span("session", "span", now, {
      "langfuse.trace.tags": [`source:${input.source ?? "unknown"}`, `mode:${input.permission_mode ?? "unknown"}`],
      "langfuse.trace.metadata.cwd": input.cwd,
      "langfuse.observation.metadata.source": input.source,
    }));
    break;

  case "UserPromptSubmit": {
    const turnSpanId = spanId();
    if (turnKey) put(turnKey, { start: now, spanId: turnSpanId });
    spans.push(span("prompt", "event", now, {
      "langfuse.observation.input": truncate(input.prompt ?? ""),
      "langfuse.observation.metadata.prompt_id": input.prompt_id,
    }, { parent: turnKey ? turnSpanId : undefined }));
    break;
  }

  case "PreToolUse":
    if (input.tool_use_id) put(`tool:${input.tool_use_id}`, { start: now, input: input.tool_input });
    process.exit(0);

  case "PostToolUse":
  case "PostToolUseFailure": {
    const hs = input.tool_use_id ? take(`tool:${input.tool_use_id}`) : null;
    const failed = event === "PostToolUseFailure";
    const toolName: string = input.tool_name ?? "tool";
    const name = toolName === "Skill" && input.tool_input?.skill ? `skill:${input.tool_input.skill}` : toolName;
    const output = failed ? input.tool_error : (input.tool_response ?? input.tool_output);
    spans.push(span(name, "tool", hs?.start ?? now, {
      "langfuse.observation.input": truncate(input.tool_input ?? hs?.input ?? {}),
      "langfuse.observation.output": output === undefined ? undefined : truncate(output),
      "langfuse.observation.level": failed ? "ERROR" : "DEFAULT",
      "langfuse.observation.metadata.tool_use_id": input.tool_use_id,
      "langfuse.observation.metadata.tool": toolName,
      "langfuse.observation.metadata.agent_type": input.agent_type,
    }, { parent: parentForChild(), error: failed ? truncate(input.tool_error, 200) : undefined }));
    break;
  }

  case "SubagentStart":
    if (agentKey) put(agentKey, { start: now, spanId: spanId(), parentSpanId: turnKey ? peek(turnKey)?.spanId : undefined });
    process.exit(0);

  case "SubagentStop": {
    const hs = agentKey ? take(agentKey) : null;
    spans.push(span(input.agent_type ?? "subagent", "agent", hs?.start ?? now, {
      "langfuse.observation.output": truncate(input.last_assistant_message ?? ""),
      "langfuse.observation.metadata.agent_id": input.agent_id,
      "langfuse.observation.metadata.agent_type": input.agent_type,
    }, { id: hs?.spanId, parent: hs?.parentSpanId ?? (turnKey ? peek(turnKey)?.spanId : undefined) }));
    break;
  }

  case "Stop": {
    const hs = turnKey ? take(turnKey) : null;
    spans.push(span("turn", "agent", hs?.start ?? now, {
      "langfuse.observation.output": truncate(input.last_assistant_message ?? ""),
      "langfuse.observation.metadata.prompt_id": input.prompt_id,
    }, { id: hs?.spanId }));
    break;
  }

  default: {
    // PreCompact, PostCompact, StopFailure, PermissionDenied, SessionEnd, anything new.
    const level = event === "StopFailure" || event === "PermissionDenied" ? "WARNING" : "DEFAULT";
    spans.push(span(event, "event", now, {
      ...scalars(input, ["session_id", "cwd", "hook_event_name", "transcript_path", "prompt_id"]),
      "langfuse.observation.level": level,
      "langfuse.observation.input": input.tool_input ? truncate(input.tool_input) : undefined,
    }, { parent: parentForChild() }));
  }
}

const result = await postSpans(cfg, spans);
if (!result.ok) console.error(`[aleph obs] ${event}: ${result.status ?? ""} ${result.error ?? ""}`.trim());
