import { test, expect, describe } from "bun:test";
import { EnvelopeSchema, IdTupleSchema, KINDS, isRegistered, capPayload, MAX_PAYLOAD_BYTES } from "../../src/core/envelope.ts";
import { redactString } from "../../src/core/redact.ts";
import { mint, isId, slugify, newTraceId } from "../../src/core/ids.ts";

const TRACE = "a".repeat(32);

describe("id tuple", () => {
  test("session_id required iff origin is channel", () => {
    expect(IdTupleSchema.safeParse({ origin: "channel", session_id: "ses_1", trace_id: TRACE }).success).toBe(true);
    expect(IdTupleSchema.safeParse({ origin: "channel", trace_id: TRACE }).success).toBe(false);
    expect(IdTupleSchema.safeParse({ origin: "librarian", trace_id: TRACE }).success).toBe(true);
    expect(IdTupleSchema.safeParse({ origin: "librarian", session_id: "ses_1", trace_id: TRACE }).success).toBe(false);
  });

  test("trace_id must be 32 lowercase hex", () => {
    expect(IdTupleSchema.safeParse({ origin: "system", trace_id: "nope" }).success).toBe(false);
    expect(IdTupleSchema.safeParse({ origin: "system", trace_id: newTraceId() }).success).toBe(true);
  });
});

describe("envelope", () => {
  const base = {
    v: 1, id: "evt_1", ts: "2026-08-20T00:00:00.000Z", kind: "daemon.started",
    ids: { origin: "system", trace_id: TRACE }, caused_by: null,
    cause: { kind: "computed", text: "boot", source: "test" },
    payload: {}, actor: "daemon",
  };

  test("accepts a well-formed envelope with an explicit null cause chain root", () => {
    expect(EnvelopeSchema.safeParse(base).success).toBe(true);
  });

  test("rejects a missing cause — an optional cause becomes an empty cause within a month", () => {
    const { cause, ...noCause } = base;
    expect(EnvelopeSchema.safeParse(noCause).success).toBe(false);
    expect(EnvelopeSchema.safeParse({ ...base, cause: { kind: "computed", text: "", source: "test" } }).success).toBe(false);
  });

  test("caused_by must be present as an explicit null, not absent", () => {
    const { caused_by, ...noCausedBy } = base;
    expect(EnvelopeSchema.safeParse(noCausedBy).success).toBe(false);
  });
});

describe("kind registry", () => {
  test("every registered kind has a payload schema and a dotted name", () => {
    for (const kind of Object.keys(KINDS)) {
      expect(kind).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(KINDS[kind as keyof typeof KINDS]).toBeDefined();
    }
  });
  test("isRegistered discriminates", () => {
    expect(isRegistered("session.turn_completed")).toBe(true);
    expect(isRegistered("session.invented")).toBe(false);
  });
});

describe("payload cap", () => {
  test("oversized string field is replaced by a truncation stub with a hash", () => {
    const payload = { text: "x".repeat(MAX_PAYLOAD_BYTES + 100), keep: "small" };
    const capped = capPayload(payload) as any;
    expect(capped.text).toBeUndefined();
    expect(capped.keep).toBe("small");
    expect(capped._truncated.field).toBe("text");
    expect(capped._truncated.sha256).toHaveLength(64);
    expect(Buffer.byteLength(JSON.stringify(capped))).toBeLessThan(MAX_PAYLOAD_BYTES);
  });
});

describe("redaction", () => {
  test("redacts real-shaped secrets", () => {
    for (const secret of [
      "123456789:AAH0abcdefghijklmnopqrstuvwxyz012345678",
      "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123",
      "pk-lf-1234567890abcdef-1234567890abcdef",
      "Bearer abcdefghijklmnopqrstuvwxyz0123456789",
      "AKIAIOSFODNN7EXAMPLE",
    ]) {
      expect(redactString(`value is ${secret} ok`)).not.toContain(secret);
      expect(redactString(`value is ${secret} ok`)).toContain("«redacted:");
    }
  });

  test("does NOT redact ids — redacting one would corrupt the causal chain", () => {
    for (const safe of [
      "550e8400-e29b-41d4-a716-446655440000",
      "038449f9c2be9cc1a2b3c4d5e6f708192a3b4c5d",
      "evt_01K2X8ABCDEFGHJKMNPQRSTVWX",
      "ses_01K2X8ABCDEFGHJKMNPQRSTVWX",
    ]) {
      expect(redactString(`id ${safe}`)).toContain(safe);
    }
  });
});

describe("ids", () => {
  test("prefixed ULIDs are recognisable and monotonic within a millisecond", () => {
    const t = Date.now();
    const a = mint("evt", t), b = mint("evt", t);
    expect(isId("evt", a)).toBe(true);
    expect(isId("ses", a)).toBe(false);
    expect(b > a).toBe(true);
  });

  test("slugify is stable and never empty", () => {
    expect(slugify("Aleph-next: Phase 1 — Spine!")).toBe("aleph-next-phase-1-spine");
    expect(slugify("café")).toBe("cafe");
    expect(slugify("!!!")).toBe("topic");
  });
});
