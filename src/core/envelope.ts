/**
 * The event envelope and the kind registry.
 *
 * docs/design/phase-1.md §5.2 / §5.3. This file is the contract every later
 * phase reads; changing a field here is a breaking change to the cockpit,
 * the librarian and the verification kernel at once.
 */
import { z } from "zod";

export const ORIGINS = ["channel", "heartbeat", "cron", "research", "librarian", "verify", "system"] as const;
export type Origin = (typeof ORIGINS)[number];

export const ACTORS = ["daemon", "agent", "user", "external"] as const;
export type Actor = (typeof ACTORS)[number];

export const IdTupleSchema = z
  .object({
    origin: z.enum(ORIGINS),
    session_id: z.string().optional(),
    task_id: z.string().optional(),
    run_id: z.string().optional(),
    trace_id: z.string().regex(/^[0-9a-f]{32}$/, "trace_id must be 32 lowercase hex chars"),
    span_id: z.string().regex(/^[0-9a-f]{16}$/).optional(),
  })
  .refine((t) => (t.origin === "channel") === (t.session_id !== undefined), {
    message: "session_id must be present iff origin === 'channel' (cockpit-spec F10)",
    path: ["session_id"],
  });
export type IdTuple = z.infer<typeof IdTupleSchema>;

export const CauseSchema = z.object({
  kind: z.enum(["computed", "self-reported", "user"]),
  text: z.string().min(1),
  source: z.string().min(1),
});
export type Cause = z.infer<typeof CauseSchema>;

export const ENVELOPE_VERSION = 1;

export const EnvelopeSchema = z.object({
  v: z.number().int().positive(),
  id: z.string(),
  ts: z.string(),
  kind: z.string().min(1),
  ids: IdTupleSchema,
  caused_by: z.string().nullable(),
  cause: CauseSchema,
  payload: z.record(z.string(), z.unknown()),
  actor: z.enum(ACTORS),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

/* ------------------------------------------------------------------ */
/* Kind registry — docs/EVENTS.md is generated from this table.        */
/* ------------------------------------------------------------------ */

const any = z.record(z.string(), z.unknown());

export const KINDS = {
  "daemon.started": z.object({ version: z.string(), git_sha: z.string().optional(), config_hash: z.string(), pid: z.number() }),
  "daemon.boot_step": z.object({ step: z.string(), ok: z.boolean(), ms: z.number().optional(), detail: z.string().optional() }),
  "daemon.stopped": z.object({ reason: z.string(), uptime_ms: z.number(), in_flight: z.number() }),
  "daemon.killed": z.object({ signal: z.string() }),
  "daemon.config_loaded": z.object({ hash: z.string(), sources: z.record(z.string(), z.string()) }),

  "bus.submitted": z.object({ job_id: z.string(), lane: z.string(), kind: z.string(), queue_depth: z.number() }),
  "bus.started": z.object({ job_id: z.string(), lane: z.string(), waited_ms: z.number() }),
  "bus.finished": z.object({ job_id: z.string(), lane: z.string(), ok: z.boolean(), ms: z.number(), error: z.string().optional() }),
  "bus.rejected": z.object({
    job_id: z.string(), lane: z.string(), reason: z.string(),
    share_5h: z.number().optional(), share_weekly: z.number().optional(), headroom: z.number().optional(),
  }),
  "bus.parked": z.object({ job_id: z.string(), lane: z.string(), until: z.string().optional(), reason: z.string() }),
  "bus.duplicate": z.object({ job_id: z.string(), lane: z.string() }),

  "channel.message_received": z.object({
    channel: z.string(), message_id: z.string(), text: z.string(),
    external: any.optional(), rejected: z.string().optional(),
  }),
  "channel.message_sent": z.object({ channel: z.string(), external_id: z.string().optional(), parts: z.number(), bytes: z.number() }),
  "channel.send_failed": z.object({ channel: z.string(), error: z.string(), attempts: z.number() }),
  "channel.topic_created": z.object({ channel: z.string(), external_id: z.string(), title: z.string() }),

  "session.created": z.object({ session_id: z.string(), topic_key: z.string(), title: z.string(), channel: z.string() }),
  "session.resumed": z.object({ session_id: z.string(), sdk_session_id: z.string(), idle_ms: z.number() }),
  "session.rehydrated": z.object({ session_id: z.string(), idle_ms: z.number(), seeded_with: z.array(z.string()) }),
  "session.turn_started": z.object({ session_id: z.string(), turn_id: z.string(), resume_mode: z.string(), model: z.string(), lane: z.string() }),
  "session.turn_completed": z.object({
    session_id: z.string(), turn_id: z.string(), ms: z.number(), reply_chars: z.number(),
    input_tokens: z.number(), output_tokens: z.number(),
  }),
  "session.turn_failed": z.object({ session_id: z.string(), turn_id: z.string(), error_class: z.string(), error: z.string() }),
  "session.checkpointed": z.object({ session_id: z.string(), turn_count: z.number(), brief_path: z.string() }),
  "session.archived": z.object({ session_id: z.string(), idle_days: z.number() }),
  "session.topic_inferred": z.object({
    decision: z.string(), title: z.string().optional(), alternatives: z.array(z.string()),
    confidence: z.number().optional(), rule: z.string(),
  }),
  "session.topic_corrected": z.object({ from_session: z.string(), to_session: z.string(), event_id: z.string() }),

  "routing.decided": z.object({ class: z.string(), tier: z.string(), model: z.string(), reason: z.string() }),
  "routing.escalated": z.object({ class: z.string(), from_tier: z.string(), to_tier: z.string(), failures: z.number() }),

  "meter.usage_recorded": z.object({
    lane: z.string(), model: z.string(), tier: z.string(),
    input_tokens: z.number(), output_tokens: z.number(),
    cache_read_tokens: z.number(), cache_creation_tokens: z.number(),
    weighted: z.number(), cost_usd: z.number().nullable(), source: z.string(),
  }),
  "meter.window_threshold": z.object({ window: z.string(), crossing: z.string(), share: z.number() }),
  "meter.window_exhausted": z.object({ window: z.string(), observed_weighted: z.number(), capacity: z.number(), detected_by: z.string() }),

  "vault.written": z.object({ path: z.string(), bytes: z.number(), sha256: z.string(), mode: z.string() }),
  "vault.commit": z.object({ paths: z.array(z.string()), sha: z.string(), message: z.string() }),
  "vault.write_denied": z.object({ path: z.string(), reason: z.string() }),
  "vault.commit_failed": z.object({ paths: z.array(z.string()), step: z.string(), error: z.string() }),

  "obs.export_failed": z.object({ endpoint: z.string(), error: z.string(), dropped: z.number() }),
  "obs.join_audit": z.object({ since: z.string(), orphans: z.number(), baseline: z.number(), delta: z.number() }),

  "event.unregistered_kind": z.object({ kind: z.string() }),
} as const;

export type Kind = keyof typeof KINDS;

export function isRegistered(kind: string): kind is Kind {
  return Object.hasOwn(KINDS, kind);
}

export const MAX_PAYLOAD_BYTES = 64 * 1024;

/** Replace the biggest string field with a truncation stub until under the cap. */
export function capPayload(payload: Record<string, unknown>): Record<string, unknown> {
  let out = payload;
  while (Buffer.byteLength(JSON.stringify(out)) > MAX_PAYLOAD_BYTES) {
    const entries = Object.entries(out).filter(([, v]) => typeof v === "string") as Array<[string, string]>;
    if (entries.length === 0) break;
    entries.sort((a, b) => b[1].length - a[1].length);
    const [field, value] = entries[0]!;
    const h = new Bun.CryptoHasher("sha256");
    h.update(value);
    out = { ...out, [field]: undefined, _truncated: { field, bytes: Buffer.byteLength(value), sha256: h.digest("hex") } };
    delete (out as Record<string, unknown>)[field];
  }
  return out;
}
