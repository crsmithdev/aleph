// The Jobs page: how long each stage of the work takes. `d` is /api/speed for the window.
import { card, chartBox, mountCharts, day, sentence, pagedTable, dur, empty, error, esc, failMessage, hashQuery, heads, legend, loadingLine, onTile, pageHead, readTokens, when, keepProject, keepWindow, projectNow, withProject, searchBox, setQuery, statCard, cardTrend, tiles, windowOf, wireScope } from "../lib.js";
import { listUrl, renderFilters, renderJobsTable, renderScope, windowShown, wireJobs } from "./jobs.js";
import { bucketOf, lastPeriod, loadSpeed, trendOn, usable, xLabel } from "./speed.js";

export const STAGES = [
  ["lead", "Lead Time", "From filing to the last land."],
  ["intake", "Intake", "From filing to the end of the first intake."],
  ["queue", "Queue", "From intake to the first agent job. This includes waits for a slot or for another issue."],
  ["implement", "Build", "From the first agent job to the last finish with work to land."],
  ["land", "Land", "From the finish to the land. This includes waits for a review or for Chris."],
];
const PARTS = [["intake", "Intake"], ["queue", "Queue"], ["implement", "Build"], ["land", "Land"]];

/** A stage card: p50 / p90 over the window, with the last 24h p50 against the window's as the trend. */
const stageTile = ([key, name], d, day, on) => {
  const c = d.phases[key], dc = day?.phases?.[key], none = !c.count;
  const tr = trendOn(d) && dc?.count && !none ? cardTrend(dc.p50, c.p50, null, { kind: "relative", lowerIsGood: true, tip: `${dur(dc.p50)} in the last 24h, against ${dur(c.p50)} over the window` }) : "";
  return statCard({ k: name, v: none ? "–" : dur(c.p50), v2: none ? "–" : dur(c.p90), q: ["p50", "p90"], trend: tr, key, on });
};

const axis = { axisLabel: { formatter: (v) => dur(v) } };

/** The p50 and p90 of a stage by bucket, two areas; a bucket with no time is 0. The p90 is drawn first, so the p50 sits on top. */
export const trendOption = (d, key, t) => ({
  animation: false,
  grid: { left: 48, right: 16, top: 28, bottom: 20 },
  legend,
  tooltip: { trigger: "axis", confine: true, valueFormatter: (v) => (v ? dur(v) : "–") },
  xAxis: { type: "category", boundaryGap: false, data: d.buckets.map((b) => xLabel(b.at, d.window)), axisTick: { show: false }, axisLabel: { hideOverlap: true } },
  yAxis: { type: "value", min: 0, splitLine: { lineStyle: { opacity: 0.5 } }, ...axis },
  series: [
    { type: "line", name: "p90", color: t.hot, symbol: "none", data: d.buckets.map((b) => b.p90?.[key] ?? 0), lineStyle: { width: 1.5 }, areaStyle: { opacity: 0.2 } },
    { type: "line", name: "p50", color: t.run, symbol: "none", data: d.buckets.map((b) => b[key] ?? 0), lineStyle: { width: 1.5 }, areaStyle: { opacity: 0.35 } },
  ],
});

/**
 * One dot per issue with a time for the stage and a filing time, coloured by outcome. The time is on the horizontal log
 * axis in base 60, so the ticks fall on 1s, 1m and 1h; it starts at 1m unless a time is under a minute. The axis ends at
 * half again the longest time. The vertical axis is the filing time, newest at the top. A dot's `href` is its issue.
 */
export const stripOption = (d, key, t) => ({
  animation: false,
  grid: { left: 8, right: 28, top: 28, bottom: 24, containLabel: true },
  legend,
  tooltip: { confine: true, formatter: (p) => `${esc(p.data.id)}: ${esc(dur(p.value[0]))}, filed ${esc(when(p.value[1]))}` },
  xAxis: { type: "log", logBase: 60, min: (v) => (v.min >= 60 ? 60 : 1), max: (v) => v.max * 1.5, axisLabel: { formatter: (v) => dur(v), hideOverlap: true } },
  yAxis: { type: "time", axisLabel: { formatter: (v) => (d.window === "week" || d.window === "month" ? xLabel(v, d.window) : `${day(v)} ${xLabel(v, d.window)}`), hideOverlap: true } },
  series: [["landed", t.done], ["unlanded", t.need]].map(([outcome, color]) => ({
    type: "scatter", name: outcome, color, symbolSize: 9,
    data: (d.times ?? []).filter((i) => i.outcome === outcome && i[key] > 0 && i.filed != null).map((i) => ({ value: [i[key], i.filed], id: i.id, href: i.href })),
  })),
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

/** The slowest rows as bars, one series per stage so each stage has its colour. A bar or label click opens the issue. */
export const slowestOption = (d, key) => {
  const top = slowest(d, key), parts = PARTS.filter(([k]) => top.some((r) => r.k === k));
  return {
    animation: false,
    grid: { left: 8, right: 28, top: 28, bottom: 24, containLabel: true },
    legend,
    tooltip: { trigger: "item", confine: true, formatter: (p) => `${esc(p.name)}: ${esc(dur(p.value))}` },
    xAxis: { type: "value", splitNumber: 3, axisLabel: { formatter: (v) => dur(v), hideOverlap: true } },
    yAxis: { type: "category", inverse: true, data: top.map((r) => r.label), axisTick: { show: false }, axisLabel: { interval: 0 }, triggerEvent: true },
    series: parts.map(([k, name]) => ({ type: "bar", stack: "one", name, barMaxWidth: 20, cursor: "pointer", data: top.map((r) => (r.k === k ? { value: r.secs, href: r.href } : null)) })),
  };
};

const label = (d, key, name, what) => {
  const times = (d.times ?? []).filter((i) => i[key] > 0);
  return `${name} ${what}: ${times.length} issues in the ${lastPeriod(d)}` + (times.length ? `, from ${dur(Math.min(...times.map((i) => i[key])))} to ${dur(Math.max(...times.map((i) => i[key])))}` : "");
};

const table = (labels, num, rows) => !rows.length ? empty("No row to show.") : pagedTable(heads(labels, num), rows.map(([h, ...cells]) => `<tr><td class="wide">${esc(h)}</td>${cells.map((c) => `<td class="num">${esc(c)}</td>`).join("")}</tr>`));

/** The page body for a stage. `day` is /api/speed for the last 24h, or null. `jobs` is /api/jobs for the window, or null while it loads; `f` is the route query. */
export function renderFactoryJobs(d, day, stage = "lead", jobs = null, f = {}) {
  const [key, name, text] = STAGES.find((s) => s[0] === stage) ?? STAGES[0];
  const scope = renderScope(jobs ?? [], { ...f, window: f.window ?? (f.days ? undefined : d.window) });
  const plot = (has, k, text) => (has ? chartBox(k, text) : empty("No time to plot in this window."));
  const timed = (d.times ?? []).filter((i) => i[key] > 0);
  return `<div class="page sp" id="perf">${pageHead("Jobs", { count: lastPeriod(d), aside: scope })}` +
    tiles("Stages", STAGES.map((s) => stageTile(s, d, day, s[0] === key)).join("")) +
    `<div class="trio">${card(`${name}: p50 and p90 by ${bucketOf(d)[0].toUpperCase()}${bucketOf(d).slice(1)}`, `<p>${esc(text)}</p>${plot(d.buckets.some((b) => b[key] > 0 || b.p90?.[key] > 0), "trend", label(d, key, sentence(name), "p50 and p90 trend"))}`, { label: `${sentence(name)}: p50 and p90 by ${bucketOf(d)}` })}` +
    card(`${name}: Time per Issue`, `<p>One dot per issue, by outcome: its time across, its filing time up.</p>${plot(timed.some((i) => i.filed != null), "strip", label(d, key, sentence(name), "time per issue"))}`, { label: `${sentence(name)}: time per issue` }) +
    card("Slowest 10", `<p>${key === "lead" ? "The slowest stages of any issue; an issue with two slow stages has two rows." : "The issues with the slowest stage."} Click one to open it.</p>${plot(timed.length, "slowest", label(d, key, sentence(name), "slowest 10"))}`) + `</div>` +
    `<div class="pair">${card("Checks", table(["Check", "Jobs", "p50", "p90"], ["Jobs", "p50", "p90"], d.checks.map((x) => [x.name, x.count, dur(x.p50), dur(x.p90)])))}` +
    card("Build Time by Model", table(["Model", "Jobs", "p50"], ["Jobs", "p50"], d.models.map((m) => [m.model === "unset" ? "not recorded" : m.model, m.count, dur(m.p50)])), { label: "Build time by model" }) + `</div>` +
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
  api: (_params, q = new URLSearchParams()) => withProject(`/api/speed?window=${windowOf(q)}`, q),
  refresh: 60,
  render: (d, _params, q) => renderFactoryJobs(d, usable("day"), q?.get("stage") ?? "lead", jobsNow(q ?? new URLSearchParams()), Object.fromEntries(q ?? [])),
  mount: async (root, d) => {
    keepWindow(windowShown(Object.fromEntries(hashQuery())) || d.window || windowOf(hashQuery()));
    keepProject(projectNow());
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
      const made = mountCharts(root, opts), top = slowest(d, key);
      made.get("strip")?.on("click", (p) => { if (p.data?.href) location.hash = p.data.href; });
      made.get("slowest")?.on("click", (p) => { const h = p.data?.href ?? (p.componentType === "yAxis" ? top.find((r) => r.label === p.value)?.href : null); if (h) location.hash = h; });
      drawn.push(...made.values());
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
