/**
 * The trace attributes of a turn, and one span posted on the turn's trace.
 * Every span carries the trace attributes: a span without trace.name, tags and
 * cwd lets Langfuse rename the trace after its root span.
 */
import { basename } from "node:path";
import { langfuseConfig, sessionEnvironment } from "../../lib/env.ts";
import { attrs, nano, postSpans, spanId, turnSpanIdFor, turnTraceIdFor, type AttrValue } from "../../lib/otlp.ts";
import { session } from "./handshake.ts";

type Attrs = Record<string, AttrValue | undefined | null>;

/** Session, user, environment, trace name, tags and cwd (from the SessionStart handshake), and the hook event. */
export function traceAttrs(input: Record<string, any>): Attrs {
  const s = input.session_id ? session(input.session_id).get() : null;
  return {
    "langfuse.session.id": input.session_id,
    "langfuse.user.id": "chris",
    "langfuse.environment": sessionEnvironment(),
    "langfuse.trace.name": s?.name ?? (input.cwd ? basename(input.cwd) : undefined),
    "langfuse.trace.tags": s?.tags,
    "langfuse.trace.metadata.cwd": s?.cwd ?? input.cwd,
    "aleph.event": input.hook_event_name,
  };
}

/** One span under the turn of `input.prompt_id`, from `start` to now. A failed post changes nothing. */
export async function postTurnSpan(input: Record<string, any>, name: string, start: number, extra: Attrs): Promise<void> {
  const cfg = langfuseConfig();
  if (!cfg || !input.prompt_id) return;
  await postSpans(cfg, [{
    traceId: turnTraceIdFor(input.prompt_id),
    spanId: spanId(),
    parentSpanId: turnSpanIdFor(input.prompt_id),
    name,
    kind: 1,
    startTimeUnixNano: nano(start),
    endTimeUnixNano: nano(Math.max(Date.now(), start)),
    attributes: attrs({ ...traceAttrs(input), ...extra }),
  }], 3000);
}
