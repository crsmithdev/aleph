/**
 * OTLP/HTTP JSON straight to Langfuse. No SDK: a hook is a fresh process that
 * lives for one event, so the whole exporter is one fetch.
 */
import { createHash, randomBytes } from "node:crypto";
import type { LangfuseConfig } from "./env.ts";

const MAX_FIELD = 4096;

export type AttrValue = string | number | boolean | string[];
export type OtlpAttr = { key: string; value: Record<string, unknown> };

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttr[];
  kind: number;
  status?: { code: number; message?: string };
}

/** One session, one trace: the id is a pure function of the session id. */
export function traceIdFor(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

export function spanId(): string {
  return randomBytes(8).toString("hex");
}

/** The turn span id is a pure function of the prompt id, so any hook can parent to it. */
export function turnSpanIdFor(promptId: string): string {
  return createHash("sha256").update(`turn:${promptId}`).digest("hex").slice(0, 16);
}

export function nano(ms: number): string {
  return `${BigInt(Math.round(ms))}000000`;
}

export function truncate(value: unknown, max = MAX_FIELD): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…[+${text.length - max} chars]`;
}

function encode(value: AttrValue): Record<string, unknown> {
  if (Array.isArray(value)) return { arrayValue: { values: value.map((item) => ({ stringValue: String(item) })) } };
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  return { stringValue: value };
}

export function attrs(record: Record<string, AttrValue | undefined | null>): OtlpAttr[] {
  return Object.entries(record)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => ({ key, value: encode(value as AttrValue) }));
}

export interface PostResult { ok: boolean; status?: number; error?: string }

export async function postSpans(cfg: LangfuseConfig, spans: Span[], timeoutMs = 8000): Promise<PostResult> {
  const body = {
    resourceSpans: [{
      resource: { attributes: attrs({ "service.name": "aleph", "service.version": "0.1.0" }) },
      scopeSpans: [{ scope: { name: "aleph-hooks" }, spans }],
    }],
  };
  const auth = Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString("base64");
  try {
    const res = await fetch(`${cfg.baseUrl}/api/public/otel/v1/traces`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${auth}`,
        "x-langfuse-ingestion-version": "4",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: res.ok, status: res.status, error: res.ok ? undefined : (await res.text()).slice(0, 300) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** Only Langfuse proves ingestion; a 200 on the POST does not. */
export async function fetchTrace(cfg: LangfuseConfig, traceId: string): Promise<unknown | null> {
  const auth = Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString("base64");
  const res = await fetch(`${cfg.baseUrl}/api/public/traces/${traceId}`, { headers: { authorization: `Basic ${auth}` } });
  return res.ok ? res.json() : null;
}
