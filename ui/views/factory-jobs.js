// The Jobs page: how long each stage of the work takes. `d` is /api/speed for the window.
import { card, chart, dataTable, dur, error, esc, failMessage, hashQuery, heads, loadingLine, onTile, pageHead, readTokens, keepWindow, searchBox, setQuery, statCard, cardTrend, tiles, windowOf, wireScope } from "../lib.js";
import { listUrl, renderFilters, renderJobsTable, renderScope, windowShown, wireJobs } from "./jobs.js";
import { bucketOf, durShort, lastPeriod, loadSpeed, trendOn, usable, xLabel } from "./speed.js";

export const STAGES = [
  ["lead", "Lead time", "From filing to the last land."],
  ["intake", "Intake", "From filing to the end of the first intake."],
  ["queue", "Queue", "From intake to the first agent run. This includes waits for a slot or for another issue."],
  ["implement", "Build", "From the first agent run to the last finish with work to land."],
  ["land", "Land", "From the finish to the land. This includes waits for a review or for Chris."],
];
const PARTS = [["intake", "Intake"], ["queue", "Queue"], ["implement", "Build"], ["land", "Land"]];

/** A stage card: p50 / p90 over the window, with the last 24h p50 against the window's as the trend. */
const stageTile = ([key, name], d, day, on) => {
  const c = d.phases[key], dc = day?.phases?.[key], none = !c.count;
  const tr = trendOn(d) && dc?.count && !none ? cardTrend(dc.p50, c.p50, null, { kind: "relative", lowerIsGood: true, tip: `${dur(dc.p50)} in the last 24h, against ${dur(c.p50)} over the window` }) : "";
  return statCard({ k: name, v: none ? "–" : durShort(c.p50), v2: none ? "–" : durShort(c.p90), q: ["p50", "p90"], trend: tr, key, on });
};

const axis = { axisLabel: { formatter: (v) => durShort(v) } };

/** The p50 and p90 of a stage by bucket, two lines. */
export const trendOption = (d, key, t) => ({
  animation: false,
  grid: { left: 48, right: 16, top: 28, bottom: 20 },
  legend: { top: 0, right: 0 },
  tooltip: { trigger: "axis", confine: true, valueFormatter: (v) => (v == null ? "–" : dur(v)) },
  xAxis: { type: "category", data: d.buckets.map((b) => xLabel(b.at, d.window)), axisTick: { show: false }, axisLabel: { hideOverlap: true } },
  yAxis: { type: "value", min: 0, splitLine: { lineStyle: { opacity: 0.5 } }, ...axis },
  series: [
    { type: "line", name: "p50", color: t.run, data: d.buckets.map((b) => b[key]), lineStyle: { width: 2 } },
    { type: "line", name: "p90", color: t.hot, data: d.buckets.map((b) => b.p90?.[key] ?? null), lineStyle: { width: 2 } },
  ],
});

/** One dot per issue with a time for the stage, on a log time axis and coloured by outcome. A dot's `href` is its issue. */
export const stripOption = (d, key, t) => ({
  animation: false,
  grid: { left: 8, right: 16, top: 28, bottom: 24 },
  legend: { top: 0, right: 0 },
  tooltip: { confine: true, formatter: (p) => `${esc(p.data.id)}: ${esc(dur(p.value[0]))}` },
  xAxis: { type: "log", min: 1, ...axis },
  yAxis: { type: "value", min: 0, max: 1, show: false },
  series: [["landed", t.done], ["unlanded", t.need]].map(([outcome, color]) => ({
    type: "scatter", name: outcome, color, symbolSize: 9,
    // The height of a dot only spreads the dots apart.
    data: (d.times ?? []).filter((i) => i.outcome === outcome && i[key] > 0).map((i, n) => ({ value: [i[key], ((n * 0.618) % 1) * 0.8 + 0.1], id: i.id, href: i.href })),
  })),
});

/** The 10 slowest issues of a stage, slowest first: one stacked bar each of its intake, queue, build and land seconds. */
export const slowestOption = (d, key) => {
  const top = (d.times ?? []).filter((i) => i[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, 10);
  return {
    animation: false,
    grid: { left: 8, right: 16, top: 28, bottom: 24, containLabel: true },
    legend: { top: 0, right: 0 },
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, valueFormatter: (v) => dur(v) },
    xAxis: { type: "value", ...axis },
    yAxis: { type: "category", inverse: true, data: top.map((i) => i.id), axisTick: { show: false } },
    series: PARTS.map(([k, name]) => ({ type: "bar", stack: "total", name, barMaxWidth: 20, data: top.map((i) => i[k] ?? 0) })),
  };
};

const label = (d, key, name, what) => {
  const times = (d.times ?? []).filter((i) => i[key] > 0);
  return `${name} ${what}: ${times.length} issues in the ${lastPeriod(d)}` + (times.length ? `, from ${dur(Math.min(...times.map((i) => i[key])))} to ${dur(Math.max(...times.map((i) => i[key])))}` : "");
};

const table = (labels, num, rows) => dataTable(heads(labels, num), rows.map(([h, ...cells]) => `<tr><td class="wide">${esc(h)}</td>${cells.map((c) => `<td class="num">${esc(c)}</td>`).join("")}</tr>`).join(""));

/** The page body for a stage. `day` is /api/speed for the last 24h, or null. `jobs` is /api/jobs for the window, or null while it loads; `f` is the route query. */
export function renderFactoryJobs(d, day, stage = "lead", jobs = null, f = {}) {
  const [key, name, text] = STAGES.find((s) => s[0] === stage) ?? STAGES[0];
  const scope = renderScope(jobs ?? [], { ...f, window: f.window ?? (f.days ? undefined : d.window) });
  return `<div class="page sp" id="perf">${pageHead("Jobs", { count: lastPeriod(d), aside: scope })}` +
    tiles("Stages", STAGES.map((s) => stageTile(s, d, day, s[0] === key)).join("")) +
    `<div class="trio">${card(`${name}: p50 and p90 by ${bucketOf(d)}`, `<p>${esc(text)}</p><div class="chartbox" data-chart="trend" role="img" aria-label="${esc(label(d, key, name, "p50 and p90 trend"))}"></div>`)}` +
    card(`${name}: time per issue`, `<p>One dot per issue, by outcome.</p><div class="chartbox" data-chart="strip" role="img" aria-label="${esc(label(d, key, name, "time per issue"))}"></div>`) +
    card("Slowest 10", `<p>Intake, queue, build and land of the slowest issues.</p><div class="chartbox" data-chart="slowest" role="img" aria-label="${esc(label(d, key, name, "slowest 10"))}"></div>`) + `</div>` +
    `<div class="pair">${card("Checks", table(["Check", "Runs", "p50", "p90"], ["Runs", "p50", "p90"], d.checks.map((x) => [x.name, x.count, dur(x.p50), dur(x.p90)])))}` +
    card("Build time by model", table(["Model", "Runs", "p50"], ["Runs", "p50"], d.models.map((m) => [m.model === "unset" ? "not recorded" : m.model, m.count, dur(m.p50)]))) + `</div>` +
    card("Jobs", searchBox("jobs-search", f.q, "Search ids and titles") + renderFilters(f) + `<div id="jobs-table">${jobs ? renderJobsTable(jobs, f) : loadingLine("jobs")}</div>`) + `</div>`;
}

/** The old address. */
export const redirect = (hash) => {
  const [path, query] = String(hash ?? "").split(/\?(.*)/s);
  return path === "#/status/performance" ? "#/factory/jobs" : path === "#/jobs" ? `#/factory/jobs${query ? `?${query}` : ""}` : null;
};

let drawn = [];
let listed = null; // { url, jobs }: /api/jobs for the window shown
const jobsNow = (q) => (listed?.url === listUrl(null, q) ? listed.jobs : null);

export const view = {
  path: "/factory/jobs",
  title: "Jobs",
  group: "factory",
  order: 0,
  icon: "stopwatch",
  api: (_params, q = new URLSearchParams()) => `/api/speed?window=${windowOf(q)}`,
  refresh: 60,
  render: (d, _params, q) => renderFactoryJobs(d, usable("day"), q?.get("stage") ?? "lead", jobsNow(q ?? new URLSearchParams()), Object.fromEntries(q ?? [])),
  mount: async (root, d) => {
    keepWindow(windowShown(Object.fromEntries(hashQuery())) || d.window || windowOf(hashQuery()));
    const draw = (k) => renderFactoryJobs(d, usable("day"), k, jobsNow(hashQuery()), Object.fromEntries(hashQuery()));
    const wire = () => {
      const stage = hashQuery().get("stage") ?? "lead", [key] = STAGES.find((s) => s[0] === stage) ?? STAGES[0];
      onTile(root.querySelector("#perf"), (k) => {
        setQuery({ stage: k });
        root.innerHTML = draw(k);
        wire();
        root.querySelector(`button[data-tile="${k}"]`)?.focus();
      });
      wireScope(root);
      for (const c of drawn) c.dispose();
      drawn = [];
      if (!globalThis.echarts) return;
      const t = readTokens(), opts = { trend: trendOption(d, key, t), strip: stripOption(d, key, t), slowest: slowestOption(d, key) };
      for (const el of root.querySelectorAll(".chartbox")) {
        const c = chart(el, opts[el.dataset.chart]);
        if (el.dataset.chart === "strip") c.on("click", (p) => { if (p.data?.href) location.hash = p.data.href; });
        drawn.push(c);
      }
    };
    wire();
    wireJobs(root, () => jobsNow(hashQuery()));
    const url = listUrl(null, hashQuery());
    const got = fetch(url, { cache: "no-store" }).then(async (r) => (r.ok ? r.json() : new Error(failMessage(url, r.status, await r.text())))).catch((e) => e);
    if (trendOn(d)) await loadSpeed("day");
    const jobs = await got, failed = jobs instanceof Error;
    if (!root.querySelector("#perf")) return;
    if (!failed) listed = { url, jobs };
    if (!failed || trendOn(d)) {
      root.innerHTML = draw(hashQuery().get("stage") ?? "lead");
      wire();
    }
    if (failed) root.querySelector("#jobs-table").innerHTML = error(jobs.message);
  },
};
