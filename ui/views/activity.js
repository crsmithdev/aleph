// The Activity view: a 30-day strip of small numbers, then cost per day as one
// bar chart, then a table each for models, tools, hooks, verify-gate denials
// and factory runs. `data` is /api/activity/view: { activity, summary }.
import { chart, empty, error, esc, money } from "../lib.js";

export const view = {
  path: "/activity",
  title: "Activity",
  group: "activity",
  order: 2,
  api: "/api/activity/view?days=7",
  refresh: 60,
  render: (d) => renderActivity(d),
  mount: (root, d) => mountChart(root, d),
};

const STYLE = `<style>
.act table { border-collapse: collapse; width: 100%; font: 13px var(--sans); }
.act th, .act td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--rule-2); }
.act th { color: var(--muted); font-weight: 500; }
.act td.n, .act th.n { text-align: right; font-variant-numeric: tabular-nums; }
.act .bad { color: var(--stuck); }
.act .strip30 { display: flex; gap: 2px; overflow-x: auto; margin: 0 0 20px; }
.act .strip30 .d { flex: 1 0 34px; text-align: center; font: 11px var(--sans); color: var(--muted); border-top: 1px solid var(--rule); padding-top: 4px; }
.act .strip30 b { display: block; font: 500 13px var(--sans); color: var(--ink); font-variant-numeric: tabular-nums; }
.act .strip30 .z b { color: var(--muted); font-weight: 400; }
.act .chart { width: 100%; max-width: 720px; height: 200px; }
</style>`;

const short = (day) => day.slice(5);
const sh = (title, aside = "") => `<div class="sh"><h2>${esc(title)}</h2>${aside ? `<span class="aside">${esc(aside)}</span>` : ""}</div>`;
const table = (head, rows) =>
  `<table><thead><tr>${head.map(([h, n]) => `<th${n ? ' class="n"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;

/** The 30-day strip: per day, the goals delivered, items done, commits, runs and cost. */
export function renderStrip(s) {
  const cell = (r) => {
    const zero = !r.goals && !r.items && !r.commits && !r.runs && !r.cost;
    return `<div class="d${zero ? " z" : ""}" title="${esc(`${r.day}: ${r.goals} goals delivered, ${r.items} items done, ${r.commits} commits, ${r.runs} runs, ${money(r.cost)}`)}">${esc(short(r.day))}` +
      `<b>${r.goals}</b><b>${r.items}</b><b>${r.commits}</b><b>${r.runs}</b><b>$${r.cost.toFixed(2)}</b></div>`;
  };
  const legend = `<div class="d"><span>day</span><b>goals</b><b>items</b><b>commits</b><b>runs</b><b>cost</b></div>`;
  return sh("Last 30 days", "goals delivered, items done, commits on main, factory runs, cost") +
    `<div class="strip30" role="group" aria-label="Last 30 days">${legend}${s.days.map(cell).join("")}</div>`;
}

/** The chart's mount point; `mount` draws into it. */
export const renderChart = (days) => `<div class="chart" role="img" aria-label="Cost per day" data-days="${days.length}"></div>`;

/** The ECharts option: one bar per day at the day's cost. Colours come from the chart theme. */
export function chartOption(days) {
  return {
    grid: { left: 56, right: 12, top: 12, bottom: 28 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (p) => { const q = [].concat(p)[0]; return `${esc(q.name)}<br>${money(q.value)}`; } },
    xAxis: { type: "category", data: days.map((d) => d.day), axisLabel: { formatter: short } },
    yAxis: { type: "value", axisLabel: { formatter: (v) => `$${v}` } },
    series: [{ type: "bar", name: "Cost", data: days.map((d) => d.cost) }],
  };
}

let drawn = null;
/** Draw the cost chart into the view's root, after render put its markup there. */
export function mountChart(root, d) {
  drawn?.dispose();
  drawn = null;
  const el = root.querySelector(".chart");
  if (el && d?.activity) drawn = chart(el, chartOption(d.activity.cost));
}

const counts = (rows, word) => rows.length
  ? table([[word], ["Calls", 1], ["Errors", 1]], rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${r.calls}</td><td class="n${r.errors ? " bad" : ""}">${r.errors}</td></tr>`))
  : empty(`No ${word.toLowerCase()} calls in this period.`);

export function renderActivity(d) {
  if (!d) return `<div class="page">${error("No data.")}</div>`;
  const { activity: a, summary: s } = d;
  const total = a.cost.reduce((x, c) => x + c.cost, 0);
  const lf = a.langfuse === "off" ? empty("Langfuse is not configured.", "Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in <code>~/.aleph/.env</code>.")
    : a.langfuse === "error" ? error(`Langfuse failed: ${a.error}`, "Check that Langfuse is running, then reload.") : "";
  return `${STYLE}<div class="page act"><h1>Activity</h1>` + renderStrip(s) +
    sh(`Cost per day, last ${a.days.length} days`, money(total) + " in all") + (lf || renderChart(a.cost)) +
    (lf ? "" :
      sh("Cost per model") + (a.models.length ? table([["Model"], ["Calls", 1], ["Cost", 1]], a.models.map((m) => `<tr><td>${esc(m.model)}</td><td class="n">${m.calls}</td><td class="n">${money(m.cost)}</td></tr>`)) : empty("No model calls in this period.")) +
      sh("Tools") + counts(a.tools, "Tool") +
      sh("Hooks") + counts(a.hooks, "Hook") +
      sh("Verify-gate denials", String(a.denials.total)) +
      (a.denials.recent.length ? table([["When"], ["Reason"]], a.denials.recent.map((r) => `<tr><td>${esc(r.at.slice(0, 16).replace("T", " "))}</td><td>${esc(r.reason)}</td></tr>`)) : empty("The gate denied nothing in this period."))) +
    sh("Factory runs per day") +
    table([["Day"], ["Runs", 1], ["Cost", 1]], a.runs.map((r) => `<tr><td>${esc(r.day)}</td><td class="n">${r.runs}</td><td class="n">${money(r.cost)}</td></tr>`)) +
    `</div>`;
}
