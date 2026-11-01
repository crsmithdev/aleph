// The Issues view: a browser for the issues of every repo: tiles, two charts, filters, fuzzy search, a sortable
// table and a form that files an issue. `data` is /api/contents: { issues, projects }.
// The issue detail (renderIssue) is shared with views/issue.js.
import { badge, chart, chips, crumb, empty, esc, filterBar, idLink, labelName, localId, md, money, pageHead, pager, sortHead, when } from "../lib.js";
import { LIFETIME_STYLE, renderLifetime } from "../timeline.js";

export const X_ICON = `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

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

export const view = {
  path: "/issues",
  title: "Issues",
  icon: "list-check",
  group: "work",
  order: 1,
  api: "/api/contents",
  render: (d, _params, query) => renderContents(d, hashOptions(query)),
  mount: (root, d) => mount(root, d),
};

/** The old addresses: `#/inventory` keeps its filters; `#/projects` and `#/contents` become `#/issues`. The detail routes are left alone. */
export function redirect(hash) {
  const [path, qs] = String(hash ?? "").replace(/^#/, "").split("?");
  const old = path.replace(/\/$/, "");
  if (old === "/inventory") return `#/issues${qs ? `?${qs}` : ""}`;
  return old === "/projects" || old === "/contents" ? "#/issues" : null;
}

// The tiles and cards follow board E of the Status redesign; the rest is what nothing shared covers: the whole-row link and the X button.
const STYLE_CONTENTS = `<style>
.contents { display: flex; flex-direction: column; gap: 16px; }
.contents > .ph, .contents .fbar { margin-bottom: 0; }
.contents .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; }
.contents .tile { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 16px; background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; color: var(--ink-2); }
.contents .tile .k { color: var(--muted); font: 600 var(--fs-xs) var(--sans); letter-spacing: .08em; text-transform: uppercase; }
.contents .tile b { font: 700 44px/1 var(--metric); color: var(--ink); font-variant-numeric: lining-nums tabular-nums; }
.contents .tile small { font-size: var(--fs-sm); }
.contents .tile .up { font-size: var(--fs-sm); font-weight: 600; color: var(--need); }
.contents .tile .down { font-size: var(--fs-sm); font-weight: 600; color: var(--done); }
.contents .graphs { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.contents .card { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 16px; background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; }
.contents .card h2 { margin: 0; font: 600 var(--fs-lg)/1.3 var(--sans); color: var(--ink); }
.contents .card p { margin: 0; font-size: var(--fs-sm); color: var(--muted); }
.contents .inv-chart { height: 180px; min-width: 0; }
.contents .inv-q { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
.contents .inv-q input[type="search"] { flex: 1 1 280px; box-sizing: border-box; min-height: 36px; padding: 0 12px; font: var(--fs-md) var(--sans); color: var(--ink); background: var(--sunk); border: 1px solid var(--rule); border-radius: 6px; }
.contents .inv-q input[type="search"]:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.contents .inv-q .hint { color: var(--muted); font-size: var(--fs-xs); }
#inv-filters { display: flex; flex-direction: column; gap: 10px; }
.contents .pfilter { display: flex; flex-wrap: wrap; gap: 6px; }
.contents .pfilter button { min-height: 28px; padding: 0 10px; font: var(--fs-sm) var(--sans); color: var(--ink-2); background: transparent; border: 1px solid var(--rule); border-radius: 999px; cursor: pointer; }
.contents .pfilter button:hover { border-color: var(--run); }
.contents .pfilter button:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.contents .pfilter button[aria-pressed="true"] { color: var(--ink); background: var(--run-bg); border-color: var(--run); font-weight: 600; }
.contents .pfilter .n { margin-left: 6px; color: var(--muted); font-variant-numeric: tabular-nums; }
.contents .sh { margin: 0; }
.contents mark { color: inherit; background: var(--need-bg); border-radius: 2px; }
.contents .tbl th button, .contents .tbl td.num, .contents .tbl td.time { white-space: nowrap; }
.contents tr.crow { position: relative; }
.contents td.wide a { color: inherit; text-decoration: none; }
.contents td.wide a::after { content: ""; position: absolute; inset: 0; }
.contents tr.crow:hover td.wide a, .contents td.wide a:focus-visible { text-decoration: underline; }
.contents td a.idl, .contents td.drop { position: relative; z-index: 1; }
.contents td.drop { width: 28px; padding: 0; text-align: right; }
.contents .cancel { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px; color: var(--muted); cursor: pointer; }
.contents .cancel svg { width: 14px; height: 14px; pointer-events: none; }
.contents .cancel:hover { color: var(--stuck); background: var(--rule-2); }
.contents .cancel:focus-visible { color: var(--stuck); outline: 2px solid currentColor; outline-offset: 1px; }
.contents .cancel.arm { color: var(--stuck); background: var(--rule-2); }
.contents .cancel[disabled] { opacity: .5; cursor: default; }
.contents .cmsg { position: absolute; right: 30px; top: 50%; transform: translateY(-50%); font: var(--fs-xs) var(--sans); color: var(--muted); background: var(--bg); white-space: nowrap; }
.contents .cmsg.err { color: var(--stuck); }
</style>`;

/** The Issues table shows this many rows, and this many more for each press of the pager's button. */
export const PAGE = 50;

/** The Status filter's default is Open; "any" (the Any option) shows every status. */
export const DEFAULT_STATUS = "open";
const statusOf = (s) => (s === null || s === undefined || s === "" ? DEFAULT_STATUS : s === "any" ? "" : s);

/** The filters and the sort, from the route's query: ?status=open&project=x&stage=x&priority=x&label=x&q=text&sort=title&dir=asc&limit=100. With a search and no sort, the best match comes first. */
export function hashOptions(q = new URLSearchParams()) {
  return {
    limit: Math.max(PAGE, Number.parseInt(q.get("limit"), 10) || PAGE),
    status: statusOf(q.get("status")), project: q.get("project") ?? "", stage: q.get("stage") ?? "", priority: q.get("priority") ?? "", label: q.get("label") ?? "", q: q.get("q") ?? "",
    sort: q.get("sort") ? { key: q.get("sort"), dir: q.get("dir") === "asc" ? 1 : -1 } : null,
  };
}

/** A row's own number: `910` for an issue, `910.1` for a part. */
const own = (r) => r.ref ?? r.id;
export const ref = (r) => `${r.repo}-${own(r)}`;
export const href = (r) => `#/issues/${encodeURIComponent(r.repo)}/${own(r)}`;
const stateBadge = (s) => badge(s);

const DAY = 86_400_000;
const ms = (s) => Date.parse(s) || 0;
/** A store date `YYYY-MM-DD` as local midnight in ms, as the CLI writes it; 0 for none. */
const dayMs = (s) => (/^\d{4}-\d\d-\d\d/.test(String(s ?? "")) ? Date.parse(`${String(s).slice(0, 10)}T00:00`) : 0);

/** The issue rows from the API data. */
export function issueRows(d) {
  return (d?.issues ?? []).map((r) => ({ status: r.status, id: ref(r), project: r.repo, title: r.title, labels: r.labels ?? [], priority: r.priority ?? "medium", notes: r.notes ?? 0, runs: r.runs ?? 0, cost: r.cost ?? 0, created: r.created ?? null, closed: r.closed ?? null, at: r.updated, href: href(r), repo: r.repo, n: own(r), stage: r.stage ?? r.status, why: r.why ?? "", part: String(own(r)).includes(".") }));
}

// ---- Fuzzy search ----

/** The edit distance of two strings; a number over `max` when their lengths alone must pass it. */
function edits(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let back = [], prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      // Two letters swapped count as one typo.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], back[j - 2] + 1);
    }
    back = prev; prev = cur;
  }
  return prev[b.length];
}

/** The tightest place where `t`'s letters appear in order in `s`, as their positions; null when there is none or it spreads over more than three times `t`'s length. */
function subsequence(t, s) {
  let best = null;
  for (let from = s.indexOf(t[0]); from >= 0; from = s.indexOf(t[0], from + 1)) {
    const at = [from];
    for (let i = 1, j = from; i < t.length && j >= 0; i++) { j = s.indexOf(t[i], j + 1); at.push(j); }
    if (at.at(-1) < 0) break;
    if (!best || at.at(-1) - at[0] < best.at(-1) - best[0]) best = at;
  }
  return best && best.at(-1) - best[0] < t.length * 3 ? best : null;
}

/**
 * How well one lower-case word of a query fits `s`: `{ score, hits }`, or null. An exact run of letters scores best, more so
 * at the start of a word; then letters in order; then a word of `s` within one typo (two from eight letters).
 */
export function fuzzyToken(t, s) {
  const i = s.indexOf(t);
  if (i >= 0) return { score: 100 + (i === 0 || /\W/.test(s[i - 1]) ? 30 : 0), hits: Array.from(t, (_, k) => i + k) };
  if (t.length < 2) return null;
  const sub = subsequence(t, s);
  if (sub) return { score: 60 - (sub.at(-1) - sub[0] - t.length + 1), hits: sub };
  if (t.length < 4) return null;
  const max = t.length >= 8 ? 2 : 1;
  for (const m of s.matchAll(/\w+/g)) {
    if (edits(t, m[0], max) <= max) return { score: 30, hits: Array.from(m[0], (_, k) => m.index + k) };
  }
  return null;
}

/** Each word of `q` must fit the title, id, project, labels, stage or priority. Answers `{ score, hits }`, with `hits` the positions in the title; null when a word fits nowhere. */
export function fuzzyMatch(q, r) {
  const title = r.title.toLowerCase(), rest = [r.id, r.project, ...r.labels, r.stage, r.priority].join(" ").toLowerCase();
  let score = 0;
  const hits = new Set();
  for (const t of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const a = fuzzyToken(t, title), b = fuzzyToken(t, rest);
    if (!a && !b) return null;
    score += Math.max(a ? a.score + 10 : 0, b?.score ?? 0);
    if (a) for (const h of a.hits) hits.add(h);
  }
  return { score, hits: [...hits] };
}

/** The title as HTML with the hit letters marked. */
export function markHits(title, hits = []) {
  if (!hits.length) return esc(title);
  const on = new Set(hits);
  let out = "", run = "";
  const flush = () => { if (run) out += `<mark>${esc(run)}</mark>`; run = ""; };
  for (let i = 0; i < title.length; i++) {
    if (on.has(i)) run += title[i];
    else { flush(); out += esc(title[i]); }
  }
  flush();
  return out;
}

/** The rows that pass every filter but the ones named in `skip`, each with its search `score` and `hits`. */
export function filterRows(rows, o = {}, skip = []) {
  const want = (k, v) => skip.includes(k) || !o[k] || v === o[k];
  const q = (o.q ?? "").trim();
  return rows.flatMap((r) => {
    if (!want("status", r.status) || !want("project", r.project) || !want("stage", r.stage) || !want("priority", r.priority)) return [];
    if (o.label && !skip.includes("label") && !r.labels.includes(o.label)) return [];
    if (!q) return [r];
    const m = fuzzyMatch(q, r);
    return m ? [{ ...r, score: m.score, hits: m.hits }] : [];
  });
}

// ---- The table ----

// Column order: id, title, state badge, project, labels, numbers, time last. [key, label, { num }]
export const COLUMNS = [["id", "Id"], ["title", "Title"], ["stage", "Stage"], ["project", "Project"], ["priority", "Priority"], ["labels", "Labels"], ["notes", "Notes", { num: true }], ["runs", "Runs", { num: true }], ["cost", "Cost", { num: true }], ["age", "Age", { num: true }], ["updated", "Updated"], ["act", ""]];
const RANK = { high: 3, medium: 2, low: 1 };
const SORT = {
  project: (r) => r.project, stage: (r) => r.stage, id: (r) => String(r.n), title: (r) => r.title, labels: (r) => r.labels.join(","), updated: (r) => dayMs(r.at),
  priority: (r) => RANK[r.priority] ?? 0, notes: (r) => r.notes, runs: (r) => r.runs, cost: (r) => r.cost, age: (r) => -dayMs(r.created),
};
/** The keys that start with the largest first. */
const DOWN_FIRST = new Set(["updated", "priority", "notes", "runs", "cost", "age"]);
const UPDATED = { key: "updated", dir: -1 };

/** The rows ordered by `sort` = { key, dir } (dir 1 up, -1 down). Ties keep newest first. */
export function sortRows(rows, sort = UPDATED) {
  const f = SORT[sort.key] ?? SORT.updated;
  return [...rows].sort((a, b) => {
    const x = f(a), y = f(b);
    const c = typeof x === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    return c * sort.dir || ms(b.at) - ms(a.at);
  });
}

/** With a search and no chosen sort, the best match first. */
const ordered = (rows, o) => (o.sort || !(o.q ?? "").trim() ? sortRows(rows, o.sort ?? UPDATED) : [...rows].sort((a, b) => b.score - a.score || ms(b.at) - ms(a.at)));

/** A store date as the table shows it: "Oct 20" this year, "2025-12-03" another; "" for none. */
export function dateText(s, now = new Date()) {
  const t = dayMs(s);
  if (!t) return "";
  const d = new Date(t);
  return d.getFullYear() === now.getFullYear() ? d.toLocaleDateString("en-US", { month: "short", day: "2-digit" }) : String(s).slice(0, 10);
}

/** The days since a store date, as "12 d"; a closed issue counts to its closing. "" for none. */
export function ageText(r, now = Date.now()) {
  const from = dayMs(r.created);
  if (!from) return "";
  return `${Math.max(0, Math.floor(((r.status === "open" ? now : dayMs(r.closed) || now) - from) / DAY))} d`;
}

/** The request an issue row's X sends, or null for a row that is not an open issue. */
export function dropTarget(r) {
  return r.status === "open" ? { url: `/api/issues/${encodeURIComponent(r.repo)}/${r.n}/drop`, body: { reason: "dropped from the Inventory page" } } : null;
}

/** One issue row, a part indented under its parent, and the X. */
export function renderRow(r) {
  const x = dropTarget(r)
    ? `<button type="button" class="cancel" data-cancel aria-label="Drop ${esc(r.id)}" title="Stop or drop">${X_ICON}</button>` : "";
  return `<tr class="crow${r.part ? " part-row" : ""}" data-repo="${esc(r.repo)}" data-n="${r.n}"><td>${idLink(r.n, r.href)}</td>` +
    `<td class="wide"><a href="${esc(r.href)}">${markHits(r.title, r.hits)}</a></td>` +
    `<td title="${esc(r.why ?? "")}">${badge(r.stage ?? r.status)}</td><td>${esc(r.project)}</td><td>${esc(r.priority)}</td><td>${chips(r.labels)}</td>` +
    `<td class="num">${r.notes}</td><td class="num">${r.runs}</td><td class="num">${r.cost ? esc(money(r.cost)) : ""}</td><td class="num">${esc(ageText(r))}</td>` +
    `<td class="time">${esc(dateText(r.at))}</td><td class="drop">${x}<span class="cmsg" role="status"></span></td></tr>`;
}

export function renderTable(rows, o = {}) {
  const all = ordered(filterRows(rows, o), o);
  if (!all.length) return empty("Nothing matches.", "Loosen the filters, or file an issue below.");
  const shown = all.slice(0, o.limit ?? PAGE);
  const sort = o.sort ?? ((o.q ?? "").trim() ? null : UPDATED);
  const head = COLUMNS.map(([k, label, c]) => (SORT[k] ? sortHead(label, k, sort, c) : `<th>${esc(label)}</th>`)).join("");
  return `<div class="tscroll"><table class="tbl"><thead><tr>${head}</tr></thead><tbody>${shown.map(renderRow).join("")}</tbody></table></div>${pager(shown.length, all.length, PAGE)}`;
}

// ---- The tiles and charts ----

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const inDays = (s, from, to) => { const t = dayMs(s); return t >= from && t < to; };

/** The numbers over `rows`: what the status and stage filters leave out still counts here, so the tiles do not empty when the table narrows. */
export function stats(rows, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), end = today + DAY;
  const week = today - 6 * DAY, before = week - 7 * DAY;
  const open = rows.filter((r) => r.status === "open");
  const ages = open.map((r) => dayMs(r.created)).filter(Boolean).map((t) => (today - t) / DAY);
  const closedIn = (from, to) => rows.filter((r) => r.status !== "open" && inDays(r.closed, from, to));
  const closed = closedIn(week, end);
  const stages = {};
  for (const r of open) stages[r.stage] = (stages[r.stage] ?? 0) + 1;
  return {
    total: rows.length, open: open.length, stages,
    filed: rows.filter((r) => inDays(r.created, week, end)).length, filedBefore: rows.filter((r) => inDays(r.created, before, week)).length,
    closed: closed.length, done: closed.filter((r) => r.status === "done").length, dropped: closed.filter((r) => r.status === "dropped").length, closedBefore: closedIn(before, week).length,
    medianAge: median(ages), oldest: ages.length ? Math.max(...ages) : null,
    runs: rows.filter((r) => !r.part).reduce((n, r) => n + r.runs, 0), cost: rows.filter((r) => !r.part).reduce((n, r) => n + r.cost, 0),
  };
}

const tile = (k, value, ...lines) => `<div class="tile"><span class="k">${esc(k)}</span><b>${esc(value)}</b>${lines.filter(Boolean).join("")}</div>`;
const small = (s) => `<small>${esc(s)}</small>`;
/** The change from the week before, with no good or bad colour on a count that can go either way. */
const change = (now, before) => (now === before ? small("same as the week before") : `<small>${now > before ? "▲" : "▼"} ${Math.abs(now - before)} from the week before</small>`);

export function renderTiles(s) {
  const stages = Object.entries(s.stages).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(", ");
  return `<section class="tiles" aria-label="Issue numbers">` +
    tile("Open", String(s.open), small(`of ${s.total} in the store`), stages && small(stages)) +
    tile("Filed, 7 days", String(s.filed), change(s.filed, s.filedBefore)) +
    tile("Closed, 7 days", String(s.closed), small(`${s.done} done, ${s.dropped} dropped`), change(s.closed, s.closedBefore)) +
    tile("Median open age", s.medianAge === null ? "–" : `${Math.round(s.medianAge)} d`, s.oldest === null ? "" : small(`oldest ${Math.round(s.oldest)} d`)) +
    tile("Runs", String(s.runs), small(`${money(s.cost)} recorded`)) + `</section>`;
}

/** The last `days` days: their labels and how many rows were filed and closed on each. */
export function flow(rows, days = 14, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out = { labels: [], filed: [], closed: [] };
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i), from = d.getTime(), to = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i + 1).getTime();
    out.labels.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
    out.filed.push(rows.filter((r) => inDays(r.created, from, to)).length);
    out.closed.push(rows.filter((r) => r.status !== "open" && inDays(r.closed, from, to)).length);
  }
  return out;
}

const AGES = [["Under 1 d", 1], ["1–3 d", 3], ["3–7 d", 7], ["1–2 wk", 14], ["2–4 wk", 28], ["Over 4 wk", Infinity]];
/** The open rows counted into age bins. */
export function ageBins(rows, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const counts = AGES.map(() => 0);
  for (const r of rows) {
    if (r.status !== "open" || !dayMs(r.created)) continue;
    const age = (today - dayMs(r.created)) / DAY;
    counts[AGES.findIndex(([, hi]) => age < hi)]++;
  }
  return { labels: AGES.map(([k]) => k), counts };
}

const barsBase = (labels) => ({
  animation: false,
  grid: { left: 28, right: 4, top: 8, bottom: 20 },
  xAxis: { type: "category", data: labels, axisTick: { show: false } },
  yAxis: { type: "value", minInterval: 1, splitLine: { show: true } },
  tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" } },
});
export const flowOption = (f) => ({ ...barsBase(f.labels), series: [{ name: "Filed", type: "bar", data: f.filed }, { name: "Closed", type: "bar", data: f.closed }] });
export const ageOption = (b) => ({ ...barsBase(b.labels), series: [{ name: "Open issues", type: "bar", barCategoryGap: "30%", data: b.counts }] });

const renderGraphs = () => `<section class="graphs" aria-label="Issue charts">` +
  `<div class="card"><h2>Filed and closed, 14 days</h2><p>Blue is filed; green is closed.</p><div class="inv-chart" data-chart="flow"></div></div>` +
  `<div class="card"><h2>Open issues by age</h2><p>Days since the issue was filed.</p><div class="inv-chart" data-chart="age"></div></div></section>`;

// ---- The filters ----

const PRIORITY_OPTIONS = [{ value: "", label: "Any" }, "high", "medium", "low"];

/** The project filter: a button per project with the count the other filters leave. */
export function renderProjects(projects, rows, o = {}) {
  const left = filterRows(rows, o, ["project"]);
  const button = (value, label, n) => `<button type="button" data-project="${esc(value)}" aria-pressed="${(o.project ?? "") === value}">${esc(label)}<span class="n">${n}</span></button>`;
  return `<div class="pfilter" role="group" aria-label="Project">${button("", "All", left.length)}${projects.map((p) => button(p, p, left.filter((r) => r.project === p).length)).join("")}</div>`;
}

export function renderFilters(rows, o = {}) {
  const stages = [...new Set(rows.map((r) => r.stage))].sort();
  const labels = [...new Set(rows.flatMap((r) => r.labels))].sort();
  return filterBar([
    { label: "Show", name: "status", value: o.status || "any", options: [{ value: "any", label: "Any" }, "open", "done", "dropped"] },
    { label: "Stage", name: "stage", value: o.stage ?? "", options: [{ value: "", label: "Any" }, ...stages] },
    { label: "Priority", name: "priority", value: o.priority ?? "", options: PRIORITY_OPTIONS },
    { label: "Label", name: "label", value: o.label ?? "", options: [{ value: "", label: "Any" }, ...labels.map((l) => ({ value: l, label: labelName(l) }))] },
  ]);
}

/** The parts that change with the filters. The search box stays out of them, so it keeps the focus while the reader types. */
function renderLive(projects, rows, o) {
  const shown = filterRows(rows, o).length;
  // The tiles and charts follow project, label, priority and search, not status or stage.
  return {
    filters: renderProjects(projects, rows, o) + renderFilters(rows, o),
    numbers: renderTiles(stats(filterRows(rows, o, ["status", "stage"]))),
    table: `<div class="sh"><h2>Issues</h2><span class="count">${shown}</span></div>${renderTable(rows, o)}`,
  };
}

const projectsOf = (d) => [...new Set([...(d?.projects ?? []), ...(d?.issues ?? []).map((r) => r.repo)])].sort();

export const BODY_TEMPLATE = "## Outcome\n\n\n\n## Oracle\n\n\n\n## Time box\n\n";

/** The Project select's options, one per registry key, `project` selected. */
export function projectOptions(keys, project) {
  return keys.map((k) => `<option value="${esc(k)}"${k === project ? " selected" : ""}>${esc(k)}</option>`).join("");
}

let drawn = [], live = null;

function draw(root) {
  for (const c of drawn) c.dispose();
  drawn = [];
  const rows = filterRows(live.rows, live.o(), ["status", "stage"]);
  const panel = (name, option) => { const el = root.querySelector(`.inv-chart[data-chart="${name}"]`); if (!el) return; try { drawn.push(chart(el, option)); } catch (e) { console.error("inventory chart failed", e); } };
  panel("flow", flowOption(flow(rows)));
  panel("age", ageOption(ageBins(rows)));
}

/** Fill what follows the filters. A filter changes no route, so nothing fetches again. */
function refill() {
  const root = live?.root;
  if (!root?.isConnected) return;
  const parts = renderLive(live.projects, live.rows, live.o());
  root.querySelector("#inv-filters").innerHTML = parts.filters;
  root.querySelector("#inv-numbers").innerHTML = parts.numbers;
  root.querySelector("#issues-table").innerHTML = parts.table;
  draw(root);
}

/** Draws the charts, keeps the data for the filters, and fills the form's Project select from the registry's keys. */
export async function mount(root, d) {
  live = { root, rows: issueRows(d), projects: projectsOf(d), o: () => hashOptions(new URLSearchParams(location.hash.split("?")[1] ?? "")) };
  if (root.querySelector?.(".inv-chart")) draw(root);
  const table = root.querySelector?.("#issues-table");
  if (table) table.addEventListener("click", (ev) => {
    const btn = ev.target.closest?.("button[data-cancel]");
    const tr = btn?.closest("tr");
    const r = tr && live.rows.find((x) => x.repo === tr.dataset.repo && String(x.n) === tr.dataset.n);
    const target = r && dropTarget(r);
    if (!target) return;
    confirmCancel(btn, tr.querySelector(".cmsg"), target, (j) => {
      r.status = j.status ?? "dropped";
      refill();
    });
  });
  const select = root.querySelector?.('select[name="repo"]');
  if (!select) return;
  try {
    const res = await fetch("/api/projects/keys");
    if (!res.ok) return;
    const keys = await res.json();
    const cur = select.value;
    select.innerHTML = projectOptions(keys, cur);
  } catch {}
}

export function renderForm(rows, o = {}) {
  const repos = [...new Set(rows.map((r) => r.repo))];
  return `<details class="new"><summary>File an issue</summary>` +
    `<form data-ui="issue-form" class="stack">` +
    `<label>Project <select name="repo" required>${projectOptions(o.keys ?? repos, o.project)}</select></label>` +
    `<label>Title <input name="title" required></label>` +
    `<label>Text <textarea name="body" rows="12">${esc(BODY_TEMPLATE)}</textarea></label>` +
    `<label>Labels <input name="labels" placeholder="comma separated"></label>` +
    `<label><input type="checkbox" name="spec"> The text is a spec: build it in the factory</label>` +
    `<label>After <input name="after" placeholder="repo-n, repo-n.k"></label>` +
    `<button type="submit" class="cmd primary">File issue</button> <span class="form-msg" role="status"></span></form></details>`;
}

export function renderContents(d, o = {}) {
  const rows = issueRows(d), parts = renderLive(projectsOf(d), rows, o);
  return `${STYLE_CONTENTS}<div class="page contents">${pageHead("Issues")}` +
    `<div id="inv-numbers">${parts.numbers}</div>${renderGraphs()}` +
    `<div class="inv-q"><input type="search" name="q" value="${esc(o.q ?? "")}" placeholder="Search titles, ids, projects, labels" aria-label="Search the issues" data-ui="inv-search"></div>` +
    `<div id="inv-filters" data-ui="contents-filter">${parts.filters}</div>` +
    `<div id="issues-table">${parts.table}</div>` +
    renderForm(d?.issues ?? [], o) + `</div>`;
}

/** The Job of a goal on the Issue page: a link to each of its jobs with the state, or a quiet line. */
function goalJobs(g, repo) {
  if (!g.jobs.length) return `<span class="quiet">No job yet</span>`;
  return g.jobs.map((j) => `${idLink(localId(j.name, repo), `#/jobs/${encodeURIComponent(j.name)}`)} <span class="time">${esc(when(j.started))}</span>`).join("<br>");
}

/** The body as the page shows it: the `## Request` heading goes, because the section has its own heading. */
export const description = (body) => String(body ?? "").replace(/^\s*## Request[ \t]*\r?\n+/, "");

/** Each `docs/specs/<file>.md` that this project has becomes a link to its Spec page. */
export const linkSpecs = (html, repo, files = []) => html.replace(/docs\/specs\/([\w.-]+\.md)/g, (m, f) => (files.includes(f) ? `<a href="#/specs/${encodeURIComponent(repo)}/${encodeURIComponent(f)}">${m}</a>` : m));

const PRIORITIES = ["high", "medium", "low"], SOURCES = ["chris", "worker", "deps", "memory", "agent"];
const choose = (name, all, cur) => `<select name="${name}" ${FORM} aria-label="${name}">${(all.includes(cur) || !cur ? all : [cur, ...all]).map((o) => `<option${o === cur ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;

/** One value and its editor in one place: edit mode shows the editor. The controls join the form in the head by `form=`. */
const editable = (shown, editor) => `<span class="view-only">${shown}</span><span class="edit-only">${editor}</span>`;
const FORM = 'form="issue-edit"';

/** The head of the Issue page: the title and the Edit button, or the title's input and Save and Cancel. */
const issueHead = (d, ref) => `<header class="ph"><h1 class="view-only">${esc(d.title)}</h1>` +
  `<input class="edit-only title-edit" name="title" ${FORM} required aria-label="Title" value="${esc(d.title)}">` +
  `<div class="aside"><button type="button" class="cmd view-only" data-edit="start">Edit</button>` +
  `<form id="issue-edit" data-ui="issue-edit" class="edit-only" data-repo="${esc(d.repo)}" data-ref="${esc(ref)}"><span class="form-msg" role="status"></span> <button type="button" class="cmd" data-edit="cancel">Cancel</button> <button type="submit" class="cmd primary">Save</button></form></div></header>`;

/** The form that appends a note. */
const renderNoteForm = (d, ref) => `<form data-ui="issue-note" class="stack" data-repo="${esc(d.repo)}" data-ref="${esc(ref)}">` +
  `<label>Add a note <textarea name="text" rows="3" required></textarea></label>` +
  `<button type="submit" class="cmd">Add note</button> <span class="form-msg" role="status"></span></form>`;

/** Machine note prefixes, matched after the `- ` and the stamp are removed. */
const MACHINE = /^(?:triage|acceptance|planner|standing|always|firefighter|its goals are all done):/;
/** The notes a person or a run needs to read, which stay visible. */
const READ = /^(?:triage: for Chris:|triage: a live check:|acceptance rerun by hand)/;
/** True when a note line is a machine line: the prefix at the start of the text after the `- ` and the stamp. */
export const isMachineNote = (n) => {
  const t = String(n).replace(/^- /, "").replace(/^\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)?: /, "");
  return MACHINE.test(t) && !READ.test(t);
};

/** The Issue page: the `## Request`, then the goals each with its Job, then the notes, the issue's own runs and the commits. Shared with views/issue.js. */
export function renderIssue(d) {
  const fm = d.frontmatter ?? {};
  const HIDE = ["labels", "id", "closed_as", "closed_why", "closed_at", "since", "ask", "reason", "question", "options", "recommended", "why", "plan", "tracker", "after", "created", "updated", "title"];
  const fact = (name, dd) => `<div><dt>${esc(name)}</dt><dd>${dd}</dd></div>`;
  const areas = d.labels ?? [], priority = d.priority ?? "medium", source = fm.source ?? "chris";
  const facts = fact("Priority", editable(esc(priority), choose("priority", PRIORITIES, priority))) + fact("Source", editable(esc(source), choose("source", SOURCES, source))) +
    fact("Areas", editable(esc(areas.map(labelName).join(", ") || "-"), `<input name="areas" ${FORM} aria-label="areas" placeholder="comma separated" value="${esc(areas.join(", "))}">`)) +
    Object.entries(fm).filter(([k]) => !HIDE.includes(k) && !["priority", "source", "areas"].includes(k)).map(([k, v]) => fact(k[0].toUpperCase() + k.slice(1), esc(Array.isArray(v) ? v.map(labelName).join(", ") : v))).join("");
  const tracker = fm.tracker === "true";
  const noteLi = (n) => `<li>${esc(n.replace(/^- /, ""))}</li>`;
  const folded = tracker ? [] : d.notes.filter(isMachineNote), shown = tracker ? d.notes : d.notes.filter((n) => !isMachineNote(n));
  const fold = folded.length ? `<details class="notes-fold"><summary>${folded.length} machine ${folded.length === 1 ? "note" : "notes"}</summary><ul class="notes">${folded.map(noteLi).join("")}</ul></details>` : "";
  const notes = d.notes.length ? (shown.length ? `<ul class="notes">${shown.map(noteLi).join("")}</ul>` : "") + fold : empty("No notes.");
  const goals = d.goals ?? [];
  const goalTable = goals.length
    ? `<div class="tscroll"><table class="tbl" id="goals"><thead><tr><th>Part</th><th>Title</th><th>Stage</th><th>Condition</th><th>Job</th></tr></thead><tbody>${goals.map((g) => `<tr><td>${idLink(localId(g.id, d.repo), g.href)}</td><td class="wide" title="${esc(localId(g.why, d.repo))}">${esc(g.title)}</td><td>${stateBadge(g.stage)}</td><td>${g.jobs.map((j) => stateBadge(j.condition)).join("<br>")}</td><td>${goalJobs(g, d.repo)}</td></tr>`).join("")}</tbody></table></div>`
    : "";
  const jobs = d.jobs.length
    ? `<div class="tscroll"><table class="tbl"><thead><tr><th>Job</th><th>Condition</th><th>Started</th></tr></thead><tbody>${d.jobs.map((j) => `<tr><td>${idLink(localId(j.name, d.repo), `#/jobs/${encodeURIComponent(j.name)}`)}</td><td>${stateBadge(j.condition)}</td><td class="time">${esc(when(j.started))}</td></tr>`).join("")}</tbody></table></div>`
    : empty("No job has worked on this.");
  const commits = d.commits.length
    ? `<div class="tscroll"><table class="tbl"><thead><tr><th>Commit</th><th>Subject</th><th>Date</th></tr></thead><tbody>${d.commits.map((c) => {
      const sha = c.hash.slice(0, 7);
      return `<tr><td>${c.commitUrl ? idLink(sha, c.commitUrl) : `<code>${esc(sha)}</code>`}</td><td class="wide" title="${esc(c.subject)}">${esc(c.subject)}</td><td class="time">${esc(when(c.date))}</td></tr>`;
    }).join("")}</tbody></table></div>`
    : empty("No commit on main names this issue in its trailers.");
  const ref = String(d.ref ?? d.id), inventory = "#/issues", project = [d.repo, `#/issues?project=${encodeURIComponent(d.repo)}`];
  const place = d.issue ? [project, ["issues", inventory], [localId(d.issue.id, d.repo), d.issue.href], [ref]] : [project, ["issues", inventory], [ref]];
  const part = (id, title, name, text) => (text || !goals.length ? `<div class="sh${text ? "" : " edit-only"}"><h2 id="h-${id}">${title}</h2></div><div class="md view-only" id="${id}">${linkSpecs(md(text ?? ""), d.repo, d.specs)}</div><textarea class="edit-only body-edit" name="${name}" ${FORM} rows="12" aria-label="${title}">${esc(text ?? "")}</textarea>` : "");
  const life = renderLifetime(d);
  return `${LIFETIME_STYLE}<div class="page issue-page">${crumb(inventory, place)}` + issueHead(d, ref) +
    `<div class="status-row">${d.derived ? stateBadge(d.derived.stage) : badge(d.status)}${chips(fm.labels)}</div>` +
    `<dl class="facts">${facts}</dl>` +
    part("request", "Description", "request", d.request) + part("spec", "Spec", "spec", d.spec) +
    (goals.length ? `<div class="sh"><h2 id="h-goals">Parts</h2><span class="count">${goals.length}</span></div>${goalTable}` : "") +
    `<div class="sh"><h2>Notes</h2></div>${notes}${renderNoteForm(d, ref)}${life ? `<div class="sh"><h2>Lifetime</h2></div>${life}` : ""}<div class="sh"><h2>Runs</h2></div>${jobs}<div class="sh"><h2>Commits</h2></div>${commits}</div>`;
}

// Interaction: the shell renders with innerHTML and has no hooks, so the view
// listens on the document. Filters live in the route's query, the form posts.
if (typeof document !== "undefined") {
  /** Change the query in place: replaceState fires no hashchange, so the shell does not fetch and render again. */
  const setQuery = (changes) => {
    const [path, qs = ""] = location.hash.replace(/^#/, "").split("?");
    const q = new URLSearchParams(qs);
    for (const [name, value] of Object.entries(changes)) { if (value) q.set(name, value); else q.delete(name); }
    history.replaceState(null, "", `#${path}${q.toString() ? `?${q}` : ""}`);
    refill();
  };
  const here = () => hashOptions(new URLSearchParams(location.hash.split("?")[1] ?? ""));
  document.addEventListener("click", (e) => {
    const t = e.target.closest ? e.target : null;
    const sort = t?.closest("#issues-table button[data-sort]");
    if (sort) {
      const key = sort.dataset.sort, cur = here().sort;
      const dir = cur?.key === key ? -cur.dir : DOWN_FIRST.has(key) ? -1 : 1;
      return setQuery({ sort: key, dir: dir > 0 ? "asc" : "desc" });
    }
    const project = t?.closest("#inv-filters button[data-project]");
    if (project) return setQuery({ project: project.dataset.project, limit: "" });
    const seg = t?.closest("#inv-filters .seg button");
    if (seg) return setQuery({ [seg.closest(".seg").dataset.name]: seg.dataset.value, limit: "" });
    const more = t?.closest("#issues-table button[data-more]");
    if (more) setQuery({ limit: String(here().limit + Number(more.dataset.more)) });
  });
  document.addEventListener("change", (e) => {
    const f = e.target.closest?.("#inv-filters select[name]");
    if (f) setQuery({ [f.name]: f.value, limit: "" });
  });
  let typing = 0;
  document.addEventListener("input", (e) => {
    if (!e.target.matches?.('[data-ui="inv-search"]')) return;
    clearTimeout(typing);
    typing = setTimeout(() => setQuery({ q: e.target.value, limit: "" }), 120);
  });
  // Edit mode: the page shows the editors in place of the values; Cancel puts the saved values back.
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-edit]");
    if (!b) return;
    const page = b.closest(".issue-page"), start = b.dataset.edit === "start";
    if (!start) page.querySelector("#issue-edit").reset();
    page.classList.toggle("editing", start);
    if (start) page.querySelector(".title-edit").focus();
  });
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest && e.target.closest('form[data-ui="issue-edit"], form[data-ui="issue-note"]');
    if (!form) return;
    e.preventDefault();
    const edit = form.dataset.ui === "issue-edit", el = form.elements;
    const body = edit
      ? { title: el.title.value, priority: el.priority.value, source: el.source.value, areas: el.areas.value, description: el.request?.value ?? "", spec: el.spec?.value ?? "" }
      : { text: el.text.value };
    const msg = form.querySelector(".form-msg");
    try {
      const res = await fetch(`/api/issues/${encodeURIComponent(form.dataset.repo)}/${encodeURIComponent(form.dataset.ref)}/${edit ? "edit" : "note"}`, {
        method: "POST", headers: { "content-type": "application/json", "x-aleph-ui": "1" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `answered ${res.status}`);
      location.reload();
    } catch (err) { msg.textContent = `Could not save it: ${err.message}`; }
  });
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest && e.target.closest('form[data-ui="issue-form"]');
    if (!form) return;
    e.preventDefault();
    const v = (n) => form.elements[n].value.trim();
    const labels = v("labels").split(",").map((s) => s.trim()).filter(Boolean);
    if (form.elements.spec.checked && !labels.includes("spec")) labels.push("spec");
    const msg = form.querySelector(".form-msg");
    try {
      const res = await fetch("/api/issues", {
        method: "POST", headers: { "content-type": "application/json", "x-aleph-ui": "1" },
        body: JSON.stringify({ repo: v("repo"), title: v("title"), body: form.elements.body.value, labels, after: v("after") }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `answered ${res.status}`);
      location.hash = `/issues/${encodeURIComponent(v("repo"))}/${data.added}`;
    } catch (err) { msg.textContent = `Could not file it: ${err.message}`; }
  });
}
