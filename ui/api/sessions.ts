/** `/api/sessions`, `/api/sessions/:id`, `/api/sessions/:id/turns/:n`: the Sessions views' data, from Langfuse. */
import { basename } from "node:path";
import { LangfuseError, config, observations, traces } from "../langfuse.ts";
import { allRuns, loadRegistry } from "../../jobs/lib/ledger.ts";
import type { Routes } from "../server.ts";
import { currentFit, share } from "../usage.ts";
// @ts-ignore plain JS, shared with the page
import { systemParts } from "../lib.js";

const line = (s: unknown, max: number) => {
  const t = typeof s === "string" ? s : s == null ? "" : JSON.stringify(s);
  const one = t.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max) + "…" : one;
};
const cut = (s: unknown, max: number) => {
  const t = typeof s === "string" ? s : s == null ? "" : JSON.stringify(s);
  return t.length > max ? t.slice(0, max) + "…" : t;
};
const text = (s: unknown) => (typeof s === "string" ? s : s == null ? "" : JSON.stringify(s));
const ms = (iso?: string) => Date.parse(iso ?? "") || 0;

/** A trace's project: its name, else the cwd's basename. */
const projectOf = (t: any): string => t.name || (t.metadata?.cwd ? basename(String(t.metadata.cwd)) : "");
const matches = (t: any, project: string | null) =>
  !project || projectOf(t) === project || (t.metadata?.cwd ? basename(String(t.metadata.cwd)) === project : false);

const taskTypes = (ts: any[]): string[] => {
  const out = new Set<string>();
  for (const t of ts) {
    if (typeof t.metadata?.task_type === "string") out.add(t.metadata.task_type);
    for (const tag of t.tags ?? []) if (String(tag).startsWith("task_type:")) out.add(String(tag).slice(10));
  }
  return [...out];
};

const byTime = (a: any, b: any) => ms(a.timestamp) - ms(b.timestamp);
const isType = (o: any, type: string) => String(o.type ?? "").toLowerCase() === type;

/** Job id → name and ledger cost (the sum over the job's runs), read once per request. */
function jobs(): Map<string, { name: string; cost: number; model?: string }> {
  const out = new Map<string, { name: string; cost: number; model?: string }>();
  for (const { run } of allRuns()) {
    if (!run.job) continue;
    const j = out.get(run.job) ?? { name: run.name, cost: 0 };
    j.cost += run.cost ?? 0;
    if (run.model) j.model = run.model;
    out.set(run.job, j);
  }
  return out;
}

/** `{ wk }` for a cost on a model, or nothing. */
const wkOf = (fit: Parameters<typeof share>[0], cost: number | undefined, model?: string | null) => {
  const wk = share(fit, cost, model ?? undefined);
  return wk ? { wk } : {};
};

const labelOf = (id: string) => { const j = jobs().get(id); return j ? { label: j.name } : {}; };

function fail(e: unknown): Response {
  if (e instanceof LangfuseError) return Response.json({ error: e.message }, { status: e.status });
  return Response.json({ error: (e as Error).message }, { status: 500 });
}

async function sessionTraces(id: string, project: string | null) {
  const cfg = config();
  const ts = (await traces(cfg, { sessionId: id })).filter((t) => t.sessionId === id || t.sessionId === undefined).sort(byTime);
  return { cfg, ts: ts.filter((t) => matches(t, project)) };
}

function modelOf(obs: any[]): string | null {
  const counts = new Map<string, number>();
  for (const o of obs) if (isType(o, "generation") && o.model) counts.set(o.model, (counts.get(o.model) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const durationMs = (o: any): number | null => {
  if (o.endTime && o.startTime) return Math.max(0, ms(o.endTime) - ms(o.startTime));
  return typeof o.latency === "number" ? Math.round(o.latency * 1000) : null; // Langfuse reports latency in seconds
};

/** The first prompt the user typed: system text (a `<task-notification>`, a `<system-reminder>`) skipped. */
const firstTyped = (ts: any[]) => ts.map((t) => systemParts(text(t.input)).text).find(Boolean) ?? text(ts[0]?.input);

/** A tool input as an object, when it is one or is JSON for one. */
function inputObject(input: unknown): Record<string, unknown> | null {
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>;
  if (typeof input !== "string") return null;
  try { const o = JSON.parse(input); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; }
}

const ARG_KEYS = ["command", "pattern", "file_path", "notebook_path", "url", "query", "skill", "description", "prompt", "path"];
/** A tool call's key argument on one line: `bun test ui` for Bash, the path for Read. A cut JSON input still yields its first key's string. */
export function argSummary(input: unknown, max = 100): string {
  const o = inputObject(input);
  if (o) {
    const key = ARG_KEYS.find((k) => typeof o[k] === "string" && o[k]) ?? Object.keys(o).find((k) => typeof o[k] === "string" && o[k]);
    return key ? line(o[key], max) : line(o, max);
  }
  const s = text(input);
  for (const k of ARG_KEYS) {
    const m = s.match(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`));
    if (m) { try { return line(JSON.parse(`"${m[1]}"`), max); } catch { return line(m[1], max); } }
  }
  return line(s, max);
}
const pretty = (input: unknown) => { const o = inputObject(input); return o ? JSON.stringify(o, null, 2) : text(input); };

/**
 * Each subagent's `agent` span paired with the `Agent` tool span that launched it (hooks/obs.ts writes it as the tool span's sibling): agent span id → tool span id.
 * The agent span lies inside the tool span in time; of several overlapping calls, the one whose `subagent_type` (default `general-purpose`) is the agent_type wins.
 */
export function pairAgents(obs: any[]): Map<string, string> {
  const tools = obs.filter((o) => isType(o, "tool") && o.name === "Agent");
  const taken = new Set<string>();
  const out = new Map<string, string>();
  const agents = obs.filter((o) => isType(o, "agent") && o.name !== "turn").sort((a, b) => ms(a.startTime) - ms(b.startTime));
  for (const a of agents) {
    const from = ms(a.startTime), to = a.endTime ? ms(a.endTime) : from;
    const type = a.metadata?.agent_type ?? a.name;
    const inside = tools.filter((t) => !taken.has(t.id) && ms(t.startTime) <= from && (!t.endTime || to <= ms(t.endTime)));
    const subtype = (t: any) => { const v = inputObject(t.input)?.subagent_type; return typeof v === "string" && v ? v : "general-purpose"; };
    const best = inside.find((t) => subtype(t) === type) ?? inside[0];
    if (!best) continue;
    taken.add(best.id);
    out.set(a.id, best.id);
  }
  return out;
}

/** A turn's tool calls in start order; a subagent's calls nest under the `Agent` call that launched it, and those of an unpaired subagent are left to the turn page. */
function toolCalls(obs: any[]) {
  const agents = new Set(obs.filter((o) => isType(o, "agent") && o.name !== "turn").map((o) => o.id));
  const spanOf = new Map([...pairAgents(obs)].map(([a, t]) => [t, a]));
  const call = (o: any): any => ({
    name: o.name, start: o.startTime, args: argSummary(o.input), input: pretty(o.input), output: text(o.output),
    error: o.level === "ERROR" ? o.statusMessage || "error" : null, durationMs: durationMs(o),
    children: spanOf.has(o.id) ? list((p) => p === spanOf.get(o.id)) : [],
  });
  const list = (under: (parent: string | undefined) => boolean) =>
    obs.filter((o) => isType(o, "tool") && under(o.parentObservationId)).sort((a, b) => ms(a.startTime) - ms(b.startTime)).map(call);
  return list((p) => !agents.has(p as string));
}

/** A turn's assistant text blocks (hooks/obs.ts writes each as an event named `text`) in time order; the final reply, which the turn's output already holds, is left out. */
function textBlocks(obs: any[], output: string) {
  return obs.filter((o) => isType(o, "event") && o.name === "text" && text(o.output).trim())
    .sort((a, b) => ms(a.startTime) - ms(b.startTime) || (a.metadata?.seq ?? 0) - (b.metadata?.seq ?? 0))
    .map((o) => ({ at: o.startTime, text: text(o.output) }))
    .filter((t) => t.text.trim() !== output.trim());
}

export const routes: Routes = {
  "GET /api/sessions": async (_req, _p, url) => {
    const days = Number(url.searchParams.get("days") ?? 7);
    const project = url.searchParams.get("project") || null;
    try {
      const cfg = config();
      const hour = 3600_000; // whole hours, so the cache key holds
      const from = new Date(Math.floor((Date.now() - (days > 0 ? days : 7) * 86400_000) / hour) * hour).toISOString();
      const all = (await traces(cfg, { fromTimestamp: from })).filter((t) => t.sessionId && matches(t, project));
      const groups = new Map<string, any[]>();
      for (const t of all) groups.set(t.sessionId, [...(groups.get(t.sessionId) ?? []), t]);
      const ledger = jobs();
      const fit = await currentFit().catch(() => null);
      const sessions = [...groups].map(([id, ts]) => {
        ts.sort(byTime);
        const job = ledger.get(id);
        const langfuse = ts.reduce((n, t) => n + (t.totalCost ?? 0), 0);
        const wk = share(fit, langfuse || job?.cost || 0, job?.model);
        return {
          ...(wk ? { wk } : {}),
          id,
          ...(job ? { label: job.name } : {}),
          project: projectOf(ts[0]),
          firstPrompt: line(firstTyped(ts), 160),
          turns: ts.length,
          start: ts[0].timestamp,
          last: ts[ts.length - 1].timestamp,
          cost: langfuse || job?.cost || 0,
          taskTypes: taskTypes(ts),
        };
      }).sort((a, b) => ms(b.last) - ms(a.last));
      return Response.json({ base: cfg.baseUrl, projects: Object.keys(loadRegistry()).sort(), sessions });
    } catch (e) { return fail(e); }
  },

  "GET /api/sessions/:id": async (_req, params, url) => {
    try {
      const { cfg, ts } = await sessionTraces(params.id, url.searchParams.get("project") || null);
      if (!ts.length) return Response.json({ error: `No session ${params.id}` }, { status: 404 });
      const all = await Promise.all(ts.map((t) => observations(cfg, t.id)));
      const fit = await currentFit().catch(() => null);
      const turns = ts.map((t, i) => ({
        n: i + 1,
        ...wkOf(fit, t.totalCost, modelOf(all[i])),
        traceId: t.id,
        start: t.timestamp,
        prompt: line(t.input, 300),
        output: cut(t.output, 400),
        tools: all[i].filter((o) => isType(o, "tool")).length,
        durationMs: durationMs(t),
        cost: t.totalCost ?? 0,
        model: modelOf(all[i]),
      }));
      return Response.json({ base: cfg.baseUrl, id: params.id, ...labelOf(params.id), project: projectOf(ts[0]), taskTypes: taskTypes(ts), turns });
    } catch (e) { return fail(e); }
  },

  "GET /api/sessions/:id/chat": async (_req, params, url) => {
    try {
      const { cfg, ts } = await sessionTraces(params.id, url.searchParams.get("project") || null);
      if (!ts.length) return Response.json({ error: `No session ${params.id}` }, { status: 404 });
      const from = Math.max(1, Math.floor(Number(url.searchParams.get("from")) || 1));
      const limit = Math.min(50, Math.max(1, Math.floor(Number(url.searchParams.get("limit")) || 20)));
      const page = ts.slice(from - 1, from - 1 + limit);
      const all = await Promise.all(page.map((t) => observations(cfg, t.id)));
      const fit = await currentFit().catch(() => null);
      const turns = page.map((t, i) => ({
        n: from + i,
        ...wkOf(fit, t.totalCost, modelOf(all[i])),
        traceId: t.id,
        start: t.timestamp,
        prompt: text(t.input),
        output: text(t.output),
        model: modelOf(all[i]),
        durationMs: durationMs(t),
        cost: t.totalCost ?? 0,
        tools: toolCalls(all[i]),
        texts: textBlocks(all[i], text(t.output)),
      }));
      // A factory worker's session is one turn Langfuse prices at 0; the ledger has its cost, as on the list.
      const job = jobs().get(params.id);
      if (ts.length === 1 && turns.length === 1 && !turns[0].cost && job?.cost) Object.assign(turns[0], { cost: job.cost }, wkOf(fit, job.cost, job.model));
      return Response.json({ base: cfg.baseUrl, id: params.id, ...labelOf(params.id), project: projectOf(ts[0]), taskTypes: taskTypes(ts), total: ts.length, from, turns });
    } catch (e) { return fail(e); }
  },

  "GET /api/sessions/:id/turns/:n": async (_req, params, url) => {
    try {
      const { cfg, ts } = await sessionTraces(params.id, url.searchParams.get("project") || null);
      const n = Number(params.n);
      const t = Number.isInteger(n) ? ts[n - 1] : undefined;
      if (!t) return Response.json({ error: `No turn ${params.n} in session ${params.id}` }, { status: 404 });
      const obs = (await observations(cfg, t.id)).sort((a, b) => ms(a.startTime) - ms(b.startTime));
      const node = (o: any) => {
        const m = o.metadata ?? {};
        const kind = isType(o, "tool") ? "tool" : isType(o, "guardrail") || o.name === "verify-gate" || o.name === "vault-recall" ? "hook" : isType(o, "agent") ? "subagent" : isType(o, "generation") ? "generation" : "event";
        const out: Record<string, unknown> = {
          id: o.id, kind, name: o.name, input: cut(o.input, 400), output: cut(o.output, 400),
          durationMs: durationMs(o), error: o.level === "ERROR" ? o.statusMessage || "error" : null, children: [] as unknown[],
        };
        if (o.name === "vault-recall") out.recall = { candidates: m.candidates ?? null, asked: m.asked ?? null, kept: m.kept ?? null };
        if (o.name === "verify-gate") out.verify = { kind: m.kind ?? null, verdict: m.verdict ?? null };
        if (kind === "generation") out.model = o.model ?? null;
        return out as any;
      };
      const nodes = new Map<string, any>(obs.map((o) => [o.id, node(o)]));
      const paired = pairAgents(obs); // a subagent hangs off its `Agent` tool span, not off the turn
      const roots: any[] = [];
      for (const o of obs) {
        const pid = paired.get(o.id) ?? o.parentObservationId;
        const parent = pid ? nodes.get(pid) : undefined;
        (parent ? parent.children : roots).push(nodes.get(o.id));
      }
      // The turn span is the tree's root; show its children as the top level.
      const top = roots.length === 1 && roots[0].name === "turn" ? roots[0].children : roots;
      return Response.json({
        ...wkOf(await currentFit().catch(() => null), t.totalCost, modelOf(obs)),
        base: cfg.baseUrl, id: params.id, ...labelOf(params.id), n, total: ts.length, traceId: t.id, project: projectOf(t), start: t.timestamp,
        prompt: cut(t.input, 400), output: cut(t.output, 400), cost: t.totalCost ?? 0, durationMs: durationMs(t), observations: top,
      });
    } catch (e) { return fail(e); }
  },
};
