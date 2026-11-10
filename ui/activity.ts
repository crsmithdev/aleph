/**
 * The tools and hooks Claude Code used over the last days, and the
 * verify-gate's denials, for `/api/sessions` and `/api/memory`. It reads Langfuse
 * observations (as `fetchObservations` does). `?project=<key>` keeps one
 * project: a Langfuse trace by the scope rule in `ui/api/scope.ts`.
 */
import { langfuseConfig, type LangfuseConfig } from "../lib/env.ts";
import type { Observation } from "../lib/otlp.ts";
import { loadRegistry } from "../jobs/lib/records/ledger.ts";
import { today } from "../issues/lib/todo.ts";
import { once } from "../jobs/lib/infra/sources.ts";
import { traceIn } from "./api/scope.ts";
import { allPages } from "./langfuse-pages.ts";

const DAY = 24 * 3600_000;
const HOOKS = ["verify-gate", "vault-recall"];

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
  /** The traces each tool ran in, for `/api/sessions`. */
  toolTraces?: Record<string, string[]>;
  /** True when the window held more pages than the fetch reads, so the counts cover only part of it. */
  partial?: boolean;
}

const isError = (o: Observation) => (o as any).level === "ERROR";


/** The ids of the traces of `project`, by the scope rule. */
async function projectTraces(cfg: LangfuseConfig, project: string, from: Date, to: Date): Promise<{ ids: Set<string>; partial: boolean }> {
  const { rows, partial } = await allPages(cfg, "/api/public/traces", { fromTimestamp: from.toISOString(), toTimestamp: to.toISOString() }, 15_000);
  return { ids: new Set(rows.filter((t) => traceIn(t, project)).map((t) => t.id)), partial };
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
    const got = await once(`${cfg.baseUrl}|${keys[0]}|${days}|${project ?? ""}`, ["langfuse"], async () => {
      const [all, mine] = await Promise.all([
        allPages(cfg, "/api/public/observations", { fromStartTime: from.toISOString(), toStartTime: to.toISOString() }, 15_000) as Promise<{ rows: Observation[]; partial: boolean }>,
        project ? projectTraces(cfg, project, new Date(from.getTime() - DAY), to) : null,
      ]);
      const rows = mine ? all.rows.filter((o) => o.traceId && mine.ids.has(o.traceId)) : all.rows;
      // A project read from part of the traces keeps part of the window's rows: the answer is partial too.
      return { rows, partial: all.partial || !!mine?.partial };
    });
    obs = [...got.rows];
    out.partial = got.partial;
  } catch (e) {
    out.langfuse = "error";
    out.error = e instanceof Error ? e.message : String(e);
    return out;
  }
  out.langfuse = "ok";

  const inRange = new Set(keys);
  const traceSets = new Map<string, Set<string>>();
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
      const tool = String(o.metadata?.tool ?? name);
      bump(tools, tool, o);
      if (o.traceId) traceSets.set(tool, (traceSets.get(tool) ?? new Set()).add(o.traceId));
    }
  }
  const byCalls = (a: Count, b: Count) => b.calls - a.calls || a.name.localeCompare(b.name);
  out.tools = [...tools.values()].sort(byCalls);
  out.hooks = [...hooks.values()].sort(byCalls);
  out.toolTraces = Object.fromEntries([...traceSets].map(([k, v]) => [k, [...v]]));
  return out;
}
