#!/usr/bin/env bun
/**
 * Every observability hook is this one script. It reads the event from stdin,
 * turns it into one OTLP span, and posts it to Langfuse. Wired with
 * `async: true` (except Stop, StopFailure and SessionEnd, which the session
 * would not wait for), so it never blocks a turn and its stdout is ignored.
 *
 * One trace per turn, all in one Langfuse session, so the Sessions page shows
 * a session as its prompts and replies:
 *
 *   turn (root)  →  tool | agent → tool | generation | event
 */
import { basename } from "node:path";
import { langfuseConfig, sessionEnvironment } from "./lib/env.ts";
import { peek, prune, put, take } from "./lib/handshake.ts";
import { attrs, nano, postScore, postSpans, spanId, truncate, turnSpanIdFor, turnTraceIdFor, type AttrValue, type Score, type Span } from "./lib/otlp.ts";
import { parseRating } from "./lib/rating.ts";
import { readEntries } from "./lib/digest.ts";
import { costDetails, type Usage } from "./lib/pricing.ts";

type Payload = Record<string, any>;

const input: Payload = JSON.parse(await Bun.stdin.text());
const cfg = langfuseConfig();
const sessionId: string | undefined = input.session_id;
if (!cfg || !sessionId) process.exit(0);

const now = Date.now();
const event: string = input.hook_event_name ?? "unknown";
const sessionKey = `session:${sessionId}`;
const turnKey = input.prompt_id ? `turn:${input.prompt_id}` : null;
const agentKey = input.agent_id ? `agent:${input.agent_id}` : null;

// SessionStart posts nothing. It leaves the name, tags and cwd that every turn trace repeats.
if (event === "SessionStart") {
  prune();
  put(sessionKey, {
    start: now,
    name: input.cwd ? basename(input.cwd) : undefined,
    cwd: input.cwd,
    tags: [
      `source:${input.source ?? "unknown"}`,
      `mode:${input.permission_mode ?? "unknown"}`,
      ...(input.cwd ? [`project:${basename(input.cwd)}`] : []),
    ],
  });
  process.exit(0);
}

// A span belongs to its turn's trace. Inside a subagent the agent's handshake remembers which.
const resolvedTraceId = input.prompt_id ? turnTraceIdFor(input.prompt_id) : agentKey ? peek(agentKey)?.traceId : undefined;
if (!resolvedTraceId) process.exit(0);
const traceId: string = resolvedTraceId;
const turnSpanId = input.prompt_id ? turnSpanIdFor(input.prompt_id) : undefined;

/** Tool spans inside a subagent hang off the agent span; everything else off the turn. */
function parentForChild(): string | undefined {
  if (agentKey) return peek(agentKey)?.spanId;
  return turnSpanId;
}

function scalars(payload: Payload, skip: string[]): Record<string, AttrValue> {
  const out: Record<string, AttrValue> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (skip.includes(key) || value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[`langfuse.observation.metadata.${key}`] = value;
  }
  return out;
}

// Trace attributes ride on every span: a span without them lets Langfuse rename the trace after its root span.
const session = peek(sessionKey);
const base: Record<string, AttrValue | undefined> = {
  "langfuse.session.id": sessionId,
  "langfuse.user.id": "chris",
  "langfuse.environment": sessionEnvironment(),
  "langfuse.trace.name": session?.name ?? (input.cwd ? basename(input.cwd) : undefined),
  "langfuse.trace.tags": session?.tags,
  "langfuse.trace.metadata.cwd": session?.cwd ?? input.cwd,
  "aleph.event": event,
};

function span(name: string, type: string, start: number, extra: Record<string, AttrValue | undefined | null>, opts: { id?: string; parent?: string; error?: string; end?: number } = {}): Span {
  const s: Span = {
    traceId,
    spanId: opts.id ?? spanId(),
    parentSpanId: opts.parent,
    name,
    kind: 1,
    startTimeUnixNano: nano(start),
    endTimeUnixNano: nano(Math.max(opts.end ?? now, start)),
    attributes: attrs({ ...base, "langfuse.observation.type": type, ...extra }),
  };
  if (opts.error) s.status = { code: 2, message: opts.error.slice(0, 200) };
  return s;
}

/**
 * The turn is the trace's root, posted once at the prompt and again, with the
 * same id, when it ends: Langfuse updates the span in place. Its input and
 * output are the trace's, which is what the Sessions page shows.
 */
function turnSpan(start: number, output: string | undefined, error?: string): Span {
  const prompt = peek(turnKey!)?.input;
  const inputText = prompt === undefined ? undefined : truncate(prompt);
  const outputText = output === undefined ? undefined : truncate(output);
  return span("turn", "agent", start, {
    "langfuse.observation.input": inputText,
    "langfuse.trace.input": inputText,
    "langfuse.observation.output": outputText,
    "langfuse.trace.output": outputText,
    "langfuse.observation.level": error ? "ERROR" : "DEFAULT",
    "langfuse.observation.metadata.prompt_id": input.prompt_id,
  }, { id: turnSpanId, error });
}

/**
 * Stop fires while the last assistant entry may still be on its way to disk
 * (measured: the final request was missing from the transcript at Stop). Wait,
 * briefly, until an assistant entry carries the final message.
 */
function settledEntries(transcriptPath: string, promptId: string, finalMessage: string) {
  const needle = finalMessage.trim().slice(0, 80);
  for (let attempt = 0; attempt < 20; attempt++) {
    const entries = readEntries(transcriptPath, promptId);
    if (!needle) return entries;
    const landed = entries.some((e) => e.type === "assistant" && Array.isArray(e.message?.content)
      && e.message.content.some((block: any) => block.type === "text" && typeof block.text === "string" && block.text.includes(needle)));
    if (landed) return entries;
    Bun.sleepSync(100);
  }
  return readEntries(transcriptPath, promptId);
}

/**
 * One generation per API request in this turn. Assistant entries come one per
 * content block and repeat the request's usage, so dedupe on requestId. The
 * span runs from the previous entry's timestamp to this one's: the model was
 * the only thing happening in between.
 */
function generations(transcriptPath: string, promptId: string, finalMessage: string): Span[] {
  const out: Span[] = [];
  const seen = new Set<string>();
  let previous = 0;
  for (const entry of settledEntries(transcriptPath, promptId, finalMessage)) {
    const at = Date.parse(entry.timestamp ?? "") || previous || now;
    const usage = entry.message?.usage;
    const requestId: string | undefined = entry.requestId;
    if (entry.type === "assistant" && usage && requestId && !seen.has(requestId)) {
      seen.add(requestId);
      const model: string = entry.message?.model ?? "unknown";
      const usageDetails: Usage = { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 };
      if (usage.cache_read_input_tokens) usageDetails.cache_read_input_tokens = usage.cache_read_input_tokens;
      if (usage.cache_creation_input_tokens) usageDetails.cache_creation_input_tokens = usage.cache_creation_input_tokens;
      const cost = costDetails(model, usageDetails);
      out.push(span(model, "generation", previous || at, {
        "langfuse.observation.model.name": model,
        "langfuse.observation.usage_details": JSON.stringify(usageDetails),
        "langfuse.observation.cost_details": cost ? JSON.stringify(cost) : undefined,
        "langfuse.observation.metadata.request_id": requestId,
      }, { parent: turnSpanId, end: at }));
    }
    previous = at;
  }
  return out;
}

const spans: Span[] = [];
const scores: Score[] = [];

switch (event) {
  case "UserPromptSubmit": {
    put(turnKey!, { start: now, spanId: turnSpanId, input: input.prompt ?? "" });
    spans.push(turnSpan(now, undefined));
    // "N/10" in a prompt rates the previous reply; the session handshake remembers which trace that was
    const previous = session?.lastTraceId;
    put(sessionKey, { ...(session ?? { start: now }), lastTraceId: traceId });
    const rating = parseRating(input.prompt ?? "");
    if (rating !== null && previous) scores.push({ traceId: previous, name: "rating", value: rating, comment: input.prompt, environment: sessionEnvironment() });
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
    if (agentKey) put(agentKey, { start: now, spanId: spanId(), parentSpanId: turnSpanId, traceId });
    process.exit(0);

  case "SubagentStop": {
    const hs = agentKey ? take(agentKey) : null;
    spans.push(span(input.agent_type ?? "subagent", "agent", hs?.start ?? now, {
      "langfuse.observation.output": truncate(input.last_assistant_message ?? ""),
      "langfuse.observation.metadata.agent_id": input.agent_id,
      "langfuse.observation.metadata.agent_type": input.agent_type,
    }, { id: hs?.spanId, parent: hs?.parentSpanId ?? turnSpanId }));
    break;
  }

  case "Stop":
  case "StopFailure": {
    // peek, not take: a blocked Stop fires again and the turn keeps its start; prune() clears the file later
    const start = peek(turnKey!)?.start ?? now;
    const failed = event === "StopFailure";
    const message: string = input.last_assistant_message ?? "";
    spans.push(turnSpan(start, message, failed ? (input.error ? `${input.error}: ${message}` : message || "StopFailure") : undefined));
    // a failed turn's message is the API error, which never reaches the transcript, so do not wait for it
    if (input.transcript_path) spans.push(...generations(input.transcript_path, input.prompt_id, failed ? "" : message));
    break;
  }

  default: {
    // PreCompact, PostCompact, PermissionDenied, SessionEnd, anything new that arrives inside a turn.
    spans.push(span(event, "event", now, {
      ...scalars(input, ["session_id", "cwd", "hook_event_name", "transcript_path", "prompt_id"]),
      "langfuse.observation.level": event === "PermissionDenied" ? "WARNING" : "DEFAULT",
      "langfuse.observation.input": input.tool_input ? truncate(input.tool_input) : undefined,
    }, { parent: parentForChild() }));
  }
}

// The turn-ending hooks run synchronously (an async hook is killed when the session exits), so keep their wait short.
const timeoutMs = event === "Stop" || event === "StopFailure" || event === "SessionEnd" ? 3000 : 8000;
const results = await Promise.all([postSpans(cfg, spans, timeoutMs), ...scores.map((score) => postScore(cfg, score, timeoutMs))]);
for (const result of results) if (!result.ok) console.error(`[aleph obs] ${event}: ${result.status ?? ""} ${result.error ?? ""}`.trim());
