// The Timeline view: an ECharts swimlane chart (30 days, one lane per
// kind), then a reverse-time stream under sticky day headers. The first day comes with
// the page; the rest load one day at a time from /api/timeline as a sentinel scrolls
// into view. `data` is /api/timeline: { days, next, strip, langfuse }.
import { chart, clock, empty, esc, money, readTokens } from "../lib.js";

export const view = {
  path: "/timeline",
  title: "Activity",
  group: "factory",
  order: 1,
  api: "/api/timeline?days=1",
  render: (d) => renderTimeline(d),
  mount: (root, d) => mountTimeline(root, d),
};

/**
 * The old List address: `#/list?set=jobs` becomes `#/timeline`. The List query is dropped;
 * only the project filter carries over. Any other hash gives null. The shell asks every view.
 */
export function redirect(hash) {
  const h = String(hash ?? "").replace(/^#/, "");
  const [path, query = ""] = h.split("?");
  if (path.replace(/\/$/, "") !== "/list") return null;
  const project = new URLSearchParams(query).get("project");
  return `#/timeline${project ? `?project=${encodeURIComponent(project)}` : ""}`;
}

export const KINDS = [["job", "Jobs"], ["land", "Lands"], ["issue", "Issues"], ["session", "Sessions"], ["note", "Notes"]];

const STYLE = `<style>
.tl .kinds { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 0 0 8px; font: 13px var(--sans); }
.tl .kinds label { cursor: pointer; }
.tl .strip { width: 100%; height: 230px; margin-bottom: 12px; }
.tl .day h2 { position: sticky; top: 0; z-index: 1; margin: 0; padding: 6px 0; background: var(--bg); border-bottom: 1px solid var(--rule); font: 600 13px var(--sans); }
.tl .tscroll { overflow-x: auto; max-width: 100%; }
.tl .tbl { border-collapse: collapse; width: 100%; font-size: 13px; }
.tl .tbl td { padding: 3px 10px 3px 0; line-height: 1.45; border-bottom: 1px solid var(--rule-2); text-align: left; vertical-align: baseline; white-space: nowrap; max-width: 28em; overflow: hidden; text-overflow: ellipsis; }
.tl .tbl th { padding: 3px 10px 3px 0; font: 600 12px var(--sans); color: var(--muted); text-align: left; white-space: nowrap; }
.tl .tbl .t { color: var(--muted); }
.tl .tbl .mark { margin-right: 4px; }
.tl .tbl .mark.run { color: var(--run); } .tl .tbl .mark.done { color: var(--done); }
.tl .tbl .mark.need { color: var(--need); } .tl .tbl .mark.stuck { color: var(--stuck); }
.tl .tbl .mark.quiet { color: var(--muted); }
.tl .tbl .num { font-variant-numeric: tabular-nums; }
.tl .tbl td.det { color: var(--muted); font-size: 12.5px; }
.tl .tbl td.det .k { margin-left: 8px; }
.tl .tbl td.det .k:first-child { margin-left: 0; }
.tl .sentinel { height: 1px; }
.tl .more { color: var(--muted); font: 12px var(--sans); padding: 8px 0; }
</style>`;

const TONE = { running: "run", landed: "done", passed: "done", done: "done", "needs-you": "need", failed: "stuck", stuck: "stuck", dropped: "quiet" };
const GLYPH = {
  job: { started: "▷", ended: "■" }, land: { landed: "⬆" }, issue: { opened: "○", closed: "✓", dropped: "✕" },
  session: { started: "◆" }, note: { written: "✎" },
};

/** The kind mark of an event: its glyph and colour class. Jobs take their state's colour. */
export function mark(e) {
  const glyph = GLYPH[e.kind]?.[e.what] ?? "•";
  const tone = e.kind === "job" || e.kind === "land" ? (TONE[e.state] ?? "quiet")
    : e.kind === "issue" ? (e.what === "opened" ? "run" : e.what === "closed" ? "done" : "quiet")
    : e.kind === "session" ? "need" : "quiet";
  return { glyph, tone };
}

/** One stream row: the List view's shared columns, then the Details cell. */
export function renderEvent(e) {
  const m = mark(e);
  const det = (e.details ?? []).map(([k, v]) => `<span class="k">${esc(k)} ${esc(v)}</span>`).join("");
  return `<tr class="evr" data-kind="${esc(e.kind)}"><td class="t num">${e.dateOnly ? "" : esc(clock(e.at))}</td>` +
    `<td><span class="mark ${m.tone}" title="${esc(`${e.kind} ${e.what}${e.state ? `: ${e.state}` : ""}`)}">${m.glyph}</span>${esc(e.kind)} ${esc(e.what)}</td>` +
    `<td>${esc(e.project ?? "")}</td><td><a class="title" href="${esc(e.href)}">${esc(e.title)}</a></td>` +
    `<td>${e.state ? `<span class="badge">${esc(e.state)}</span>` : ""}</td><td class="num">${e.cost == null ? "" : esc(money(e.cost))}</td>` +
    `<td class="det">${det}</td></tr>`;
}

const dayLabel = (day) => new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
export const renderDay = (d) =>
  `<section class="day" id="tl-${esc(d.day)}" data-day="${esc(d.day)}"><h2>${esc(dayLabel(d.day))}</h2>` +
  `<div class="list"><div class="tscroll"><table class="tbl"><thead><tr><th>Time</th><th>Kind</th><th>Project</th><th>Title</th><th>State</th><th>Cost</th><th>Details</th></tr></thead>` +
  `<tbody>${d.events.map(renderEvent).join("")}</tbody></table></div></div></section>`;

export function renderTimeline(d) {
  if (!d) return `<div class="page">${empty("No data.")}</div>`;
  const note = d.langfuse === "off" ? `<p class="hint">Langfuse is not configured: sessions are left out.</p>` : d.langfuse === "error" ? `<p class="hint">Langfuse failed: sessions are left out.</p>` : "";
  return `${STYLE}<div class="page tl"><h1>Timeline</h1>${note}` +
    `<div class="kinds" role="group" aria-label="Kinds">${KINDS.map(([k, label]) => `<label><input type="checkbox" data-kind="${k}" checked> ${esc(label)}</label>`).join("")}</div>` +
    `<div class="strip" id="tl-strip" role="img" aria-label="Swimlanes: jobs, lands, issues, sessions and notes, last 30 days"></div>` +
    `<div id="tl-days">${d.days.map(renderDay).join("")}</div>` +
    (d.days.length ? "" : empty("Nothing happened yet.", "Jobs, issues, sessions, lands and notes show up here.")) +
    `<div class="sentinel" id="tl-sentinel"></div><div class="more" id="tl-more">${d.next ? "Scroll for earlier days." : d.days.length ? "That is all of it." : ""}</div></div>`;
}

const DAY = 86400_000;
const LANE_TONE = { land: "done", issue: "run", session: "need", note: "ink" };
const toneOf = (it) => it.kind === "job" ? (TONE[it.state] ?? "run") : LANE_TONE[it.kind];

/**
 * The strip's ECharts option: a swimlane chart, one lane per enabled kind on the y axis and the
 * last 30 days on the x axis. Jobs and sessions are bars (a job with no end runs to `now`);
 * lands, issues and notes are points. A datum is [lane, start, end, name, tone, day, kind].
 */
export function stripOption(strip, kinds = KINDS.map(([k]) => k), now = Date.now()) {
  const lanes = KINDS.filter(([k]) => kinds.includes(k));
  const data = [];
  for (const it of strip) {
    const lane = lanes.findIndex(([k]) => k === it.kind);
    if (lane < 0) continue;
    const start = Date.parse(it.start);
    const bar = it.kind === "job" || it.kind === "session";
    const end = bar ? Math.max(start, it.end ? Date.parse(it.end) : now) : start;
    data.push({ name: it.name, value: [lane, start, end, it.name, toneOf(it), it.day, it.kind] });
  }
  const color = (tone) => {
    const t = typeof document === "undefined" ? {} : readTokens();
    return t[tone] || t.ink || "#888";
  };
  return {
    animation: false,
    grid: { left: 64, right: 12, top: 8, bottom: 56 },
    legend: { show: false },
    tooltip: {
      trigger: "item",
      formatter: (p) => {
        const [, s, e, name, , , kind] = p.value;
        const range = e > s ? `${clock(new Date(s).toISOString())} – ${clock(new Date(e).toISOString())}` : clock(new Date(s).toISOString());
        return `${esc(kind)}: ${esc(name)}<br>${esc(range)}`;
      },
    },
    xAxis: { type: "time", min: now - 30 * DAY, max: now, axisLabel: { hideOverlap: true } },
    yAxis: { type: "category", inverse: true, data: lanes.map(([, label]) => label), axisTick: { show: false }, splitLine: { show: true } },
    dataZoom: [
      { type: "inside", xAxisIndex: 0, filterMode: "none" },
      { type: "slider", xAxisIndex: 0, height: 18, bottom: 6, filterMode: "none" },
    ],
    series: [{
      name: "Timeline", type: "custom", clip: true, data,
      encode: { x: [1, 2], y: 0 },
      renderItem: (params, api) => {
        const lane = api.value(0);
        const a = api.coord([api.value(1), lane]), b = api.coord([api.value(2), lane]);
        const band = api.size([0, 1])[1];
        const fill = color(api.value(4));
        if (api.value(2) > api.value(1)) {
          const h = Math.min(band * 0.5, 16), w = Math.max(b[0] - a[0], 3);
          const rect = echartsClip(params, { x: a[0], y: a[1] - h / 2, width: w, height: h });
          return rect && { type: "rect", shape: rect, style: { fill } };
        }
        return { type: "circle", shape: { cx: a[0], cy: a[1], r: 4 }, style: { fill } };
      },
    }],
  };
}

// Clip a rect to the grid so a zoomed bar does not spill over the axis.
function echartsClip(params, r) {
  const cs = params.coordSys, x1 = Math.max(r.x, cs.x), x2 = Math.min(r.x + r.width, cs.x + cs.width);
  return x2 > x1 || x2 === x1 && r.width === 0 ? { x: x1, y: r.y, width: Math.max(x2 - x1, 0), height: r.height } : null;
}

export function mountTimeline(root, d) {
  const days = root.querySelector("#tl-days"), sentinel = root.querySelector("#tl-sentinel"), more = root.querySelector("#tl-more");
  if (!days || !sentinel) return;
  const on = new Set(KINDS.map(([k]) => k));
  let next = d?.next ?? null, loading = null, c = null, io = null;
  const project = new URLSearchParams(location.hash.split("?")[1] ?? "").get("project") ?? "";

  const filter = () => {
    for (const ev of days.querySelectorAll(".evr")) ev.hidden = !on.has(ev.dataset.kind);
    for (const s of days.querySelectorAll(".day")) s.hidden = !s.querySelector(".evr:not([hidden])");
    c?.setOption(stripOption(d.strip ?? [], [...on]), true);
  };
  const loadMore = () => {
    if (!next) return Promise.resolve(false);
    return loading ??= (async () => {
      try {
        const q = new URLSearchParams({ before: next, days: "1" });
        if (project) q.set("project", project);
        const res = await fetch(`/api/timeline?${q}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const page = await res.json();
        days.insertAdjacentHTML("beforeend", page.days.map(renderDay).join(""));
        next = page.next;
        more.textContent = next ? "Scroll for earlier days." : "That is all of it.";
        filter();
      } catch (e) { more.textContent = `Could not load earlier days (${e.message}).`; next = null; }
      finally { loading = null; if (io && next) { io.unobserve(sentinel); io.observe(sentinel); } }  // a fresh look: the sentinel may still be in view
      return true;
    })();
  };
  const goTo = async (day) => {
    let el;
    while (!(el = root.querySelector(`#tl-${day}`)) && next && day < (days.lastElementChild?.dataset.day ?? "")) await loadMore();
    // A day with no events has no section: scroll to the nearest older one.
    el ??= [...days.querySelectorAll(".day")].find((s) => s.dataset.day <= day);
    el?.scrollIntoView({ block: "start" });
  };

  if (d?.strip && globalThis.echarts) {
    try {
      c = chart(root.querySelector("#tl-strip"), stripOption(d.strip));
      c.on("click", (p) => p.value && goTo(p.value[5]));
    } catch (e) { console.error("timeline strip failed", e); }
  }
  for (const box of root.querySelectorAll(".kinds input")) box.addEventListener("change", () => { box.checked ? on.add(box.dataset.kind) : on.delete(box.dataset.kind); filter(); });
  if (typeof IntersectionObserver === "function") {
    io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: "400px" });
    io.observe(sentinel);
  }
}
