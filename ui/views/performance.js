// The Performance page: how long each stage of the work takes. `d` is /api/speed for the week.
import { esc, pageHead } from "../lib.js";
import { dur, durShort, loadSpeed, usable, xLabel } from "./speed.js";

export const STAGES = [
  ["lead", "Lead time", "From filing to the last land. The stages do not add up to it, because medians do not add."],
  ["intake", "Triage", "From filing to the end of the first triage."],
  ["queue", "Queue", "From triage to the first agent run. This includes waits for a slot or for another issue."],
  ["implement", "Build", "From the first agent run to the last finish with work to land."],
  ["land", "Land", "From the finish to the land. This includes waits for a review or for Chris."],
];
const BINS = ["under 1m", "1–5m", "5–15m", "15–30m", "30m–1h", "1–4h", "over 4h"];
const SLOW_BINS = 5;

let pick = "lead";
export const resetPick = () => { pick = "lead"; };

const stageTile = ([key, name], d, day, on) => {
  const c = d.phases[key], dc = day?.phases?.[key];
  const none = !c.count;
  return `<button type="button" class="tile" data-stage="${key}" aria-pressed="${on}"><span class="k">${esc(name)}</span><b>${esc(none ? "–" : durShort(c.p50))}</b><small>p90 ${esc(none ? "–" : dur(c.p90))}</small><small>${dc?.count ? `${esc(dur(dc.p50))} in the last 24 h` : "none in the last 24 h"}</small></button>`;
};

function histogram(c, name) {
  const hist = c.hist ?? BINS.map(() => 0), max = Math.max(1, ...hist);
  const bars = hist.map((n, i) => `<div class="hbar"><span>${n}</span><div class="${i >= SLOW_BINS ? "slow" : ""}" style="height:${n ? Math.max(2, (n / max) * 85) : 0}%"></div></div>`).join("");
  return `<div class="hist" role="img" aria-label="${esc(`${name} times: ${hist.join(", ")} issues from under 1 minute to over 4 hours`)}">${bars}</div><div class="hbins" aria-hidden="true">${BINS.map((b) => `<span>${b}</span>`).join("")}</div>`;
}

function days(d, key) {
  const vals = d.buckets.map((b) => b[key]), max = Math.max(1, ...vals.map((v) => v ?? 0));
  return d.buckets.map((b, i) => `<div class="dayrow"><span>${esc(xLabel(b.at, d.window))}</span><div><i style="width:${((vals[i] ?? 0) / max) * 100}%"></i></div><span>${esc(dur(vals[i]))}</span></div>`).join("");
}

const table = (cols, rows) => `<table><thead><tr>${cols.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map(([h, ...cells]) => `<tr><th scope="row">${esc(h)}</th>${cells.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;

/** The page body for a stage. `day` is /api/speed for the last 24 h, or null. */
export function renderPerformance(d, day, stage = pick) {
  const cur = STAGES.find((s) => s[0] === stage) ?? STAGES[0];
  const [key, name, text] = cur, c = d.phases[key];
  const over = (c.hist ?? [])[6] ?? 0;
  return `<div class="page sp" id="perf">${pageHead("Performance")}` +
    `<section aria-label="Stages" class="tiles">${STAGES.map((s) => stageTile(s, d, day, s[0] === key)).join("")}</section>` +
    `<div class="split"><section class="card wide2" aria-label="Time distribution"><h2>${esc(name)}: how long it took</h2><p>${esc(text)} ${over} of ${c.count} took over 4 h.</p>${histogram(c, name)}</section>` +
    `<section class="card" aria-label="Median by day"><h2>Median by day</h2>${days(d, key)}<p class="foot">Longest: ${esc(c.count ? dur(c.worst) : "–")}.</p></section></div>` +
    `<div class="pair"><section class="card" aria-label="Checks"><h2>Checks</h2>${table(["Check", "Runs", "p50", "p90"], d.checks.map((x) => [x.name, x.count, dur(x.p50), dur(x.p90)]))}</section>` +
    `<section class="card" aria-label="Worker models"><h2>Build time by model</h2>${table(["Model", "Runs", "p50"], d.models.map((m) => [m.model === "unset" ? "not recorded" : m.model, m.count, dur(m.p50)]))}</section></div></div>`;
}

export const view = {
  path: "/status/performance",
  title: "Performance",
  group: "factory",
  order: 0.1,
  sub: true,
  icon: "stopwatch",
  api: "/api/speed?window=week",
  refresh: 60,
  render: (d) => renderPerformance(d, usable("day")),
  mount: async (root, d) => {
    const wire = () => root.querySelector("#perf")?.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-stage]");
      if (!b) return;
      pick = b.dataset.stage;
      draw();
      root.querySelector(`button[data-stage="${pick}"]`)?.focus();
    });
    const draw = () => { root.innerHTML = renderPerformance(d, usable("day")); wire(); };
    wire();
    await loadSpeed("day");
    if (root.querySelector("#perf")) draw();
  },
};
