// The Agents page: the usage, the slots and who used them. `s` is /api/state; the agents come from /api/speed for the window.
import { barsOption, card, cardTrend, chart, dataTable, dur, esc, filterBar, hashQuery, heads, keepWindow, lineOption, loadingLine, mean, money, onTile, pageHead, pct, setQuery, statCard, tiles, when, WINDOWS, windowOf, wireScope } from "../lib.js";
import { hours, lastPeriod, loadSpeed, pace, usable, usageAge, usageCard, xLabel } from "./speed.js";

/** Each point's total live agents over the timed roles. */
export const totals = (a) => a.points.map((p) => a.roles.reduce((n, r) => n + (p[r.key] ?? 0), 0));

function scorecard(s, a, key, w) {
  const f = s.factory, on = (k) => ({ key: k, on: key === k }), p = pace(s);
  return usageCard(s, on("usage"), usageAge(s) || (p ? `${p.word} pace, live` : "live, not the window")) +
    statCard({ k: "Runs today", v: String(f.runsToday), v2: money(f.costToday), q: ["runs", "recorded cost"], ...on("runs") }) +
    statCard({ k: "Worker slots", v: String(f.liveRuns ?? 0), v2: String(f.liveCap), q: ["in use", "cap"], ...on("slots") }) +
    statCard({ k: "Agents live", v: a ? mean(a.mean) : "–", ...(a ? { v2: String(a.peak), q: ["mean", "peak"] } : { note: "loading the agents" }), ...on("live") });
}

/** A success rate under this line (0 to 1) shows in the warn tone. */
export const WARN_RATE = 0.7;

function roles(a) {
  const num = ["Runs", "Succeeded", "Failed", "Timed out or stuck", "Success", "p50", "Cost", "First pass", "Reviewer pass", "Pass", "Fail"];
  const names = Object.fromEntries(a.roles.map((r) => [r.key, r.name]));
  const share = (v) => (v == null ? "–" : pct(v * 100));
  const cell = (v) => `<td class="num">${v ?? "–"}</td>`;
  const rows = (a.outcomes ?? []).map((o) => {
    const trend = cardTrend(o.rate, o.baseline, null, { kind: "points", lowerIsGood: false, format: share, basis: "the baseline", tip: `Baseline ${share(o.baseline)}` });
    const warn = o.rate != null && o.rate < WARN_RATE ? " warn" : "";
    return `<tr><td>${esc(names[o.role] ?? o.role)} · ${esc(o.model)}</td>${cell(o.runs)}${cell(o.succeeded)}${cell(o.failed)}${cell(o.stuck)}<td class="num${warn}">${esc(share(o.rate))} ${trend}</td><td class="num">${esc(dur(o.p50))}</td><td class="num">${esc(money(o.cost))}</td>${cell(o.firstPass)}<td class="num">${esc(share(o.reviewPass))}</td>${cell(o.pass)}${cell(o.fail)}<td><a href="#/factory/jobs?role=${esc(o.role)}&condition=failed">Failed runs</a></td></tr>`;
  }).join("");
  return dataTable(heads(["Role", ...num, "Jobs"], num), rows);
}

/** What each tile shows in the card below it: the title, and the chart's option from the two answers. Tokens come from the theme. */
export const DETAILS = {
  live: { title: "Agents live", option: (_s, d) => liveOption(d) },
  slots: { title: "Worker slots in use", option: (s, d) => slotsOption(d, s.factory.liveCap) },
  usage: { title: "Weekly usage since the last reset", option: (s) => usageOption(s.usage?.series ?? []) },
  runs: { title: "Runs started", option: (_s, d) => barsOption(d.buckets.map((b) => xLabel(b.at, d.window)), [{ name: "Runs", data: d.buckets.map((b) => b.runs ?? 0) }]) },
};

const stepOption = (d, name, vals) => lineOption(d.agents.points.map((p) => xLabel(p.at, d.window)), name, vals, { step: true, formatter: (p) => { const q = [].concat(p)[0]; return `${esc(when(d.agents.points[q.dataIndex].at))}<br>${esc(mean(q.value))} ${esc(name.toLowerCase())}`; } });

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
  const wait = d?.error ? `<p>${esc(d.error)}</p>` : loadingLine("the agents");
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
