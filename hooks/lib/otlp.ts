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

/** A trace id from any string; the live test uses it for a throwaway session. */
export function traceIdFor(seed: string): string {
  return createHash("sha256").update(seed).digest("hex").slice(0, 32);
}

/** One turn, one trace: the id is a pure function of the prompt id, so every hook lands in the same trace. */
export function turnTraceIdFor(promptId: string): string {
  return traceIdFor(`turn:${promptId}`);
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

export interface Score { traceId: string; name: string; value: number; comment?: string; environment?: string }

/** A score on a trace, through the scores API: OTLP has no score. */
export async function postScore(cfg: LangfuseConfig, score: Score, timeoutMs = 3000): Promise<PostResult> {
  const auth = Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString("base64");
  try {
    const res = await fetch(`${cfg.baseUrl}/api/public/scores`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Basic ${auth}` },
      body: JSON.stringify({ ...score, dataType: "NUMERIC", comment: score.comment?.slice(0, 500) }),
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

export interface Observation {
  id?: string;
  traceId?: string;
  type?: string;
  name?: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, any> | null;
  startTime?: string;
}

/** Every observation that started in [from, to], paged through the observations API. */
export async function fetchObservations(cfg: LangfuseConfig, from: Date, to: Date, timeoutMs = 15000): Promise<Observation[]> {
  const auth = Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString("base64");
  const page = async (n: number) => {
    const q = new URLSearchParams({ fromStartTime: from.toISOString(), toStartTime: to.toISOString(), limit: "100", page: String(n) });
    const res = await fetch(`${cfg.baseUrl}/api/public/observations?${q}`, { headers: { authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`${res.status} on observations`);
    return (await res.json()) as any;
  };
  const first = await page(1);
  const pages = first.meta ? Math.min(Number(first.meta.totalPages) || 1, 499) : 1;
  const out: any[][] = [first.data ?? []];
  let next = 2;
  let failed = false;
  // A pool of 4, as ui/api/skills.ts does: all pages at once overload Langfuse. Each request has its own timeout.
  const worker = async () => {
    try { for (let n = next++; n <= pages && !failed; n = next++) out[n - 1] = (await page(n).catch(() => page(n))).data ?? []; }
    catch (e) { failed = true; throw e; }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(4, pages - 1) }, worker));
  const bad = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  if (bad) throw bad.reason;
  return out.flat();
}
