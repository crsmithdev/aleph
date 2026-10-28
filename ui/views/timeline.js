// The Activity view: an ECharts stacked area chart (events per day, 30 days, one series per
// kind), then a sortable table (Time, Status, Type, Subtype, Id, Title, Contents, X), one row per job, session, land, issue and note, 100 to a
// page with Older and Newer controls. `data` is /api/timeline: { rows, now, strip, langfuse }.
import { chart, empty, esc, money, readTokens } from "../lib.js";

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
.tl .tbl { border-collapse: collapse; width: 100%; table-layout: fixed; font-size: 13px; }
.tl .tbl th { padding: 3px 10px 3px 0; font: 600 12px var(--sans); color: var(--muted); text-align: left; white-space: nowrap; }
.tl .tbl th button { all: unset; cursor: pointer; }
.tl .tbl th button:hover, .tl .tbl th button:focus-visible { color: var(--ink); }
.tl .tbl th[aria-sort] { color: var(--ink); }
.tl .tbl td { padding: 6px 10px 6px 0; border-top: 1px solid var(--rule-2); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.tl .tbl .c-time { width: 92px; } .tl .tbl .c-status { width: 96px; } .tl .tbl .c-type { width: 64px; }
.tl .tbl .c-sub { width: 88px; } .tl .tbl .c-id { width: 128px; } .tl .tbl .c-title { width: 24%; } .tl .tbl .c-act { width: 112px; }
.tl .tbl td.c-time { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.tl .tbl td.c-id a, .tl .tbl td.c-id span { font: 500 12.5px var(--mono); }
.tl .tbl td.c-title { font-weight: 500; }
.tl .tbl .c2 { display: block; color: var(--muted); font-size: 12.5px; }
.tl .tbl .k { color: var(--muted); }
.tl .tbl .f { margin-right: 12px; white-space: nowrap; }
.tl .pager { display: flex; align-items: center; gap: 12px; padding: 10px 0; font: 13px var(--sans); color: var(--muted); }
.tl .tbl .cancel { font: 14px var(--sans); cursor: pointer; }
.tl .tbl .cancel.arm { color: var(--stuck); font-size: 12px; }
.tl .tbl .cmsg { margin-left: 8px; font: 12px var(--sans); color: var(--muted); }
.tl .tbl .cmsg.err { color: var(--stuck); }
@media (max-width: 760px) {
  .tl .tbl, .tl .tbl tbody, .tl .tbl thead { display: block; }
  .tl .tbl tr { display: flex; flex-wrap: wrap; gap: 2px 10px; padding: 6px 0; }
  .tl .tbl tbody tr { border-top: 1px solid var(--rule-2); }
  .tl .tbl th, .tl .tbl td { width: auto; padding: 0; border: 0; }
  .tl .tbl .c-title, .tl .tbl .c-con { flex: 1 1 100%; }
  .tl .tbl .c-con { order: 9; }
  .tl .tbl .c-act { margin-left: auto; }
}
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

/** The request a row's X sends, or null when the row is not cancellable: a running job or land, or an open issue. */
export function cancelTarget(e, closed = new Set()) {
  if (running(e)) return { url: `/api/drop/${encodeURIComponent(e.id ?? e.title)}`, body: { reason: CANCEL_REASON } };
  const m = e.kind === "issue" && e.what === "opened" && e.state === "open" && !closed.has(e.href) && /^#\/issues\/([^/]+)\/(\d+)$/.exec(e.href ?? "");
  return m ? { url: `/api/issues/${m[1]}/${m[2]}/drop`, body: { reason: CANCEL_REASON } } : null;
}
const CANCEL_REASON = "cancelled from the Activity page";

const detail = (e, k) => e.details?.find(([key]) => key === k)?.[1];

/** "MM/DD HH:MM", or "MM/DD" when only the day is known. */
export function stamp(e) {
  const d = new Date(e.at);
  if (Number.isNaN(d.getTime())) return "";
  const day = `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  return e.dateOnly ? day : `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const JOB_STATES = { running: "Running", landed: "Landed", passed: "Passed", done: "Done", "needs-you": "Needs you", failed: "Failed", stuck: "Stuck", dropped: "Dropped" };
/** The Status cell: { text, tone }. */
export function statusOf(e) {
  const s = e.state;
  if (e.kind === "job") return { text: JOB_STATES[s] ?? s ?? "", tone: TONE[s] ?? "quiet" };
  if (e.kind === "land") return { text: "Landed", tone: "done" };
  if (e.kind === "issue") return { text: s === "open" ? "Open" : s === "done" ? "Done" : s === "dropped" ? "Dropped" : s ?? "", tone: s === "open" ? "run" : s === "done" ? "done" : "quiet" };
  if (e.kind === "session") return { text: "Logged", tone: "quiet" };
  return { text: "Written", tone: "quiet" };
}

/** The Subtype cell: the kind of land, job, issue, session or note. */
export function subtypeOf(e) {
  if (e.sub) return e.sub;
  if (e.kind === "job") return "agent";
  if (e.kind === "land") return e.commit && !e.id?.includes("-") ? "commit" : "job";
  if (e.kind === "issue") return e.what ?? "";
  if (e.kind === "session") return (detail(e, "kinds") ?? "").split(",")[0] || "chat";
  return "daily";
}

const idOf = (e) => e.id ?? (e.kind === "job" || e.kind === "land" ? e.title : "");
const SORT = {
  time: (e) => Date.parse(e.at) || 0, status: (e) => statusOf(e).text, type: (e) => e.kind, sub: subtypeOf,
  id: idOf, title: (e) => e.title ?? "",
};
export const COLUMNS = [["time", "Time"], ["status", "Status"], ["type", "Type"], ["sub", "Subtype"], ["id", "Id"], ["title", "Title"], ["con", "Contents"], ["act", ""]];

/** The rows ordered by `sort` = { key, dir } (dir 1 up, -1 down). Ties keep newest first. */
export function sortRows(rows, sort = { key: "time", dir: -1 }) {
  const f = SORT[sort.key] ?? SORT.time;
  return [...rows].sort((a, b) => {
    const x = f(a), y = f(b);
    const c = typeof x === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    return c * sort.dir || SORT.time(b) - SORT.time(a);
  });
}
/** A click on a header: the same column reverses, another starts (Time descending, the rest ascending). */
export const nextSort = (sort, key) => sort.key === key ? { key, dir: -sort.dir } : { key, dir: key === "time" ? -1 : 1 };

/** The Contents cell: project, time taken and cost on the first line, the item's other fields muted on the second. */
function contents(e, now) {
  const fact = (k, v) => v ? `<span class="f"><span class="k">${esc(k)}</span> ${esc(v)}</span>` : "";
  const first = fact("Project", e.project) + fact("Took", duration(e, now)) + fact("Cost", e.cost == null ? "" : money(e.cost));
  const rest = (e.details ?? []).filter(([k]) => k !== "took").map(([k, v]) => fact(k[0].toUpperCase() + k.slice(1), k === "labels" ? v.split(",").join(", ") : v)).join("");
  return `${first}${rest ? `<span class="c2">${rest}</span>` : ""}`;
}

/** One stream row, aligned in the columns: Time, Status, Type, Subtype, Id, Title, Contents and an X where one applies. */
export function renderEvent(e, now = Date.now(), closed = new Set()) {
  const st = statusOf(e), id = idOf(e);
  const idCell = !id ? "" : e.href ? `<a class="id" href="${esc(e.href)}">${esc(id)}</a>` : `<span class="id">${esc(id)}</span>`;
  const x = cancelTarget(e, closed)
    ? `<button type="button" class="cancel" data-cancel aria-label="Stop or drop ${esc(id || e.title)}" title="Stop or drop">✕</button>` : "";
  return `<tr class="evr" data-kind="${esc(e.kind)}"><td class="c-time">${esc(stamp(e))}</td>` +
    `<td class="c-status">${st.text ? `<span class="badge ${st.tone}">${esc(st.text)}</span>` : ""}</td>` +
    `<td class="c-type">${esc(e.kind)}</td><td class="c-sub">${esc(subtypeOf(e))}</td><td class="c-id">${idCell}</td>` +
    `<td class="c-title">${esc(e.title)}</td><td class="c-con">${contents(e, now)}</td>` +
    `<td class="c-act">${x}<span class="cmsg" role="status"></span></td></tr>`;
}

export const PAGE = 100;

function head(sort) {
  return `<thead><tr>${COLUMNS.map(([k, label]) => {
    if (!SORT[k]) return `<th class="c-${k}">${label}</th>`;
    const on = sort.key === k;
    return `<th class="c-${k}"${on ? ` aria-sort="${sort.dir > 0 ? "ascending" : "descending"}"` : ""}><button type="button" data-sort="${k}">${label}${on ? (sort.dir > 0 ? " ▲" : " ▼") : ""}</button></th>`;
  }).join("")}</tr></thead>`;
}

/** Page `page` (0 = first) of the rows in `sort` order, 100 to a page, with Older and Newer controls. */
export function renderStream(rows, page = 0, now = Date.now(), size = PAGE, sort = { key: "time", dir: -1 }) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(0, page), pages - 1);
  // An issue that has a closed or dropped row is no longer open, whatever its opened row says.
  const closed = new Set(rows.filter((e) => e.kind === "issue" && e.what !== "opened").map((e) => e.href));
  const body = sortRows(rows, sort).slice(p * size, (p + 1) * size).map((e) => renderEvent(e, now, closed)).join("");
  const ctl = `<div class="pager"><button type="button" data-page="${p + 1}"${p + 1 >= pages ? " disabled" : ""}>Older</button>` +
    `<span>Page ${p + 1} of ${pages}</span><button type="button" data-page="${p - 1}"${p === 0 ? " disabled" : ""}>Newer</button></div>`;
  return `<div class="list"><table class="tbl">${head(sort)}<tbody>${body}</tbody></table></div>${ctl}`;
}

export function renderTimeline(d) {
  if (!d) return `<div class="page">${empty("No data.")}</div>`;
  const note = d.langfuse === "off" ? `<p class="hint">Langfuse is not configured: sessions are left out.</p>` : d.langfuse === "error" ? `<p class="hint">Langfuse failed: sessions are left out.</p>` : "";
  const rows = d.rows ?? [];
  return `${STYLE}<div class="page tl"><h1>Activity</h1>${note}` +
    `<div class="kinds" role="group" aria-label="Kinds">${KINDS.map(([k, label]) => `<label><input type="checkbox" data-kind="${k}" checked> ${esc(label)}</label>`).join("")}</div>` +
    `<div class="strip" id="tl-strip" role="img" aria-label="Events per day by kind, stacked, last 30 days"></div>` +
    `<div id="tl-stream">${renderStream(rows, 0, d.now ? Date.parse(d.now) : Date.now())}</div>` +
    (rows.length ? "" : empty("Nothing happened yet.", "Jobs, issues, sessions, lands and notes show up here.")) + `</div>`;
}

const DAYS = 30;
const SERIES_TONE = { job: "run", land: "done", issue: "need", session: "focus", note: "ink" };

/**
 * The strip's ECharts option: a stacked area chart of events per day, one line series per shown
 * kind, over the last 30 days ending at `now`. Series are stacked and have an area fill.
 */
export function stripOption(strip, kinds = KINDS.map(([k]) => k), now = Date.now()) {
  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(now), x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (DAYS - 1 - i), 12);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  });
  const shown = KINDS.filter(([k]) => kinds.includes(k));
  const t = typeof document === "undefined" ? {} : readTokens();
  return {
    animation: false,
    grid: { left: 36, right: 12, top: 28, bottom: 28 },
    legend: { show: false },
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", boundaryGap: false, data: days, axisLabel: { hideOverlap: true, formatter: (v) => v.slice(5) } },
    yAxis: { type: "value", minInterval: 1 },
    series: shown.map(([k, name]) => {
      const color = t[SERIES_TONE[k]] || t.ink;
      const counts = days.map((day) => strip.filter((it) => it.kind === k && it.day === day).length);
      return { name, type: "line", stack: "events", areaStyle: { opacity: 0.7 }, symbol: "none", lineStyle: { width: 1 }, ...(color ? { color } : {}), data: counts };
    }),
  };
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
  let page = 0, c = null, sort = { key: "time", dir: -1 };

  const show = () => {
    const rows = (d?.rows ?? []).filter((e) => on.has(e.kind));
    stream.innerHTML = renderStream(rows, page, now, PAGE, sort);
  };
  if (d?.strip && globalThis.echarts) {
    try {
      c = chart(root.querySelector("#tl-strip"), stripOption(d.strip, undefined, now));
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
    page = 0; show(); c?.setOption(stripOption(d?.strip ?? [], [...on], now), true);
  });
  // Rows by position on the page, so a click finds its event again after a redraw.
  const CONFIRM_MS = 5000;
  stream.addEventListener("click", async (ev) => {
    const cb = ev.target.closest?.("button[data-cancel]");
    if (cb) return cancelClick(cb);
    const sb = ev.target.closest?.("button[data-sort]");
    if (sb) { sort = nextSort(sort, sb.dataset.sort); page = 0; return show(); }
    const b = ev.target.closest?.("button[data-page]");
    if (!b || b.disabled) return;
    page = Number(b.dataset.page); show();
    stream.scrollIntoView?.({ block: "start" });
  });
  async function cancelClick(btn) {
    const tr = btn.closest("tr"), msg = tr.querySelector(".cmsg");
    const rows = sortRows((d?.rows ?? []).filter((e) => on.has(e.kind)), sort).slice(page * PAGE, (page + 1) * PAGE);
    const e = rows[[...stream.querySelectorAll("tbody tr")].indexOf(tr)];
    const closed = new Set((d?.rows ?? []).filter((x) => x.kind === "issue" && x.what !== "opened").map((x) => x.href));
    const target = e && cancelTarget(e, closed);
    if (!target) return;
    if (!btn.dataset.armed) {
      btn.dataset.armed = "1"; btn.textContent = "Confirm?"; btn.classList.add("arm"); msg.textContent = "";
      setTimeout(() => { if (!btn.isConnected || btn.dataset.sent) return; delete btn.dataset.armed; btn.textContent = "✕"; btn.classList.remove("arm"); }, CONFIRM_MS);
      return;
    }
    if (btn.dataset.sent) return;
    btn.dataset.sent = "1"; btn.disabled = true; msg.className = "cmsg"; msg.textContent = "Cancelling…";
    try {
      const res = await fetch(target.url, { method: "POST", headers: { "content-type": "application/json", "x-aleph-ui": "1" }, body: JSON.stringify(target.body) });
      const j = await res.json().catch(() => ({}));
      const err = !res.ok ? (j.error ?? `HTTP ${res.status}`) : j.code ? (j.stderr || j.stdout || `aleph exited ${j.code}`).trim() : "";
      if (err) throw new Error(err);
      // The row shows its new state, and keeps it when the page redraws.
      if (e.kind === "issue") e.state = j.status ?? "dropped";
      else { e.state = "dropped"; e.end = new Date().toISOString(); }
      tr.outerHTML = renderEvent(e, now, closed);
      const done = [...stream.querySelectorAll("tbody tr")][rows.indexOf(e)]?.querySelector(".cmsg");
      if (done) done.textContent = e.kind === "issue" ? `Now ${e.state}` : "Dropped";
    } catch (x) {
      delete btn.dataset.sent; delete btn.dataset.armed; btn.disabled = false; btn.textContent = "✕"; btn.classList.remove("arm");
      msg.className = "cmsg err"; msg.textContent = x?.message ?? String(x);
    }
  }
}
