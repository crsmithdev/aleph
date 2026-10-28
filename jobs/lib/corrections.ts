/**
 * Correction signals, the procedural memory (docs/specs/2026-10-27-memory.md):
 * Chris's messages that push back on the assistant, the verify-gate's denials
 * and the reviewer's drop reasons of the last 14 days, grouped into lessons by
 * Jev. The store is corrections.json in the factory directory.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { langfuseConfig, type LangfuseConfig } from "../../hooks/lib/env.ts";
import { decide } from "../../hooks/lib/jev.ts";
import { fetchObservations } from "../../hooks/lib/otlp.ts";
import { factoryLog, factoryDir } from "./factory.ts";
import { allRuns } from "./ledger.ts";

export const CORRECTION_AT = 0.7;
const WINDOW = 14 * 24 * 3600_000;
const QUOTE = 300;
const SENTENCE = 160;

export interface Signal { id: string; source: "chris" | "gate" | "drop"; at: string; quote: string; link: string }
export interface Lesson { id: string; sentence: string; state: "open"; signals: Signal[]; count: number }
export interface Store { minedAt: string; lessons: Lesson[] }

const file = () => join(factoryDir(), "corrections.json");

/** A missing or bad file is empty. */
export function readStore(): Store {
  try {
    const s = JSON.parse(readFileSync(file(), "utf8"));
    if (s && typeof s === "object" && Array.isArray(s.lessons)) return { minedAt: String(s.minedAt ?? ""), lessons: s.lessons };
  } catch {}
  return { minedAt: "", lessons: [] };
}

function writeStore(s: Store): void {
  mkdirSync(factoryDir(), { recursive: true });
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n");
  renameSync(tmp, file());
}

const text = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
const cut = (s: string) => s.slice(0, QUOTE);

/** The quote up to its first sentence end, at most 160 characters. */
function firstSentence(quote: string): string {
  const q = quote.trim();
  const m = q.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (m ? m[0] : q).slice(0, SENTENCE);
}
const lessonId = (sentence: string) => "l-" + createHash("sha256").update(sentence).digest("hex").slice(0, 8);

interface Trace { id: string; sessionId?: string; timestamp?: string; input?: unknown; output?: unknown }

async function fetchTraces(cfg: LangfuseConfig, from: Date): Promise<Trace[]> {
  const auth = Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString("base64");
  const page = async (n: number) => {
    const q = new URLSearchParams({ fromTimestamp: from.toISOString(), limit: "100", page: String(n) });
    const res = await fetch(`${cfg.baseUrl}/api/public/traces?${q}`, { headers: { authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`${res.status} on traces`);
    return (await res.json()) as any;
  };
  const first = await page(1);
  const pages = first.meta ? Math.min(Number(first.meta.totalPages) || 1, 499) : 1;
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => page(i + 2)));
  return [first, ...rest].flatMap((b) => b.data ?? []);
}

async function chrisSignals(cfg: LangfuseConfig, from: Date, seen: Set<string>): Promise<Signal[]> {
  const traces = (await fetchTraces(cfg, from))
    .filter((t) => t.id && t.timestamp && Date.parse(t.timestamp) >= from.getTime())
    .sort((a, b) => Date.parse(a.timestamp!) - Date.parse(b.timestamp!));
  const lastBySession = new Map<string, Trace>();
  const out: Signal[] = [];
  for (const t of traces) {
    const prev = t.sessionId ? lastBySession.get(t.sessionId) : undefined;
    if (t.sessionId) lastBySession.set(t.sessionId, t);
    const message = text(t.input).trim();
    const before = text(prev?.output).trim();
    if (!message || !before || seen.has(t.id)) continue;
    try {
      const d = await decide(
        { message, previous_assistant_message: before },
        { correction: { type: "noul", instructions: "Does `message` correct, reject or push back on what `previous_assistant_message` did or said?" } },
      );
      const a = d.answers.correction;
      if (a.type !== "noul" || !(a.noul >= CORRECTION_AT)) continue;
    } catch (e) {
      factoryLog(`corrections: jev failed on trace ${t.id}: ${(e as Error).message}`);
      continue;
    }
    out.push({ id: t.id, source: "chris", at: new Date(t.timestamp!).toISOString(), quote: cut(message), link: `${cfg.baseUrl}/trace/${t.id}` });
  }
  return out;
}

async function gateSignals(cfg: LangfuseConfig, from: Date, now: number, seen: Set<string>): Promise<Signal[]> {
  const obs = await fetchObservations(cfg, from, new Date(now));
  return obs
    .filter((o) => o.id && o.name === "verify-gate" && o.metadata?.verdict === "deny" && !seen.has(o.id) && Date.parse(o.startTime ?? "") >= from.getTime())
    .map((o) => ({
      id: o.id!, source: "gate" as const, at: new Date(o.startTime!).toISOString(),
      quote: cut(text(o.output).replace(/^deny:\s*/, "")),
      link: o.traceId ? `${cfg.baseUrl}/trace/${o.traceId}` : cfg.baseUrl,
    }));
}

function dropSignals(from: Date, seen: Set<string>): Signal[] {
  const out: Signal[] = [];
  for (const e of allRuns()) {
    const { run } = e;
    const ended = Date.parse(run.ended ?? "");
    if (run.state !== "dropped" || !run.reason || !(ended >= from.getTime()) || seen.has(e.id)) continue;
    out.push({ id: e.id, source: "drop", at: new Date(ended).toISOString(), quote: cut(run.reason), link: run.job });
  }
  return out;
}

/** Put the signal in the lesson Jev picks, else in a new one. A Jev failure leaves the signal out. */
async function group(lessons: Lesson[], s: Signal): Promise<boolean> {
  let pick = "new";
  if (lessons.length) {
    try {
      const criteria: Record<string, string> = { new: "The signal is a lesson not listed" };
      const listed: Record<string, string> = {};
      for (const l of lessons) { criteria[l.id] = l.sentence; listed[l.id] = l.sentence; }
      const d = await decide(
        { signal: s.quote, lessons: listed },
        { lesson: { type: "choice", instructions: "Which lesson does `signal` teach?", criteria: Object.fromEntries(Object.entries(criteria).sort(([a], [b]) => (a === "new" ? 1 : b === "new" ? -1 : 0))) } },
      );
      const a = d.answers.lesson;
      if (a.type === "choice" && criteria[a.choice]) pick = a.choice;
    } catch (e) {
      factoryLog(`corrections: jev failed on signal ${s.id}: ${(e as Error).message}`);
      return false;
    }
  }
  let lesson = pick === "new" ? undefined : lessons.find((l) => l.id === pick);
  if (!lesson) {
    const sentence = firstSentence(s.quote);
    lesson = lessons.find((l) => l.id === lessonId(sentence));
    if (!lesson) {
      lesson = { id: lessonId(sentence), sentence, state: "open", signals: [], count: 0 };
      lessons.push(lesson);
    }
  }
  lesson.signals.push(s);
  lesson.count = lesson.signals.length;
  return true;
}

/** Collect the last 14 days of new signals and group them into lessons; the store is rewritten. */
export async function mine(now = Date.now()): Promise<Store> {
  const store = readStore();
  const from = new Date(now - WINDOW);
  const seen = new Set(store.lessons.flatMap((l) => l.signals.map((s) => s.id)));
  const signals: Signal[] = [];
  const cfg = langfuseConfig();
  if (cfg) {
    for (const f of [() => chrisSignals(cfg, from, seen), () => gateSignals(cfg, from, now, seen)]) {
      try { signals.push(...(await f())); } catch (e) { factoryLog(`corrections: langfuse failed: ${(e as Error).message}`); }
    }
  }
  signals.push(...dropSignals(from, seen));
  signals.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const s of signals) await group(store.lessons, s);
  store.minedAt = new Date(now).toISOString();
  writeStore(store);
  return store;
}
