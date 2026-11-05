// The Jobs page: how long each stage of the work takes. `d` is /api/speed for the window.
import { barList, barRow, barsOption, card, chart, dataTable, dur, error, esc, failMessage, hashQuery, heads, loadingLine, onTile, pageHead, readTokens, keepWindow, searchBox, setQuery, small, tile, tiles, windowOf, wireScope } from "../lib.js";
import { listUrl, renderFilters, renderJobsTable, renderScope, windowShown, wireJobs } from "./jobs.js";
import { bucketOf, durShort, lastPeriod, loadSpeed, trendOn, usable, xLabel } from "./speed.js";

export const STAGES = [
  ["lead", "Lead time", "From filing to the last land. The stages do not add up to it, because medians do not add."],
  ["intake", "Intake", "From filing to the end of the first intake."],
  ["queue", "Queue", "From intake to the first agent run. This includes waits for a slot or for another issue."],
  ["implement", "Build", "From the first agent run to the last finish with work to land."],
  ["land", "Land", "From the finish to the land. This includes waits for a review or for Chris."],
];
const BINS = ["under 1m", "1–5m", "5–15m", "15–30m", "30m–1h", "1–4h", "over 4h"];
const SLOW_BINS = 5;

const stageTile = ([key, name], d, day, on) => {
  const c = d.phases[key], dc = day?.phases?.[key], none = !c.count;
  return tile({ k: name, v: none ? "–" : durShort(c.p50), body: small(`p90 ${none ? "–" : dur(c.p90)}`) + (trendOn(d) ? small(dc?.count ? `${dur(dc.p50)} in the last 24h` : "none in the last 24h") : ""), key, on });
};

/** The ECharts option for a stage's times. The slowest bins take the hot colour. */
export const histOption = (c, name, t) => barsOption(BINS, [{ name, data: c.hist ?? BINS.map(() => 0), color: (p) => (p.dataIndex >= SLOW_BINS ? t.hot : t.run) }], { labels: true });

const histLabel = (c, name) => `${name} times: ${(c.hist ?? []).join(", ")} issues from under 1 minute to over 4 hours`;

function days(d, key) {
  const vals = d.buckets.map((b) => b[key]), max = Math.max(1, ...vals.map((v) => v ?? 0));
  return barList(d.buckets.map((b, i) => barRow(esc(xLabel(b.at, d.window)), ((vals[i] ?? 0) / max) * 100, esc(dur(vals[i])))).join(""));
}

const table = (labels, num, rows) => dataTable(heads(labels, num), rows.map(([h, ...cells]) => `<tr><td class="wide">${esc(h)}</td>${cells.map((c) => `<td class="num">${esc(c)}</td>`).join("")}</tr>`).join(""));

/** The page body for a stage. `day` is /api/speed for the last 24h, or null. `jobs` is /api/jobs for the window, or null while it loads; `f` is the route query. */
export function renderFactoryJobs(d, day, stage = "lead", jobs = null, f = {}) {
  const [key, name, text] = STAGES.find((s) => s[0] === stage) ?? STAGES[0], c = d.phases[key];
  const over = (c.hist ?? [])[6] ?? 0;
  const scope = renderScope(jobs ?? [], { ...f, window: f.window ?? (f.days ? undefined : d.window) });
  return `<div class="page sp" id="perf">${pageHead("Jobs", { count: lastPeriod(d), aside: scope })}` +
    tiles("Stages", STAGES.map((s) => stageTile(s, d, day, s[0] === key)).join("")) +
    `<div class="split">${card(`${name}: how long it took`, `<p>${esc(text)} ${over} of ${c.count} took over 4h in the ${lastPeriod(d)}.</p><div class="chartbox" role="img" aria-label="${esc(histLabel(c, name))}"></div>`)}` +
    card(`Median by ${bucketOf(d)}`, days(d, key) + `<p>Longest: ${esc(c.count ? dur(c.worst) : "–")}.</p>`) + `</div>` +
    `<div class="pair">${card("Checks", table(["Check", "Runs", "p50", "p90"], ["Runs", "p50", "p90"], d.checks.map((x) => [x.name, x.count, dur(x.p50), dur(x.p90)])))}` +
    card("Build time by model", table(["Model", "Runs", "p50"], ["Runs", "p50"], d.models.map((m) => [m.model === "unset" ? "not recorded" : m.model, m.count, dur(m.p50)]))) + `</div>` +
    card("Jobs", searchBox("jobs-search", f.q, "Search ids and titles") + renderFilters(f) + `<div id="jobs-table">${jobs ? renderJobsTable(jobs, f) : loadingLine("jobs")}</div>`) + `</div>`;
}

/** The old address. */
export const redirect = (hash) => {
  const [path, query] = String(hash ?? "").split(/\?(.*)/s);
  return path === "#/status/performance" ? "#/factory/jobs" : path === "#/jobs" ? `#/factory/jobs${query ? `?${query}` : ""}` : null;
};

let drawn = null;
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
      const stage = hashQuery().get("stage") ?? "lead", [key, name] = STAGES.find((s) => s[0] === stage) ?? STAGES[0];
      onTile(root.querySelector("#perf"), (k) => {
        setQuery({ stage: k });
        root.innerHTML = draw(k);
        wire();
        root.querySelector(`button[data-tile="${k}"]`)?.focus();
      });
      wireScope(root);
      drawn?.dispose();
      drawn = null;
      const el = root.querySelector(".chartbox");
      if (el && globalThis.echarts) drawn = chart(el, histOption(d.phases[key], name, readTokens()));
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
