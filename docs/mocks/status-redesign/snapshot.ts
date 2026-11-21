// Writes data.json: the numbers the Status redesign mocks draw. Run once against saved API answers:
//   bun docs/mocks/status-redesign/snapshot.ts <dir>
// <dir> holds /api/factory?window=week, /api/flow?window=week&baseline=1, /api/memory, /api/memory/processes,
// /api/automation?window=week and /api/issues as JSON, and events-week.json, the last 7 days of `readEvents()`
// (lib/layout.ts). The quiet state is the live state of QUIET; the busy state is the factory at BUSY, read back from
// the events.
const dir = process.argv[2];
const load = (n: string) => Bun.file(`${dir}/${n}.json`).json();
const [factory, flow, memory, processes, automation, issues, ev] = await Promise.all(
  ["factory_window_week", "flow_window_week_baseline_1", "memory", "memory_processes", "automation", "issues", "events-week"].map(load));

const BUSY = Date.parse("2026-11-20T19:05:00Z"), QUIET = Date.parse(factory.now);
const HOUR = 3_600_000, DAY = 24 * HOUR;
const titles = new Map<string, string>(issues.issues.filter((i: any) => i.repo === "aleph").map((i: any) => [`issue.${i.id}`, i.title]));
/** The Pacific day of a time, as 2026-11-20. */
const pday = (t: number) => new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

/** An event with the title of its issue. */
const row = (e: any) => ({
  at: e.time, by: e.subject_role ?? e.subject, action: e.action, object: e.object, role: e.object_role ?? null, target: e.object_target ?? null,
  title: titles.get(e.object_target ?? e.object) ?? null, detail: e.detail ?? null, model: e.model ?? null, cost: e.cost ?? null, started: e.started ?? null, ended: e.ended ?? null,
});

/** The jobs that ran in the `span` before `T`, one per job key: its role, issue, model, start, end, cost and last action. */
function jobs(T: number, span: number) {
  const out = new Map<string, any>();
  for (const e of ev) {
    if (Date.parse(e.time) > T || !String(e.object).startsWith("job.")) continue;
    const j = out.get(e.object) ?? { id: e.object, role: e.object_role, target: e.object_target, title: titles.get(e.object_target) ?? null };
    for (const k of ["started", "ended", "model"]) if (e[k]) j[k] = e[k];
    if (e.cost != null) j.cost = e.cost;
    if (e.action !== "running") j.last = e.action;
    out.set(e.object, j);
  }
  return [...out.values()].filter((j) => j.started && Date.parse(j.started) <= T && Date.parse(j.ended ?? j.started) >= T - span)
    .map((j) => ({ ...j, live: !j.ended || Date.parse(j.ended) > T, ended: j.ended && Date.parse(j.ended) <= T ? j.ended : null }));
}

/** The issues held at `T`: the latest `held` event of each, until a start or an end. A hold older than 6 hours is a parked issue. */
function held(T: number) {
  const out = new Map<string, any>();
  for (const e of ev) {
    if (Date.parse(e.time) > T) break;
    if (e.action === "held") out.set(e.object, e);
    else if (["started", "landed", "done", "dropped"].includes(e.action)) out.delete(e.object);
  }
  return [...out.values()].filter((e) => T - Date.parse(e.time) < 6 * HOUR).map((e) => ({ issue: e.object, title: titles.get(e.object) ?? null, at: e.time, detail: e.detail }));
}

/** The state at `T`: the jobs and events of the `span` before it, the issues held at it, the day's lands and the usage. `events` holds the newest 220 of `total`. */
function state(T: number, span: number) {
  const seen = ev.filter((e: any) => Date.parse(e.time) <= T && Date.parse(e.time) > T - span);
  return {
    now: new Date(T).toISOString(), span, jobs: jobs(T, span), held: held(T), events: seen.slice(-220).map(row), total: seen.length,
    landedToday: ev.filter((e: any) => e.action === "landed" && Date.parse(e.time) <= T && pday(Date.parse(e.time)) === pday(T)).length,
    usage: factory.usage.series.filter((p: any) => Date.parse(p.at) <= T).at(-1)?.seven_day ?? null,
  };
}

/** The issues landed on each Pacific day of the week before the live state, by land time. */
const days = Array.from({ length: 7 }, (_, i) => pday(QUIET - (6 - i) * DAY));
const landed = Object.fromEntries(days.map((d) => [d, 0]));
for (const t of flow.times) {
  const at = pday(Date.parse(t.filed) + t.lead * 1000);
  if (t.outcome === "landed" && at in landed) landed[at]++;
}

const notes: any[] = memory.notes, monitor = factory.factory.monitor;
const data = {
  taken: factory.now,
  flow: {
    figures: flow.figures, baseline: flow.baseline, phases: flow.phases, open: flow.open, firstPass: flow.issues.firstPass, asks: flow.asks,
    classes: flow.classes.map((c: any) => ({ key: c.key, lost: c.lost, hours: c.hours, causes: c.causes })),
    stages: flow.stages.rows,
    agents: { cap: flow.agents.cap, roles: flow.agents.roles.map((r: any) => ({ key: r.key, p50: r.p50, p95: r.p95 })) },
    days: days.map((d) => ({ day: d, landed: landed[d] })),
  },
  monitor: { day: monitor.day, holds: monitor.holds, stages: monitor.stages },
  usage: { seven_day: factory.usage.now.seven_day, resets: factory.usage.now.seven_day_resets_at },
  automation: { schedules: automation.schedules, backend: automation.backend },
  memory: {
    total: memory.total, start: Object.fromEntries(Object.entries<any>(memory.start).map(([k, s]) => [k, { bytes: s.bytes, budget: s.budget, core: s.core.length }])),
    refused: memory.lint.refuse.length, unofferedReads: memory.misses.unoffered_reads,
    offered: notes.filter((n) => n.read && QUIET - Date.parse(n.read) <= 7 * DAY).length, never: notes.filter((n) => !n.read).length,
    // A note's `history` is its offers per day, oldest first, and ends at today.
    offers: Array.from({ length: 10 }, (_, i) => notes.reduce((a, n) => a + (n.history?.[n.history.length - 10 + i] ?? 0), 0)),
    maintained: processes.steps.find((s: any) => s.name === "maintain").last,
    stale: processes.decay.stale.length, late: processes.decay.stale.filter((s: any) => s.over > 30).length,
  },
  quiet: { ...state(QUIET, 12 * HOUR), herald: factory.herald.rows },
  busy: state(BUSY, 2 * HOUR),
};
await Bun.write(`${import.meta.dir}/data.json`, JSON.stringify(data, null, 1));
for (const k of ["busy", "quiet"] as const) console.log(`${k}:`, data[k].jobs.filter((j) => j.live).length, "live jobs,", data[k].held.length, "held,", data[k].total, "events, landed today", data[k].landedToday, "usage", data[k].usage);
console.log("landed per day:", JSON.stringify(data.flow.days.map((d) => d.landed)), "offers:", JSON.stringify(data.memory.offers));
