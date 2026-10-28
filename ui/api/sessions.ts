/** `/api/sessions`, `/api/sessions/:id`, `/api/sessions/:id/turns/:n`: the Sessions views' data, from Langfuse. */
import { basename } from "node:path";
import { LangfuseError, config, observations, traces } from "../langfuse.ts";
import type { Routes } from "../server.ts";

const line = (s: unknown, max: number) => {
  const t = typeof s === "string" ? s : s == null ? "" : JSON.stringify(s);
  const one = t.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max) + "…" : one;
};
const cut = (s: unknown, max: number) => {
  const t = typeof s === "string" ? s : s == null ? "" : JSON.stringify(s);
  return t.length > max ? t.slice(0, max) + "…" : t;
};
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
      const sessions = [...groups].map(([id, ts]) => {
        ts.sort(byTime);
        return {
          id,
          project: projectOf(ts[0]),
          firstPrompt: line(ts[0].input, 160),
          turns: ts.length,
          start: ts[0].timestamp,
          last: ts[ts.length - 1].timestamp,
          cost: ts.reduce((n, t) => n + (t.totalCost ?? 0), 0),
          taskTypes: taskTypes(ts),
        };
      }).sort((a, b) => ms(b.last) - ms(a.last));
      return Response.json({ base: cfg.baseUrl, sessions });
    } catch (e) { return fail(e); }
  },

  "GET /api/sessions/:id": async (_req, params, url) => {
    try {
      const { cfg, ts } = await sessionTraces(params.id, url.searchParams.get("project") || null);
      if (!ts.length) return Response.json({ error: `No session ${params.id}` }, { status: 404 });
      const all = await Promise.all(ts.map((t) => observations(cfg, t.id)));
      const turns = ts.map((t, i) => ({
        n: i + 1,
        traceId: t.id,
        start: t.timestamp,
        prompt: line(t.input, 300),
        output: cut(t.output, 400),
        tools: all[i].filter((o) => isType(o, "tool")).length,
        durationMs: durationMs(t),
        cost: t.totalCost ?? 0,
        model: modelOf(all[i]),
      }));
      return Response.json({ base: cfg.baseUrl, id: params.id, project: projectOf(ts[0]), taskTypes: taskTypes(ts), turns });
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
      const roots: any[] = [];
      for (const o of obs) {
        const parent = o.parentObservationId ? nodes.get(o.parentObservationId) : undefined;
        (parent ? parent.children : roots).push(nodes.get(o.id));
      }
      // The turn span is the tree's root; show its children as the top level.
      const top = roots.length === 1 && roots[0].name === "turn" ? roots[0].children : roots;
      return Response.json({
        base: cfg.baseUrl, id: params.id, n, total: ts.length, traceId: t.id, project: projectOf(t), start: t.timestamp,
        prompt: cut(t.input, 400), output: cut(t.output, 400), cost: t.totalCost ?? 0, durationMs: durationMs(t), observations: top,
      });
    } catch (e) { return fail(e); }
  },
};
