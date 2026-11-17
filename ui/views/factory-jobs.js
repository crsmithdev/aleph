// The Jobs page: how long each stage of the work takes. `d` is /api/flow for the window.
import { get, moved, redraw } from "./lib/router.js";
import { setQuery, scope } from "./lib/address.js";
import { cardPct, dur, count, failMessage, MIN_LANDED, plural, shortModel } from "./lib/format.js";
import { card, cell, dataTable, filterBar, miss, row, empty, error, heads, loadingLine, onTile, pageHead, searchBox, statCard, cardTrend, tiles } from "./lib/html.js";
import { NAMES } from "../../lib/naming.ts";
import { quantile } from "../../lib/windows.ts";
import { panelOf } from "./lib/chart.js";
import { listUrl, renderFilters, renderJobsTable, renderScope, wireJobs } from "./lib/jobs-table.js";
import { bucketOf, flowOf, flowUrl, lastPeriod, trendOn, usable, windowTrend } from "./lib/flow-parts.js";

export const STAGES = [
  ["lead", NAMES.lead],
  ["intake", NAMES.intake],
  ["queue", NAMES.queue],
  ["implement", NAMES.build],
  ["land", NAMES.land],
];
const PARTS = [["intake", NAMES.intake, "series-1"], ["queue", NAMES.queue, "series-2"], ["implement", NAMES.build, "series-3"], ["land", NAMES.land, "series-4"]];

/** A stage card: p50 / p90 over the window, with the last 24h p50 against the window's as the trend. */
const stageTile = ([key, name], d, day, on) => {
  const c = d.phases[key], dc = day?.phases?.[key], none = !c.count;
  const tr = trendOn(d) && dc?.count && !none ? cardTrend(dc.p50, c.p50, null, { kind: "relative", lowerIsGood: true, tip: `${dur(dc.p50)} in the last 24h, against ${dur(c.p50)} over the window` }) : "";
  return statCard({ k: name, v: none ? "–" : dur(c.p50), v2: none ? "–" : dur(c.p90), q: ["p50", "p90"], trend: tr, key, on });
};

/** The Wait share card: the p50 of queue time over lead time, over the issues that landed in the window; no figure with fewer than `MIN_LANDED`. */
const waitTile = (d) => {
  const { count: n, p50 } = d.wait, few = n < MIN_LANDED;
  return statCard({ k: "Wait share", v: few ? "–" : cardPct(p50), note: plural(n, "issue"), trend: few ? "" : windowTrend(d, "waitShare", p50, { kind: "points", lowerIsGood: true, format: cardPct }) });
};

/** The p50 and p90 of a stage by bucket, as two lines: a bucket with no time is null, a gap. */
export const trendFrame = (d, key, name) => ({
  measure: { name: name, unit: "seconds", agg: "max" },
  over: { kind: "time", window: d.window },
  by: { name: bucketOf(d)[0].toUpperCase() + bucketOf(d).slice(1), keys: [{ key: "p90", name: "p90", color: "hot" }, { key: "p50", name: "p50", color: "run" }] },
  rows: d.buckets.map((b) => ({ at: b.at, p90: b.p90?.[key] ?? null, p50: b[key] ?? null })),
  // The p50 is not a part of the p90, so the panel draws two lines, not stacked areas.
  form: "lines",
});

/** One point per issue with a time for the stage and a filing time, in filing order, coloured by outcome; a point's `href` is its issue. */
export const stripFrame = (d, key, name) => ({
  measure: { name, unit: "seconds", agg: "max" },
  over: { kind: "time", window: d.window },
  by: { name: "Outcome", keys: [{ key: "landed", name: "landed", color: "done" }, { key: "unlanded", name: "unlanded", color: "need" }] },
  rows: (d.times ?? []).filter((i) => ["landed", "unlanded"].includes(i.outcome) && i[key] > 0 && i.filed != null).sort((a, b) => a.filed.localeCompare(b.filed)).map((i) => ({ at: Date.parse(i.filed), name: i.id, href: i.href, [i.outcome]: i[key] })),
  form: "points",
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
    by: { keys: parts.map(([k, name, color]) => ({ key: k, name, color })) },
    rows: top.map((r) => ({ name: r.label, href: r.href, [r.k]: r.secs })),
    form: "stacked",
  };
};

/** Each Jobs chart panel: its key, and its frame from the answer and the stage. */
export const FRAMES = { trend: trendFrame, strip: stripFrame, slowest: slowestFrame };
/** The key of a Jobs chart panel: its frame, its kept form and its kept hidden series are its own. */
export const chartKey = (k) => `factory/jobs/${k}`;

/** A row's cell: text, or `{ td }` for a cell that holds markup or a title. */
const td = (c, o) => (typeof c === "string" ? cell(c, o) : c.td);
const table = (labels, num, rows) => !rows.length ? empty() : dataTable(heads(labels, num), rows.map(([h, ...cells]) => row([td(h, { wide: true }), ...cells.map((c) => td(c, { num: true }))])).join(""), { fit: true });
const none = (reason, wide = true) => ({ td: `<td class="${wide ? "wide" : "num"}">${miss(reason)}</td>` });

const SIZES = ["small", "medium", "large"];
const landedIssues = (d) => (d.times ?? []).filter((i) => i.outcome === "landed" && i.lead > 0);
const buildsOf = (d, size = "") => (d.builds ?? []).filter((b) => !size || b.size === size);

/** The Lead Time by Size rows: the landed issues of each size, and of no size when any; an issue's size is that of its last build. */
function leadBySize(d) {
  const landed = landedIssues(d);
  const rows = [...SIZES, null].map((size) => {
    const xs = landed.filter((i) => i.size === size).map((i) => i.lead);
    return [size ?? none("no size"), count(xs.length), dur(quantile(xs, 0.5)), dur(quantile(xs, 0.9))];
  });
  return landed.length ? rows.filter((r, i) => i < SIZES.length || r[1] !== "0") : [];
}

/** The Build Time by Model rows of the build runs of `size` (all with none), fastest Per Landed first. A model with fewer than `MIN_LANDED` landed issues has no Per Landed and sorts last. */
function buildByModel(d, size = "") {
  const rows = [...Map.groupBy(buildsOf(d, size), (b) => b.model)].map(([model, runs]) => {
    const secs = runs.map((b) => b.secs), issues = [...Map.groupBy(runs.filter((b) => b.issue), (b) => b.issue).values()];
    const retried = issues.filter((x) => x.length > 1).length;
    const landed = issues.filter((x) => x[0].landed).map((x) => x.reduce((t, b) => t + b.secs, 0));
    const per = landed.length >= MIN_LANDED ? quantile(landed, 0.5) : null;
    return { per, count: runs.length, model, cells: [
      model === "unset" ? none("no model") : shortModel(model), count(runs.length), dur(quantile(secs, 0.5)), dur(quantile(secs, 0.9)),
      issues.length ? { td: cell(cardPct(retried / issues.length), { num: true, title: `${retried} of ${plural(issues.length, "issue")}` }) } : none("no issue", false),
      per === null ? none(`${landed.length} landed`, false) : dur(per),
    ] };
  });
  return rows.sort((a, b) => (a.per ?? Infinity) - (b.per ?? Infinity) || b.count - a.count || a.model.localeCompare(b.model));
}

/** The page body for a stage. `day` is /api/flow for the last 24h, or null. `jobs` is /api/jobs for the window, null while it loads, or the Error of a failed load; `f` is the route query. */
export function renderFactoryJobs(d, day, stage = "lead", jobs = null, f = {}) {
  const [key, name] = STAGES.find((s) => s[0] === stage) ?? STAGES[0];
  const head = renderScope(Array.isArray(jobs) ? jobs : [], { ...f, window: f.window ?? d.window });
  return `<div class="page sp" id="perf">${pageHead("Jobs", { aside: head })}` +
    tiles("Stages", STAGES.map((s) => stageTile(s, d, day, s[0] === key)).toSpliced(1, 0, waitTile(d)).join("")) +
    `<div class="trio">${panelOf(chartKey("trend"), trendFrame(d, key, name))}${panelOf(chartKey("strip"), stripFrame(d, key, name))}${panelOf(chartKey("slowest"), slowestFrame(d, key))}</div>` +
    `<div class="pair">${card("Lead Time by Size", table(["Size", "Issues", "p50", "p90"], ["Issues", "p50", "p90"], leadBySize(d)), { count: landedIssues(d).length, label: "Lead time by size" })}` +
    card("Build Time by Model", filterBar([{ label: "Size", name: "size", value: f.size || "", options: [{ value: "", label: "All" }, ...SIZES] }]) + table(["Model", "Jobs", "p50", "p90", "Retried", "Per Landed"], ["Jobs", "p50", "p90", "Retried", "Per Landed"], buildByModel(d, f.size).map((m) => m.cells)), { count: buildsOf(d, f.size).length, label: "Build time by model" }) + `</div>` +
    card("Checks", table(["Check", "Jobs", "p50", "p90"], ["Jobs", "p50", "p90"], d.checks.map((x) => [x.name, count(x.count), dur(x.p50), dur(x.p90)]))) +
    card("Jobs", searchBox("jobs-search", f.q, "Search ids and titles") + renderFilters(f) + `<div id="jobs-table">${jobs instanceof Error ? error("Could not load the jobs.", { detail: jobs.message }) : jobs ? renderJobsTable(jobs, f) : loadingLine("jobs")}</div>`) + `</div>`;
}

/** The old address. */
export const redirect = (hash) => moved(hash, ["#/status/performance", "#/jobs"], "#/factory/jobs");

export const view = {
  path: "/factory/jobs",
  title: "Jobs",
  group: "factory",
  order: 1,
  icon: "stopwatch",
  api: (_params, q = new URLSearchParams()) => flowUrl(scope(q).window, q, true),
  live: true,
  refresh: 60,
  // `d.day` is /api/flow for the last 24h and `d.jobs` is /api/jobs for the window, which `more` adds; the page draws without them first.
  render: (d, _params, q) => renderFactoryJobs(d, usable(d.day), q?.get("stage") ?? "lead", d.jobs ?? null, Object.fromEntries(q ?? [])),
  more: async (d, q) => {
    // The API holds 2000 jobs a page and gives `next`, the `before` of the following page, until the window ends.
    const page = async (url) => {
      const r = await get(url);
      if (!r.ok) throw new Error(failMessage(url, r.status, await r.text()));
      const { jobs, next } = await r.json();
      return next ? [...jobs, ...await page(`${listUrl(null, q)}&before=${encodeURIComponent(next)}`)] : jobs;
    };
    const jobs = page(listUrl(null, q)).catch((e) => e);
    return { ...d, day: trendOn(d) ? await flowOf("day", q) : null, jobs: await jobs };
  },
  mount: (root, d, q) => {
    const stage = q.get("stage") ?? "lead", [key, name] = STAGES.find((s) => s[0] === stage) ?? STAGES[0];
    onTile(root.querySelector("#perf"), async (k) => {
      setQuery({ stage: k });
      await redraw();
      root.querySelector(`button[data-tile="${k}"]`)?.focus();
    });
    scope().wire(root);
    // Each panel draws the frame of the stage shown; its form and hidden series are its own.
    for (const [k, fr] of Object.entries(FRAMES)) {
      const el = root.querySelector(`aleph-chart[key="${chartKey(k)}"]`);
      if (el) el.frame = fr(d, key, name);
    }
    wireJobs(root, () => (Array.isArray(d.jobs) ? d.jobs : null));
    // The Size filter changes only what the model table counts, so it redraws and does not fetch: wireJobs would goQuery.
    const onclick = root.onclick;
    root.onclick = async (e) => {
      const b = e.target.closest?.('.seg[data-name="size"] button');
      if (!b) return onclick(e);
      setQuery({ size: b.dataset.value });
      await redraw();
      root.querySelector('.seg[data-name="size"] button[aria-pressed="true"]')?.focus();
    };
  },
};
