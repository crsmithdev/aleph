// The Agents page: the usage, the slots and who used them. `s` is /api/state; the agents come from /api/speed for the window.
import { barsOption, card, chart, dataTable, dur, esc, filterBar, hashQuery, heads, keepWindow, lineOption, onTile, pageHead, pct, setQuery, small, tile, tiles, when, WINDOWS, windowOf, wireScope } from "../lib.js";
import { hours, lastPeriod, loadSpeed, usable, usageTile, xLabel } from "./speed.js";

/** Each point's total live agents over the timed roles. */
export const totals = (a) => a.points.map((p) => a.roles.reduce((n, r) => n + (p[r.key] ?? 0), 0));

/** The roles with each timed role's share of the timed hours. */
export function roleRows(a) {
  const all = a.roles.reduce((n, r) => n + (r.hours ?? 0), 0);
  return a.roles.map((r) => ({ ...r, share: r.hours === null || !all ? null : (r.hours / all) * 100 }));
}

function scorecard(s, a, key, w) {
  const f = s.factory, live = a && totals(a), on = (k) => ({ key: k, on: key === k });
  return usageTile(s, on("usage"), small("live, not the window")) +
    tile({ k: "Runs today", v: String(f.runsToday), body: small(`$${(f.costToday ?? 0).toFixed(2)} recorded cost`) + small("live, not the window"), ...on("runs") }) +
    tile({ k: "Worker slots", vHtml: `${f.liveRuns ?? 0} <em>of ${f.liveCap}</em>`, body: small("live, in use now"), ...on("slots") }) +
    tile({ k: "Agents live", v: a ? a.mean.toFixed(1) : "–", body: a ? small(`mean, all roles, peak ${a.peak}, ${lastPeriod(w)}`) + small(`${live.filter((v) => v === 0).length} of ${live.length} steps had no agent live`) : small("Loading…"), ...on("live") });
}

function roles(a) {
  const num = ["Runs", "Hours", "Share of hours", "p50"];
  const rows = roleRows(a).map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.runs}</td><td class="num">${r.hours === null ? "not timed" : esc(hours(r.hours))}</td><td class="num">${esc(pct(r.share))}</td><td class="num">${esc(dur(r.p50))}</td><td class="wide">${esc(r.models.join(", ")) || "–"}</td></tr>`).join("");
  return dataTable(heads(["Role", ...num, "Models"], num), rows);
}

/** What each tile shows in the card below it: the title, and the chart's option from the two answers. Tokens come from the theme. */
export const DETAILS = {
  live: { title: "Agents live", option: (_s, d) => liveOption(d) },
  slots: { title: "Worker slots in use", option: (s, d) => slotsOption(d, s.factory.liveCap) },
  usage: { title: "Weekly usage since the last reset", option: (s) => usageOption(s.usage?.series ?? []) },
  runs: { title: "Runs started", option: (_s, d) => barsOption(d.buckets.map((b) => xLabel(b.at, d.window)), [{ name: "Runs", data: d.buckets.map((b) => b.runs ?? 0) }]) },
};

const fixed = (v) => (v == null ? "–" : Number(v).toFixed(1));
const stepOption = (d, name, vals) => lineOption(d.agents.points.map((p) => xLabel(p.at, d.window)), name, vals, { step: true, formatter: (p) => { const q = [].concat(p)[0]; return `${esc(when(d.agents.points[q.dataIndex].at))}<br>${esc(fixed(q.value))} ${esc(name.toLowerCase())}`; } });

/** The chart option: one area of total agents live. */
export const liveOption = (d) => stepOption(d, "Live", totals(d.agents));

/** One area of the worker agents, and a line at the cap. */
export function slotsOption(d, cap) {
  const o = stepOption(d, "Workers", d.agents.points.map((p) => p.worker ?? 0));
  o.series[0].markLine = { silent: true, symbol: "none", label: { formatter: `cap ${cap}` }, data: [{ yAxis: cap }] };
  return o;
}

export const usageOption = (series) => lineOption(series.map((p) => when(p.at)), "Used, %", series.map((p) => Math.round(p.seven_day * 10) / 10), { max: 100 });

/** The page body. `d` is /api/speed for the window, or null while it loads; `key` is the selected tile. */
export function renderFactoryAgents(s, d, key = "live", window = "week") {
  const win = d?.window ?? window, w = { window: win }, a = d?.agents ?? null, cur = DETAILS[key] ? key : "live";
  const wait = `<p role="status">${esc(d?.error ?? "Loading…")}</p>`;
  const scope = filterBar([{ name: "window", value: win, options: WINDOWS }]);
  return `<div class="page sp" id="capacity">${pageHead("Agents", { count: lastPeriod(w), aside: scope })}${tiles("Scorecard", scorecard(s, a, cur, w))}` +
    card(DETAILS[cur].title, a ? `<div class="chartbox" role="img" aria-label="${esc(DETAILS[cur].title)}"></div>` : wait) +
    card("Roles", a ? roles(a) : wait) + `</div>`;
}

/** The old address. */
export const redirect = (hash) => (String(hash ?? "").split("?")[0] === "#/status/capacity" ? "#/factory/agents" : null);

const windowNow = () => windowOf(hashQuery());
const picked = () => hashQuery().get("tile") ?? "live";
let drawn = null;

export const view = {
  path: "/factory/agents",
  title: "Agents",
  group: "factory",
  order: 2,
  icon: "robot",
  api: "/api/state",
  refresh: 60,
  render: (s, _params, q) => renderFactoryAgents(s, usable(windowOf(q)), q?.get("tile") ?? "live", windowOf(q)),
  mount: async (root, s) => {
    const draw = (d) => {
      root.innerHTML = renderFactoryAgents(s, d, picked(), windowNow());
      wireScope(root);
      onTile(root.querySelector("#capacity"), (k) => { setQuery({ tile: k === "live" ? "" : k }); draw(d); root.querySelector(`button[data-tile="${k}"]`)?.focus(); });
      drawn?.dispose();
      drawn = null;
      const el = root.querySelector(".chartbox"), detail = DETAILS[picked()] ?? DETAILS.live;
      if (el && d?.agents && globalThis.echarts) drawn = chart(el, detail.option(s, d));
    };
    keepWindow(windowNow());
    draw(usable(windowNow()));
    const d = await loadSpeed(windowNow());
    if (root.querySelector("#capacity")) draw(d);
  },
};
