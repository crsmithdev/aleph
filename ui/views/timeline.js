// The Activity view: an ECharts stacked area chart (events per day, 30 days, one series per
// kind), a segmented kind filter (All, Jobs, Lands, Issues; the state is `?kinds=` in the hash), then a
// sortable table (Id, Title, Status, Type, Project, Contents, Time, X): one row per event (a job started,
// passed or failed; an issue opened, triaged, decided or closed; a land), 50 rows and a "Show 50 more" pager. `data` is /api/timeline: { rows, now, strip }.
import { chart, chips, empty, esc, filterBar, idLink, labelName, money, pageHead, pager, readTokens, shortModel, sortHead, tone, when } from "../lib.js";

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

const PAGE_STYLE = `<style>
.tl .strip { width: 100%; height: 230px; margin-bottom: 12px; }
.tl .tbl .c-title { font-weight: 500; }
.tl .tbl td.c-con { max-width: 34ch; overflow: hidden; text-overflow: ellipsis; font-size: var(--fs-xs); }
.tl .tbl .k { color: var(--muted); font-weight: 700; }
.tl .tbl .c-con > span + span { margin-left: 8px; }
.tl .tbl tr.evr { cursor: pointer; }
.tl .tbl tr.more td { padding: 6px 12px 10px 0; white-space: normal; background: var(--rule-2); }
.tl .tbl tr.more dl { display: flex; flex-wrap: wrap; gap: 2px 16px; margin: 0; }
.tl .tbl tr.more dl > div { overflow-wrap: anywhere; }
.tl .tbl tr.more dt, .tl .tbl tr.more dd { display: inline; margin: 0; }
.tl .tbl tr.more .open { display: inline-block; margin-top: 6px; }
.tl .tbl .c-act { position: relative; width: 28px; padding: 0; text-align: right; }
.tl .tbl .cancel { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px; color: var(--muted); cursor: pointer; }
.tl .tbl .cancel svg { width: 14px; height: 14px; pointer-events: none; }
.tl .tbl .cancel:hover { color: var(--stuck); background: var(--rule-2); }
.tl .tbl .cancel:focus-visible { color: var(--stuck); outline: 2px solid currentColor; outline-offset: 1px; }
.tl .tbl .cancel.arm { color: var(--stuck); background: var(--rule-2); }
.tl .tbl .cancel[disabled] { opacity: .5; cursor: default; }
.tl .tbl .cmsg { position: absolute; right: 30px; top: 50%; transform: translateY(-50%); font: var(--fs-xs) var(--sans); color: var(--muted); background: var(--bg, #fff); white-space: nowrap; }
.tl .tbl .cmsg.err { color: var(--stuck); }
</style>`;

const GLYPH = {
  job: { started: "▷", passed: "■", held: "■", landed: "■", dropped: "■", failed: "■", stuck: "■" },
  land: { landed: "⬆" }, issue: { opened: "○", triaged: "◇", decided: "◆", closed: "✓", dropped: "✕" },
};

/** The tone of an event: a job's or land's follows its state, an issue's its verb. */
const toneOf = (e) => e.kind === "job" || e.kind === "land" ? (tone(e.state))
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

/** The Time cell: the shared `when` ("Oct 28 08:45"), or "Oct 28" when only the day is known. */
export function stamp(e) {
  const t = when(e.at);
  return e.dateOnly ? t.replace(/ \d\d:\d\d$/, "") : t;
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
export const COLUMNS = [["id", "Id"], ["title", "Title"], ["status", "Status"], ["type", "Type"], ["project", "Project"], ["con", "Contents"], ["time", "Time"], ["act", ""]];

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
  const plain = (...kv) => kv.filter(([, text]) => text).map(([key, text]) => ({ key, text }));
  if (e.kind === "job") return plain(["run", e.sub ?? "agent"], ["model", shortModel(d.model)], ["cost", e.cost == null ? "" : money(e.cost)], ["took", duration(e, now) || d.took]);
  if (e.kind === "land") return plain(["commit", d.commit ?? e.commit?.slice(0, 7)], ["landed", e.sub]);
  const labels = (d.labels ?? "").split(",").filter(Boolean).map((l) => ({ text: labelName(l), raw: l }));
  return [...(labels.length ? [{ key: "labels", chips: labels }] : []), ...plain(["notes", d.notes])];
}
const partText = (p) => `${p.key}: ${p.chips ? p.chips.map((c) => c.text).join(" ") : p.text}`;
/** The Contents cell as plain text, one line of `key: value` pairs two spaces apart: "labels: factory followup  notes: 2". */
export const contentsText = (e, now) => contentsParts(e, now).map(partText).join("  ");
/** One `key: value` pair: the key bold and muted, the value as it is (chips for labels). */
const pair = (p) => `<span><b class="k">${esc(p.key)}:</b> ${p.chips ? chips(p.chips.map((c) => c.raw ?? c.text)) : esc(p.text)}</span>`;
const contents = (e, now) => contentsParts(e, now).map(pair).join(" ");

/** A row's identity in the hash: kind, verb, id and time, unique per event. */
export const rowKey = (e) => `${e.kind}.${e.what}.${idOf(e)}.${Date.parse(e.at) || 0}`;
/**
 * The extra row under an expanded event: every `details` pair of the event as `key: value` (plus
 * the cost, the run kind and a long title when the details lack them), and a link to its page.
 */
export function renderMore(e, now) {
  const kv = (e.details ?? []).map(([key, text]) => ({ key, text: key === "labels" ? text.split(",").map(labelName).join(" ") : text }));
  const has = (k) => kv.some((p) => p.key === k);
  // The API leaves out pairs the row repeats at top level; put them back.
  if (e.state && !has("state") && e.kind !== "issue") kv.unshift({ key: "state", text: e.state });
  if (e.kind === "land" && e.commit && !has("commit")) kv.push({ key: "commit", text: e.commit.slice(0, 7) });
  if (e.kind === "land" && e.sub !== "direct" && e.id && !has("job")) kv.push({ key: "job", text: e.id });
  if (e.kind === "land" && e.title && e.title !== e.id && !has("message")) kv.push({ key: "message", text: e.title });
  if (e.kind === "job" && e.cost != null && !has("cost")) kv.push({ key: "cost", text: money(e.cost) });
  if (e.kind === "job" && e.sub && !has("run")) kv.splice(1, 0, { key: "run", text: e.sub });
  if (e.kind === "job" && e.what === "started" && !has("took") && duration(e, now)) kv.push({ key: "took", text: duration(e, now) });
  if (String(e.title ?? "").length > 60) kv.unshift({ key: "title", text: e.title });
  const list = kv.map((p) => `<div>${pair(p)}</div>`).join("");
  const link = e.href ? `<a class="open" href="${esc(e.href)}">Open ${e.kind} page →</a>` : "";
  return `<tr class="more" data-key="${esc(rowKey(e))}"><td colspan="${COLUMNS.length}"><dl>${list}</dl>${link}</td></tr>`;
}

export const X_ICON = `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

/** One stream row, aligned in the columns: Id, Title, Status, Type, Project, Contents, Time and an X where one applies. */
export function renderEvent(e, now = Date.now(), closed = new Set(), open = false) {
  const st = statusOf(e), id = idText(e);
  const idCell = !id ? "" : e.href ? idLink(id, e.href) : esc(id);
  const x = cancelTarget(e, closed)
    ? `<button type="button" class="cancel" data-cancel aria-label="Stop or drop ${esc(id || e.title)}" title="Stop or drop">${X_ICON}</button>` : "";
  return `<tr class="evr" data-kind="${esc(e.kind)}" data-key="${esc(rowKey(e))}" aria-expanded="${open}"><td class="c-id">${idCell}</td>` +
    `<td class="c-title wide" title="${esc(e.title)}">${esc(e.title)}</td>` +
    `<td class="c-status">${st.text ? `<span class="badge ${st.tone}">${esc(st.text)}</span>` : ""}</td>` +
    `<td class="c-type">${esc(e.kind)}</td><td class="c-project">${esc(e.project ?? "")}</td>` +
    `<td class="c-con" title="${esc(contentsText(e, now))}">${contents(e, now)}</td>` +
    `<td class="c-time time">${esc(stamp(e))}</td>` +
    `<td class="c-act">${x}<span class="cmsg" role="status"></span></td></tr>`;
}

export const PAGE = 50;
/** The issues that have a closed or dropped row. */
const closedIssues = (rows) => new Set(rows.filter((e) => e.kind === "issue" && (e.what === "closed" || e.what === "dropped")).map((e) => e.href));

/** The stream's header row: the sortable columns get a sort button. */
function streamHead(sort) {
  return `<thead><tr>${COLUMNS.map(([k, label]) => SORT[k] ? sortHead(label, k, sort) : `<th>${label}</th>`).join("")}</tr></thead>`;
}

/** The first `shown` rows in `sort` order (50 to start), with the pager under them. */
export function renderStream(rows, shown = PAGE, now = Date.now(), sort = { key: "time", dir: -1 }, open = new Set()) {
  // An issue that has a closed or dropped row is no longer open, whatever its opened row says.
  const closed = closedIssues(rows);
  const body = sortRows(rows, sort).slice(0, shown).map((e) => open.has(rowKey(e)) ? renderEvent(e, now, closed, true) + renderMore(e, now) : renderEvent(e, now, closed)).join("");
  return `<div class="list"><div class="tscroll"><table class="tbl">${streamHead(sort)}<tbody>${body}</tbody></table></div></div>${pager(shown, rows.length, PAGE)}`;
}

/** The kinds shown by the hash query `?kinds=job,land`; none named, or none valid, is all. */
export function parseKinds(query) {
  const named = String(query?.get?.("kinds") ?? "").split(",").filter((k) => KINDS.some(([x]) => x === k));
  return new Set(named.length ? named : KINDS.map(([k]) => k));
}
/** The expanded rows named by `?open=`, keys joined by "~". */
export function parseOpen(query) {
  return new Set(String(query?.get?.("open") ?? "").split("~").filter(Boolean));
}
/** The hash for a set of kinds and expanded rows: the Activity address with `?kinds=` unless all are on, and `?open=` when rows are open. */
export function kindsHash(on, open = new Set()) {
  const q = [];
  if (on.size !== KINDS.length) q.push(`kinds=${KINDS.filter(([k]) => on.has(k)).map(([k]) => k).join(",")}`);
  if (open.size) q.push(`open=${[...open].map(encodeURIComponent).join("~")}`);
  return q.length ? `#/timeline?${q.join("&")}` : "#/timeline";
}

/** The kind control: All, then one button per kind, pressed while shown. */
export function renderKinds(on) {
  const all = on.size === KINDS.length;
  const bar = filterBar([{ label: "Kinds", name: "kind", options: [{ value: "all", label: "All" }, ...KINDS.map(([value, label]) => ({ value, label }))], value: "all" }]);
  // filterBar shows one value; several kinds can be on at once, so set each button's state here.
  return bar.replace(/data-value="(\w+)" aria-pressed="\w+"/g, (_, k) => `data-value="${k}" aria-pressed="${k === "all" ? all : !all && on.has(k)}"`);
}

export function renderTimeline(d, query) {
  if (!d) return `<div class="page">${empty("No data.")}</div>`;
  const rows = d.rows ?? [], on = parseKinds(query);
  const shownRows = rows.filter((e) => on.has(e.kind));
  return `${PAGE_STYLE}<div class="page tl">${pageHead("Activity", { count: rows.length })}${renderKinds(on)}` +
    `<div class="strip" id="tl-strip" role="img" aria-label="Events per day by kind, stacked, last 30 days"></div>` +
    `<div id="tl-stream">${renderStream(shownRows, PAGE, d.now ? Date.parse(d.now) : Date.now(), undefined, parseOpen(query))}</div>` +
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
  const open = parseOpen(query ?? (typeof location === "undefined" ? undefined : new URLSearchParams(location.hash.split("?")[1] ?? "")));
  let shown = PAGE, c = null, sort = { key: "time", dir: -1 };

  const show = () => {
    const rows = (d?.rows ?? []).filter((e) => on.has(e.kind));
    stream.innerHTML = renderStream(rows, shown, now, sort, open);
  };
  const saveHash = () => {
    // The hash keeps the state over a reload; replaceState does not reload the view.
    if (typeof history !== "undefined" && typeof location !== "undefined") history.replaceState(null, "", kindsHash(on, open));
  };
  const toggle = (key, to = !open.has(key)) => { if (to) open.add(key); else open.delete(key); saveHash(); show(); };
  const onKey = (ev) => {
    if (stream.isConnected === false) return document.removeEventListener("keydown", onKey);
    if (ev.key === "Escape" && open.size) { open.clear(); saveHash(); show(); }
  };
  if (typeof document !== "undefined") document.addEventListener("keydown", onKey);
  if (d?.strip && globalThis.echarts) {
    try {
      c = chart(root.querySelector("#tl-strip"), stripOption(d.strip, [...on], now));
    } catch (e) { console.error("timeline strip failed", e); }
  }
  const buttons = [...(root.querySelectorAll?.(".fbar .seg button") ?? [])];
  root.querySelector(".fbar .seg")?.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("button[data-value]");
    if (!btn) return;
    pickKind(on, btn.dataset.value, !!(ev.shiftKey || ev.ctrlKey || ev.metaKey));
    const all = on.size === KINDS.length;
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.value === "all" ? all : !all && on.has(b.dataset.value)));
    saveHash();
    shown = PAGE; show(); c?.setOption(stripOption(d?.strip ?? [], [...on], now), true);
  });
  // Rows by position on the page, so a click finds its event again after a redraw.
  stream.addEventListener("click", async (ev) => {
    const cb = ev.target.closest?.("button[data-cancel]");
    if (cb) return cancelClick(cb);
    const sb = ev.target.closest?.("button[data-sort]");
    if (sb) { sort = nextSort(sort, sb.dataset.sort); shown = PAGE; return show(); }
    const b = ev.target.closest?.("button[data-more]");
    if (!b) {
      // A click on a row, not on its id link or another control, opens or closes its extra row.
      if (ev.target.closest?.("a, button")) return;
      const row = ev.target.closest?.("tr.evr");
      if (row?.dataset?.key) toggle(row.dataset.key);
      return;
    }
    shown += Number(b.dataset.more); show();
  });
  async function cancelClick(btn) {
    const tr = btn.closest("tr"), msg = tr.querySelector(".cmsg");
    const rows = sortRows((d?.rows ?? []).filter((e) => on.has(e.kind)), sort).slice(0, shown);
    const e = rows[[...stream.querySelectorAll("tbody tr.evr")].indexOf(tr)];
    const closed = closedIssues(d?.rows ?? []);
    const target = e && cancelTarget(e, closed);
    if (!target) return;
    await confirmCancel(btn, msg, target, (j) => {
      // The row shows its new state, and keeps it when the page redraws.
      if (e.kind === "issue") { e.state = j.status ?? "dropped"; e.what = e.state === "done" ? "closed" : "dropped"; }
      else { e.state = "dropped"; e.what = "dropped"; e.end = new Date().toISOString(); }
      tr.outerHTML = renderEvent(e, now, closed, open.has(rowKey(e)));
      const done = [...stream.querySelectorAll("tbody tr.evr")][rows.indexOf(e)]?.querySelector(".cmsg");
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
