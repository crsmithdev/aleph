/**
 * The compile digest: one day's Langfuse turns, handoffs and daily note,
 * plus the trace ids already cited, so the agent proposes writes from it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LangfuseConfig } from "../../hooks/lib/env.ts";

const TRACE_CAP = 12 * 1024;

interface Obs { id: string; type: string; name?: string; parentObservationId?: string; input?: unknown; output?: unknown; metadata?: Record<string, any>; startTime?: string }

function dayRange(date: string): { from: string; to: string } {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start.getTime() + 86400_000);
  return { from: start.toISOString(), to: end.toISOString() };
}

async function get(cfg: LangfuseConfig, path: string): Promise<any> {
  const auth = Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString("base64");
  const res = await fetch(`${cfg.baseUrl}${path}`, { headers: { authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${res.status} on ${path}`);
  return res.json();
}

function str(v: unknown, max: number): string {
  const s = typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v);
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

function inputOf(o: Obs): any {
  if (typeof o.input === "string") { try { return JSON.parse(o.input); } catch { return o.input; } }
  return o.input;
}

/** One block per turn: cwd, final message, guardrail verdict, commands run. */
export function digestTrace(trace: { id: string; name?: string; metadata?: any; observations?: Obs[] }): string {
  const obs = trace.observations ?? [];
  const cwd = trace.metadata?.cwd ?? trace.name ?? "";
  const turns = obs.filter((o) => o.name === "turn").sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
  const children = (id: string) => obs.filter((o) => o.parentObservationId === id);
  const out: string[] = [`### trace ${trace.id} (${cwd})`];
  for (const t of turns) {
    const kids = children(t.id);
    const guard = kids.find((o) => o.type === "GUARDRAIL" || o.name === "verify-gate");
    const bash = kids.filter((o) => o.name === "Bash").map((o) => str(inputOf(o)?.command ?? inputOf(o), 160));
    out.push(`- prompt: ${str(t.input, 200)}`);
    if (bash.length) out.push(`  ran: ${bash.slice(0, 8).join(" ; ")}`);
    if (guard) out.push(`  verify: ${str(guard.metadata?.verdict ?? guard.output, 40)} ${str(guard.metadata?.reason ?? "", 200)}`);
    out.push(`  final: ${str(t.output, 600)}`);
  }
  if (!turns.length) out.push("- no turns");
  return out.join("\n");
}

export async function traceDigest(cfg: LangfuseConfig, date: string): Promise<{ text: string; error?: string }> {
  const { from, to } = dayRange(date);
  const parts: string[] = [];
  let size = 0;
  try {
    for (let page = 1; page < 20; page++) {
      const list = await get(cfg, `/api/public/traces?fromTimestamp=${from}&toTimestamp=${to}&limit=50&page=${page}`);
      for (const t of list.data ?? []) {
        const full = await get(cfg, `/api/public/traces/${t.id}`);
        const block = digestTrace(full);
        if (size + block.length > TRACE_CAP) { parts.push(`… ${list.meta?.totalItems ?? "more"} traces on the day; digest capped at ${TRACE_CAP} bytes`); return { text: parts.join("\n\n") }; }
        parts.push(block);
        size += block.length;
      }
      if (!list.meta || page >= (list.meta.totalPages ?? 1)) break;
    }
  } catch (e) {
    return { text: parts.join("\n\n"), error: String(e instanceof Error ? e.message : e) };
  }
  return { text: parts.length ? parts.join("\n\n") : "no traces on this date" };
}

export function handoffsFor(dir: string, date: string): string {
  if (!existsSync(dir)) return "";
  return readdirSync(dir).filter((f) => f.startsWith(date) && f.endsWith(".md")).sort()
    .map((f) => `### ${f}\n${readFileSync(join(dir, f), "utf8").slice(0, 6000)}`).join("\n\n");
}
