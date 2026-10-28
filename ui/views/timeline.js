// The Activity view: an ECharts swimlane chart (30 days, one lane per
// kind), then a reverse-time table, one row per job, session, land, issue and note, 100 to a
// page with Older and Newer controls. `data` is /api/timeline: { rows, now, strip, langfuse }.
import { chart, clock, empty, esc, money, readTokens } from "../lib.js";

export const view = {
  path: "/timeline",
  title: "Activity",
  group: "factory",
  order: 1,
  api: "/api/timeline",
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
.tl .tscroll { overflow-x: auto; max-width: 100%; }
.tl .tbl { border-collapse: collapse; width: 100%; font-size: 13px; }
.tl .tbl td { padding: 3px 10px 3px 0; line-height: 1.45; border-bottom: 1px solid var(--rule-2); text-align: left; vertical-align: baseline; white-space: nowrap; max-width: 28em; overflow: hidden; text-overflow: ellipsis; }
.tl .tbl th { padding: 3px 10px 3px 0; font: 600 12px var(--sans); color: var(--muted); text-align: left; white-space: nowrap; }
.tl .tbl .t { color: var(--muted); }
.tl .tbl .chip { display: inline-block; font: 600 12px var(--sans); padding: 1px 8px; border-radius: 3px; background: var(--sunk); color: var(--muted); }
.tl .tbl .chip.run { background: var(--run-bg); color: var(--run); } .tl .tbl .chip.done { background: var(--done-bg); color: var(--done); }
.tl .tbl .chip.need { color: var(--need); } .tl .tbl .chip.stuck { background: var(--stuck-bg); color: var(--stuck); }
.tl .tbl td.ttl { width: 99%; min-width: 16em; max-width: none; white-space: normal; overflow-wrap: anywhere; }
.tl .pager { display: flex; align-items: center; gap: 12px; padding: 10px 0; font: 13px var(--sans); color: var(--muted); }
.tl .tbl .num { font-variant-numeric: tabular-nums; }
.tl .tbl td.det { color: var(--muted); font-size: 12.5px; }
.tl .tbl td.det .k { margin-left: 8px; }
.tl .tbl td.det .k:first-child { margin-left: 0; }
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

const pad = (n) => String(n).padStart(2, "0");
/** "Oct 27 10:00", or the date alone when only the day is known. */
function when(e) {
  const d = new Date(e.at);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString([], { day: "numeric", month: "short" });
  return e.dateOnly ? day : `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "25m", "1h05m": a job's or session's span; a running job counts to `now`. "" for the rest. */
export function duration(e, now = Date.now()) {
  if (e.kind !== "job" && e.kind !== "session") return "";
  const end = e.end ? Date.parse(e.end) : e.kind === "job" && e.state === "running" ? now : NaN;
  const ms = end - Date.parse(e.at);
  if (!(ms >= 0)) return "";
  const m = Math.floor(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${pad(m % 60)}m`;
}

const running = (e) => e.kind === "job" && e.state === "running" && !e.end;

/** One stream row: Time, Duration, Kind chip, Id link, Title, Cost, Details. */
export function renderEvent(e, now = Date.now()) {
  const det = (e.details ?? []).map(([k, v]) => `<span class="k">${esc(k)} ${esc(v)}</span>`).join("");
  const m = mark(e);
  const chip = `<span class="chip ${m.tone}" title="${esc(`${e.kind} ${e.what}${e.state ? `: ${e.state}` : ""}`)}">${esc(e.kind)}</span>` +
    (running(e) ? ` <span class="chip run">running</span>` : "");
  const id = e.id ?? (e.kind === "job" || e.kind === "land" ? e.title : "");
  return `<tr class="evr" data-kind="${esc(e.kind)}"><td class="t num">${esc(when(e))}</td><td class="num">${esc(duration(e, now))}</td>` +
    `<td>${chip}</td><td>${id ? `<a href="${esc(e.href)}">${esc(id)}</a>` : ""}</td>` +
    `<td class="ttl">${esc(e.title)}</td><td class="num">${e.cost == null ? "" : esc(money(e.cost))}</td>` +
    `<td class="det">${det}</td></tr>`;
}

export const PAGE = 100;
const HEAD = "<thead><tr><th>Time</th><th>Duration</th><th>Kind</th><th>Id</th><th>Title</th><th>Cost</th><th>Details</th></tr></thead>";

/** Page `page` (0 = newest) of the rows, 100 to a page, with Older and Newer controls. */
export function renderStream(rows, page = 0, now = Date.now(), size = PAGE) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(0, page), pages - 1);
  const body = rows.slice(p * size, (p + 1) * size).map((e) => renderEvent(e, now)).join("");
  const ctl = `<div class="pager"><button type="button" data-page="${p + 1}"${p + 1 >= pages ? " disabled" : ""}>Older</button>` +
    `<span>Page ${p + 1} of ${pages}</span><button type="button" data-page="${p - 1}"${p === 0 ? " disabled" : ""}>Newer</button></div>`;
  return `<div class="list"><div class="tscroll"><table class="tbl">${HEAD}<tbody>${body}</tbody></table></div></div>${ctl}`;
}

export function renderTimeline(d) {
  if (!d) return `<div class="page">${empty("No data.")}</div>`;
  const note = d.langfuse === "off" ? `<p class="hint">Langfuse is not configured: sessions are left out.</p>` : d.langfuse === "error" ? `<p class="hint">Langfuse failed: sessions are left out.</p>` : "";
  const rows = d.rows ?? [];
  return `${STYLE}<div class="page tl"><h1>Activity</h1>${note}` +
    `<div class="kinds" role="group" aria-label="Kinds">${KINDS.map(([k, label]) => `<label><input type="checkbox" data-kind="${k}" checked> ${esc(label)}</label>`).join("")}</div>` +
    `<div class="strip" id="tl-strip" role="img" aria-label="Swimlanes: jobs, lands, issues, sessions and notes, last 30 days"></div>` +
    `<div id="tl-stream">${renderStream(rows, 0, d.now ? Date.parse(d.now) : Date.now())}</div>` +
    (rows.length ? "" : empty("Nothing happened yet.", "Jobs, issues, sessions, lands and notes show up here.")) + `</div>`;
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

/** Shift-click on a kind: show only that kind; on the only kind shown, show all kinds again. */
export function soloKind(on, kind) {
  if (on.size === 1 && on.has(kind)) for (const [k] of KINDS) on.add(k);
  else { on.clear(); on.add(kind); }
  return on;
}

export function mountTimeline(root, d) {
  const stream = root.querySelector("#tl-stream");
  if (!stream) return;
  const on = new Set(KINDS.map(([k]) => k));
  const now = d?.now ? Date.parse(d.now) : Date.now();
  let page = 0, c = null;

  const show = () => {
    const rows = (d?.rows ?? []).filter((e) => on.has(e.kind));
    stream.innerHTML = renderStream(rows, page, now);
  };
  if (d?.strip && globalThis.echarts) {
    try {
      c = chart(root.querySelector("#tl-strip"), stripOption(d.strip));
      c.on("click", (p) => { const it = p.value && (d.strip ?? []).find((i) => i.name === p.value[3] && Date.parse(i.start) === p.value[1]); if (it?.href) location.hash = it.href; });
    } catch (e) { console.error("timeline strip failed", e); }
  }
  const boxes = [...root.querySelectorAll(".kinds input")];
  // A click on a label text reaches the box as a second, synthetic click that may lose the shift key.
  let labelShift = false;
  root.querySelector(".kinds")?.addEventListener("click", (ev) => {
    const box = ev.target;
    if (!boxes.includes(box)) { labelShift = !!ev.shiftKey; return; }
    const shift = ev.shiftKey || labelShift;
    labelShift = false;
    if (shift) soloKind(on, box.dataset.kind); else box.checked ? on.add(box.dataset.kind) : on.delete(box.dataset.kind);
    for (const b of boxes) b.checked = on.has(b.dataset.kind);
    page = 0; show(); c?.setOption(stripOption(d?.strip ?? [], [...on]), true);
  });
  stream.addEventListener("click", (ev) => {
    const b = ev.target.closest?.("button[data-page]");
    if (!b || b.disabled) return;
    page = Number(b.dataset.page); show();
    stream.scrollIntoView?.({ block: "start" });
  });
}
