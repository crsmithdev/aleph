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
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const hours = (h) => `${h.toFixed(h < 10 ? 1 : 0)} h`;
const pctText = (w) => `${Math.round((w || 0) * 100)}%`;
const PHASES = [
  ["intake", "Intake", "An issue is created, then its first triage ends. Counted when the triage ends."],
  ["queue", "Queue", "An issue is sorted, then its first agent run starts. This includes any wait for a slot or for another issue. Counted when the run starts."],
  ["implement", "Implement", "A job's first agent run starts, then its last agent run finishes with work to land. Counted when it finishes."],
  ["land", "Land", "A job finishes, then it lands. This includes any wait for a review or for Chris. Counted when it lands."],
  ["lead", "Lead time", "An issue is created, then its last land. The whole span, including what the other phases leave out. Counted when it lands."],
];

/** One phase card: the title and count, the p50, the p90, and a chart of its median per `step`, which `mountSpeed` fills. A phase with no count has no times. */
const phaseCard = ([key, title, text], c, step) => {
  const f = (v) => (c.count ? dur(v) : dur(null));
  return `<div class="med" title="${esc(text)}"><span class="k">${esc(title)} (${c.count})</span><span class="v">${esc(f(c.p50))} <small>p50</small></span><span class="p90">${esc(f(c.p90))} <small>p90</small></span><div class="speedchart spark" data-chart="${key}" role="img" aria-label="${esc(`Median ${title.toLowerCase()} time per ${step}`)}"></div></div>`;
};

/** The phase cards: intake, queue, implement, land, lead time. */
export const renderPhases = (d) => `<div class="meds phases">${PHASES.map((p) => phaseCard(p, d.phases[p[0]], STEP_TEXT[d.window])).join("")}</div>`;

const BAR_PX = 760;
const weekText = (v) => `${v.toFixed(1)}%`;

/** The agent-time bar: the brackets with each side's share, one segment per class in two sides, and the not-counted line. */
export function renderBar(d, { pinned = null } = {}) {
  const cs = d.classes ?? [];
  const f = hours;
  const total = cs.reduce((a, c) => a + c.hours, 0);
  if (!(total > 0)) return `<div class="empty"><p class="hint">No agent run of an issue ended in this period.</p></div>`;
  const sum = (xs) => xs.reduce((a, c) => a + c.hours, 0);
  const good = sum(cs.slice(0, 2)), lost = sum(cs.slice(2));
  const share = (v) => Math.round((v / total) * 100);
  const bracket = (v, side, t) => (v > 0 ? `<span class="bracket ${side}" style="flex:${v / total}">${t}</span>` : "");
  const brackets = `<div class="brackets">${bracket(good, "reached", `Reached main ${share(good)}%`)}${bracket(lost, "missed", `Did not reach main ${share(lost)}%`)}</div>`;
  const seg = (c, sideHours) => {
    const v = c.hours, w = (v / total) * BAR_PX;
    const title = [c.text, ...(c.causes ?? []).slice(0, 5).map((x) => `${x.name}: ${f(x.hours)} · ${x.runs} runs`)].join("\n");
    // `.abar button` wraps or hides the value by the width the segment has.
    const inside = w <= 70 ? "" : `<span class="nm">${esc(c.name)}</span><span class="val">${esc(f(v))} · ${share(v)}%</span>`;
    return `<button type="button" class="seg-${c.key}" data-class="${c.key}" style="flex:${v / sideHours}" aria-pressed="${c.key === pinned}" aria-label="${esc(`${c.name}: ${f(v)}, ${share(v)}%`)}" title="${esc(title)}">${inside}</button>`;
  };
  // Each side of the bar is a group of its own, sized by its share, and its segments share the group.
  const side = (group, hrs) => (hrs > 0 ? `<div class="abar-side" style="flex:${hrs / total}">${group.filter((c) => c.hours > 0).map((c) => seg(c, hrs)).join("")}</div>` : "");
  const bar = `<div class="abar" role="group" aria-label="Agent time by what each run's work came to">${side(cs.slice(0, 2), good)}${side(cs.slice(2), lost)}</div>`;
  const nc = d.notCounted;
  const not = nc && nc.runs ? `<p class="quiet notcounted">Not counted: ${nc.runs} runs of ${nc.issues} open issues, ${hours(nc.hours)}</p>` : "";
  return brackets + bar + not;
}

// What each role does, and the page token of its colour in the chart.
const ROLE_TEXT = {
  worker: "Builds an issue on a branch. The live cap counts these.",
  triage: "Reads a new issue and routes it.",
  planner: "Splits a large goal into parts.",
  facts: "Checks what a landed run recorded.",
  firefighter: "Looks at failed factory runs and repairs them.",
  reviewer: "Reviews a held run before it lands. It works inside the run and records no times, so only its count shows.",
};
export const ROLE_TOKEN = { worker: "series-1", triage: "series-2", planner: "series-3", facts: "series-4", firefighter: "series-5" };

/** The two panels under the charts: the agents by role, and how many were live over the window. */
export function renderAgents(d) {
  const a = d.agents;
  const none = "–";
  const rows = a.roles.map((r) => `<tr title="${esc(ROLE_TEXT[r.key] ?? "")}"><th scope="row">${ROLE_TOKEN[r.key] ? `<i class="sw" style="background:var(--${ROLE_TOKEN[r.key]})"></i>` : `<i class="sw"></i>`}${esc(r.name)}</th><td>${r.live ?? none}</td><td>${r.runs}</td><td>${r.hours === null ? none : esc(hours(r.hours))}</td><td>${esc(dur(r.p50))}</td><td class="models">${esc(r.models.join(", ")) || none}</td></tr>`).join("");
  return `<div class="flowpanels">` +
    `<section class="flowpanel"><h3>Agents</h3><p class="stats">${a.live} live · ${a.workers} of ${a.cap} worker slots</p><p class="quiet note">runs and hours in ${esc(WINDOW_TEXT[d.window])}</p>` +
    `<table class="agentroles"><thead><tr><th scope="col">Role</th><th scope="col">Live</th><th scope="col">Runs</th><th scope="col">Hours</th><th scope="col">p50</th><th scope="col">Models</th></tr></thead><tbody>${rows}</tbody></table></section>` +
    `<section class="flowpanel" title="The mean number of agents live in each step, by role. Peak is the most live at one moment."><h3>Agents live</h3><p class="stats">${a.mean.toFixed(1)} mean · ${a.peak} peak</p><p class="quiet note">${esc(WINDOW_TEXT[d.window])}</p><div class="speedchart tall" data-panel="agents" role="img" aria-label="Agents live over time, by role"></div></section>` +
    `</div>`;
}

const loading = (what, d) => (!d ? `<p class="quiet loading" role="status">Loading ${what}…</p>` : `<div class="empty"><p class="hint">${esc(d.error)}</p></div>`);

/** The Performance block: the phase cards and the agents. `d` is null while loading, `{error}` on a failed load. */
export function renderSpeedTop(d) {
  const head = `<div class="sh sub"><h2 id="h-speed">Performance</h2></div>`;
  if (!d || d.error) return head + loading("performance", d);
  return head + renderPhases(d) + renderAgents(d);
}

// Duplicated from ui/api/speed.ts: keep the texts identical.
const CLASS_NAME = { landed: "Landed", fixed: "Fixed", nothing: "Late", restarted: "Restarted", dropped: "Dropped" };
const CLASS_TEXT = {
  landed: "The run whose work landed on main.",
  fixed: "A run of the landing job before the run that landed: a fix round the issue needed.",
  nothing: "A run that started after its issue had landed, or found the work already on main.",
  restarted: "A run that a later start replaced: another job of the same issue landed, or the issue started 4 or more times inside an hour.",
  dropped: "A run of an issue that was then dropped or closed without landing.",
};

/** The class shown under the bar: the pinned one if it has a value, else the largest of the classes after the first two; null when all are 0. */
export function shownClass(d, pinned = null) {
  const cs = d.classes ?? [];
  if (pinned && cs.some((c) => c.key === pinned && c.hours > 0)) return pinned;
  let best = null;
  for (const c of cs.slice(2)) if (c.hours > 0 && (!best || c.hours > best.hours)) best = c;
  return best?.key ?? null;
}

const TOP_ISSUES = 5;

/** The breakdown of one class: its causes and the goals that took the most. "" when `key` is null. */
export function renderBreakdown(d, key) {
  const c = key && (d.classes ?? []).find((x) => x.key === key);
  if (!c) return "";
  const f = (v) => esc(hours(v));
  const alt = d.hasWeek ? `${esc(weekText(c.week))} of week · ` : "";
  const causes = (c.causes ?? []).map((x) => `<div class="crow"${x.text ? ` title="${esc(x.text)}"` : ""}><span class="cn">${esc(x.name)}</span><span class="cbar"><i style="width:${c.hours > 0 ? (x.hours / c.hours) * 100 : 0}%"></i></span><span class="cv">${f(x.hours)} · ${plural(x.runs, "run")}</span></div>`).join("");
  const top = (c.top ?? []).slice(0, TOP_ISSUES).map((x) => `<div class="grow">${repoIdLink(x.goal, x.href)} ${esc(x.title ?? "")} <b>${f(x.hours)}</b> <span class="quiet">${plural(x.runs, "run")}</span><div class="quiet reason">${esc(x.reason)}</div></div>`).join("");
  return `<section class="brk" data-class="${key}"><h3><i class="sw seg-${key}"></i>${esc(CLASS_NAME[key] ?? c.name)} <b>${f(c.hours)}</b> <span class="quiet">${alt}${plural(c.runs, "run")} · ${plural(c.issues, "goal")}</span></h3>` +
    `<p class="def">${esc(CLASS_TEXT[key] ?? c.text)}</p>` +
    `<div class="two"><div><h4>Causes</h4><div class="causes">${causes}</div></div><div><h4>Top Affected Issues</h4>${top}</div></div></section>`;
}

/** The Efficiency block: reruns, the agent time by class and the breakdown of one class, for the picked window. */
export function renderEfficiency(d, { pinned = null } = {}) {
  const head = `<div class="sh sub"><h2 id="h-efficiency">Efficiency</h2></div>`;
  if (!d || d.error) return head + loading("efficiency", d);
  return head + renderEffCards(d) + "<div class=\"effbody\"><div class=\"effbar\">" + renderBar(d, { pinned }) + "</div>" + renderBreakdown(d, shownClass(d, pinned)) + "</div>";
}

const card = (k, v, note) => `<div class="med"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span><span class="quiet">${esc(note)}</span></div>`;

/** The efficiency cards: reruns, first-pass rate, fix rounds, week per landed issue, lost time. */
export function renderEffCards(d) {
  const g = d.issues ?? { landed: 0, firstPass: null, fixRounds: null, week: null };
  const none = g.landed ? null : "no issue landed";
  const w = WINDOW_TEXT[d.window];
  const week = g.week ?? null, lost = d.lost ?? { hours: 0, share: 0 };
  return `<div class="meds eff">` +
    card("Reruns", String(d.flaky), `passed on rerun, ${w}`) +
    card("First pass", g.firstPass === null ? "–" : pctText(g.firstPass), none ?? "landed issues with 0 fix rounds") +
    card("Fix rounds", g.fixRounds === null ? "–" : String(g.fixRounds), none ?? "median per landed issue") +
    card("Week per issue", week === null ? "–" : `${week.toFixed(1)}%`, none ?? (week === null ? "needs 6 hours of usage snapshots" : "of the weekly limit, median per landed issue")) +
    card("Lost time", hours(lost.hours), `${Math.round(lost.share * 100)}% of agent hours on runs whose work did not reach main`) + `</div>`;
}

/** A bucket's x-axis label: "4a" or "1:36p" in the hour and day windows, "10/25" in week and month. */
export function xLabel(at, window) {
  const d = new Date(at);
  if (window === "week" || window === "month") return `${d.getMonth() + 1}/${d.getDate()}`;
  const m = d.getMinutes();
  return `${d.getHours() % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${d.getHours() < 12 ? "a" : "p"}`;
}

// How many buckets lie between date labels on a phase card, counted back from today.
const DATE_EVERY = { week: 2, month: 7 };

/** The bar-chart option of one phase card: one time per bucket (null leaves a gap), no y axis, x labels every few days in week and month and at the ends otherwise, and `p50` as a dotted line when it lies under the top bar. */
export function barOption(buckets, key, { window, color, p50 = 0, lineColor = "#888" }) {
  const n = buckets.length;
  const peak = Math.max(...buckets.map((b) => b[key] ?? 0));
  const every = DATE_EVERY[window];
  const data = p50 > 0 && p50 <= peak ? [{ yAxis: p50 }] : [];
  return {
    // A push redraws the chart, and an entry animation on each redraw flashes the bars.
    animation: false,
    color: [color],
    // A date centred under the last bar needs room past it.
    grid: { left: every ? 12 : 0, right: every ? 12 : 0, top: 2, bottom: 18 },
    tooltip: { trigger: "axis", confine: true, formatter: (p) => { const q = [].concat(p)[0]; return `${esc(q.name)}<br>${q.value == null ? "none" : esc(dur(q.value))}`; } },
    xAxis: { type: "category", data: buckets.map((b) => xLabel(b.at, window)), axisTick: { show: false }, axisLabel: every ? { interval: (i) => (n - 1 - i) % every === 0, showMinLabel: (n - 1) % every === 0 } : { interval: (i) => i === 0 || i === n - 1, alignMinLabel: "left", alignMaxLabel: "right" } },
    yAxis: { type: "value", show: false, min: 0, max: peak || 1, splitLine: { show: false } },
    series: [{ type: "bar", barCategoryGap: "20%", data: buckets.map((b) => b[key]), markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { type: "dotted", color: lineColor, width: 1 }, data } }],
  };
}

// How many agents points lie between date labels: a day in week and a week in month.
const AGENT_LABEL_EVERY = { week: 24, month: 28 };

/** The stacked option of the agents live: each timed role's mean live per step, with a legend. */
export function agentsOption({ points, roles }, { window, colors, muted }) {
  const n = points.length;
  const stamp = (at) => new Date(at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  const timed = roles.filter((r) => colors[r.key]);
  return {
    animation: false,
    color: timed.map((r) => colors[r.key]),
    legend: { top: 0, left: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: muted, fontSize: 11 } },
    grid: { left: 24, right: 16, top: 28, bottom: 20 },
    tooltip: { trigger: "axis", confine: true, formatter: (p) => { const qs = [].concat(p); const lines = qs.filter((q) => q.value > 0).map((q) => `${esc(q.seriesName)} ${esc(q.value.toFixed(1))}`); return `${esc(stamp(points[qs[0].dataIndex].at))}<br>${lines.join("<br>") || "none live"}`; } },
    xAxis: { type: "category", boundaryGap: false, data: points.map((p) => xLabel(p.at, window)), axisTick: { show: false }, axisLabel: { interval: (AGENT_LABEL_EVERY[window] ?? Math.ceil(n / 4)) - 1, hideOverlap: true } },
    yAxis: { type: "value", min: 0, minInterval: 1, splitLine: { lineStyle: { opacity: 0.5 } }, axisTick: { show: false } },
    series: timed.map((r) => ({ type: "line", name: r.name, stack: "live", step: "end", symbol: "none", lineStyle: { width: 0 }, areaStyle: { opacity: 0.85 }, data: points.map((p) => p[r.key] ?? 0) })),
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
  const colors = { intake: t.run, queue: t.muted, implement: t.need, land: t.done, lead: t.ink };
  const panel = (id, option) => { const el = box.querySelector(`.speedchart[data-panel="${id}"]`); if (!el) return; try { drawn.push(chart(el, option)); } catch (e) { console.error("speed chart failed", e); } };
  panel("agents", agentsOption(d.agents, { window: d.window, colors: Object.fromEntries(Object.entries(ROLE_TOKEN).map(([k, v]) => [k, t[v]])), muted: t.muted }));
  for (const el of box.querySelectorAll(".speedchart[data-chart]")) {
    const key = el.dataset.chart, c = d.phases[key];
    try { drawn.push(chart(el, barOption(d.buckets, key, { window: d.window, color: colors[key], p50: c.count ? c.p50 : 0, lineColor: t.ink }))); } catch (e) { console.error("speed chart failed", e); }
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
