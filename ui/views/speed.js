// The speed parts of the Status page: how fast runs are. `d` is /api/speed. The render functions
// return HTML strings; `mountSpeed` fetches the data, draws the phase ECharts and wires the control.
import { chart, esc, readTokens, repoIdLink } from "../lib.js";

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
const PHASES = [
  ["intake", "Intake", "An issue is created, then its first goal is queued. Counted when the goal is queued."],
  ["implement", "Implement", "A job's first agent run starts, then its last agent run finishes with work to land. Counted when it finishes."],
  ["land", "Land", "A job finishes, then it lands. This includes any wait for a review or for Chris. Counted when it lands."],
];

/** One phase card: the title and count, the p50, the p90. A phase with no count has no times. */
const phaseCard = ([key, title, text], c) => {
  const f = (v) => (c.count ? dur(v) : dur(null));
  return `<div class="med" title="${esc(text)}"><span class="k">${esc(title)} (${c.count})</span><span class="v">${esc(f(c.p50))} p50</span><span class="p90">${esc(f(c.p90))} p90</span></div>`;
};

/** The phase cards: intake, implement, land. */
export const renderPhases = (d) => `<div class="meds phases">${PHASES.map((p) => phaseCard(p, d.phases[p[0]])).join("")}</div>`;

const BAR_PX = 760;
const weekText = (v) => `${v.toFixed(1)}%`;

/** The agent-time bar: the lost sentence, the brackets, one segment per class in two sides, and the not-counted line. */
export function renderBar(d, { pinned = null } = {}) {
  const cs = d.classes ?? [];
  const f = hours;
  const total = cs.reduce((a, c) => a + c.hours, 0);
  if (!(total > 0)) return `<div class="empty"><p class="hint">No agent run of a goal ended in this period.</p></div>`;
  const sum = (xs) => xs.reduce((a, c) => a + c.hours, 0);
  const good = sum(cs.slice(0, 2)), lost = sum(cs.slice(2));
  const share = (v) => Math.round((v / total) * 100);
  const sentence = `<p class="lost"><b>${esc(f(lost))}</b> of ${esc(f(total))} (${share(lost)}%) of agent time in ${WINDOW_TEXT[d.window]} went to runs whose work did not reach main.</p>`;
  const bracket = (v, side, t) => (v > 0 ? `<span class="bracket ${side}" style="flex:${v / total}">${t}</span>` : "");
  const brackets = `<div class="brackets">${bracket(good, "reached", "Reached main")}${bracket(lost, "missed", "Did not reach main")}</div>`;
  const seg = (c, sideHours) => {
    const v = c.hours, w = (v / total) * BAR_PX;
    const title = [c.text, ...(c.causes ?? []).slice(0, 5).map((x) => `${x.name}: ${f(x.hours)} · ${x.runs} runs`)].join("\n");
    const inside = w <= 70 ? "" : `<span class="nm">${esc(c.name)}</span>` + (w <= 8 + c.name.length * 7 + 90 ? "" : `<span class="val">${esc(f(v))} · ${share(v)}%</span>`);
    return `<button type="button" class="seg-${c.key}" data-class="${c.key}" style="flex:${v / sideHours}" aria-pressed="${c.key === pinned}" aria-label="${esc(`${c.name}: ${f(v)}, ${share(v)}%`)}" title="${esc(title)}">${inside}</button>`;
  };
  // Each side of the bar is a group of its own, sized by its share, and its segments share the group.
  const side = (group, hrs) => (hrs > 0 ? `<div class="abar-side" style="flex:${hrs / total}">${group.filter((c) => c.hours > 0).map((c) => seg(c, hrs)).join("")}</div>` : "");
  const bar = `<div class="abar" role="group" aria-label="Agent time by what each run's work came to">${side(cs.slice(0, 2), good)}${side(cs.slice(2), lost)}</div>`;
  const nc = d.notCounted;
  const not = nc && nc.runs ? `<p class="quiet notcounted">Not counted: ${nc.runs} runs of ${nc.goals} open goals, ${hours(nc.hours)}</p>` : "";
  return sentence + brackets + bar + not;
}

const chartBox = (key, title, label) => `<figure class="chartbox"><figcaption>${esc(title)}</figcaption><div class="speedchart" data-chart="${key}" role="img" aria-label="${esc(label)}"></div></figure>`;

/** One chart box per phase; `mountSpeed` fills them. */
export const renderCharts = (d) => `<div class="charts3">` +
  PHASES.map(([key, title]) => chartBox(key, `${title} by ${STEP_TEXT[d.window]} (median)`, `Median ${title.toLowerCase()} time per bucket`)).join("") + `</div>`;

const loading = (what, d) => (!d ? `<p class="quiet loading" role="status">Loading ${what}…</p>` : `<div class="empty"><p class="hint">${esc(d.error)}</p></div>`);

/** The Performance block: the phase cards and the three charts. `d` is null while loading, `{error}` on a failed load. */
export function renderSpeedTop(d) {
  const head = `<div class="sh sub"><h2 id="h-speed">Performance</h2></div>`;
  if (!d || d.error) return head + loading("performance", d);
  return head + renderPhases(d) + renderCharts(d);
}

// Duplicated from ui/api/speed.ts: keep the texts identical.
const CLASS_NAME = { landed: "Landed", fixed: "Fixed", nothing: "Late", restarted: "Restarted", dropped: "Dropped" };
const CLASS_TEXT = {
  landed: "The run whose work landed on main.",
  fixed: "A run of the landing job before the run that landed: a fix round the goal needed.",
  nothing: "A run that started after its goal had landed, or found the work already on main.",
  restarted: "A run that a later start replaced: another job of the same goal landed, or the goal started 4 or more times inside an hour.",
  dropped: "A run of a goal that was then dropped or closed without landing.",
};

/** The class shown under the bar: the pinned one if it has a value, else the largest of the classes after the first two; null when all are 0. */
export function shownClass(d, pinned = null) {
  const cs = d.classes ?? [];
  if (pinned && cs.some((c) => c.key === pinned && c.hours > 0)) return pinned;
  let best = null;
  for (const c of cs.slice(2)) if (c.hours > 0 && (!best || c.hours > best.hours)) best = c;
  return best?.key ?? null;
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The breakdown of one class: its causes and the goals that took the most. "" when `key` is null. */
export function renderBreakdown(d, key) {
  const c = key && (d.classes ?? []).find((x) => x.key === key);
  if (!c) return "";
  const f = (v) => esc(hours(v));
  const alt = d.hasWeek ? `${esc(weekText(c.week))} of week · ` : "";
  const causes = (c.causes ?? []).map((x) => `<div class="crow"><span class="cn">${esc(x.name)}</span><span class="cbar"><i style="width:${c.hours > 0 ? (x.hours / c.hours) * 100 : 0}%"></i></span><span class="cv">${f(x.hours)} · ${plural(x.runs, "run")}</span></div>`).join("");
  const top = (c.top ?? []).map((x) => `<div class="grow">${repoIdLink(x.goal, x.href)} ${esc(x.title ?? "")} <b>${f(x.hours)}</b> <span class="quiet">${plural(x.runs, "run")}</span><div class="quiet reason">${esc(x.reason)}</div></div>`).join("");
  return `<section class="brk" data-class="${key}"><h3><i class="sw seg-${key}"></i>${esc(CLASS_NAME[key] ?? c.name)} <b>${f(c.hours)}</b> <span class="quiet">${alt}${plural(c.runs, "run")} · ${plural(c.goals, "goal")}</span></h3>` +
    `<p class="def">${esc(CLASS_TEXT[key] ?? c.text)}</p>` +
    `<div class="two"><div><h4>Causes</h4>${causes}</div><div><h4>Top Affected Issues</h4>${top}</div></div></section>`;
}

/** The Efficiency block: reruns, the agent time by class and the breakdown of one class, for the picked window. */
export function renderEfficiency(d, { pinned = null } = {}) {
  const head = `<div class="sh sub"><h2 id="h-efficiency">Efficiency</h2></div>`;
  if (!d || d.error) return head + loading("efficiency", d);
  return head + renderEffCards(d) + "<div class=\"effbody\"><div class=\"effbar\">" + renderBar(d, { pinned }) + "</div>" + renderBreakdown(d, shownClass(d, pinned)) + "</div>";
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

/** The dotted threshold lines of a chart: p50 thin, p90 heavier and in its own color. Equal thresholds share one line; a threshold of 0 lies on the axis and has none. */
function thresholdLines({ p50, p90 }, { p50: p50Color, p90: p90Color }) {
  // The p90 label sits above its line and the p50 label below, so close thresholds stay readable.
  const line = (yAxis, name, color, width, up) => ({ yAxis, lineStyle: { type: "dotted", color, width }, label: { color, offset: [0, up], formatter: `${name} ${dur(yAxis)}` } });
  const lines = p50 === p90 ? [line(p90, "p50, p90", p90Color, 2, 0)] : [line(p50, "p50", p50Color, 1, 5), line(p90, "p90", p90Color, 2, -5)];
  return { silent: true, symbol: "none", label: { position: "end", fontSize: 10 }, data: lines.filter((l) => l.yAxis > 0) };
}

// The seconds an axis step can be, so the axis marks read as round times.
const AXIS_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 86400, 172800, 345600, 604800];
/** An axis mark at a round time: "30s", "15m", "2h". */
const axisTime = (v) => (v < 60 ? `${v}s` : v < 3600 ? `${v / 60}m` : `${v / 3600}h`);

/** A bucket's x-axis label: "4a" or "1:36p" in the hour and day windows, "Sat" in week, "10/25" in month. */
export function xLabel(at, window) {
  const d = new Date(at);
  if (window === "month") return `${d.getMonth() + 1}/${d.getDate()}`;
  if (window === "week") return d.toLocaleDateString("en-US", { weekday: "short" });
  const m = d.getMinutes();
  return `${d.getHours() % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${d.getHours() < 12 ? "a" : "p"}`;
}

/** The bar-chart option of one chart: one time per bucket (null leaves a gap), `lines` the p50 and the p90 to mark. */
export function barOption(buckets, key, { window, color, lines = null, lineColors = { p50: "#888", p90: "#888" } }) {
  const n = buckets.length;
  // A mark line does not grow the axis, so the top has to reach the p90.
  const top = Math.max(...buckets.map((b) => b[key] ?? 0), lines?.p90 ?? 0) || 60;
  const step = AXIS_STEPS.find((s) => top / s <= 3) ?? top;
  return {
    color: [color],
    grid: { left: 48, right: lines ? 78 : 8, top: 8, bottom: 20 },
    tooltip: { trigger: "axis", confine: true, formatter: (p) => { const q = [].concat(p)[0]; return `${esc(q.name)}<br>${q.value == null ? "none" : esc(dur(q.value))}`; } },
    xAxis: { type: "category", data: buckets.map((b) => xLabel(b.at, window)), axisTick: { show: false }, axisLabel: { interval: Math.max(0, Math.ceil(n / 4) - 1), hideOverlap: true } },
    yAxis: { type: "value", min: 0, max: Math.ceil(top / step) * step, interval: step, splitLine: { lineStyle: { opacity: 0.5 } }, axisTick: { show: false }, axisLabel: { formatter: axisTime } },
    series: [{ type: "bar", data: buckets.map((b) => b[key]), ...(lines ? { markLine: thresholdLines(lines, lineColors) } : {}) }],
  };
}

// What the reader chose and what came back, so a refresh of the page re-renders at once.
let win = DEFAULT_WINDOW;
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
export const efficiency = () => renderEfficiency(speedData(), { pinned });
export const resetSpeed = () => { win = DEFAULT_WINDOW; pinned = null; got.clear(); };

function draw(box, d) {
  clear();
  if (!globalThis.echarts) return;
  const t = readTokens();
  const colors = { intake: t.run, implement: t.need, land: t.done };
  for (const el of box.querySelectorAll(".speedchart[data-chart]")) {
    const key = el.dataset.chart, c = d.phases[key];
    try { drawn.push(chart(el, barOption(d.buckets, key, { window: d.window, color: colors[key], lines: c.count ? c : null, lineColors: { p50: t.ink, p90: t.stuck } }))); } catch (e) { console.error("speed chart failed", e); }
  }
}

/** Fetch the data for the window, fill the Speed and Efficiency sections and the Done card, draw the charts. A click on the picker puts the window in the hash, which re-renders the page. */
export async function mountSpeed(root, fetcher = fetch) {
  const top = root.querySelector?.("#speed");
  if (!top) return;
  const eff = root.querySelector("#efficiency"), doneN = root.querySelector("#done-n");
  const show = (d) => {
    top.innerHTML = renderSpeedTop(d);
    if (eff) eff.innerHTML = renderEfficiency(d, { pinned });
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
      const c = e.target.closest(".abar button[data-class], .narrow button[data-class]");
      if (!c) return;
      pinned = c.dataset.class;
      const d = got.get(win);
      if (!d) return;
      eff.innerHTML = renderEfficiency(d, { pinned });
      eff.querySelector?.(`button[data-class="${pinned}"]`)?.focus?.();
    });
  }
}
