// The Jobs page: how long each stage of the work takes. `d` is /api/flow for the window.
import { get, redraw } from "../router.js";
import { card, pagedTable, dur, empty, error, esc, failMessage, heads, loadingLine, onTile, pageHead, searchBox, setQuery, statCard, cardTrend, tiles, scope } from "../lib.js";
import { NAMES } from "../../lib/naming.ts";
import { panelOf } from "../chart.js";
import { listUrl, renderFilters, renderJobsTable, renderScope, wireJobs } from "./jobs.js";
import { bucketOf, flowOf, lastPeriod, trendOn, usable } from "./speed.js";

export const STAGES = [
  ["lead", NAMES.lead, "From filing to the last land."],
  ["intake", NAMES.intake, "From filing to the end of the first intake."],
  ["queue", NAMES.queue, "From intake to the first agent job. This includes waits for a slot or for another issue."],
  ["implement", NAMES.build, "From the first agent job to the last finish with work to land."],
  ["land", NAMES.land, "From the finish to the land. This includes waits for a review or for Chris."],
];
const PARTS = [["intake", NAMES.intake], ["queue", NAMES.queue], ["implement", NAMES.build], ["land", NAMES.land]];

/** A stage card: p50 / p90 over the window, with the last 24h p50 against the window's as the trend. */
const stageTile = ([key, name], d, day, on) => {
  const c = d.phases[key], dc = day?.phases?.[key], none = !c.count;
  const tr = trendOn(d) && dc?.count && !none ? cardTrend(dc.p50, c.p50, null, { kind: "relative", lowerIsGood: true, tip: `${dur(dc.p50)} in the last 24h, against ${dur(c.p50)} over the window` }) : "";
  return statCard({ k: name, v: none ? "–" : dur(c.p50), v2: none ? "–" : dur(c.p90), q: ["p50", "p90"], trend: tr, key, on });
};

/** The line a Jobs chart shows when the window holds no time for the stage. */
const NONE = "No time to plot in this window.";

/** The p50 and p90 of a stage by bucket, as two lines: a bucket with no time is 0. */
export const trendFrame = (d, key, name, text) => ({
  measure: { name: name, unit: "seconds", agg: "max" },
  over: { kind: "time", window: d.window },
  by: { name: bucketOf(d)[0].toUpperCase() + bucketOf(d).slice(1), keys: [{ key: "p90", name: "p90", color: "hot" }, { key: "p50", name: "p50", color: "run" }] },
  rows: d.buckets.map((b) => ({ at: b.at, p90: b.p90?.[key] ?? 0, p50: b[key] ?? 0 })),
  // The p50 is not a part of the p90, so the panel draws two lines, not stacked areas.
  form: "lines",
  note: text,
  empty: NONE,
});

/** One point per issue with a time for the stage and a filing time, in filing order, coloured by outcome; a point's `href` is its issue. */
export const stripFrame = (d, key, name) => ({
  measure: { name: `${name}: Time per Issue`, unit: "seconds", agg: "max" },
  over: { kind: "time", window: d.window },
  by: { keys: [{ key: "landed", name: "landed", color: "done" }, { key: "unlanded", name: "unlanded", color: "need" }] },
  rows: (d.times ?? []).filter((i) => ["landed", "unlanded"].includes(i.outcome) && i[key] > 0 && i.filed != null).sort((a, b) => a.filed.localeCompare(b.filed)).map((i) => ({ at: Date.parse(i.filed), name: i.id, href: i.href, [i.outcome]: i[key] })),
  form: "points",
  note: "One point per issue, by outcome: its filing time across, its time up.",
  empty: NONE,
});

/**
 * The 10 slowest stages of an issue: for Lead Time, any of intake, queue, build and land, so an issue with two slow
 * stages has two rows; for another stage, that stage. Ordered by stage, then by issue. Each row is `{ id, href, k, name, secs, label }`.
 */
export function slowest(d, key) {
  const parts = key === "lead" ? PARTS : PARTS.filter(([k]) => k === key);
  const order = (k) => PARTS.findIndex(([p]) => p === k);
  return (d.times ?? []).flatMap((i) => parts.filter(([k]) => i[k] > 0).map(([k, name]) => ({ id: i.id, href: i.href, k, name, secs: i[k], label: key === "lead" ? `${i.id} ${name}` : i.id })))
    .sort((a, b) => b.secs - a.secs).slice(0, 10)
    .sort((a, b) => order(a.k) - order(b.k) || a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/** The slowest rows as bars, one key per stage so each stage keeps its colour; a row links to its issue. */
export const slowestFrame = (d, key) => {
  const top = slowest(d, key), parts = PARTS.filter(([k]) => top.some((r) => r.k === k));
  return {
    measure: { name: "Slowest 10", unit: "seconds", agg: "max" },
    over: { kind: "category" },
    by: { keys: parts.map(([k, name]) => ({ key: k, name })) },
    rows: top.map((r) => ({ name: r.label, href: r.href, [r.k]: r.secs })),
    form: "stacked",
    note: (key === "lead" ? "The slowest stages of any issue; an issue with two slow stages has two rows." : "The issues with the slowest stage.") + " Click one to open it.",
    empty: NONE,
  };
};

/** Each Jobs chart panel: its key, and its frame from the answer and the stage. */
export const FRAMES = { trend: trendFrame, strip: stripFrame, slowest: slowestFrame };
/** The key of a Jobs chart panel: its frame, its kept form and its kept hidden series are its own. */
export const chartKey = (k) => `factory/jobs/${k}`;

const table = (labels, num, rows) => !rows.length ? empty("No row to show.") : pagedTable(heads(labels, num), rows.map(([h, ...cells]) => `<tr><td class="wide">${esc(h)}</td>${cells.map((c) => `<td class="num">${esc(c)}</td>`).join("")}</tr>`));

/** The page body for a stage. `day` is /api/flow for the last 24h, or null. `jobs` is /api/jobs for the window, null while it loads, or the Error of a failed load; `f` is the route query. */
export function renderFactoryJobs(d, day, stage = "lead", jobs = null, f = {}) {
  const [key, name, text] = STAGES.find((s) => s[0] === stage) ?? STAGES[0];
  const head = renderScope(Array.isArray(jobs) ? jobs : [], { ...f, window: f.window ?? d.window });
  return `<div class="page sp" id="perf">${pageHead("Jobs", { count: lastPeriod(d), aside: head })}` +
    tiles("Stages", STAGES.map((s) => stageTile(s, d, day, s[0] === key)).join("")) +
    `<div class="trio">${panelOf(chartKey("trend"), trendFrame(d, key, name, text))}${panelOf(chartKey("strip"), stripFrame(d, key, name))}${panelOf(chartKey("slowest"), slowestFrame(d, key))}</div>` +
    `<div class="pair">${card("Checks", table(["Check", "Jobs", "p50", "p90"], ["Jobs", "p50", "p90"], d.checks.map((x) => [x.name, x.count, dur(x.p50), dur(x.p90)])))}` +
    card("Build Time by Model", table(["Model", "Jobs", "p50"], ["Jobs", "p50"], d.models.map((m) => [m.model === "unset" ? "not recorded" : m.model, m.count, dur(m.p50)])), { label: "Build time by model" }) + `</div>` +
    card("Jobs", searchBox("jobs-search", f.q, "Search ids and titles") + renderFilters(f) + `<div id="jobs-table">${jobs instanceof Error ? error(jobs.message) : jobs ? renderJobsTable(jobs, f) : loadingLine("jobs")}</div>`) + `</div>`;
}

/** The old address. */
export const redirect = (hash) => {
  const [path, query] = String(hash ?? "").split(/\?(.*)/s);
  return path === "#/status/performance" ? "#/factory/jobs" : path === "#/jobs" ? `#/factory/jobs${query ? `?${query}` : ""}` : null;
};

export const view = {
  path: "/factory/jobs",
  title: "Jobs",
  group: "factory",
  order: 0,
  icon: "stopwatch",
  api: (_params, q = new URLSearchParams()) => { const s = scope(q); return s.url(`/api/flow?window=${s.window}`); },
  live: true,
  refresh: 60,
  // `d.day` is /api/flow for the last 24h and `d.jobs` is /api/jobs for the window, which `more` adds; the page draws without them first.
  render: (d, _params, q) => renderFactoryJobs(d, usable(d.day), q?.get("stage") ?? "lead", d.jobs ?? null, Object.fromEntries(q ?? [])),
  more: async (d, q) => {
    const url = listUrl(null, q);
    const jobs = get(url).then(async (r) => (r.ok ? (await r.json()).jobs : new Error(failMessage(url, r.status, await r.text())))).catch((e) => e);
    return { ...d, day: trendOn(d) ? await flowOf("day", q) : null, jobs: await jobs };
  },
  mount: (root, d, q) => {
    const stage = q.get("stage") ?? "lead", [key, name, text] = STAGES.find((s) => s[0] === stage) ?? STAGES[0];
    onTile(root.querySelector("#perf"), async (k) => {
      setQuery({ stage: k });
      await redraw();
      root.querySelector(`button[data-tile="${k}"]`)?.focus();
    });
    scope().wire(root);
    // Each panel draws the frame of the stage shown; its form and hidden series are its own.
    for (const [k, fr] of Object.entries(FRAMES)) {
      const el = root.querySelector(`aleph-chart[key="${chartKey(k)}"]`);
      if (el) el.frame = fr(d, key, name, text);
    }
    wireJobs(root, () => (Array.isArray(d.jobs) ? d.jobs : null));
  },
};
