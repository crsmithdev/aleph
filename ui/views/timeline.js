// The Activity view: an ECharts stacked area chart (events per day, 30 days, one series per
// kind), a segmented kind filter (All, Jobs, Lands, Issues; the state is `?kinds=` in the hash), then a
// sortable table (Time, Status, Type, Project, Id, Title, Contents, X): one row per event (a job started,
// passed or failed; an issue opened, triaged, decided or closed; a land), 100 to a page with Older and
// Newer controls. `data` is /api/timeline: { rows, now, strip }.
import { chart, empty, esc, labelName, money, readTokens } from "../lib.js";

export const view = {
  path: "/timeline",
  title: "Activity",
  group: "factory",
  order: 1,
  api: "/api/timeline",
  render: (d, _params, query) => renderTimeline(d, query),
  mount: (root, d, query) => mountTimeline(root, d, query),
};

/**
 * The old List address: `#/list?set=jobs` becomes `#/timeline`. The whole query is dropped,
 * a project filter too. Any other hash gives null. The shell asks every view.
 */
export function redirect(hash) {
  const h = String(hash ?? "").replace(/^#/, "");
  const path = h.split("?")[0];
  return path.replace(/\/$/, "") === "/list" ? "#/timeline" : null;
}

export const KINDS = [["job", "Jobs"], ["land", "Lands"], ["issue", "Issues"]];

export const STYLE = `<style>
.tl .kinds { display: inline-flex; margin: 0 0 8px; font: 13px var(--sans); border: 1px solid var(--rule-2); border-radius: 6px; overflow: hidden; }
.tl .kinds button { all: unset; box-sizing: border-box; padding: 3px 12px; cursor: pointer; color: var(--muted); border-left: 1px solid var(--rule-2); }
.tl .kinds button:first-child { border-left: 0; }
.tl .kinds button:hover { color: var(--ink); }
.tl .kinds button[aria-pressed="true"] { color: var(--ink); background: var(--rule-2); font-weight: 600; }
.tl .kinds button:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; }
.tl .strip { width: 100%; height: 230px; margin-bottom: 12px; }
.tl .tbl { border-collapse: collapse; width: 100%; font-size: 13px; }
.tl .tbl th { padding: 3px 10px 3px 0; font: 600 12px var(--sans); color: var(--muted); text-align: left; white-space: nowrap; }
.tl .tbl th button { all: unset; cursor: pointer; }
.tl .tbl th button:hover, .tl .tbl th button:focus-visible { color: var(--ink); }
.tl .tbl th[aria-sort] { color: var(--ink); }
.tl .tbl td { padding: 6px 10px 6px 0; border-top: 1px solid var(--rule-2); text-align: left; vertical-align: middle; white-space: nowrap; }
.tl .tbl .c-title { width: 100%; white-space: normal; overflow-wrap: anywhere; font-weight: 500; }
.tl .tbl td.c-time { color: var(--muted); font-variant-numeric: tabular-nums; }
.tl .tbl td.c-id a, .tl .tbl td.c-id span { font: 500 12.5px var(--mono); }
.tl .tbl td.c-con { max-width: 34ch; overflow: hidden; text-overflow: ellipsis; }
.tl .tbl .sep { margin: 0 6px; color: var(--muted); }
.tl .tbl .c-con .badge { margin-right: 4px; }
.tl .tbl .c-act { position: relative; width: 28px; padding: 0; text-align: right; }
.tl .pager { display: flex; align-items: center; gap: 12px; padding: 10px 0; font: 13px var(--sans); color: var(--muted); }
.tl .tbl .cancel { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px; color: var(--muted); cursor: pointer; }
.tl .tbl .cancel svg { width: 14px; height: 14px; pointer-events: none; }
.tl .tbl .cancel:hover { color: var(--stuck); background: var(--rule-2); }
.tl .tbl .cancel:focus-visible { color: var(--stuck); outline: 2px solid currentColor; outline-offset: 1px; }
.tl .tbl .cancel.arm { color: var(--stuck); background: var(--rule-2); }
.tl .tbl .cancel[disabled] { opacity: .5; cursor: default; }
.tl .tbl .cmsg { position: absolute; right: 30px; top: 50%; transform: translateY(-50%); font: 12px var(--sans); color: var(--muted); background: var(--bg, #fff); white-space: nowrap; }
.tl .tbl .cmsg.err { color: var(--stuck); }
@media (max-width: 760px) {
  .tl .tbl, .tl .tbl tbody, .tl .tbl thead { display: block; }
  .tl .tbl tr { display: flex; flex-wrap: wrap; gap: 2px 10px; padding: 6px 0; }
  .tl .tbl tbody tr { border-top: 1px solid var(--rule-2); }
  .tl .tbl th, .tl .tbl td { width: auto; padding: 0; border: 0; }
  .tl .tbl .c-title, .tl .tbl .c-con { flex: 1 1 100%; max-width: none; }
  .tl .tbl .c-con { order: 9; }
  .tl .tbl .c-act { margin-left: auto; width: 24px; }
}
</style>`;

const TONE = { running: "run", landed: "done", passed: "done", done: "done", "needs-you": "need", failed: "stuck", stuck: "stuck", dropped: "quiet" };
const GLYPH = {
  job: { started: "▷", passed: "■", held: "■", landed: "■", dropped: "■", failed: "■", stuck: "■" },
  land: { landed: "⬆" }, issue: { opened: "○", triaged: "◇", decided: "◆", closed: "✓", dropped: "✕" },
};

/** The tone of an event: a job's or land's follows its state, an issue's its verb. */
const toneOf = (e) => e.kind === "job" || e.kind === "land" ? (TONE[e.state] ?? "quiet")
  : e.kind === "issue" ? (e.what === "closed" ? "done" : e.what === "dropped" ? "quiet" : "run") : "quiet";

/** The kind mark of an event: its glyph and colour class. */
export function mark(e) {
  return { glyph: GLYPH[e.kind]?.[e.what] ?? "•", tone: toneOf(e) };
}

const pad = (n) => String(n).padStart(2, "0");
/** "25m", "1h05m": the span of a started row, which counts to `now` while the job runs. "" for the rest. */
export function duration(e, now = Date.now()) {
  if (e.kind !== "job" || e.what !== "started") return "";
  const end = e.end ? Date.parse(e.end) : e.state === "running" ? now : NaN;
  const ms = end - Date.parse(e.at);
  if (!(ms >= 0)) return "";
  const m = Math.floor(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${pad(m % 60)}m`;
}

const running = (e) => e.kind === "job" && e.what === "started" && e.state === "running" && !e.end;

/** The request a row's X sends, or null when the row is not cancellable: a running job or land, or an open issue. */
export function cancelTarget(e, closed = new Set()) {
  if (running(e)) return { url: `/api/drop/${encodeURIComponent(e.id ?? e.title)}`, body: { reason: CANCEL_REASON } };
  const m = e.kind === "issue" && e.what === "opened" && e.state === "open" && !closed.has(e.href) && /^#\/issues\/([^/]+)\/(\d+)$/.exec(e.href ?? "");
  return m ? { url: `/api/issues/${m[1]}/${m[2]}/drop`, body: { reason: CANCEL_REASON } } : null;
}
const CANCEL_REASON = "cancelled from the Activity page";

/** "MM/DD HH:MM", or "MM/DD" when only the day is known. */
export function stamp(e) {
  const d = new Date(e.at);
  if (Number.isNaN(d.getTime())) return "";
  const day = `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  return e.dateOnly ? day : `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The Status cell: { text, tone }. The text is the event's verb, past tense (started, passed, held, landed, dropped, failed, stuck, opened, triaged, decided, closed). */
export function statusOf(e) {
  return { text: e.what ?? "", tone: toneOf(e) };
}

const idOf = (e) => e.id ?? (e.kind === "job" || e.kind === "land" ? e.title : "");
/** The Id cell's text: "#247" for a job or issue (its trailing number), a commit's short sha as it is. */
export function idText(e) {
  const id = idOf(e);
  const m = /-(\d+)$/.exec(id);
  return m ? `#${m[1]}` : id;
}
const SORT = {
  time: (e) => Date.parse(e.at) || 0, status: (e) => statusOf(e).text, type: (e) => e.kind, project: (e) => e.project ?? "",
  id: idOf, title: (e) => e.title ?? "",
};
export const COLUMNS = [["time", "Time"], ["status", "Status"], ["type", "Type"], ["project", "Project"], ["id", "Id"], ["title", "Title"], ["con", "Contents"], ["act", ""]];

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

/**
 * The Contents cell as parts, only what is unique to the row's type: a job's run kind, model, cost and
 * took; a land's commit and "by hand" or "direct"; an issue's labels (chips) and note count.
 */
export function contentsParts(e, now) {
  const d = Object.fromEntries(e.details ?? []);
  const plain = (...texts) => texts.filter(Boolean).map((text) => ({ text }));
  if (e.kind === "job") return plain(e.sub ?? "agent", d.model, e.cost == null ? "" : money(e.cost), duration(e, now) || d.took);
  if (e.kind === "land") return plain(d.commit ?? e.commit?.slice(0, 7), e.sub);
  const labels = (d.labels ?? "").split(",").filter(Boolean).map((l) => ({ text: labelName(l), chip: true }));
  return [...labels, ...plain(d.notes ? `${d.notes} ${d.notes === "1" ? "note" : "notes"}` : "")];
}
/** The Contents cell as plain text, one line: "factory · followup · 2 notes". */
export const contentsText = (e, now) => contentsParts(e, now).map((p) => p.text).join(" · ");
function contents(e, now) {
  return contentsParts(e, now).map((p) => p.chip ? `<span class="badge">${esc(p.text)}</span>` : `<span>${esc(p.text)}</span>`).join('<span class="sep">·</span>');
}

export const X_ICON = `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

/** One stream row, aligned in the columns: Time, Status, Type, Project, Id, Title, Contents and an X where one applies. */
export function renderEvent(e, now = Date.now(), closed = new Set()) {
  const st = statusOf(e), id = idText(e);
  const idCell = !id ? "" : e.href ? `<a class="id" href="${esc(e.href)}">${esc(id)}</a>` : `<span class="id">${esc(id)}</span>`;
  const x = cancelTarget(e, closed)
    ? `<button type="button" class="cancel" data-cancel aria-label="Stop or drop ${esc(id || e.title)}" title="Stop or drop">${X_ICON}</button>` : "";
  return `<tr class="evr" data-kind="${esc(e.kind)}"><td class="c-time">${esc(stamp(e))}</td>` +
    `<td class="c-status">${st.text ? `<span class="badge ${st.tone}">${esc(st.text)}</span>` : ""}</td>` +
    `<td class="c-type">${esc(e.kind)}</td><td class="c-project">${esc(e.project ?? "")}</td><td class="c-id">${idCell}</td>` +
    `<td class="c-title">${esc(e.title)}</td><td class="c-con" title="${esc(contentsText(e, now))}">${contents(e, now)}</td>` +
    `<td class="c-act">${x}<span class="cmsg" role="status"></span></td></tr>`;
}

export const PAGE = 100;
/** The issues that have a closed or dropped row. */
const closedIssues = (rows) => new Set(rows.filter((e) => e.kind === "issue" && (e.what === "closed" || e.what === "dropped")).map((e) => e.href));

/** A sortable header row: `columns` are [key, label], only keys in `sortable` get a button. */
export function head(sort, columns = COLUMNS, sortable = SORT) {
  return `<thead><tr>${columns.map(([k, label]) => {
    if (!sortable[k]) return `<th class="c-${k}">${label}</th>`;
    const on = sort.key === k;
    return `<th class="c-${k}"${on ? ` aria-sort="${sort.dir > 0 ? "ascending" : "descending"}"` : ""}><button type="button" data-sort="${k}">${label}${on ? (sort.dir > 0 ? " ▲" : " ▼") : ""}</button></th>`;
  }).join("")}</tr></thead>`;
}

/** Page `page` (0 = first) of the rows in `sort` order, 100 to a page, with Older and Newer controls. */
export function renderStream(rows, page = 0, now = Date.now(), size = PAGE, sort = { key: "time", dir: -1 }) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(0, page), pages - 1);
  // An issue that has a closed or dropped row is no longer open, whatever its opened row says.
  const closed = closedIssues(rows);
  const body = sortRows(rows, sort).slice(p * size, (p + 1) * size).map((e) => renderEvent(e, now, closed)).join("");
  const ctl = `<div class="pager"><button type="button" data-page="${p + 1}"${p + 1 >= pages ? " disabled" : ""}>Older</button>` +
    `<span>Page ${p + 1} of ${pages}</span><button type="button" data-page="${p - 1}"${p === 0 ? " disabled" : ""}>Newer</button></div>`;
  return `<div class="list"><table class="tbl">${head(sort)}<tbody>${body}</tbody></table></div>${ctl}`;
}

/** The kinds shown by the hash query `?kinds=job,land`; none named, or none valid, is all. */
export function parseKinds(query) {
  const named = String(query?.get?.("kinds") ?? "").split(",").filter((k) => KINDS.some(([x]) => x === k));
  return new Set(named.length ? named : KINDS.map(([k]) => k));
}
/** The hash for a set of kinds: the Activity address with `?kinds=` unless all are on. */
export function kindsHash(on) {
  return on.size === KINDS.length ? "#/timeline" : `#/timeline?kinds=${KINDS.filter(([k]) => on.has(k)).map(([k]) => k).join(",")}`;
}

/** The kind control: All, then one button per kind, pressed while shown. */
export function renderKinds(on) {
  const all = on.size === KINDS.length;
  const b = (k, label, pressed) => `<button type="button" data-kind="${k}" aria-pressed="${pressed}">${esc(label)}</button>`;
  return `<div class="kinds" role="group" aria-label="Kinds">${b("all", "All", all)}${KINDS.map(([k, label]) => b(k, label, !all && on.has(k))).join("")}</div>`;
}

export function renderTimeline(d, query) {
  if (!d) return `<div class="page">${empty("No data.")}</div>`;
  const rows = d.rows ?? [], on = parseKinds(query);
  return `${STYLE}<div class="page tl"><h1>Activity</h1>${renderKinds(on)}` +
    `<div class="strip" id="tl-strip" role="img" aria-label="Events per day by kind, stacked, last 30 days"></div>` +
    `<div id="tl-stream">${renderStream(rows.filter((e) => on.has(e.kind)), 0, d.now ? Date.parse(d.now) : Date.now())}</div>` +
    (rows.length ? "" : empty("Nothing happened yet.", "Jobs, issues and lands show up here.")) + `</div>`;
}

const DAYS = 30;
const SERIES_TONE = { job: "run", land: "done", issue: "need" };

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

/**
 * A click on the kind control: All shows every kind; a plain click on a kind shows only it; a click with
 * shift, Ctrl or Cmd toggles it and keeps the others (toggling the last one off shows all).
 */
export function pickKind(on, kind, multi) {
  const all = () => { for (const [k] of KINDS) on.add(k); };
  if (kind === "all") all();
  else if (!multi) { on.clear(); on.add(kind); }
  else { if (on.has(kind)) on.delete(kind); else on.add(kind); if (!on.size) all(); }
  return on;
}

export function mountTimeline(root, d, query) {
  const stream = root.querySelector("#tl-stream");
  if (!stream) return;
  const on = parseKinds(query ?? (typeof location === "undefined" ? undefined : new URLSearchParams(location.hash.split("?")[1] ?? "")));
  const now = d?.now ? Date.parse(d.now) : Date.now();
  let page = 0, c = null, sort = { key: "time", dir: -1 };

  const show = () => {
    const rows = (d?.rows ?? []).filter((e) => on.has(e.kind));
    stream.innerHTML = renderStream(rows, page, now, PAGE, sort);
  };
  if (d?.strip && globalThis.echarts) {
    try {
      c = chart(root.querySelector("#tl-strip"), stripOption(d.strip, [...on], now));
    } catch (e) { console.error("timeline strip failed", e); }
  }
  const buttons = [...(root.querySelectorAll?.(".kinds button") ?? [])];
  root.querySelector(".kinds")?.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("button[data-kind]");
    if (!btn) return;
    pickKind(on, btn.dataset.kind, !!(ev.shiftKey || ev.ctrlKey || ev.metaKey));
    const all = on.size === KINDS.length;
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.kind === "all" ? all : !all && on.has(b.dataset.kind)));
    // The hash keeps the state over a reload; replaceState does not reload the view.
    if (typeof history !== "undefined" && typeof location !== "undefined") history.replaceState(null, "", kindsHash(on));
    page = 0; show(); c?.setOption(stripOption(d?.strip ?? [], [...on], now), true);
  });
  // Rows by position on the page, so a click finds its event again after a redraw.
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
    const closed = closedIssues(d?.rows ?? []);
    const target = e && cancelTarget(e, closed);
    if (!target) return;
    await confirmCancel(btn, msg, target, (j) => {
      // The row shows its new state, and keeps it when the page redraws.
      if (e.kind === "issue") { e.state = j.status ?? "dropped"; e.what = e.state === "done" ? "closed" : "dropped"; }
      else { e.state = "dropped"; e.what = "dropped"; e.end = new Date().toISOString(); }
      tr.outerHTML = renderEvent(e, now, closed);
      const done = [...stream.querySelectorAll("tbody tr")][rows.indexOf(e)]?.querySelector(".cmsg");
      if (done) done.textContent = e.kind === "issue" ? `Now ${e.state}` : "Dropped";
    });
  }
}

const CONFIRM_MS = 5000;
/**
 * The X's two clicks: the first arms the button, the second within 5 s sends `target`
 * ({ url, body }); `done(json)` runs on success, the error shows in the row's `msg` cell.
 */
export async function confirmCancel(btn, msg, target, done) {
  if (!btn.dataset.armed) {
    btn.dataset.armed = "1"; btn.title = "Click again to confirm"; btn.classList.add("arm"); msg.textContent = "";
    setTimeout(() => { if (!btn.isConnected || btn.dataset.sent) return; delete btn.dataset.armed; btn.title = "Stop or drop"; btn.classList.remove("arm"); }, CONFIRM_MS);
    return;
  }
  if (btn.dataset.sent) return;
  btn.dataset.sent = "1"; btn.disabled = true; msg.className = "cmsg"; msg.textContent = "Cancelling…";
  try {
    const res = await fetch(target.url, { method: "POST", headers: { "content-type": "application/json", "x-aleph-ui": "1" }, body: JSON.stringify(target.body) });
    const j = await res.json().catch(() => ({}));
    const err = !res.ok ? (j.error ?? `HTTP ${res.status}`) : j.code ? (j.stderr || j.stdout || `aleph exited ${j.code}`).trim() : "";
    if (err) throw new Error(err);
    done(j);
  } catch (x) {
    delete btn.dataset.sent; delete btn.dataset.armed; btn.disabled = false; btn.title = "Stop or drop"; btn.classList.remove("arm");
    msg.className = "cmsg err"; msg.textContent = x?.message ?? String(x);
  }
}
