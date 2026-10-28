/**
 * `GET /api/activity?days=7`: the tools and hooks Claude Code used over the
 * last days, and the verify-gate's denials. It reads Langfuse observations (as
 * `fetchObservations` does). `?project=<key>` keeps one project: a Langfuse
 * trace by its name or cwd.
 */
import { basename } from "node:path";
import { langfuseConfig, type LangfuseConfig } from "../../hooks/lib/env.ts";
import type { Observation } from "../../hooks/lib/otlp.ts";
import { loadRegistry } from "../../jobs/lib/ledger.ts";
import { today } from "../../todo/lib/todo.ts";
import type { Routes } from "../server.ts";
import { staleAsync } from "../stale.ts";

const DAY = 24 * 3600_000;
const HOOKS = ["verify-gate", "vault-recall"];

/** `n` from the query, an integer in 1..90, else `fallback`. */
function daysOf(url: URL, fallback: number): number {
  const n = Number(url.searchParams.get("days"));
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 90) : fallback;
}

/** The local dates of the last `days` days, oldest first, ending today. */
function dayKeys(days: number, now: Date): string[] {
  return Array.from({ length: days }, (_, i) => today(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1 - i), 12)));
}
const dayOf = (iso: string | number | undefined): string | null => {
  const d = new Date(iso ?? NaN);
  return Number.isNaN(d.getTime()) ? null : today(d);
};
const startOf = (key: string) => new Date(`${key}T00:00:00`);

export interface Count { name: string; calls: number; errors: number; lastAt?: string }
export interface Activity {
  days: string[];
  langfuse: "ok" | "off" | "error";
  error?: string;
  projects: string[];
  tools: Count[];
  hooks: Count[];
  denials: { total: number; recent: { at: string; reason: string }[] };
  /** When the Langfuse half was fetched; it is reused for ALEPH_UI_CACHE_TTL seconds. */
  cachedAt?: string;
}

const isError = (o: Observation) => (o as any).level === "ERROR";

/** Langfuse reads kept `ALEPH_UI_CACHE_TTL` seconds (default 300; 0 turns the cache off), keyed by their arguments; an older one is served while it reloads. */
const cache = staleAsync<{ value: unknown; cachedAt: string }>();
const ttlMs = () => { const n = Number(process.env.ALEPH_UI_CACHE_TTL ?? 300); return Number.isFinite(n) && n > 0 ? n * 1000 : 0; };
export const clearCache = () => cache.clear();
function cached<T>(key: string, load: () => Promise<T>): Promise<{ value: T; cachedAt: string }> {
  return cache.get(key, ttlMs(), () => load().then((v) => ({ value: v as unknown, cachedAt: new Date().toISOString() }))) as Promise<{ value: T; cachedAt: string }>;
}

/** Every row of a paged Langfuse list: page 1 says how many pages there are, the rest are fetched together. */
async function allPages(cfg: LangfuseConfig, path: string, params: Record<string, string>): Promise<any[]> {
  const page = (n: number) => getJson(cfg, `${path}?${new URLSearchParams({ ...params, limit: "100", page: String(n) })}`);
  const first = await page(1);
  const pages = first.meta ? Math.min(Number(first.meta.totalPages) || 1, 499) : 1;
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => page(i + 2)));
  return [first, ...rest].flatMap((b) => b.data ?? []);
}

async function getJson(cfg: LangfuseConfig, path: string): Promise<any> {
  const auth = Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString("base64");
  const res = await fetch(`${cfg.baseUrl}${path}`, { headers: { authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${res.status} on ${path.split("?")[0]}`);
  return res.json();
}

/** The ids of the traces of `project`: its session's cwd, or the trace's name, is the key. */
async function projectTraces(cfg: LangfuseConfig, project: string, from: Date, to: Date): Promise<Set<string>> {
  const rows = await allPages(cfg, "/api/public/traces", { fromTimestamp: from.toISOString(), toTimestamp: to.toISOString() });
  const ids = new Set<string>();
  for (const t of rows) {
    const cwd = t.metadata?.cwd;
    if (t.name === project || (typeof cwd === "string" && basename(cwd) === project)) ids.add(t.id);
  }
  return ids;
}

export async function activity(days: number, project: string | null, now = new Date()): Promise<Activity> {
  const keys = dayKeys(days, now);
  const out: Activity = {
    days: keys, langfuse: "off",
    projects: Object.keys(loadRegistry()).sort(),
    tools: [], hooks: [], denials: { total: 0, recent: [] },
  };
  const cfg = langfuseConfig();
  if (!cfg) return out;
  const from = startOf(keys[0]), to = new Date(now.getTime() + 60_000);
  let obs: Observation[];
  try {
    const got = await cached(`${cfg.baseUrl}|${keys[0]}|${days}|${project ?? ""}`, async () => {
      const [all, mine] = await Promise.all([
        allPages(cfg, "/api/public/observations", { fromStartTime: from.toISOString(), toStartTime: to.toISOString() }) as Promise<Observation[]>,
        project ? projectTraces(cfg, project, new Date(from.getTime() - DAY), to) : null,
      ]);
      return mine ? all.filter((o) => o.traceId && mine.has(o.traceId)) : all;
    });
    obs = [...got.value];
    out.cachedAt = got.cachedAt;
  } catch (e) {
    out.langfuse = "error";
    out.error = e instanceof Error ? e.message : String(e);
    return out;
  }
  out.langfuse = "ok";

  const inRange = new Set(keys);
  const tools = new Map<string, Count>(), hooks = new Map<string, Count>();
  // Observations arrive newest first, so the first one seen is the last call.
  const bump = (m: Map<string, Count>, name: string, o: Observation) => {
    const c = m.get(name) ?? { name, calls: 0, errors: 0 };
    c.calls++;
    if (o.startTime && !c.lastAt) c.lastAt = new Date(o.startTime).toISOString();
    if (isError(o)) c.errors++;
    m.set(name, c);
  };
  for (const o of obs.sort((a, b) => (b.startTime ?? "").localeCompare(a.startTime ?? ""))) {
    const day = dayOf(o.startTime);
    if (!day || !inRange.has(day)) continue;
    const name = o.name ?? "";
    if (HOOKS.includes(name)) {
      bump(hooks, name, o);
      if (name === "verify-gate" && o.metadata?.verdict === "deny") {
        out.denials.total++;
        if (out.denials.recent.length < 10) out.denials.recent.push({ at: o.startTime ?? "", reason: String(o.output ?? "").replace(/^deny:\s*/, "") });
      }
    } else if (o.type === "TOOL" && !name.startsWith("skill:")) {
      bump(tools, String(o.metadata?.tool ?? name), o);
    }
  }
  const byCalls = (a: Count, b: Count) => b.calls - a.calls || a.name.localeCompare(b.name);
  out.tools = [...tools.values()].sort(byCalls);
  out.hooks = [...hooks.values()].sort(byCalls);
  return out;
}

const projectOf = (url: URL) => url.searchParams.get("project") || null;

export const routes: Routes = {
  "GET /api/activity": async (_req, _p, url) => Response.json(await activity(daysOf(url, 7), projectOf(url))),
};
