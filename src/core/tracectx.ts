/**
 * The daemon mints the trace id (it exists before any span does — a message is
 * received, a session resolved and a job queued before the turn starts). OTel
 * would otherwise generate its own, and the event log's trace_id would deep-link
 * to a Langfuse trace that does not exist.
 *
 * So spans are opened under a synthetic REMOTE parent carrying the minted trace
 * id: exactly the shape of a distributed trace whose caller lives in another
 * process, which is what the daemon is relative to the SDK. cockpit-spec F1/F12.
 */
import { context, trace, TraceFlags, type Context } from "@opentelemetry/api";

/** Deterministic root span id for a trace, so every fragment agrees on the parent. */
export function rootSpanId(traceId: string): string {
  return traceId.slice(0, 16);
}

export function remoteParentContext(traceId: string, base: Context = context.active()): Context {
  return trace.setSpanContext(base, {
    traceId,
    spanId: rootSpanId(traceId),
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  });
}
