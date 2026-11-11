/** `/api/sessions`, `/api/sessions/:id`, `/api/sessions/:id/turns/:n`: the Sessions views' data, from Langfuse. */
import { clip } from "../../lib/naming.ts";
import { LangfuseError, need, type Langfuse } from "../../lib/langfuse.ts";
import { list } from "../langfuse.ts";
import { allRuns, loadRegistry } from "../../jobs/lib/records/ledger.ts";
import { projectOf as projectOfUrl, scopeOf, traceIn, traceProject } from "./scope.ts";
import { SESSIONS } from "../../lib/windows.ts";
import type { Routes } from "../server.ts";
import { currentFit, share } from "../usage.ts";
// @ts-ignore plain JS, shared with the page
import { systemParts } from "../system-parts.js";

const cut = (s: unknown, max: number) => {
  const t = typeof s === "string" ? s : s == null ? "" : JSON.stringify(s);
  return t.length > max ? t.slice(0, max) + "…" : t;
};
const text = (s: unknown) => (typeof s === "string" ? s : s == null ? "" : JSON.stringify(s));
const ms = (iso?: string) => Date.parse(iso ?? "") || 0;

/** A trace's project, by the rule that the Skills page uses too. */
const projectOf = (t: any): string => traceProject(t.metadata?.cwd, t.tags);

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
  const lf = need();
  const ts = (await list(lf, "traces", { session: id })).rows.filter((t) => t.sessionId === id || t.sessionId === undefined).sort(byTime);
  return { lf, ts: ts.filter((t) => traceIn(t, project)) };
}

const observationsOf = async (lf: Langfuse, trace: string) => (await list(lf, "observations", { trace })).rows;

function modelOf(obs: any[]): string | null {
  const counts = new Map<string, number>();
  for (const o of obs) if (isType(o, "generation") && o.model) counts.set(o.model, (counts.get(o.model) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Seconds from ms. */
const sec = (n: number) => n / 1000;
/** An observation's or a trace's duration in seconds, or null. */
const secondsOf = (o: any): number | null => { const d = durationMs(o); return d === null ? null : sec(d); };

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
    return key ? clip(text(o[key]), max) : clip(text(o), max);
  }
  const s = text(input);
  for (const k of ARG_KEYS) {
    const m = s.match(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`));
    if (m) { try { return clip(text(JSON.parse(`"${m[1]}"`)), max); } catch { return clip(text(m[1]), max); } }
  }
  return clip(text(s), max);
}
const pretty = (input: unknown) => { const o = inputObject(input); return o ? JSON.stringify(o, null, 2) : text(input); };

/**
 * Each subagent's `agent` span paired with the `Agent` tool span that launched it (hooks/obs.ts writes it as the tool span's sibling): agent span id → tool span id.
 * The agent span lies inside the tool span in time; of several overlapping calls, the one whose `subagent_type` (default `general-purpose`) is the agent_type wins.
 */
function pairAgents(obs: any[]): Map<string, string> {
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
function toolCalls(obs: any[], t0: number) {
  const agents = new Set(obs.filter((o) => isType(o, "agent") && o.name !== "turn").map((o) => o.id));
  const spanOf = new Map([...pairAgents(obs)].map(([a, t]) => [t, a]));
  const call = (o: any, parent: string | null = null): any => ({
    id: o.id, parent, name: o.name, start: o.startTime, from: sec(Math.max(0, ms(o.startTime) - t0)), to: sec(Math.max(0, ms(o.startTime) - t0) + (durationMs(o) ?? 0)), args: argSummary(o.input), input: pretty(o.input), output: text(o.output),
    error: o.level === "ERROR" ? o.statusMessage || "error" : null, seconds: secondsOf(o),
    kind: spanOf.has(o.id) ? "subagent" : "tool",
    children: spanOf.has(o.id) ? list((p) => p === spanOf.get(o.id), o.id) : [],
  });
  const list = (under: (parent: string | undefined) => boolean, parent: string | null = null) =>
    obs.filter((o) => isType(o, "tool") && under(o.parentObservationId)).sort((a, b) => ms(a.startTime) - ms(b.startTime)).map((o) => call(o, parent));
  return list((p) => !agents.has(p as string));
}

/** A turn's model calls (GENERATION observations) in start order, apart from the tool calls; one in a paired subagent has the `Agent` call's id as parent, one in an unpaired subagent is left out. */
function generations(obs: any[], t0: number) {
  const agents = new Set(obs.filter((o) => isType(o, "agent") && o.name !== "turn").map((o) => o.id));
  const spanTool = pairAgents(obs);
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return obs.filter((o) => isType(o, "generation") && (!agents.has(o.parentObservationId) || spanTool.has(o.parentObservationId)))
    .sort((a, b) => ms(a.startTime) - ms(b.startTime))
    .map((o) => {
      const startMs = Math.max(0, ms(o.startTime) - t0), durMs = durationMs(o);
      return {
        id: o.id, parent: agents.has(o.parentObservationId) ? spanTool.get(o.parentObservationId)! : null, kind: "generation", name: o.name, model: o.model ?? null,
        start: o.startTime, from: sec(startMs), to: sec(startMs + (durMs ?? 0)), seconds: durMs === null ? null : sec(durMs),
        cost: num(o.calculatedTotalCost) ?? num(o.totalCost), inputTokens: num(o.usage?.input ?? o.usageDetails?.input), outputTokens: num(o.usage?.output ?? o.usageDetails?.output),
        error: o.level === "ERROR" ? o.statusMessage || "error" : null, input: cut(o.input, 400), output: cut(o.output, 400),
      };
    });
}

/** A turn's assistant text blocks (hooks/obs.ts writes each as an event named `text`) in time order; the final reply, which the turn's output already holds, is left out. */
function textBlocks(obs: any[], output: string) {
  return obs.filter((o) => isType(o, "event") && o.name === "text" && text(o.output).trim())
    .sort((a, b) => ms(a.startTime) - ms(b.startTime) || (a.metadata?.seq ?? 0) - (b.metadata?.seq ?? 0))
    .map((o) => ({ at: o.startTime, text: text(o.output) }))
    .filter((t) => t.text.trim() !== output.trim());
}

/** The traces with a session over the last `days` days, at most 90 (the widest window the page offers), and whether Langfuse held more pages than the read. */
export async function windowTraces(days: number, project: string | null): Promise<{ rows: any[]; partial: boolean }> {
  const hour = 3600_000; // whole hours, so the cache key holds
  const from = new Date(Math.floor((Date.now() - Math.min(days > 0 ? days : 7, 90) * 86400_000) / hour) * hour);
  const { rows, partial } = await list(need(), "traces", { from });
  return { rows: rows.filter((t) => t.sessionId && traceIn(t, project)), partial };
}

const LIMIT = 100, MAX = 2000;

/** One row per session of `traces`, newest last turn first: a factory worker's session has its job's name, and its ledger cost when Langfuse prices it at 0. */
export async function sessionRows(traces: any[]) {
  const groups = new Map<string, any[]>();
  for (const t of traces) groups.set(t.sessionId, [...(groups.get(t.sessionId) ?? []), t]);
  const ledger = jobs();
  const fit = await currentFit().catch(() => null);
  return [...groups].map(([id, ts]) => {
    ts.sort(byTime);
    const job = ledger.get(id);
    const langfuse = ts.reduce((n, t) => n + (t.totalCost ?? 0), 0);
    const wk = share(fit, langfuse || job?.cost || 0, job?.model);
    return {
      ...(wk ? { wk } : {}),
      id,
      ...(job ? { label: job.name } : {}),
      project: projectOf(ts[0]),
      firstPrompt: clip(text(firstTyped(ts)), 160),
      turns: ts.length,
      start: ts[0].timestamp as string,
      last: ts[ts.length - 1].timestamp as string,
      cost: langfuse || job?.cost || 0,
      taskTypes: taskTypes(ts),
    };
  }).sort((a, b) => ms(b.last) - ms(a.last));
}

/** The fields of turn `i` that the session and chat views share. A factory worker's session is one turn Langfuse prices at 0: it has the ledger's cost, as on the list. */
function turnOf(id: string, ts: any[], i: number, obs: any[], fit: Parameters<typeof share>[0]) {
  const t = ts[i], job = ts.length === 1 && !t.totalCost ? jobs().get(id) : undefined;
  const model = modelOf(obs), cost = t.totalCost || job?.cost || 0;
  return { n: i + 1, ...wkOf(fit, cost, job?.cost ? job.model : model), traceId: t.id, start: t.timestamp, model, seconds: secondsOf(t), cost };
}

/** The sessions of a window for the Agents view: newest last turn first, `?limit=` of them before the `?before=` time, and `next`, the `before` of the next page. A bad query or a Langfuse failure throws its message. */
export async function listSessions(req: Request) {
  const url = new URL(req.url);
  const sc = scopeOf(url, "week", SESSIONS);
  if (sc instanceof Response) throw new Error(((await sc.json()) as any).error);
  const { days, project } = sc;
  const limit = Number(url.searchParams.get("limit") ?? LIMIT), before = url.searchParams.get("before");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX) throw new Error(`limit must be 1 to ${MAX}`);
  if (before !== null && Number.isNaN(Date.parse(before))) throw new Error("before must be an ISO time");
  const lf = need();
  const { rows: all, partial } = await windowTraces(days, project);
  const sessions = (await sessionRows(all)).filter((x) => before === null || ms(x.last) < Date.parse(before));
  const page = sessions.slice(0, limit), next = sessions.length > limit ? page.at(-1)!.last : null;
  return { base: lf.base, projects: Object.keys(loadRegistry()).sort(), sessions: page, next, partial };
}

export const routes: Routes = {
  "GET /api/sessions/:id": async (_req, params, url) => {
    try {
      const { lf, ts } = await sessionTraces(params.id, projectOfUrl(url));
      if (!ts.length) return Response.json({ error: `No session ${params.id}` }, { status: 404 });
      const all = await Promise.all(ts.map((t) => observationsOf(lf, t.id)));
      const fit = await currentFit().catch(() => null);
      const turns = ts.map((t, i) => ({
        ...turnOf(params.id, ts, i, all[i], fit),
        prompt: clip(text(t.input), 300),
        output: cut(t.output, 400),
        tools: all[i].filter((o) => isType(o, "tool")).length,
      }));
      return Response.json({ base: lf.base, id: params.id, ...labelOf(params.id), project: projectOf(ts[0]), taskTypes: taskTypes(ts), turns });
    } catch (e) { return fail(e); }
  },

  "GET /api/sessions/:id/chat": async (_req, params, url) => {
    try {
      const { lf, ts } = await sessionTraces(params.id, projectOfUrl(url));
      if (!ts.length) return Response.json({ error: `No session ${params.id}` }, { status: 404 });
      const from = Math.max(1, Math.floor(Number(url.searchParams.get("from")) || 1));
      const limit = Math.min(50, Math.max(1, Math.floor(Number(url.searchParams.get("limit")) || 20)));
      const page = ts.slice(from - 1, from - 1 + limit);
      const all = await Promise.all(page.map((t) => observationsOf(lf, t.id)));
      const fit = await currentFit().catch(() => null);
      const t0 = ms(ts[0].timestamp); // the waterfall's axis starts at the session's first turn
      const turns = page.map((t, i) => ({
        ...turnOf(params.id, ts, from - 1 + i, all[i], fit),
        from: sec(Math.max(0, ms(t.timestamp) - t0)),
        to: sec(Math.max(0, ms(t.timestamp) - t0) + (durationMs(t) ?? 0)),
        prompt: text(t.input),
        output: text(t.output),
        tools: toolCalls(all[i], t0),
        generations: generations(all[i], t0),
        texts: textBlocks(all[i], text(t.output)),
      }));
      return Response.json({ base: lf.base, id: params.id, ...labelOf(params.id), project: projectOf(ts[0]), taskTypes: taskTypes(ts), total: ts.length, from, turns });
    } catch (e) { return fail(e); }
  },

  "GET /api/sessions/:id/turns/:n": async (_req, params, url) => {
    try {
      const { lf, ts } = await sessionTraces(params.id, projectOfUrl(url));
      const n = Number(params.n);
      const t = Number.isInteger(n) ? ts[n - 1] : undefined;
      if (!t) return Response.json({ error: `No turn ${params.n} in session ${params.id}` }, { status: 404 });
      const obs = (await observationsOf(lf, t.id)).sort((a, b) => ms(a.startTime) - ms(b.startTime));
      const node = (o: any) => {
        const m = o.metadata ?? {};
        const kind = isType(o, "tool") ? "tool" : isType(o, "guardrail") || o.name === "verify-gate" || o.name === "vault-recall" ? "hook" : isType(o, "agent") ? "subagent" : isType(o, "generation") ? "generation" : "event";
        const out: Record<string, unknown> = {
          id: o.id, kind, name: o.name, input: cut(o.input, 400), output: cut(o.output, 400),
          seconds: secondsOf(o), error: o.level === "ERROR" ? o.statusMessage || "error" : null, children: [] as unknown[],
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
        base: lf.base, id: params.id, ...labelOf(params.id), n, total: ts.length, traceId: t.id, project: projectOf(t), start: t.timestamp,
        prompt: cut(t.input, 400), output: cut(t.output, 400), cost: t.totalCost ?? 0, seconds: secondsOf(t), observations: top,
      });
    } catch (e) { return fail(e); }
  },
};
