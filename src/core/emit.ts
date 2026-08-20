/**
 * emit() — the single emission helper.
 *
 * cockpit-spec-v0.2.md F7: subsystems must never emit envelope and span
 * separately, so dual emission is a property of this library and not a
 * discipline at 40 call sites. One call: validate -> JSONL -> SQLite index ->
 * OTel. Returns the new event id so the caller can chain `caused_by`.
 */
import { context, trace, type Span } from "@opentelemetry/api";
import type { Tracer } from "@opentelemetry/api";
import { mint, newTraceId } from "./ids.ts";
import { redact } from "./redact.ts";
import {
  EnvelopeSchema, ENVELOPE_VERSION, KINDS, isRegistered, capPayload,
  type Actor, type Cause, type Envelope, type IdTuple,
} from "./envelope.ts";
import type { EventLog } from "./eventlog.ts";
import type { Clock } from "./clock.ts";
import { systemClock } from "./clock.ts";

export interface EmitOptions {
  causedBy?: string | null;
  cause?: Cause;
  actor?: Actor;
  /** Span to attach the event to; defaults to the active span. */
  span?: Span;
}

export interface EmitterDeps {
  log: EventLog;
  clock?: Clock;
  tracer?: Tracer;
  strict?: boolean;      // throw on unregistered kind / schema mismatch (dev + CI)
  onEvent?: (e: Envelope) => void;
}

export class Emitter {
  private readonly clock: Clock;
  constructor(private readonly deps: EmitterDeps) {
    this.clock = deps.clock ?? systemClock;
  }

  emit(kind: string, ids: IdTuple, payload: Record<string, unknown>, opts: EmitOptions = {}): string {
    const id = mint("evt", this.clock.ms());
    const activeSpan = opts.span ?? trace.getSpan(context.active());
    const spanCtx = activeSpan?.spanContext();

    const fullIds: IdTuple = {
      ...ids,
      trace_id: ids.trace_id || spanCtx?.traceId || newTraceId(),
      span_id: ids.span_id ?? spanCtx?.spanId,
    };

    let checked: Record<string, unknown> = payload;
    if (isRegistered(kind)) {
      const parsed = KINDS[kind].safeParse(payload);
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        const message = `event payload invalid for ${kind} at ${issue.path.join(".")}: ${issue.message}`;
        if (this.deps.strict) throw new Error(message);
        checked = { ...payload, _schema_error: message };
      } else {
        checked = parsed.data as Record<string, unknown>;
      }
    } else if (this.deps.strict) {
      throw new Error(`unregistered event kind: ${kind}`);
    } else {
      this.emit("event.unregistered_kind", { origin: "system", trace_id: fullIds.trace_id }, { kind });
    }

    const envelope: Envelope = {
      v: ENVELOPE_VERSION,
      id,
      ts: this.clock.iso(),
      kind,
      ids: fullIds,
      caused_by: opts.causedBy ?? null,
      cause: opts.cause ?? { kind: "computed", text: kind, source: "core/emit.ts" },
      payload: capPayload(redact(checked)),
      actor: opts.actor ?? "daemon",
    };

    const validated = EnvelopeSchema.parse(envelope);
    this.deps.log.append(validated);
    this.deps.onEvent?.(validated);

    // Fan out to OTel. An event inside an active span becomes a span event; an
    // event with no span becomes a zero-duration span so it still joins the tree.
    if (activeSpan) {
      activeSpan.addEvent(kind, { "aleph.event_id": id, "aleph.caused_by": envelope.caused_by ?? "" });
    } else if (this.deps.tracer) {
      const span = this.deps.tracer.startSpan(kind, {
        attributes: { "aleph.event_id": id, "aleph.origin": fullIds.origin },
      });
      span.end();
    }

    return id;
  }
}

let current: Emitter | null = null;

export function setEmitter(e: Emitter | null): void { current = e; }
export function getEmitter(): Emitter {
  if (!current) throw new Error("emit() called before setEmitter() — the daemon must install an emitter at boot");
  return current;
}

/** The call every subsystem makes. */
export function emit(kind: string, ids: IdTuple, payload: Record<string, unknown>, opts: EmitOptions = {}): string {
  return getEmitter().emit(kind, ids, payload, opts);
}
