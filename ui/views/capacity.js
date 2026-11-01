// The Capacity page: the usage, the slots and who used them. `s` is /api/state; the agents come from /api/speed for the week.
import { chart, esc, readTokens } from "../lib.js";
import { dur, head, hours, loadSpeed, pace, small, tile, usable, usageAge, usageTile, xLabel } from "./speed.js";

/** The sentence at the head. */
export function headline(s) {
  const p = pace(s);
  const age = usageAge(s);
  return p ? `Usage is ${p.word} pace: ${Math.round(p.used)}% used, ${p.gone.toFixed(1)}% of the week gone${age ? ` (${age})` : ""}.` : "Usage is unknown.";
}

/** Each point's total live agents over the timed roles. */
export const totals = (a) => a.points.map((p) => a.roles.reduce((n, r) => n + (p[r.key] ?? 0), 0));

/** The roles with each timed role's share of the timed hours. */
export function roleRows(a) {
  const all = a.roles.reduce((n, r) => n + (r.hours ?? 0), 0);
  return a.roles.map((r) => ({ ...r, share: r.hours === null || !all ? null : (r.hours / all) * 100 }));
}
const shareText = (v) => (v === null ? "–" : `${v < 1 ? v.toFixed(1) : Math.round(v)}%`);

function tiles(s, a) {
  const f = s.factory, live = a && totals(a);
  return usageTile(s) +
    tile("Runs today", String(f.runsToday), small(`$${(f.costToday ?? 0).toFixed(2)} recorded cost`) + small(f.dayCap > 0 ? `day cap ${f.dayCap}` : "no day cap")) +
    `<div class="tile"><span class="k">Worker slots</span><b>${f.liveRuns ?? 0} <em>of ${f.liveCap}</em></b>${small("in use now")}</div>` +
    tile("Agents live", a ? a.mean.toFixed(1) : "–", a ? small(`mean, all roles, peak ${a.peak}`) + small(`${live.filter((v) => v === 0).length} of ${live.length} steps had no agent live`) : small("Loading…"));
}

function roles(a) {
  const rows = roleRows(a).map((r) => `<tr><th scope="row">${esc(r.name)}</th><td>${r.runs}</td><td>${r.hours === null ? "not timed" : esc(hours(r.hours))}</td><td>${esc(shareText(r.share))}</td><td>${esc(dur(r.p50))}</td><td>${esc(r.models.join(", ")) || "–"}</td></tr>`).join("");
  return `<div class="wrap"><table class="roles"><thead><tr><th scope="col">Role</th><th scope="col">Runs</th><th scope="col">Hours</th><th scope="col">Share of hours</th><th scope="col">p50</th><th scope="col">Models</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** The page body. `d` is /api/speed for the week, or null while it loads. */
export function renderCapacity(s, d) {
  const a = d?.agents ?? null;
  const wait = `<p role="status">${esc(speedError(d) ?? "Loading…")}</p>`;
  return `<div class="page sp" id="capacity">${head(headline(s))}<section aria-label="Scorecard" class="tiles">${tiles(s, a)}</section>` +
    `<section class="card" aria-label="Agents live"><h2>Agents live</h2>${a ? `<div class="livechart" role="img" aria-label="Agents live over the last 7 days"></div>` : wait}</section>` +
    `<section class="card" aria-label="Agent roles"><h2>Roles</h2>${a ? roles(a) : wait}</section></div>`;
}
const speedError = (d) => d?.error ?? null;

/** The chart option: one area of total agents live. */
export function liveOption(d, color) {
  const vals = totals(d.agents);
  const stamp = (at) => new Date(at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  return {
    animation: false,
    color: [color],
    grid: { left: 24, right: 16, top: 8, bottom: 20 },
    tooltip: { trigger: "axis", confine: true, formatter: (p) => { const q = [].concat(p)[0]; return `${esc(stamp(d.agents.points[q.dataIndex].at))}<br>${esc(q.value.toFixed(1))} live`; } },
    xAxis: { type: "category", boundaryGap: false, data: d.agents.points.map((p) => xLabel(p.at, d.window)), axisTick: { show: false }, axisLabel: { interval: 23, hideOverlap: true } },
    yAxis: { type: "value", min: 0, minInterval: 1, splitLine: { lineStyle: { opacity: 0.5 } }, axisTick: { show: false } },
    series: [{ type: "line", step: "end", symbol: "none", lineStyle: { width: 0 }, areaStyle: { opacity: 0.85 }, data: vals }],
  };
}

let drawn = null;
export const view = {
  path: "/status/capacity",
  title: "Capacity",
  group: "factory",
  order: 0.3,
  sub: true,
  icon: "battery-half",
  api: "/api/state",
  refresh: 60,
  render: (s) => renderCapacity(s, usable("week")),
  mount: async (root, s) => {
    const draw = (d) => {
      drawn?.dispose();
      drawn = null;
      const el = root.querySelector(".livechart");
      if (el && d?.agents && globalThis.echarts) drawn = chart(el, liveOption(d, readTokens().run));
    };
    draw(usable("week"));
    const d = await loadSpeed("week");
    if (!root.querySelector("#capacity")) return;
    root.innerHTML = renderCapacity(s, d);
    draw(d);
  },
};
