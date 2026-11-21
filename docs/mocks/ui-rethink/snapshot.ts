// Reads the live UI API and writes data.json, the rows and numbers the mock draws.
// Run: bun docs/mocks/ui-rethink/snapshot.ts [base URL]
import { buckets, DAY, quantile } from "../../../lib/windows.ts";
import { CLOSED, setCodes, shortId, shownId } from "../../../lib/naming.ts";

const BASE = process.argv[2] ?? "http://127.0.0.1:3020";
const NOW = Date.now(), WEEK = buckets("week", NOW), PRIOR = buckets("week", WEEK.since - 1);
const get = async (path: string) => {
  const res = await fetch(BASE + path, { headers: { "X-Aleph-UI": "1" } });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json();
};
const ms = (iso?: string | null) => Date.parse(iso ?? "") || 0;
const within = (b: { since: number; until: number }) => (iso?: string | null) => ms(iso) >= b.since && ms(iso) < b.until;
const tally = <T>(rows: T[], key: (r: T) => string) => Object.fromEntries([...Map.groupBy(rows, key)].map(([k, xs]) => [k, xs.length]));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

setCodes(Object.fromEntries(Object.entries(await get("/api/projects")).filter(([, p]: [string, any]) => p.code).map(([k, p]: [string, any]) => [k, p.code])));

// ---------- Issues ----------
const all = (await get("/api/issues")).issues as any[];
const sid = (r: any) => shortId(`${r.repo}-${r.ref}`);
const detail = async (r: any) => {
  const d = await get(`/api/issues/${encodeURIComponent(sid(r))}`);
  return { request: d.request, spec: d.spec, note: d.notes.at(-1) ?? null, noteCount: d.notes.length, runs: d.timeline.runs.map((x: any) => ({ kind: x.kind, state: x.state, model: x.model, cost: x.cost, secs: (ms(x.ended) - ms(x.started)) / 1000, started: x.started, reason: x.reason })), specs: d.specs.length };
};
const row = (r: any) => ({ id: sid(r), repo: r.repo, title: r.title, status: r.status, stage: r.stage, priority: r.priority, kind: r.kind, source: r.source, labels: r.labels, notes: r.notes, runs: r.runs, cost: r.cost, created: r.createdTime, closed: r.closedTime, updated: r.updatedTime, parent: r.parent });
const byUpdate = (a: any, b: any) => ms(b.updatedTime) - ms(a.updatedTime);
const active = all.filter((r) => !CLOSED.includes(r.status)).sort(byUpdate);
const closed = all.filter((r) => CLOSED.includes(r.status)).sort(byUpdate).slice(0, 40);
const spans = (rows: any[], inside: (iso?: string | null) => boolean) => rows.filter((r) => CLOSED.includes(r.status) && !r.everParked && inside(r.closedTime) && ms(r.createdTime)).map((r) => (ms(r.closedTime) - ms(r.createdTime)) / 1000);
const inWeek = within(WEEK), inPrior = within(PRIOR);
const days = WEEK.starts.map((at) => ({
  at,
  filed: all.filter((r) => WEEK.slotOf(ms(r.createdTime)) === WEEK.starts.indexOf(at)).length,
  closed: all.filter((r) => CLOSED.includes(r.status) && WEEK.slotOf(ms(r.closedTime)) === WEEK.starts.indexOf(at)).length,
  backlog: all.filter((r) => ms(r.createdTime) && ms(r.createdTime) <= at && (!ms(r.closedTime) || at < ms(r.closedTime))).length,
  source: tally(all.filter((r) => WEEK.slotOf(ms(r.createdTime)) === WEEK.starts.indexOf(at)), (r) => r.source),
}));
const kinds = [...Map.groupBy(all.filter((r) => CLOSED.includes(r.status) && inWeek(r.closedTime)), (r) => r.kind)].map(([kind, xs]) => {
  const s = spans(xs, inWeek);
  return { kind, closed: xs.length, dropped: xs.filter((r) => r.status === "dropped").length, p50: quantile(s, 0.5), p90: quantile(s, 0.9) };
}).sort((a, b) => b.closed - a.closed);
const issues = {
  total: all.length, counts: tally(all, (r) => r.status),
  filed: all.filter((r) => inWeek(r.createdTime)).length, closedWeek: all.filter((r) => CLOSED.includes(r.status) && inWeek(r.closedTime)).length,
  droppedWeek: all.filter((r) => r.status === "dropped" && inWeek(r.closedTime)).length,
  p50: quantile(spans(all, inWeek), 0.5), p90: quantile(spans(all, inWeek), 0.9), p50Before: quantile(spans(all, inPrior), 0.5),
  sources: tally(all.filter((r) => inWeek(r.createdTime)), (r) => r.source),
  days, kinds,
  active: await Promise.all(active.map(async (r) => ({ ...row(r), ...(await detail(r)) }))),
  closed: await Promise.all(closed.map(async (r, i) => ({ ...row(r), ...(i < 12 ? await detail(r) : {}) }))),
};

// ---------- Jobs ----------
const runs = (await get("/api/jobs?window=week&limit=2000")).jobs as any[];
const flow = await get("/api/flow?window=week");
const factory = await get("/api/factory?window=week");
const run = (j: any) => ({ id: j.id, kind: j.kind, state: j.state, model: j.model, secs: j.seconds, cost: j.cost, started: j.started });
const grouped = [...Map.groupBy(runs.filter((j) => j.issue), (j) => j.issue)].map(([issue, xs]) => {
  const rs = [...xs].sort((a, b) => ms(a.started) - ms(b.started));
  return { id: shownId(issue, rs[0].repo || "aleph"), key: issue, title: rs.at(-1).title, repo: rs[0].repo, runs: rs.map(run), last: rs.at(-1).started, cost: sum(rs.map((j) => j.cost ?? 0)), secs: sum(rs.map((j) => j.seconds ?? 0)) };
}).sort((a, b) => ms(b.last) - ms(a.last));
const system = runs.filter((j) => !j.issue).slice(0, 30).map((j) => ({ ...run(j), name: j.name }));
const builds = flow.builds as any[];
const byModel = [...Map.groupBy(builds, (b) => b.model)].map(([model, xs]) => {
  const per = [...Map.groupBy(xs.filter((b) => b.issue), (b) => b.issue).values()];
  const landed = per.filter((x) => x[0].landed).map((x) => sum(x.map((b) => b.secs)));
  return { model, runs: xs.length, p50: quantile(xs.map((b) => b.secs), 0.5), p90: quantile(xs.map((b) => b.secs), 0.9), retried: per.length ? per.filter((x) => x.length > 1).length / per.length : null, perLanded: landed.length >= 20 ? quantile(landed, 0.5) : null };
}).sort((a, b) => b.runs - a.runs);
const landedTimes = (flow.times as any[]).filter((t) => t.outcome === "landed" && t.lead > 0);
const bySize = ["small", "medium", "large", null].map((size) => {
  const xs = landedTimes.filter((t) => t.size === size).map((t) => t.lead);
  return { size, issues: xs.length, p50: quantile(xs, 0.5), p90: quantile(xs, 0.9) };
});
const STAGE_KEYS = ["intake", "queue", "implement", "land"];
const slowest = (flow.times as any[]).flatMap((t) => STAGE_KEYS.filter((k) => t[k] > 0).map((k) => ({ id: shortId(t.id), stage: k, secs: t[k] }))).sort((a, b) => b.secs - a.secs).slice(0, 10);
const jobs = {
  live: factory.factory.liveRuns, liveCap: factory.factory.liveCap, queued: factory.queued.length, runsToday: factory.factory.runsToday, costToday: factory.factory.costToday,
  states: tally(runs, (j) => j.state), total: runs.length,
  landed: flow.issues.landed, firstPass: flow.issues.firstPass, wait: flow.wait, lost: flow.lost, phases: flow.phases,
  days: flow.buckets.map((b: any) => ({ at: ms(b.at), p50: b.lead, p90: b.p90.lead, runs: b.runs })),
  classes: flow.classes.map((c: any) => ({ key: c.key, lost: c.lost, hours: c.hours, runs: c.runs, issues: c.issues, causes: c.causes.map((x: any) => ({ name: x.name, hours: x.hours, runs: x.runs })) })),
  checks: flow.checks, byModel, bySize, slowest,
  grouped: grouped.slice(0, 45), groups: grouped.length, system,
};

// ---------- Agents ----------
const models = await get("/api/models");
const usage = factory.usage;
const agents = {
  usage: { used: usage.now.seven_day, resets: usage.now.seven_day_resets_at, series: usage.series.filter((_: any, i: number) => i % 12 === 0).map((p: any) => ({ at: ms(p.at), used: p.seven_day })) },
  rates: flow.agents.rates, live: flow.agents.live, cap: flow.agents.cap, peak: flow.agents.peak, mean: flow.agents.mean,
  roles: flow.agents.roles.map((r: any) => ({ key: r.key, name: r.name, runs: r.runs, hours: r.hours })),
  outcomes: flow.agents.outcomes, models,
  days: flow.buckets.map((b: any) => ({ at: ms(b.at), cost: b.cost, tokens: b.tokens })),
};

// ---------- Automation ----------
const auto = await get("/api/automation?window=week");
const automation = {
  metrics: auto.metrics, backend: auto.backend ?? null, baseline: auto.baseline, schedules: auto.schedules, monitor: auto.monitor,
  rules: auto.rules, held: auto.held, repoHeld: auto.repoHeld,
  caps: { live: factory.factory.liveCap, liveNow: factory.factory.liveRuns, run: factory.factory.runCap, runNow: factory.factory.runStarts ?? 0, ...auto.settings },
  logTotal: auto.log.entries.length, actors: tally(auto.log.entries, (e: any) => (/^job\./.test(e.subject) ? "job" : e.subject)),
  log: auto.log.entries.slice(0, 70).map((e: any) => ({ time: e.time, subject: e.subject, action: e.action, object: shownId(e.object, e.project), detail: e.detail })),
};

// ---------- Sessions ----------
const sess = await get("/api/sessions?window=week&limit=2000");
const FACTORY = /^(You (are|take|read) |# Merge origin|Task: |## Code-change method)/, SCRIPT = /^(Below (are|is) |This is one month|Each item is |These are monthly|- reply with only|Answer from your|Quote the line|Reply with |<agent-message|<task-notification|\[From the bridge)/;
const who = (s: any) => (FACTORY.test(s.firstPrompt ?? "") || /^issue\./.test(s.label ?? "") ? "factory" : SCRIPT.test(s.firstPrompt ?? "") || !s.firstPrompt ? "headless" : "you");
const rows = (sess.sessions.sessions as any[]).map((s) => ({ id: s.id, label: s.label ?? null, project: s.project, prompt: (s.firstPrompt ?? "").slice(0, 400), turns: s.turns, cost: s.cost ?? 0, wk: s.wk?.pct ?? null, start: s.start, last: s.last, kinds: s.taskTypes, who: who(s) }));
const yours = rows.filter((s) => s.who === "you").sort((a, b) => ms(b.last) - ms(a.last));
const holds = (await get("/api/hooks?window=week")) as any;
const sessions = {
  stale: sess.sessions.since ?? null, total: rows.length,
  who: Object.fromEntries(["you", "factory", "headless"].map((w) => [w, { n: rows.filter((s) => s.who === w).length, cost: sum(rows.filter((s) => s.who === w).map((s) => s.cost)) }])),
  yours: await Promise.all(yours.slice(0, 40).map(async (s, i) => {
    if (i >= 10) return s;
    const d = await get(`/api/sessions/${s.id}`);
    return { ...s, turnList: d.turns.slice(0, 6).map((t: any) => ({ n: t.n, prompt: (t.prompt ?? "").slice(0, 220), secs: t.seconds, cost: t.cost, tools: t.tools, model: t.model })), holds: holds.holds.filter((h: any) => h.sid === s.id).length };
  })),
  factory: rows.filter((s) => s.who === "factory").sort((a, b) => b.cost - a.cost).slice(0, 12),
  tools: sess.activity.tools.map((t: any) => ({ name: t.name, calls: t.calls, errors: t.errors })),
  skills: sess.skills.skills.map((s: any) => ({ name: s.name, uses: s.uses, errors: s.errors, sessions: s.sessions })),
  unused: sess.skills.unused,
};

// ---------- Memory ----------
const mem = await get("/api/memory"), procs = await get("/api/memory/processes"), found = (await get("/api/memory/search?q=")).results as any[], mlog = (await get("/api/memory/log")).rows as any[];
const week = NOW - 7 * DAY;
const memory = {
  total: mem.total, kinds: tally(mem.notes, (n: any) => n.kind), types: tally(found, (r) => r.type),
  offered: mem.notes.filter((n: any) => ms(n.read) >= week).length, never: mem.notes.filter((n: any) => !n.read).length,
  start: Object.fromEntries(Object.entries(mem.start).map(([k, v]: [string, any]) => [k, { bytes: v.bytes, budget: v.budget, cut: v.cut, memory: v.memory, core: v.core.map((c: any) => ({ title: c.title, bytes: c.bytes, scope: c.scope, kept: c.kept })) }])),
  misses: mem.misses,
  lint: [...Map.groupBy([...mem.lint.refuse.map((l: any) => ({ ...l, refused: true })), ...mem.lint.warn], (l: any) => l.rule)].map(([rule, xs]) => ({ rule, n: xs.length, refused: !!xs[0].refused, notes: xs.slice(0, 4).map((x: any) => x.note) })),
  stale: procs.decay.stale.slice(0, 6), staleTotal: procs.decay.stale.length, steps: procs.steps,
  notes: Object.fromEntries(["semantic", "procedural", "episodic", "working"].map((t) => [t, found.filter((r) => r.type === t).slice(0, t === "semantic" ? 28 : 8).map((r) => ({ ...r, history: mem.notes.find((n: any) => n.title === r.key)?.history ?? null }))])),
  log: mlog.filter((r) => !/^(daily|episodes)\//.test(r.note ?? "")).slice(0, 40),
  writes: Array.from({ length: 14 }, (_, i) => { const at = new Date(NOW - (13 - i) * DAY).setHours(0, 0, 0, 0); return { at, writes: mlog.filter((r) => r.kind === "write" && ms(r.at) >= at && ms(r.at) < at + DAY).length, recalls: mlog.filter((r) => r.kind === "recall" && ms(r.at) >= at && ms(r.at) < at + DAY).length }; }),
};

// ---------- Hooks ----------
const hooks = {
  holds: holds.holds.length, outcomes: tally(holds.holds, (h: any) => h.out), who: tally(holds.holds, (h: any) => (h.who === "interactive" ? "interactive" : "workers")),
  byHook: holds.byHook, errors: holds.errors, inventory: holds.hooks.map((h: any) => ({ event: h.event, name: h.name, matcher: h.matcher, file: h.file, mode: h.mode, timeout: h.timeout, workers: h.workers, holds: h.holds, changed: h.changed && { t: h.changed.t, hash: h.changed.hash.slice(0, 8), subject: h.changed.subject } })),
  log: holds.holds.slice(0, 60).map((h: any) => ({ t: h.t, sid: h.sid.slice(0, 8), hook: h.hook, kind: h.kind, who: h.who, out: h.out, why: h.why.slice(0, 260) })),
  days: WEEK.starts.map((at, i) => ({ at, holds: holds.holds.filter((h: any) => WEEK.slotOf(ms(h.t)) === i).length })),
};

await Bun.write(new URL("data.json", import.meta.url), JSON.stringify({ at: new Date(NOW).toISOString(), issues, jobs, agents, automation, sessions, memory, hooks }));
console.log(`data.json: ${issues.active.length} active issues, ${jobs.grouped.length} jobs, ${sessions.yours.length} sessions, ${hooks.holds} holds`);
