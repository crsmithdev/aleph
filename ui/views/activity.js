// The Activity view: a 30-day strip of small numbers, then cost per day as one
// bar chart, then a table each for models, tools, hooks, verify-gate denials
// and factory runs. `data` is /api/activity/view: { activity, summary }.
import { empty, error, esc, money } from "../lib.js";

export const view = {
  path: "/activity",
  title: "Activity",
  group: "activity",
  order: 2,
  api: "/api/activity/view?days=7",
  refresh: 60,
  render: (d) => renderActivity(d),
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
.act .chart { width: 100%; height: auto; max-width: 720px; }
.act .chart text { fill: var(--muted); font: 11px var(--sans); }
.act .chart .col { fill: var(--run); }
.act .chart .axis { stroke: var(--rule); }
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

/** One bar per day, scaled to the day's cost. Inline SVG on the page's tokens, so both themes read. */
export function renderChart(days) {
  const W = 720, H = 180, L = 44, B = 22, T = 8;
  const max = Math.max(...days.map((d) => d.cost), 0.0001);
  const slot = (W - L) / Math.max(days.length, 1), bw = Math.max(slot * 0.7, 2);
  const bars = days.map((d, i) => {
    const h = Math.round(((H - B - T) * d.cost) / max * 10) / 10;
    const x = L + i * slot + (slot - bw) / 2;
    return `<rect class="col" x="${x.toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h}"><title>${esc(`${d.day}: ${money(d.cost)}`)}</title></rect>` +
      (days.length <= 14 || i % Math.ceil(days.length / 10) === 0 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(short(d.day))}</text>` : "");
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cost per day">` +
    `<line class="axis" x1="${L}" y1="${H - B}" x2="${W}" y2="${H - B}"/>` +
    `<text x="${L - 6}" y="${T + 8}" text-anchor="end">${esc(`$${max.toFixed(2)}`)}</text><text x="${L - 6}" y="${H - B}" text-anchor="end">$0</text>` +
    bars + `</svg>`;
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
