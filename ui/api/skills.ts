/**
 * `GET /api/skills` and `GET /api/skills/:name`: skill use from Langfuse. A use
 * is a `Skill` tool call or a turn whose prompt starts with a slash command.
 * Both take `?days=` (default 30) and `?project=<key>`; an analysis is reloaded at most every 30 s, and an older one is served while it reloads.
 */
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { langfuseConfig } from "../../hooks/lib/env.ts";
import type { Observation } from "../../hooks/lib/otlp.ts";
import { loadRegistry } from "../../jobs/lib/ledger.ts";
import type { Routes } from "../server.ts";
import { staleAsync } from "../stale.ts";

const DAY = 86400_000;
const TTL = 30_000;

interface Use { skill: string; via: "tool" | "slash"; trace: string; session: string; project: string; time: string; prompt: string; start: string }
interface TraceInfo { id: string; sessionId?: string; metadata?: Record<string, any> | null; tags?: string[] }

const cache = staleAsync<Analysis>();
export const clearCache = () => cache.clear();

const asValue = (v: unknown): any => { if (typeof v === "string") { try { return JSON.parse(v); } catch { return v; } } return v; };
const day = (iso: string) => iso.slice(0, 10);
const text = (v: unknown): string => { const x = asValue(v); return typeof x === "string" ? x : x?.prompt ?? x?.text ?? (x == null ? "" : JSON.stringify(x)); };
const firstLine = (s: string) => s.replace(/<command-message>[\s\S]*?<\/command-message>/g, "").replace(/<[^>]+>/g, " ").split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 200) ?? "";

export const skillsDir = () => process.env.ALEPH_SKILLS_DIR ?? join(import.meta.dir, "..", "..", "skills");
const folders = (): string[] => {
  const dir = skillsDir();
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "SKILL.md"))).map((d) => d.name).sort() : [];
};
const short = (name: string) => name.split(":").pop()!;

/** The slash command a prompt starts with, or null. */
export function slashCommand(prompt: string): string | null {
  const m = prompt.match(/^\s*(?:<command-message>[\s\S]*?<\/command-message>\s*)?<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/) ?? prompt.match(/^\s*\/([\w][\w:.-]*)/);
  return m ? m[1] : null;
}

function projectOf(cwd: string | undefined, tags: string[] | undefined): string {
  if (cwd) {
    for (const r of Object.values(loadRegistry())) if (cwd === r.path || cwd.startsWith(r.path.replace(/\/+$/, "") + "/")) return r.key;
    return basename(cwd);
  }
  return tags?.find((t) => t.startsWith("project:"))?.slice(8) ?? "";
}

async function getJson(cfg: { baseUrl: string; publicKey: string; secretKey: string }, path: string, q: Record<string, string>): Promise<any> {
  const auth = Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString("base64");
  const res = await fetch(`${cfg.baseUrl}${path}?${new URLSearchParams(q)}`, { headers: { authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${res.status} on ${path}`);
  return res.json();
}

/** Every row of a paged Langfuse list: page 1 says how many pages there are, the rest are fetched together. */
async function allPages<T>(cfg: any, path: string, q: Record<string, string>): Promise<T[]> {
  const page = (n: number) => getJson(cfg, path, { ...q, limit: "100", page: String(n) });
  const first = await page(1);
  const pages = first.meta ? Math.min(Number(first.meta.totalPages) || 1, 499) : 1;
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => page(i + 2)));
  return [first, ...rest].flatMap((b) => b.data ?? []);
}

const fetchObservations = (cfg: any, from: Date, to: Date) => allPages<Observation>(cfg, "/api/public/observations", { fromStartTime: from.toISOString(), toStartTime: to.toISOString() });
const fetchTraces = (cfg: any, from: Date, to: Date) => allPages<TraceInfo>(cfg, "/api/public/traces", { fromTimestamp: from.toISOString(), toTimestamp: to.toISOString() });

interface Analysis { uses: Use[]; tools: Map<string, Map<string, number>>; errors: Map<string, { trace: string; message: string }>; since: Date; days: number }

async function analyse(days: number, project: string | null): Promise<Analysis> {
  const cfg = langfuseConfig();
  if (!cfg) throw new Error("no Langfuse keys");
  const to = new Date();
  const since = new Date(Math.floor(to.getTime() / DAY) * DAY - (days - 1) * DAY);
  const [obs, traces] = await Promise.all([fetchObservations(cfg, since, new Date(to.getTime() + 60_000)), fetchTraces(cfg, since, new Date(to.getTime() + 60_000))]);
  const info = new Map(traces.map((t) => [t.id, t]));
  const byTrace = new Map<string, Observation[]>();
  for (const o of obs) {
    if (!o.traceId || !o.startTime || new Date(o.startTime) < since) continue;
    (byTrace.get(o.traceId) ?? byTrace.set(o.traceId, []).get(o.traceId)!).push(o);
  }
  const known = new Set(folders());
  const uses: Use[] = [];
  const tools = new Map<string, Map<string, number>>();
  const errors = new Map<string, { trace: string; message: string }>();
  for (const [trace, list] of byTrace) {
    list.sort((a, b) => a.startTime!.localeCompare(b.startTime!));
    const t = info.get(trace);
    const meta = { ...list.find((o) => o.metadata?.cwd)?.metadata, ...t?.metadata };
    const session = t?.sessionId ?? (list.find((o) => (o as any).sessionId) as any)?.sessionId ?? list.find((o) => o.metadata?.session_id)?.metadata?.session_id ?? "";
    const proj = projectOf(meta.cwd, t?.tags);
    if (project && proj !== project) continue;
    const turn = list.find((o) => o.name === "turn");
    const prompt = turn ? text(turn.input) : "";
    const isTool = (o: Observation) => o !== turn && (o.metadata?.tool || String(o.type).toUpperCase() === "TOOL");
    const toolName = (o: Observation) => String(o.metadata?.tool ?? o.name);
    const here: { use: Use; from: string; self?: Observation }[] = [];
    const cmd = slashCommand(prompt);
    if (cmd && (cmd.includes(":") || known.has(cmd))) here.push({ use: { skill: cmd, via: "slash", trace, session, project: proj, time: turn!.startTime!, prompt: firstLine(prompt), start: turn!.startTime! }, from: turn!.startTime! });
    for (const o of list) {
      const isSkill = o.metadata?.tool === "Skill" || o.name === "Skill" || o.name?.startsWith("skill:");
      if (!isSkill) continue;
      const name = asValue(o.input)?.skill ?? (o.name!.startsWith("skill:") ? o.name!.slice(6) : "");
      if (name) here.push({ use: { skill: String(name), via: "tool", trace, session, project: proj, time: o.startTime!, prompt: firstLine(prompt), start: o.startTime! }, from: o.startTime!, self: o });
    }
    if (!here.length) continue;
    const failed = list.filter((o) => String((o as any).level ?? "").toUpperCase() === "ERROR" || (o as any).statusMessage);
    for (const { use, from, self } of here) {
      uses.push(use);
      const counts = tools.get(use.skill) ?? tools.set(use.skill, new Map()).get(use.skill)!;
      for (const o of list) if (o !== self && isTool(o) && o.startTime! >= from && !(o.metadata?.tool === "Skill" || o.name?.startsWith("skill:"))) counts.set(toolName(o), (counts.get(toolName(o)) ?? 0) + 1);
      if (failed.length) errors.set(`${use.skill}\0${trace}`, { trace, message: String(text(failed[0].output) || failed[0].name || "error").slice(0, 200) });
    }
  }
  return { uses, tools, errors, since, days };
}

const perDay = (uses: Use[], a: Analysis): number[] => {
  const out = new Array(a.days).fill(0);
  for (const u of uses) { const i = Math.floor((Date.parse(day(u.time)) - a.since.getTime()) / DAY); if (i >= 0 && i < a.days) out[i]++; }
  return out;
};
const same = (skill: string, name: string) => skill === name || (!name.includes(":") && short(skill) === name);

function summary(a: Analysis) {
  const names = [...new Set(a.uses.map((u) => u.skill))];
  const skills = names.map((name) => {
    const mine = a.uses.filter((u) => u.skill === name);
    return {
      name, uses: mine.length,
      byTool: mine.filter((u) => u.via === "tool").length, bySlash: mine.filter((u) => u.via === "slash").length,
      sessions: new Set(mine.map((u) => u.session)).size,
      projects: [...new Set(mine.map((u) => u.project).filter(Boolean))].sort(),
      lastUsed: mine.map((u) => u.time).sort().pop()!,
      errors: [...a.errors.keys()].filter((k) => k.startsWith(name + "\0")).length,
      perDay: perDay(mine, a),
    };
  }).sort((x, y) => y.uses - x.uses || x.name.localeCompare(y.name));
  const unused = folders().filter((f) => !names.some((n) => short(n) === f));
  return { days: a.days, since: day(a.since.toISOString()), skills, unused };
}

function detail(a: Analysis, name: string) {
  const mine = a.uses.filter((u) => same(u.skill, name)).sort((x, y) => y.time.localeCompare(x.time));
  const counts = new Map<string, number>();
  for (const [skill, m] of a.tools) if (same(skill, name)) for (const [t, n] of m) counts.set(t, (counts.get(t) ?? 0) + n);
  const projects = new Map<string, number>();
  for (const u of mine) if (u.project) projects.set(u.project, (projects.get(u.project) ?? 0) + 1);
  const turns = new Map(mine.map((u) => [u.trace, u]));
  return {
    name, days: a.days, since: day(a.since.toISOString()), uses: mine.length, perDay: perDay(mine, a),
    projects: [...projects].map(([project, uses]) => ({ project, uses })).sort((x, y) => y.uses - x.uses || x.project.localeCompare(y.project)),
    sessions: mine.map((u) => ({ id: u.session, project: u.project, time: u.time, prompt: u.prompt, via: u.via })),
    tools: [...counts].map(([tool, count]) => ({ tool, count })).sort((x, y) => y.count - x.count || x.tool.localeCompare(y.tool)),
    errors: [...a.errors].filter(([k]) => same(k.split("\0")[0], name)).map(([, e]) => ({ ...e, session: turns.get(e.trace)?.session ?? "", project: turns.get(e.trace)?.project ?? "", time: turns.get(e.trace)?.time ?? "", prompt: turns.get(e.trace)?.prompt ?? "" })),
  };
}

/** Fills the cache for the default view (30 days, all projects); throws when Langfuse fails. */
export async function warm(): Promise<void> {
  const res = await cached(new URL("http://localhost/api/skills"), summary);
  if (!res.ok) throw new Error(`skills warm-up: ${res.status} ${await res.text()}`);
}

async function cached(url: URL, make: (a: Analysis) => unknown | null): Promise<Response> {
  const d = Number(url.searchParams.get("days"));
  const days = d > 0 ? Math.min(Math.floor(d), 365) : 30;
  const project = url.searchParams.get("project") || null;
  const key = `${process.env.LANGFUSE_BASE_URL}\0${days}\0${project}`;
  let a: Analysis;
  try { a = await cache.get(key, TTL, () => analyse(days, project)); }
  catch (e) { return Response.json({ error: `Langfuse failed: ${(e as Error).message}` }, { status: 502 }); }
  const value = make(a);
  return value ? Response.json(value) : new Response("no such skill", { status: 404 });
}

export const routes: Routes = {
  "GET /api/skills": (_req, _p, url) => cached(url, summary),
  "GET /api/skills/:name": (_req, p, url) => cached(url, (a) => {
    const d = detail(a, p.name);
    return d.uses || folders().includes(short(p.name)) ? d : null;
  }),
};
