// The Agents page: the usage, the slots and who used them. `s` is /api/state; the agents come from /api/speed for the window.
import { barsOption, card, cardTrend, chart, dataTable, dur, esc, hashQuery, heads, keepProject, keepWindow, loadingLine, money, pageHead, pct, projectNow, readTokens, scopeBar, stackedAreaOption, statCard, tiles, windowOf, wireScope, withProject } from "../lib.js";
import { lastPeriod, loadSpeed, pace, usable, usageAge, usageCard, xLabel } from "./speed.js";

const share = (v) => (v == null ? "–" : pct(v * 100));
const rateCard = (k, v, base, note) => statCard({ k, v: share(v), note, trend: cardTrend(v, base, null, { kind: "points", lowerIsGood: false, format: share, basis: "the baseline", tip: `Baseline ${share(base)}` }) });

function scorecard(s, a, w) {
  const f = s.factory, p = pace(s);
  return usageCard(s, {}, usageAge(s) || (p ? `${p.word} pace, live` : "live, not the window")) +
    statCard({ k: "Worker slots", v: String(f.liveRuns ?? 0), v2: String(f.liveCap), q: ["in use", "cap"] }) +
    rateCard("Success rate", a?.rates?.success, a?.rates?.baseline, "ended runs, all roles") +
    rateCard("Worker first pass", a?.rates?.firstPass, null, "landed builds, no fix round") +
    rateCard("Local share", a?.rates?.local, null, "runs on gpt-oss-20b");
}

/** A success rate under this line (0 to 1) shows in the warn tone. */
export const WARN_RATE = 0.7;

function roles(a) {
  const num = ["Runs", "Succeeded", "Failed", "Timed out or stuck", "Success", "p50", "Cost", "First pass", "Reviewer pass", "Pass", "Fail"];
  const names = Object.fromEntries(a.roles.map((r) => [r.key, r.name]));
  const cell = (v) => `<td class="num">${v ?? "–"}</td>`;
  const rows = (a.outcomes ?? []).map((o) => {
    const trend = cardTrend(o.rate, o.baseline, null, { kind: "points", lowerIsGood: false, format: share, basis: "the baseline", tip: `Baseline ${share(o.baseline)}` });
    const warn = o.rate != null && o.rate < WARN_RATE ? " warn" : "";
    return `<tr><td>${esc(names[o.role] ?? o.role)} · ${esc(o.model)}</td>${cell(o.runs)}${cell(o.succeeded)}${cell(o.failed)}${cell(o.stuck)}<td class="num${warn}">${esc(share(o.rate))} ${trend}</td><td class="num">${esc(dur(o.p50))}</td><td class="num">${esc(money(o.cost))}</td>${cell(o.firstPass)}<td class="num">${esc(share(o.reviewPass))}</td>${cell(o.pass)}${cell(o.fail)}<td><a href="#/factory/jobs?role=${esc(o.role)}&condition=failed">Failed runs</a></td></tr>`;
  }).join("");
  return dataTable(heads(["Role", ...num, "Jobs"], num), rows);
}

const legend = { top: 0, right: 0, itemWidth: 10, itemHeight: 10 };
const stacked = (o) => ({ ...o, grid: { ...o.grid, top: 24 }, legend, series: o.series.map((s) => ({ ...s, stack: "all" })) });
const timed = (a) => a.roles.filter((r) => r.hours != null);

/** The live chart: one stacked area per timed role, in `--series-1` to `--series-5`. `t` is the page tokens. */
export function liveOption(d, t) {
  const o = stackedAreaOption(d.agents.points.map((p) => xLabel(p.at, d.window)), timed(d.agents).map((r) => ({ name: r.name, data: d.agents.points.map((p) => p[r.key] ?? 0) })));
  o.series.forEach((s, i) => { s.color = t[`series-${i + 1}`]; });
  return o;
}

/** The outcomes chart: a stacked horizontal bar per role of succeeded, failed and stuck runs, summed over the models. */
export function outcomesOption(d, t) {
  const rows = d.agents.outcomes ?? [], rs = d.agents.roles.filter((r) => rows.some((o) => o.role === r.key));
  const sum = (r, k) => rows.filter((o) => o.role === r.key).reduce((n, o) => n + (o[k] ?? 0), 0);
  return {
    animation: false,
    grid: { left: 64, right: 16, top: 24, bottom: 20 },
    legend,
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" } },
    xAxis: { type: "value", minInterval: 1, splitLine: { show: true } },
    yAxis: { type: "category", inverse: true, data: rs.map((r) => r.name), axisTick: { show: false } },
    series: [["succeeded", "Succeeded", t.done], ["failed", "Failed", t.need], ["stuck", "Stuck", t.stuck]].map(([k, name, color]) => ({ type: "bar", name, stack: "all", barMaxWidth: 32, color, data: rs.map((r) => sum(r, k)) })),
  };
}

/** The cost chart: one stacked column per bucket, one series per model. */
export function costOption(d) {
  const models = [...new Set((d.buckets ?? []).flatMap((b) => Object.keys(b.cost ?? {})))].sort();
  const o = stacked(barsOption(d.buckets.map((b) => xLabel(b.at, d.window)), models.map((m) => ({ name: m, data: d.buckets.map((b) => b.cost?.[m] ?? 0) }))));
  o.yAxis.minInterval = 0;
  o.tooltip.valueFormatter = money;
  return o;
}

const labels = (d) => {
  const rows = d.agents.outcomes ?? [], sum = (k) => rows.reduce((n, o) => n + (o[k] ?? 0), 0);
  const cost = {};
  for (const b of d.buckets ?? []) for (const [m, c] of Object.entries(b.cost ?? {})) cost[m] = (cost[m] ?? 0) + c;
  return {
    live: `Agents live by role: ${timed(d.agents).map((r) => `${r.name} ${r.hours} hours`).join(", ")}`,
    outcomes: `Outcomes by role: ${sum("succeeded")} succeeded, ${sum("failed")} failed, ${sum("stuck")} stuck`,
    cost: `Cost by model: ${Object.entries(cost).map(([m, c]) => `${m} ${money(c)}`).join(", ") || "none"}`,
  };
};

/** Each tier's name and its Claude model; the other model each tier offers is gpt-oss-20b. */
const TIERS = { "worker-low": ["Worker low", "haiku"], "worker-medium": ["Worker medium", "sonnet"], merge: ["Merge", "haiku"], title: ["Title", "haiku"], judge: ["Judge", "haiku"] };
const FIXED = ["Intake", "Review", "Monitor", "Director"];

/** The Models card: a Claude | Local control per tier, the fixed roles, and the local server's state. `m` is /api/models, or null while it loads. */
function models(m) {
  if (!m) return card("Models", loadingLine("the models"), { id: "models" });
  const up = m.local === "up";
  const row = ([tier, [name, claude]]) => `<div class="cap-row"><b>${esc(name)}</b><div class="seg" role="group" aria-label="${esc(name)} model" data-tier="${esc(tier)}">` +
    [[claude, "Claude"], ["gpt-oss-20b", "Local"]].map(([v, l]) => `<button type="button" data-value="${v}" aria-pressed="${m.tiers[tier]?.model === v}"${l === "Local" && !up ? " disabled" : ""}>${l}</button>`).join("") + `</div></div>`;
  return card("Models", `<p class="quiet">Local server: ${up ? "up" : "down"}</p><div class="caps">` + Object.entries(TIERS).map(row).join("") +
    FIXED.map((n) => `<div class="cap-row"><b>${n}</b><span>Claude, fixed</span></div>`).join("") + `</div>`, { id: "models" });
}

/** The page body. `d` is /api/speed for the window, or null while it loads. */
export function renderFactoryAgents(s, d, _key = "live", window = "week", m = null) {
  const win = d?.window ?? window, w = { window: win }, a = d?.agents ?? null;
  const wait = d?.error ? `<p>${esc(d.error)}</p>` : loadingLine("the agents");
  const scope = scopeBar(projectNow(), win), l = a ? labels(d) : null;
  const box = (k) => `<div class="chartbox" data-chart="${k}" role="img" aria-label="${esc(l[k])}"></div>`;
  return `<div class="page sp" id="capacity">${pageHead("Agents", { count: lastPeriod(w), aside: scope })}${tiles("Scorecard", scorecard(s, a, w))}` +
    (a ? `<div class="trio">${card("Agents live by role", box("live"))}${card("Outcomes by role", box("outcomes"))}${card("Cost by model", box("cost"))}</div>` : card("Agents", wait)) +
    models(m) + card("Roles", a ? roles(a) : wait) + `</div>`;
}

/** The old address. */
export const redirect = (hash) => (String(hash ?? "").split("?")[0] === "#/status/capacity" ? "#/factory/agents" : null);

const windowNow = () => windowOf(hashQuery());
let drawn = [], modelsNow = null;
const post = (body) => fetch("/api/models", { method: "POST", headers: { "X-Aleph-UI": "1", "content-type": "application/json" }, body: JSON.stringify(body) });

export const view = {
  path: "/factory/agents",
  title: "Agents",
  group: "factory",
  order: 2,
  icon: "robot",
  api: (_params, q = new URLSearchParams()) => withProject("/api/state", q),
  refresh: 60,
  render: (s, _params, q) => renderFactoryAgents(s, usable(windowOf(q)), "live", windowOf(q)),
  mount: async (root, s) => {
    const draw = (d) => {
      root.innerHTML = renderFactoryAgents(s, d, "live", windowNow(), modelsNow);
      wireScope(root);
      for (const c of drawn) c.dispose();
      drawn = [];
      if (!d?.agents || !globalThis.echarts) return;
      const t = readTokens(), opts = { live: liveOption(d, t), outcomes: outcomesOption(d, t), cost: costOption(d) };
      for (const el of root.querySelectorAll(".chartbox")) drawn.push(chart(el, opts[el.dataset.chart]));
    };
    root.onclick = async (e) => {
      const b = e.target.closest?.("#models .seg button");
      if (!b || b.disabled) return;
      const res = await post({ tier: b.parentElement.dataset.tier, model: b.dataset.value });
      if (res.ok) { modelsNow = await res.json(); draw(usable(windowNow())); }
    };
    keepWindow(windowNow());
    keepProject(projectNow());
    draw(usable(windowNow()));
    modelsNow = await fetch("/api/models").then((r) => r.json()).catch(() => null);
    draw(usable(windowNow()));
    const d = await loadSpeed(windowNow());
    if (root.querySelector("#capacity")) draw(d);
  },
};
