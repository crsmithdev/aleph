// The speed parts of the Status page: how fast runs are. `d` is /api/speed. The render functions
// return HTML strings; `mountSpeed` fetches the data, draws the three ECharts and wires the control.
import { chart, esc, readTokens } from "../lib.js";

export const WINDOWS = [{ value: "hour", label: "Hour" }, { value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }];
export const DEFAULT_WINDOW = "week";
const WINDOW_TEXT = { hour: "the last hour", day: "the last 24 hours", week: "the last 7 days", month: "the last 30 days" };
const STEP_TEXT = { hour: "minute", day: "hour", week: "day", month: "day" };

/** Seconds as "43s", "4m 05s" or "1h 02m"; "–" for none. */
export function dur(s) {
  if (s === null || s === undefined || Number.isNaN(s)) return "–";
  s = Math.round(s);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
const hours = (h) => `${h.toFixed(h < 10 ? 1 : 0)} h`;
const pctText = (w) => `${Math.round((w || 0) * 100)}%`;
/** The p50 of a check by name, or null. */
export const checkP50 = (d, name) => d?.checks?.find((c) => c.name === name || c.name === `${name}s`)?.p50 ?? null;

/** A p50 and a p90 side by side: p50 large in the text color, p90 small and quiet. `f` formats a value. */
export const p5090 = (p50, p90, f = dur) => `<span class="pp"><span class="v">${esc(f(p50))}</span><span class="p90">p90 ${esc(f(p90))}</span></span>`;

const med = (k, c) => `<div class="med"><span class="k">${esc(k)}</span>${p5090(c.p50, c.p90)}<span class="runs">${c.count}</span></div>`;

/** The medians row: build, land, triage, plan, test. Each has the p50, the p90 and the run count. Build is the worker run of every goal, code or not, plus rechecks. */
export function renderMedians(d) {
  const tests = d.checks.find((c) => c.name === "tests" || c.name === "test") ?? { count: 0, p50: null, p90: null };
  return `<div class="meds">` +
    med("Build", d.kinds.agent) +
    ["land", "triage", "plan"].map((n) => med(n.charAt(0).toUpperCase() + n.slice(1), d.kinds[n])).join("") +
    med("Test", tests) + `</div>`;
}

const BAR_PX = 760;
const fmt = (v, measure) => (measure === "week" ? `${v.toFixed(1)}%` : hours(v));

/** The agent-time bar: the lost sentence, the brackets, one segment per class, the narrow line and the not-counted line. */
export function renderBar(d, { measure = "hours", pinned = null } = {}) {
  const cs = d.classes ?? [];
  const f = (v) => fmt(v, measure);
  const total = cs.reduce((a, c) => a + c[measure], 0);
  if (!(total > 0)) return `<div class="empty"><p class="hint">No agent run of a goal ended in this period.</p></div>`;
  const sum = (xs) => xs.reduce((a, c) => a + c[measure], 0);
  const good = sum(cs.slice(0, 2)), lost = sum(cs.slice(2));
  const share = (v) => Math.round((v / total) * 100);
  const sentence = `<p class="lost"><b>${esc(f(lost))}</b> of ${esc(f(total))} (${share(lost)}%) of agent time in ${WINDOW_TEXT[d.window]} went to runs whose work did not reach main.</p>`;
  const bracket = (v, t) => (v > 0 ? `<span class="bracket" style="flex:${v / total}">${t}</span>` : "");
  const brackets = `<div class="brackets">${bracket(good, "Reached main")}${bracket(lost, "Did not reach main")}</div>`;
  const live = cs.filter((c) => c[measure] > 0);
  const px = (c) => (c[measure] / total) * BAR_PX;
  const segs = live.map((c) => {
    const v = c[measure], w = px(c);
    const title = [c.text, ...(c.causes ?? []).slice(0, 5).map((x) => `${x.name}: ${f(x[measure])} · ${x.runs} runs`)].join("\n");
    const inside = w <= 70 ? "" : `<span class="nm">${esc(c.name)}</span>` + (w <= 8 + c.name.length * 7 + 90 ? "" : `<span class="val">${esc(f(v))} · ${share(v)}%</span>`);
    return `<button type="button" class="seg-${c.key}" data-class="${c.key}" style="flex:${v / total}" aria-pressed="${c.key === pinned}" aria-label="${esc(`${c.name}: ${f(v)}, ${share(v)}%`)}" title="${esc(title)}">${inside}</button>`;
  }).join("");
  const bar = `<div class="abar" role="group" aria-label="Agent time by what each run's work came to">${segs}</div>`;
  const thin = live.filter((c) => px(c) <= 70);
  const narrow = thin.length ? `<ul class="narrow">${thin.map((c) => `<li><button type="button" class="nar" data-class="${c.key}"><i class="sw seg-${c.key}"></i> ${esc(c.name)} <b>${esc(f(c[measure]))}</b></button></li>`).join("")}</ul>` : "";
  const nc = d.notCounted;
  const not = nc && nc.runs ? `<p class="quiet notcounted">Not counted: ${nc.runs} runs of ${nc.goals} open goals, ${hours(nc.hours)}</p>` : "";
  return sentence + brackets + bar + narrow + not;
}

const chartBox = (key, title, label) => `<figure class="chartbox"><figcaption>${esc(title)}</figcaption><div class="speedchart" data-chart="${key}" role="img" aria-label="${esc(label)}"></div></figure>`;

/** The three chart boxes; `mountSpeed` fills them. */
export const renderCharts = (d) => `<div class="charts3">` +
  chartBox("agent", `Build run time by ${STEP_TEXT[d.window]} (median)`, "Median build run time per bucket") +
  chartBox("tests", `Test time by ${STEP_TEXT[d.window]} (median)`, "Median test time per bucket") +
  chartBox("lands", `Lands by ${STEP_TEXT[d.window]}`, "Lands per bucket") + `</div>`;

const loading = (what, d) => (!d ? `<p class="quiet loading" role="status">Loading ${what}…</p>` : `<div class="empty"><p class="hint">${esc(d.error)}</p></div>`);

/** The Speed block: the medians and the three charts. `d` is null while loading, `{error}` on a failed load. */
export function renderSpeedTop(d) {
  const head = `<div class="sh sub"><h2 id="h-speed">Speed</h2></div>`;
  if (!d || d.error) return head + loading("speed", d);
  return head + renderMedians(d) + renderCharts(d);
}

// Duplicated from ui/api/speed.ts: keep the texts identical.
const CLASS_NAME = { landed: "Landed", fixed: "Fixed in place", nothing: "Nothing to do", loop: "Loop", restarted: "Restarted", dropped: "Dropped" };
const CLASS_TEXT = {
  landed: "The run whose work landed on main.",
  fixed: "A run of the landing job before the run that landed: a fix round the goal needed.",
  nothing: "A run that started after its goal had landed, or found the work already on main.",
  loop: "A run that was the 4th or later start of its goal inside an hour.",
  restarted: "A run of an earlier job of a goal whose later job landed.",
  dropped: "A run of a goal that was then dropped or closed without landing.",
};

/** The class shown under the bar: the pinned one if it has a value, else the largest of classes 3 to 6; null when all are 0. */
export function shownClass(d, measure = "hours", pinned = null) {
  const cs = d.classes ?? [];
  if (pinned && cs.some((c) => c.key === pinned && c[measure] > 0)) return pinned;
  let best = null;
  for (const c of cs.slice(2)) if (c[measure] > 0 && (!best || c[measure] > best[measure])) best = c;
  return best?.key ?? null;
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The breakdown of one class: its causes and the goals that took the most. "" when `key` is null. */
export function renderBreakdown(d, key, measure = "hours") {
  const c = key && (d.classes ?? []).find((x) => x.key === key);
  if (!c) return "";
  const other = measure === "week" ? "hours" : "week";
  const f = (v) => esc(fmt(v, measure));
  const alt = d.hasWeek ? `${esc(fmt(c[other], other))} · ` : "";
  const causes = (c.causes ?? []).map((x) => `<div class="crow"><span class="cn">${esc(x.name)}</span><span class="cbar"><i style="width:${c[measure] > 0 ? (x[measure] / c[measure]) * 100 : 0}%"></i></span><span class="cv">${f(x[measure])} · ${plural(x.runs, "run")}</span></div>`).join("");
  const top = (c.top ?? []).map((x) => `<div class="grow"><a class="idl" href="${esc(x.href)}">${esc(x.goal)}</a> <b>${f(x[measure])}</b> <span class="quiet">${plural(x.runs, "run")}</span><div class="quiet reason">${esc(x.reason)}</div></div>`).join("");
  return `<section class="brk" data-class="${key}"><h3><i class="sw seg-${key}"></i>${esc(CLASS_NAME[key] ?? c.name)} <b>${f(c[measure])}</b> <span class="quiet">${alt}${plural(c.runs, "run")} · ${plural(c.goals, "goal")}</span></h3>` +
    `<p class="def">${esc(CLASS_TEXT[key] ?? c.text)}</p>` +
    `<div class="two"><div><h4>By cause</h4>${causes}</div><div><h4>Goals that took the most</h4>${top}</div></div></section>`;
}

/** The Efficiency block: reruns, the agent time by class and the breakdown of one class, for the picked window. */
export function renderEfficiency(d, { measure = "hours", pinned = null } = {}) {
  const pick = (m, label, extra = "") => `<button type="button" data-measure="${m}" aria-pressed="${measure === m}"${extra}>${label}</button>`;
  const head = `<div class="sh sub"><h2 id="h-efficiency">Efficiency</h2><span class="seg mpick" role="group" aria-label="Measure">${pick("hours", "Hours")}${pick("week", "% of week", d?.hasWeek ? "" : ' disabled title="Needs 6 hours of usage snapshots"')}</span></div>`;
  if (!d || d.error) return head + loading("efficiency", d);
  return head + renderEffCards(d) + "<div class=\"effbody\"><div class=\"effbar\">" + renderBar(d, { measure, pinned }) + "</div>" + renderBreakdown(d, shownClass(d, measure, pinned), measure) + "</div>";
}

const card = (k, v, note) => `<div class="med"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span><span class="quiet">${esc(note)}</span></div>`;

/** The efficiency cards: reruns, first-pass rate, fix rounds, week per landed goal, lost time. */
export function renderEffCards(d) {
  const g = d.goals ?? { landed: 0, firstPass: null, fixRounds: null, week: null };
  const none = g.landed ? null : "no goal landed";
  const w = WINDOW_TEXT[d.window];
  const week = g.week ?? null, lost = d.lost ?? { hours: 0, share: 0 };
  return `<div class="meds eff">` +
    card("Reruns", String(d.flaky), `passed on rerun, ${w}`) +
    card("First pass", g.firstPass === null ? "–" : pctText(g.firstPass), none ?? "landed goals with 0 fix rounds") +
    card("Fix rounds", g.fixRounds === null ? "–" : String(g.fixRounds), none ?? "median per landed goal") +
    card("Week per goal", week === null ? "–" : `${week.toFixed(1)}%`, none ?? (week === null ? "needs 6 hours of usage snapshots" : "of the weekly limit, median per landed goal")) +
    card("Lost time", hours(lost.hours), `${Math.round(lost.share * 100)}% of agent hours on runs whose work did not reach main`) + `</div>`;
}

/** The area-chart option of one chart: `values` per bucket (null leaves a gap), `unit` for the tooltip. */
export function areaOption(buckets, key, { unit, color, fmt = String }) {
  return {
    color: [color],
    grid: { left: 40, right: 8, top: 8, bottom: 22 },
    tooltip: { trigger: "axis", confine: true, formatter: (p) => { const q = [].concat(p)[0]; return `${esc(q.name)}<br>${q.value == null ? "none" : esc(fmt(q.value)) + (unit ? " " + unit : "")}`; } },
    xAxis: { type: "category", boundaryGap: false, data: buckets.map((b) => b.label), axisLabel: { interval: "auto", hideOverlap: true } },
    yAxis: { type: "value", min: 0, minInterval: unit === "lands" ? 1 : undefined, axisLabel: { formatter: (v) => (unit === "lands" ? String(v) : dur(v)) } },
    series: [{ type: "line", smooth: false, showSymbol: buckets.length <= 12, connectNulls: true, areaStyle: { opacity: 0.25 }, data: buckets.map((b) => b[key]) }],
  };
}

// What the reader chose and what came back, so a refresh of the page re-renders at once.
let win = DEFAULT_WINDOW;
let measure = "hours";
let pinned = null;
const got = new Map();
let drawn = [];
const clear = () => { for (const c of drawn) c.dispose(); drawn = []; };

/** The window in a route query (`?window=day`); week when absent or unknown. */
export const windowOf = (query) => { const w = query?.get?.("window"); return WINDOWS.some((x) => x.value === w) ? w : DEFAULT_WINDOW; };
/** Take the window from the route; the page calls it on every render. */
export const setWindow = (query) => { win = windowOf(query); return win; };
export const speedWindow = () => win;
/** The last answer for the current window, or null. */
export const speedData = () => got.get(win) ?? null;
/** The page time picker: Hour, Day, Week, Month. */
export const renderPicker = (w = win) =>
  `<span class="seg wpick" role="group" aria-label="Time window" data-name="window">${WINDOWS.map((o) => `<button type="button" data-value="${o.value}" aria-pressed="${o.value === w}">${o.label}</button>`).join("")}</span>`;
export const speedTop = () => renderSpeedTop(speedData());
export const efficiency = () => renderEfficiency(speedData(), { measure, pinned });
export const resetSpeed = () => { win = DEFAULT_WINDOW; measure = "hours"; pinned = null; got.clear(); };

function draw(box, d) {
  clear();
  if (!globalThis.echarts) return;
  const t = readTokens();
  const specs = { agent: ["agent", { color: t.run, fmt: dur }], tests: ["tests", { color: t.need, fmt: dur }], lands: ["lands", { unit: "lands", color: t.done }] };
  for (const el of box.querySelectorAll(".speedchart[data-chart]")) {
    const [key, o] = specs[el.dataset.chart];
    try { drawn.push(chart(el, areaOption(d.buckets, key, o))); } catch (e) { console.error("speed chart failed", e); }
  }
}

/** Fetch the data for the window, fill the Speed and Efficiency sections and the Done card, draw the charts. A click on the picker puts the window in the hash, which re-renders the page. */
export async function mountSpeed(root, fetcher = fetch) {
  const top = root.querySelector?.("#speed");
  if (!top) return;
  const eff = root.querySelector("#efficiency"), doneN = root.querySelector("#done-n");
  const show = (d) => {
    top.innerHTML = renderSpeedTop(d);
    if (eff) eff.innerHTML = renderEfficiency(d, { measure, pinned });
    if (doneN && d && !d.error) doneN.textContent = String(d.done);
    if (d && !d.error) draw(top, d); else clear();
  };
  const load = async () => {
    const want = win;
    try {
      const res = await fetcher(`/api/speed?window=${want}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not load speed (${res.status}).`);
      got.set(want, await res.json());
    } catch (e) { if (!got.has(want)) got.set(want, { error: e.message }); }
    if (want === win && top.isConnected !== false) show(got.get(want));
  };
  if (got.has(win) && !got.get(win).error) draw(top, got.get(win));
  await load();
  if (eff && eff.dataset && !eff.dataset.wired) {
    eff.dataset.wired = "1";
    eff.addEventListener("click", (e) => {
      const m = e.target.closest(".mpick button");
      const c = m ? null : e.target.closest(".abar button[data-class], .narrow button[data-class]");
      if (m) { if (m.disabled) return; measure = m.dataset.measure; } else if (c) pinned = c.dataset.class; else return;
      const d = got.get(win);
      if (!d) return;
      eff.innerHTML = renderEfficiency(d, { measure, pinned });
      const sel = m ? `.mpick button[data-measure="${measure}"]` : `button[data-class="${pinned}"]`;
      eff.querySelector?.(sel)?.focus?.();
    });
  }
}
