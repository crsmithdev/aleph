/**
 * `GET /api/activity?days=7` and `GET /api/summary?days=30`: what the factory
 * and Claude Code did over the last days. Activity reads Langfuse observations
 * (as `fetchObservations` does) and the ledger; the summary reads the ledger,
 * the work store and each factory repo's origin/<main>. `?project=<key>` keeps
 * one project: a ledger run by its repo, a Langfuse trace by its name or cwd.
 */
import { basename } from "node:path";
import { langfuseConfig, type LangfuseConfig } from "../../hooks/lib/env.ts";
import { fetchObservations, type Observation } from "../../hooks/lib/otlp.ts";
import { allJobs, allRuns, loadRegistry } from "../../jobs/lib/ledger.ts";
import { readList } from "../../todo/lib/store.ts";
import { status, today } from "../../todo/lib/todo.ts";
import type { Routes } from "../server.ts";

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

export interface Count { name: string; calls: number; errors: number }
export interface Activity {
  days: string[];
  langfuse: "ok" | "off" | "error";
  error?: string;
  cost: { day: string; cost: number }[];
  models: { model: string; cost: number; calls: number; perDay: Record<string, number> }[];
  tools: Count[];
  hooks: Count[];
  denials: { total: number; recent: { at: string; reason: string }[] };
  runs: { day: string; runs: number; cost: number }[];
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
function costOf(o: any): number {
  if (typeof o.calculatedTotalCost === "number") return o.calculatedTotalCost;
  if (typeof o.totalCost === "number") return o.totalCost;
  const d = o.costDetails ?? o.cost_details;
  if (d && typeof d === "object") return num(d.total) || Object.values(d).reduce<number>((a, v) => a + num(v), 0);
  return 0;
}
const isError = (o: Observation) => (o as any).level === "ERROR";

async function getJson(cfg: LangfuseConfig, path: string): Promise<any> {
  const auth = Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString("base64");
  const res = await fetch(`${cfg.baseUrl}${path}`, { headers: { authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${res.status} on ${path.split("?")[0]}`);
  return res.json();
}

/** The ids of the traces of `project`: its session's cwd, or the trace's name, is the key. */
async function projectTraces(cfg: LangfuseConfig, project: string, from: Date, to: Date): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let page = 1; page < 200; page++) {
    const q = new URLSearchParams({ fromTimestamp: from.toISOString(), toTimestamp: to.toISOString(), limit: "100", page: String(page) });
    const body = await getJson(cfg, `/api/public/traces?${q}`);
    for (const t of body.data ?? []) {
      const cwd = t.metadata?.cwd;
      if (t.name === project || (typeof cwd === "string" && basename(cwd) === project)) ids.add(t.id);
    }
    if (!body.meta || page >= (body.meta.totalPages ?? 1)) break;
  }
  return ids;
}

function factoryRuns(keys: string[], project: string | null) {
  const registry = loadRegistry();
  const factory = new Set(Object.values(registry).filter((r) => r.sandbox).map((r) => r.key));
  const by = new Map(keys.map((k) => [k, { day: k, runs: 0, cost: 0 }]));
  for (const e of allRuns()) {
    const r = e.run;
    if (r.kind !== "agent" || !r.repo || !factory.has(r.repo) || (project && r.repo !== project)) continue;
    const row = by.get(dayOf(r.started) ?? "");
    if (row) { row.runs++; row.cost += r.cost ?? 0; }
  }
  return [...by.values()];
}

export async function activity(days: number, project: string | null, now = new Date()): Promise<Activity> {
  const keys = dayKeys(days, now);
  const out: Activity = {
    days: keys, langfuse: "off",
    cost: keys.map((day) => ({ day, cost: 0 })), models: [], tools: [], hooks: [],
    denials: { total: 0, recent: [] }, runs: factoryRuns(keys, project),
  };
  const cfg = langfuseConfig();
  if (!cfg) return out;
  const from = startOf(keys[0]), to = new Date(now.getTime() + 60_000);
  let obs: Observation[];
  try {
    obs = await fetchObservations(cfg, from, to);
    if (project) {
      const mine = await projectTraces(cfg, project, new Date(from.getTime() - DAY), to);
      obs = obs.filter((o) => o.traceId && mine.has(o.traceId));
    }
  } catch (e) {
    out.langfuse = "error";
    out.error = e instanceof Error ? e.message : String(e);
    return out;
  }
  out.langfuse = "ok";

  const perDay = new Map(out.cost.map((c) => [c.day, c]));
  const models = new Map<string, Activity["models"][number]>();
  const tools = new Map<string, Count>(), hooks = new Map<string, Count>();
  const bump = (m: Map<string, Count>, name: string, o: Observation) => {
    const c = m.get(name) ?? { name, calls: 0, errors: 0 };
    c.calls++;
    if (isError(o)) c.errors++;
    m.set(name, c);
  };
  for (const o of obs.sort((a, b) => (b.startTime ?? "").localeCompare(a.startTime ?? ""))) {
    const day = dayOf(o.startTime);
    if (!day || !perDay.has(day)) continue;
    const name = o.name ?? "";
    if (o.type === "GENERATION") {
      const cost = costOf(o);
      perDay.get(day)!.cost += cost;
      const model = (o as any).model ?? name ?? "unknown";
      const m: Activity["models"][number] = models.get(model) ?? { model, cost: 0, calls: 0, perDay: {} };
      m.cost += cost; m.calls++; m.perDay[day] = (m.perDay[day] ?? 0) + cost;
      models.set(model, m);
    } else if (HOOKS.includes(name)) {
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
  out.models = [...models.values()].sort((a, b) => b.cost - a.cost);
  out.tools = [...tools.values()].sort(byCalls);
  out.hooks = [...hooks.values()].sort(byCalls);
  return out;
}

export interface Summary {
  days: { day: string; goals: number; items: number; commits: number; runs: number; cost: number }[];
}

export function summary(days: number, project: string | null, now = new Date()): Summary {
  const keys = dayKeys(days, now);
  const rows = new Map(keys.map((k) => [k, { day: k, goals: 0, items: 0, commits: 0, runs: 0, cost: 0 }]));
  const registry = loadRegistry();
  const mine = Object.values(registry).filter((r) => !project || r.key === project);

  for (const j of allJobs()) {
    const last = j.at(-1)!.run;
    if (last.state !== "landed" || (project && last.repo !== project)) continue;
    const row = rows.get(dayOf(last.ended) ?? "");
    if (row) row.goals++;
  }
  for (const r of factoryRuns(keys, project)) Object.assign(rows.get(r.day)!, { runs: r.runs, cost: r.cost });

  for (const repo of mine) {
    let doc = null;
    try { doc = readList({ key: repo.key }); } catch {}
    for (const item of doc?.items ?? []) {
      if (status(item) !== "done") continue;
      const row = rows.get(String(item.fm.updated ?? "").slice(0, 10));
      if (row) row.items++;
    }
    if (!repo.sandbox) continue;
    const since = startOf(keys[0]).toISOString();
    const p = Bun.spawnSync(["git", "-C", repo.path, "log", `origin/${repo.main}`, `--since=${since}`, "--format=%ct"], { stdout: "pipe", stderr: "ignore" });
    if (p.exitCode !== 0) continue;
    for (const line of p.stdout.toString().split("\n")) {
      const row = rows.get(dayOf(Number(line) * 1000) ?? "");
      if (line && row) row.commits++;
    }
  }
  return { days: [...rows.values()] };
}

const projectOf = (url: URL) => url.searchParams.get("project") || null;

export const routes: Routes = {
  "GET /api/activity": async (_req, _p, url) => Response.json(await activity(daysOf(url, 7), projectOf(url))),
  "GET /api/summary": (_req, _p, url) => Response.json(summary(daysOf(url, 30), projectOf(url))),
  // The page fetches one URL per view: this is the Activity view's, both objects at once.
  "GET /api/activity/view": async (_req, _p, url) =>
    Response.json({ activity: await activity(daysOf(url, 7), projectOf(url)), summary: summary(30, projectOf(url)) }),
};
