// The Issues view: a browser for the issues of every repo: tiles, three charts, filters, fuzzy search, a sortable
// table and a form that files an issue. `data` is /api/contents: { issues, projects }.
// The issue detail (renderIssue) is shared with views/issue.js.
import { xLabel } from "./speed.js";
import { barList, barRow, blockersHtml, rangeBarOption, stackedAreaOption, timeSeriesOption, badge, tag, priorityBadge, card, sectionHead, chart, chip, chips, crumb, dataTable, day, empty, hourLabel, esc, filterBar, idLink, labelName, localId, md, money, onTile, pageHead, pager, searchBox, setQuery as setHash, cardTrend, sortHead, statCard, projectOf, storeProject, storeWindow, tiles, when, WINDOW_DAYS, WINDOWS, windowOf } from "../lib.js";
import { askRow } from "./now.js";
import { barsOf, costText, fold, fromTo, gaps, lifespan, localMs, noteEvent, renderKpis, renderTimeline, spans, timeText, waitEvent } from "../timeline.js";

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
  group: "factory",
  order: -1,
  api: "/api/contents",
  render: (d, _params, query) => renderIssues(d, hashOptions(query)),
  mount: (root, d) => mount(root, d),
};

/** The old addresses: `#/inventory` keeps its filters; `#/projects` and `#/contents` become `#/issues`. The detail routes are left alone. */
export function redirect(hash) {
  const [path, qs] = String(hash ?? "").replace(/^#/, "").split("?");
  const old = path.replace(/\/$/, "");
  if (old === "/inventory") return `#/issues${qs ? `?${qs}` : ""}`;
  return old === "/projects" || old === "/contents" ? "#/issues" : null;
}

/** The Issues table shows this many rows, and this many more for each press of the pager's button. */
export const PAGE = 50;

/** The Status filter's default is Open; "any" (the All option) shows every status. */
/** The statuses that close an issue; a parked one is neither open nor closed. */
const CLOSED = ["done", "dropped"];
export const DEFAULT_STATUS = "open";
const statusOf = (s) => (s === null || s === undefined || s === "" ? DEFAULT_STATUS : s === "any" ? "" : s);

/** The filters and the sort, from the route's query: ?status=open&project=x&stage=x&priority=x&label=x&q=text&sort=title&dir=asc&limit=100. With a search and no sort, the best match comes first. */
export function hashOptions(q = new URLSearchParams()) {
  return {
    limit: Math.max(PAGE, Number.parseInt(q.get("limit"), 10) || PAGE),
    status: statusOf(q.get("status")), project: projectOf(q), stage: q.get("stage") ?? "", priority: q.get("priority") ?? "", label: q.get("label") ?? "", q: q.get("q") ?? "", tile: q.get("tile") || "open", window: windowOf(q),
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
  return (d?.issues ?? []).map((r) => ({ status: r.status, id: ref(r), project: r.repo, title: r.title, kind: r.kind ?? "task", labels: r.labels ?? [], priority: r.priority ?? "medium", notes: r.notes ?? 0, runs: r.runs ?? 0, cost: r.cost ?? 0, created: r.created ?? null, createdTime: r.createdTime ?? null, closed: r.closed ?? null, closedTime: r.closedTime ?? null, at: r.updated, href: href(r), repo: r.repo, n: own(r), stage: r.stage ?? r.status, why: r.why ?? "", part: String(own(r)).includes(".") }));
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
  const q = (o.q ?? "").trim(), now = new Date(), end = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() + DAY, from = end - Math.max(1, Math.ceil(WINDOW_DAYS[o.window] ?? 7)) * DAY;
  const at = inSpan(now.getTime(), WINDOW_DAYS[o.window] ?? 7);
  const inTile = (r) => skip.includes("tile") || (o.tile === "filed" ? at(r.created, r.createdTime, 0, from, end) : o.tile === "closed" ? CLOSED.includes(r.status) && at(r.closed, r.closedTime, 0, from, end) : true);
  return rows.flatMap((r) => {
    if (!inTile(r)) return [];
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
const RANK = { critical: 4, high: 3, medium: 2, low: 1 };
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
  return day(new Date(t), now);
}

/** The days since a store date, as "12d"; a closed issue counts to its closing. "" for none. */
export function ageText(r, now = Date.now()) {
  const from = dayMs(r.created);
  if (!from) return "";
  return `${Math.max(0, Math.floor(((r.status === "open" ? now : dayMs(r.closed) || now) - from) / DAY))}d`;
}

/** The request an issue row's X sends, or null for a row that is not an open issue. */
export function dropTarget(r) {
  return r.status === "open" ? { url: `/api/issues/${encodeURIComponent(r.repo)}/${r.n}/drop`, body: { reason: "from the Inventory page" } } : null;
}

/** One issue row, a part indented under its parent, and the X. */
export function renderRow(r) {
  const x = dropTarget(r)
    ? `<button type="button" class="cancel" data-cancel aria-label="Drop ${esc(r.id)}" title="Stop or drop">${X_ICON}</button>` : "";
  return `<tr class="rowlink${r.part ? " part-row" : ""}" data-repo="${esc(r.repo)}" data-n="${r.n}"><td>${idLink(r.n, r.href)}</td>` +
    `<td class="wide"><a href="${esc(r.href)}">${markHits(r.title, r.hits)}</a></td>` +
    `<td title="${esc(r.why ?? "")}">${badge(r.stage ?? r.status)}</td><td>${esc(r.project)}</td><td>${priorityBadge(r.priority)}</td><td>${chip(r.kind ?? "task", { cls: "kind" })}${chips(r.labels)}</td>` +
    `<td class="num">${r.notes}</td><td class="num">${r.runs}</td><td class="num">${r.cost ? esc(money(r.cost)) : ""}</td><td class="num">${esc(ageText(r))}</td>` +
    `<td class="time">${esc(dateText(r.at))}</td><td class="drop">${x}<span class="cmsg" role="status"></span></td></tr>`;
}

export function renderTable(rows, o = {}) {
  const all = ordered(filterRows(rows, o), o);
  if (!all.length) return empty("Nothing matches.", "Loosen the filters, or file an issue below.");
  const shown = all.slice(0, o.limit ?? PAGE);
  const sort = o.sort ?? ((o.q ?? "").trim() ? null : UPDATED);
  const head = COLUMNS.map(([k, label, c]) => (SORT[k] ? sortHead(label, k, sort, c) : `<th>${esc(label)}</th>`)).join("");
  return `${dataTable(head, shown.map(renderRow).join(""))}${pager(shown.length, all.length, PAGE)}`;
}

// ---- The tiles and charts ----

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const inDays = (s, from, to) => { const t = dayMs(s); return t >= from && t < to; };
/** For the hour window a row with a stored minute counts by that minute: `k` hours-windows back from `now`. Else by its day. */
const inSpan = (now, days) => (day, time, k, from, to) => {
  const t = days < 1 && time ? Date.parse(String(time).replace(" ", "T")) : NaN, span = Math.round(days * DAY);
  return t === t ? t > now - (k + 1) * span && t <= now - k * span : inDays(day, from, to);
};

/** The numbers over `rows`: what the status and stage filters leave out still counts here, so the tiles do not empty when the table narrows. */
export function stats(rows, now = new Date(), days = 7) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), end = today + DAY;
  // The store keeps whole dates, so the window is whole days back from tonight, at least today.
  const span = Math.max(1, Math.ceil(days)) * DAY, week = end - span, before = week - span, at = inSpan(now.getTime(), days);
  const open = rows.filter((r) => r.status === "open");
  const ages = open.map((r) => dayMs(r.created)).filter(Boolean).map((t) => (today - t) / DAY);
  const closedIn = (k, from, to) => rows.filter((r) => CLOSED.includes(r.status) && at(r.closed, r.closedTime, k, from, to));
  const closed = closedIn(0, week, end);
  const stages = {};
  for (const r of open) stages[r.stage] = (stages[r.stage] ?? 0) + 1;
  return {
    total: rows.length, open: open.length, stages,
    filed: rows.filter((r) => at(r.created, r.createdTime, 0, week, end)).length, filedBefore: rows.filter((r) => at(r.created, r.createdTime, 1, before, week)).length,
    closed: closed.length, done: closed.filter((r) => r.status === "done").length, dropped: closed.filter((r) => r.status === "dropped").length, closedBefore: closedIn(1, before, week).length,
    medianAge: median(ages), oldest: ages.length ? Math.max(...ages) : null,
    runs: rows.filter((r) => !r.part).reduce((n, r) => n + r.runs, 0), cost: rows.filter((r) => !r.part).reduce((n, r) => n + r.cost, 0),
  };
}

/** The change from the period before: more closed is good, more filed is warn. */
const change = (now, before, w, lowerIsGood) => cardTrend(now, before, before, { kind: "relative", lowerIsGood, tip: `${before} the ${w} before` });

export function renderTiles(s, key = "open", win = "week") {
  const w = win in WINDOW_DAYS ? win : "week";
  const on = (k) => ({ key: k, on: key === k });
  return tiles("Issue numbers",
    statCard({ k: "Open", v: String(s.open), v2: String(s.total), q: ["open", "in store"], ...on("open") }) +
    statCard({ k: "Filed", v: String(s.filed), trend: change(s.filed, s.filedBefore, w, true), note: `${s.filedBefore} the ${w} before`, ...on("filed") }) +
    statCard({ k: "Closed", v: String(s.closed), v2: String(s.dropped), q: ["closed", "dropped"], trend: change(s.closed, s.closedBefore, w, false), ...on("closed") }) +
    statCard({ k: "Open Age", v: s.medianAge === null ? "–" : `${Math.round(s.medianAge)}d`, ...(s.oldest === null ? {} : { v2: `${Math.round(s.oldest)}d`, q: ["open age", "oldest"] }), ...on("age") }) +
    statCard({ k: "Runs", v: String(s.runs), v2: money(s.cost), q: ["runs", "recorded cost"], ...on("runs") }));
}

/** The window's buckets (60 minutes, 24 hours, 7 or 30 days): their labels and how many rows were filed and closed in each. A stored time counts to its minute; a row with only a day counts at the start of that day. */
export function flow(rows, window = "month", now = new Date()) {
  const unit = { hour: 60000, day: 3600000 }[window], n = { hour: 60, day: 24, week: 7 }[window] ?? 30;
  const edge = (i) => unit ? Math.floor(now.getTime() / unit) * unit - i * unit : new Date(now.getFullYear(), now.getMonth(), now.getDate() - i).getTime();
  const at = (d, t) => { const m = unit && t ? Date.parse(String(t).replace(" ", "T")) : NaN; return m === m ? m : dayMs(d); };
  const out = { labels: [], filed: [], closed: [] };
  for (let i = n - 1; i >= 0; i--) {
    const from = edge(i), to = unit ? from + unit : new Date(now.getFullYear(), now.getMonth(), now.getDate() - i + 1).getTime();
    out.labels.push(xLabel(from, window));
    out.filed.push(rows.filter((r) => { const t = at(r.created, r.createdTime); return t >= from && t < to; }).length);
    out.closed.push(rows.filter((r) => { const t = at(r.closed, r.closedTime); return CLOSED.includes(r.status) && t >= from && t < to; }).length);
  }
  return out;
}

const PRIORITY_ORDER = ["low", "medium", "high", "critical"];
/** The window's buckets: how many rows were open in each, per priority. Hour is 60 minutes and day is 24 hours, sampled at each bucket's end; week and month are days. A row is open from its created time to its closed time, or by day when it has no time. */
export function backlog(rows, win = "month", now = new Date()) {
  const labels = [], counts = Object.fromEntries(PRIORITY_ORDER.map((p) => [p, []]));
  const fine = { hour: [60, 60_000], day: [24, 3_600_000] }[win];
  const stamp = (time, d, late) => { const t = Date.parse(String(time ?? "").replace(" ", "T")); return t === t ? t : dayMs(d) ? dayMs(d) + (late ? DAY : 0) : 0; };
  const [n, step] = fine ?? [WINDOW_DAYS[win], DAY];
  for (let i = n - 1; i >= 0; i--) {
    const d = fine ? new Date(now.getTime() - i * step) : new Date(now.getFullYear(), now.getMonth(), now.getDate() - i), t = d.getTime();
    labels.push(fine ? hourLabel(d) : day(d, now));
    for (const p of PRIORITY_ORDER) counts[p].push(rows.filter((r) => {
      if (r.priority !== p) return false;
      if (!fine) return dayMs(r.created) && dayMs(r.created) <= t && (!dayMs(r.closed) || t <= dayMs(r.closed));
      const from = stamp(r.createdTime, r.created, false), to = stamp(r.closedTime, r.closed, true);
      return from && from <= t && (!to || t < to);
    }).length);
  }
  return { labels, counts };
}

const KINDS = ["task", "bug", "check", "proposal", "flake"];
/** The p-th share (0 to 1) of `xs`, by linear interpolation; null for none. */
const quantile = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), at = (s.length - 1) * p, lo = Math.floor(at);
  return s[lo] + (s[Math.ceil(at)] - s[lo]) * (at - lo);
};
/** For each kind, the p50 and p90 from created to closed over the rows closed inside the window; null for a kind with none. A row counts from its times, or from its dates where it has none. `unit` is "hours" when a row has a time and every value is under 2 days; else "days". */
export function closeTimes(rows, win = "month", now = new Date()) {
  const out = { kinds: KINDS, unit: "days", p50: [], p90: [] };
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() + DAY, from = end - Math.max(1, Math.ceil(WINDOW_DAYS[win])) * DAY, at = inSpan(now.getTime(), WINDOW_DAYS[win]);
  const stamp = (time, d) => { const t = Date.parse(String(time ?? "").replace(" ", "T")); return t === t ? t : dayMs(d); };
  let timed = false;
  const spans = KINDS.map((k) => rows.filter((r) => r.kind === k && CLOSED.includes(r.status) && dayMs(r.created) && dayMs(r.closed) && at(r.closed, r.closedTime, 0, from, end)).map((r) => {
    timed ||= !!(r.createdTime || r.closedTime);
    return stamp(r.closedTime, r.closed) - stamp(r.createdTime, r.created);
  }));
  const hours = timed && spans.flat().every((ms) => ms < 2 * DAY);
  if (hours) out.unit = "hours";
  for (const xs of spans) {
    const per = xs.map((ms) => ms / (hours ? 3600000 : DAY));
    out.p50.push(quantile(per, 0.5));
    out.p90.push(quantile(per, 0.9));
  }
  return out;
}

export const backlogOption = (b, f) => stackedAreaOption(b.labels, PRIORITY_ORDER.map((p) => ({ name: p, data: b.counts[p] })), [{ name: "Filed", data: f.filed }, { name: "Closed", data: f.closed }]);
/** The suite records of `tests` ({ project: records }) of `project` (all when empty) within the window: the test count of each record as a line per project, and the tests that passed only on rerun as bars. */
export function testsOption(tests, project = "", win = "month", now = new Date()) {
  const from = now.getTime() - WINDOW_DAYS[win in WINDOW_DAYS ? win : "week"] * 86400000, lines = [], bars = [];
  for (const [key, records] of Object.entries(tests ?? {})) {
    if (project && key !== project) continue;
    const kept = records.map((r) => ({ t: Date.parse(r.at), r })).filter(({ t }) => t >= from && t <= now.getTime());
    lines.push({ name: `${key} tests`, data: kept.map(({ t, r }) => [t, r.ran]) });
    bars.push({ name: `${key} passed on rerun`, data: kept.map(({ t, r }) => [t, r.rerunPassed]) });
  }
  return timeSeriesOption(lines, bars);
}
export const closeOption = (c) => rangeBarOption(c.kinds, c.p50, c.p90, c.unit === "hours" ? "h" : "d");

/** What the filters set when a tile is selected, so the table shows the issues behind the number. */
export const TILE_FILTER = {
  open: { tile: "", status: "", sort: "", dir: "", limit: "" },
  filed: { tile: "filed", status: "any", sort: "", dir: "", limit: "" },
  closed: { tile: "closed", status: "any", sort: "", dir: "", limit: "" },
  age: { tile: "age", status: "", sort: "age", dir: "desc", limit: "" },
  runs: { tile: "runs", status: "any", sort: "runs", dir: "desc", limit: "" },
};

const TOP_RUNS = 10;
/** The card under the charts for the Runs tile; none for the other tiles. */
function renderDetail(rows, o) {
  if (o.tile === "runs") {
    const top = [...rows].filter((r) => !r.part && r.runs > 0).sort((a, b) => b.runs - a.runs).slice(0, TOP_RUNS), max = top[0]?.runs ?? 1;
    return card("Issues by Runs", top.length ? barList(top.map((r) => barRow(`<a href="${esc(r.href)}">${esc(r.title)}</a>`, (r.runs / max) * 100, `${r.runs} · ${esc(money(r.cost))}`)).join("")) : empty("No issue has a run."), { label: "Issues by runs" });
  }
  return "";
}

/** The two charts under the tiles, on every tile. */
const renderCharts = (o) => `<div class="trio">${card(`Open Backlog, Filed and Closed, Last ${o.window in WINDOW_DAYS ? o.window[0].toUpperCase() + o.window.slice(1) : "Week"}`, '<p>Open issues over time, by priority (left axis); filed and closed per bucket (right axis).</p><div class="chartbox" data-chart="backlog"></div>', { cls: "wide", label: `Open backlog, filed and closed, last ${o.window in WINDOW_DAYS ? o.window : "week"}` })}` +
  `${card("Time to Close", '<p data-close-note>Days from filed to closed: the bar is p50, the tick p90.</p><div class="chartbox" data-chart="close"></div>', { label: "Time to close" })}` +
  `${card("Tests", '<p>Tests per suite run (left axis); tests that passed only on rerun (right axis).</p><div class="chartbox" data-chart="tests"></div>', { cls: "wide" })}</div>`;

// ---- The filters ----

const PRIORITY_OPTIONS = [{ value: "", label: "All" }, "critical", "high", "medium", "low"];

/** The project filter scopes the tiles too: a select in the page head, each option with the count the other filters leave. */
export function renderProjects(projects, rows, o = {}) {
  const left = filterRows(rows, o, ["project"]);
  return filterBar([{ label: "Project", name: "project", data: true, value: o.project ?? "", options: [{ value: "", label: `All (${left.length})` }, ...projects.map((p) => ({ value: p, label: `${p} (${left.filter((r) => r.project === p).length})` }))] }, { name: "window", value: o.window ?? "week", options: WINDOWS }]);
}

export function renderFilters(rows, o = {}) {
  const stages = [...new Set(rows.map((r) => r.stage))].sort();
  const labels = [...new Set(rows.flatMap((r) => r.labels))].sort();
  return filterBar([
    { label: "Status", name: "status", value: o.status || "any", options: [{ value: "any", label: "All" }, "open", "parked", "done", "dropped"] },
    { label: "Stage", name: "stage", data: true, value: o.stage ?? "", options: [{ value: "", label: "All" }, ...stages] },
    { label: "Priority", name: "priority", value: o.priority ?? "", options: PRIORITY_OPTIONS },
    { label: "Label", name: "label", data: true, value: o.label ?? "", options: [{ value: "", label: "All" }, ...labels.map((l) => ({ value: l, label: labelName(l) }))] },
  ]);
}

/** The parts that change with the filters. The search box stays out of them, so it keeps the focus while the reader types. */
function renderLive(projects, rows, o) {
  const shown = filterRows(rows, o).length;
  // The tiles and charts follow project, label, priority and search, not status, stage or the selected tile.
  const scoped = filterRows(rows, o, ["status", "stage", "tile"]);
  return {
    scope: renderProjects(projects, rows, o),
    filters: renderFilters(rows, o),
    numbers: renderTiles(stats(scoped, new Date(), WINDOW_DAYS[o.window] ?? 7), o.tile, o.window),
    detail: renderCharts(o) + renderDetail(scoped, o),
    count: sectionHead("Issues", { count: shown }),
    table: renderTable(rows, o),
  };
}

const projectsOf = (d) => [...new Set([...(d?.projects ?? []), ...(d?.issues ?? []).map((r) => r.repo)])].sort();

export const BODY_TEMPLATE = "## Outcome\n\n\n\n## Oracle\n\n\n\n## Time box\n\n";

/** The Project select's options, one per registry key, `project` selected. */
export function projectOptions(keys, project) {
  return keys.map((k) => `<option value="${esc(k)}"${k === project ? " selected" : ""}>${esc(k)}</option>`).join("");
}

let drawn = [], live = null;
/** Change the query in place: replaceState fires no hashchange, so the shell does not fetch and render again. */
const setQuery = (changes) => { setHash(changes); refill(); };

function draw(root) {
  for (const c of drawn) c.dispose();
  drawn = [];
  const rows = filterRows(live.rows, live.o(), ["status", "stage", "tile"]);
  const panel = (name, option) => { const el = root.querySelector(`.chartbox[data-chart="${name}"]`); if (!el) return; try { drawn.push(chart(el, option)); } catch (e) { console.error("inventory chart failed", e); } };
  const win = live.o().window, now = new Date();
  panel("backlog", backlogOption(backlog(rows, win, now), flow(rows, win, now)));
  const close = closeTimes(rows, win, now), note = root.querySelector("[data-close-note]");
  if (note) note.textContent = `${close.unit === "hours" ? "Hours" : "Days"} from filed to closed: the bar is p50, the tick p90.`;
  panel("close", closeOption(close));
  panel("tests", testsOption(live.tests, live.o().project, win, now));
}

/** Fill what follows the filters. A filter changes no route, so nothing fetches again. */
function refill() {
  const root = live?.root;
  if (!root?.isConnected) return;
  const parts = renderLive(live.projects, live.rows, live.o());
  for (const [id, html] of [["inv-scope", parts.scope], ["inv-filters", parts.filters], ["inv-numbers", parts.numbers], ["inv-detail", parts.detail], ["inv-count", parts.count], ["issues-table", parts.table]]) root.querySelector(`#${id}`).innerHTML = html;
  draw(root);
}

/** Draws the charts, keeps the data for the filters, and fills the form's Project select from the registry's keys. */
export async function mount(root, d) {
  live = { root, tests: d?.tests, rows: issueRows(d), projects: projectsOf(d), o: () => hashOptions(new URLSearchParams(location.hash.split("?")[1] ?? "")) };
  if (root.querySelector?.(".chartbox")) draw(root);
  onTile(root.querySelector?.("#inv-numbers"), (k) => {
    setQuery(TILE_FILTER[k]);
    root.querySelector(`button[data-tile="${k}"]`)?.focus();
  });
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
    `<button type="submit" class="act primary">File issue</button> <span class="form-msg" role="status"></span></form></details>`;
}

export function renderIssues(d, o = {}) {
  const rows = issueRows(d), parts = renderLive(projectsOf(d), rows, o);
  return `<div class="page sp contents">${pageHead("Issues", { aside: `<div id="inv-scope">${parts.scope}</div>` })}` +
    `<div id="inv-numbers">${parts.numbers}</div><div id="inv-detail">${parts.detail}</div>` +
    renderForm(d?.issues ?? [], o) +
    `<section class="card" aria-label="Issues"><div id="inv-count">${parts.count}</div>${searchBox("inv-search", o.q, "Search titles, ids, projects, labels")}` +
    `<div id="inv-filters" data-ui="contents-filter">${parts.filters}</div>` +
    `<div id="issues-table">${parts.table}</div></section></div>`;
}

/** The body as the page shows it: the `## Request` heading goes, because the section has its own heading. */
export const description = (body) => String(body ?? "").replace(/^\s*## Request[ \t]*\r?\n+/, "");

/** Each `docs/specs/<file>.md` that this project has becomes a link to its Spec page. */
export const linkSpecs = (html, repo, files = []) => html.replace(/docs\/specs\/([\w.-]+\.md)/g, (m, f) => (files.includes(f) ? `<a href="#/specs/${encodeURIComponent(repo)}/${encodeURIComponent(f)}">${m}</a>` : m));

const PRIORITIES = ["critical", "high", "medium", "low"], SOURCES = ["chris", "worker", "deps", "memory", "agent"];
const choose = (name, all, cur) => `<select name="${name}" ${FORM} aria-label="${name}">${(all.includes(cur) || !cur ? all : [cur, ...all]).map((o) => `<option${o === cur ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;

/** One value and its editor in one place: edit mode shows the editor. The controls join the form in the head by `form=`. */
const editable = (shown, editor) => `<span class="view-only">${shown}</span><span class="edit-only">${editor}</span>`;
const FORM = 'form="issue-edit"';

/** The head of the Issue page: the title and the Edit button, or the title's input and Save and Cancel. */
const issueHead = (d, ref) => `<header class="ph"><h1 class="view-only">${esc(d.title)}</h1>` +
  `<input class="edit-only title-edit" name="title" ${FORM} required aria-label="Title" value="${esc(d.title)}">` +
  `<div class="aside"><button type="button" class="act view-only" data-edit="start">Edit</button>` +
  `<form id="issue-edit" data-ui="issue-edit" class="edit-only" data-repo="${esc(d.repo)}" data-ref="${esc(ref)}"><span class="form-msg" role="status"></span> <button type="button" class="act" data-edit="cancel">Cancel</button> <button type="submit" class="act primary">Save</button></form></div></header>`;

/** The form that appends a note. */
const renderNoteForm = (d, ref) => `<form data-ui="issue-note" class="stack" data-repo="${esc(d.repo)}" data-ref="${esc(ref)}">` +
  `<label>Add a note <textarea name="text" rows="3" required></textarea></label>` +
  `<button type="submit" class="act">Add note</button> <span class="form-msg" role="status"></span></form>`;

/** Machine note prefixes, matched after the `- ` and the stamp are removed. */
const MACHINE = /^(?:intake|triage|acceptance|planner|standing|always|firefighter|sealed checks|its goals are all done):/;
/** The notes a person or a run needs to read, which stay visible. */
const READ = /^(?:intake: for Chris:|triage: for Chris:|triage: a live check:|acceptance rerun by hand)/;
/** True when a note line is a machine line: the prefix at the start of the text after the `- ` and the stamp. */
export const isMachineNote = (n) => {
  const t = String(n).replace(/^- /, "").replace(/^\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)?: /, "");
  return MACHINE.test(t) && !READ.test(t);
};

/** A note as an event: a machine note's prefix is its tag, any other note is tagged "note". */
function noteItem(e) {
  const m = /^([a-z ]+): (.*)$/s.exec(e.text);
  return m && isMachineNote(`- ${e.text}`) ? { at: e.at, tag: m[1], tone: "quiet", html: esc(m[2]) } : { at: e.at, tag: "note", tone: "quiet", html: esc(e.text) };
}

/** The filing time: the store's, else the created date unless a run that day starts the issue (midnight would draw a false wait). */
function filedAt(d, runs) {
  const created = localMs(d.frontmatter?.created);
  const sameDay = runs.length && new Date(created).toDateString() === new Date(runs[0].start).toDateString();
  return d.timeline?.filed ?? (created >= 0 && !sameDay ? created : runs[0]?.start ?? NaN);
}

const RUN_TAG = { stuck: ["Stuck", "stuck"], failed: ["Failed", "stuck"], dropped: ["Dropped", "quiet"], awaiting: ["Awaiting you", "need"] };
/** The events of a lane: each wait, and each run that stopped or asks, with its reason. */
const laneEvents = (runs, waits, bars, holds = []) => [...waits.map((w) => waitEvent(w, holds)), ...runs.flatMap((x, i) => {
  // A run that awaits you shows only with its question; the wait after it already shows.
  if (!RUN_TAG[x.r.condition] || (x.r.condition === "awaiting" && !x.r.reason)) return [];
  const [text, tone] = RUN_TAG[x.r.condition], name = bars[i].label;
  return [{ at: x.end, tag: text, tone, html: `${esc(name[0].toUpperCase() + name.slice(1))}${x.r.reason ? `: ${inline(x.r.reason)}` : "."}` }];
})];

/** Text with its `code` spans set as code, escaped. */
const inline = (t) => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>");
const ends = (runs) => (runs.length ? Math.max(...runs.map((x) => x.end)) : NaN);
const sum = (runs) => runs.reduce((n, x) => n + (x.r.cost ?? 0), 0);
const kinds = (runs) => [...new Set(runs.map((x) => (x.r.kind === "build" ? "build" : x.r.kind)))].join(", ");

/** One timeline row: the runs as bars, the waits from `from` to `to`, and their events with `events`. */
function laneRow({ head, runs, from = NaN, to = NaN, marks = [], result, events = [], holds = [] }) {
  const waits = gaps(runs, from, to), bars = barsOf(runs);
  const times = [from, to, ...runs.flatMap((x) => [x.start, x.end]), ...marks.map((m) => m.at)].filter(Number.isFinite);
  return { head, bars, waits, marks, result, time: timeText(times.length ? Math.max(...times) - Math.min(...times) : 0), cost: costText(sum(runs)), events: [...laneEvents(runs, waits, bars, holds), ...events] };
}

/**
 * The Timeline's segments for an issue. With parts: Before the split (the issue's own runs before its parts start),
 * Parts (one row per part), After the parts (to the close). Without: one Work row. Notes are events at their time.
 */
export function issueSegments(d, now = Date.now()) {
  const id = `${d.repo}-${d.ref ?? d.id}`, goals = d.goals ?? [], open = !CLOSED.includes(d.status);
  const all = spans(d.timeline?.runs ?? [], now), filed = filedAt(d, all);
  const notes = (d.notes ?? []).map(noteEvent).filter(Boolean).map(noteItem);
  // A closed issue closes at its last stamped note after its runs, else at its last run.
  const last = ends(all), closing = notes.filter((n) => !(n.at < last)).at(-1)?.at;
  const closed = open ? NaN : closing ?? last;
  const marks = [...(Number.isFinite(filed) ? [{ at: filed, tone: "made", tip: "filed" }] : []), ...(Number.isFinite(closed) ? [{ at: closed, tone: "done", tip: d.status }] : [])];
  // The issue's own job, when one has its name, is where its id links.
  const job = (d.jobs ?? []).find((j) => j.name === id);
  const headOf = (text) => `${job ? idLink(id, `#/jobs/${encodeURIComponent(job.name)}`) : `<span class="idp">${esc(id)}</span>`}<span class="quiet t">${esc(text)}</span>`;
  const state = d.derived?.stage ?? d.status;
  // The hold records of a job name: why its waits waited.
  const holdsOf = (name) => (d.holds ?? []).filter((h) => h.name === name);
  if (!goals.length) {
    return [{ title: "Work", rows: [laneRow({ head: headOf(kinds(all) || (open ? "no run yet" : d.status)), runs: all, from: filed, to: open ? (all.some((x) => x.r.condition === "running") ? NaN : now) : closed, marks, result: badge(state), events: notes, holds: holdsOf(id) })] }];
  }
  const ofPart = (g) => all.filter((x) => x.r.on === g.id), partRuns = goals.flatMap(ofPart);
  const first = partRuns.length ? Math.min(...partRuns.map((x) => x.start)) : Infinity;
  const own = all.filter((x) => !partRuns.includes(x)), before = own.filter((x) => x.start < first), after = own.filter((x) => x.start >= first);
  const split = Number.isFinite(ends(before)) ? ends(before) : filed, lastPart = ends(partRuns);
  const done = goals.filter((g) => g.stage === "done").length;
  const segments = [
    { title: "Before the Split", rows: [laneRow({ head: headOf(kinds(before) || "filed"), runs: before, from: filed, marks: marks.filter((m) => m.tone === "made"), result: tag(`split in ${goals.length}`), events: notes.filter((n) => n.at < first), holds: holdsOf(id) })] },
    { title: "Parts", aside: `${done} of ${goals.length} done`, rows: goals.map((g) => {
      const runs = ofPart(g);
      const job = g.jobs?.at(-1), p = g.priority && g.priority !== "medium" ? ` ${priorityBadge(g.priority)}` : "";
      return laneRow({ head: `<span>${idLink(localId(g.id, d.repo), job ? `#/jobs/${encodeURIComponent(job.name)}` : g.href)}${p}</span><a class="t" href="${esc(g.href)}" title="${esc(g.title)}">${esc(g.title)}</a>`, runs, from: split, to: runs.length || !open ? NaN : now, result: badge(g.stage), holds: holdsOf(job?.name) });
    }) },
  ];
  const later = notes.filter((n) => n.at >= first);
  if (after.length || later.length || !open) segments.push({ title: "After the Parts", rows: [laneRow({ head: headOf(open ? kinds(after) : d.status), runs: after, from: lastPart, to: open ? NaN : closed, marks: marks.filter((m) => m.tone === "done"), result: badge(state), events: later, holds: holdsOf(id) })] });
  return segments;
}

const title = (s) => String(s).replace(/^./, (c) => c.toUpperCase());

/** The KPI strip of an issue: parts or stage, elapsed, waiting, cost and commits. */
function issueKpis(d, segments, now = Date.now()) {
  const goals = d.goals ?? [], open = !CLOSED.includes(d.status), rows = segments.flatMap((s) => s.rows);
  const times = rows.flatMap((r) => [...r.bars.flatMap((b) => [b.start, b.end]), ...r.waits.flatMap((w) => [w.start, w.end]), ...(r.marks ?? []).map((m) => m.at)]).filter(Number.isFinite);
  const lo = Math.min(...times), hi = open ? now : Math.max(...times);
  // Waiting is the time no run ran, on the whole issue, so a part waiting beside a running part does not count.
  const all = spans(d.timeline?.runs ?? [], now), waits = times.length ? gaps(all, lo, hi) : [];
  const waited = waits.reduce((n, w) => n + w.end - w.start, 0), chris = waits.filter((w) => w.chris).reduce((n, w) => n + w.end - w.start, 0);
  const runs = all.length, cost = all.reduce((n, x) => n + (x.r.cost ?? 0), 0), done = goals.filter((g) => g.stage === "done").length;
  const commits = d.commits ?? [];
  const sha = (c) => (c.commitUrl ? idLink(c.hash.slice(0, 7), c.commitUrl) : `<code>${esc(c.hash.slice(0, 7))}</code>`);
  return renderKpis([
    goals.length ? { k: "Parts done", v: esc(`${done} of ${goals.length}`), sub: esc(goals.filter((g) => g.stage !== "done").map((g) => `${localId(g.id, d.repo)} ${title(g.stage)}`).join(", ")) }
      : { k: "Stage", v: esc(title(d.derived?.stage ?? d.status)), sub: "" },
    { k: open ? "Open for" : "Elapsed", v: esc(times.length ? lifespan(hi - lo) : "–"), sub: times.length ? esc(fromTo(lo, hi)) : "" },
    { k: "Waiting", v: esc(times.length ? lifespan(waited) : "–"), sub: chris ? esc(`${lifespan(chris)} for your answer`) : "" },
    { k: "Cost", v: esc(costText(cost)), sub: esc(runs === 1 ? "1 run" : `${runs} runs`) },
    { k: "Commits", v: commits.length ? commits.slice(0, 3).map(sha).join(" ") : "–", text: commits.length > 0, sub: commits.length > 3 ? esc(`${commits.length} on main`) : commits.length ? "on main" : "" },
  ]);
}

/** Front-matter keys the page shows elsewhere, or that are the store's own. */
const HIDE = ["labels", "id", "closed_as", "parked", "closed_why", "closed_at", "closed_time", "created_time", "since", "ask", "reason", "question", "options", "recommended", "why", "plan", "intake", "tracker", "after", "created", "updated", "title", "headline", "situation", "details", "effects", "recommend", "priority", "source", "areas", "kind"];

/** The Issue page: the header and its pills, the KPI strip, the Timeline, the Description and the Spec, then Notes and Commits. Shared with views/issue.js. */
export function renderIssue(d) {
  const fm = d.frontmatter ?? {};
  const areas = d.labels ?? [], priority = d.priority ?? "medium", source = fm.source ?? (d.issue ? "agent" : "chris");
  const tracker = fm.tracker === "true";
  const ref = String(d.ref ?? d.id), inventory = "#/issues", project = [d.repo, `#/issues?project=${encodeURIComponent(d.repo)}`];
  const place = d.issue ? [project, ["issues", inventory], [localId(d.issue.id, d.repo), d.issue.href], [ref]] : [project, ["issues", inventory], [ref]];
  // Front matter the page shows nowhere else: a chip each.
  const extra = Object.entries(fm).filter(([k]) => !HIDE.includes(k)).map(([k, v]) => chip(`${k}: ${Array.isArray(v) ? v.map(labelName).join(", ") : v}`)).join("");
  const pills = `<div class="status-row">${d.derived ? stateBadge(d.derived.stage) : badge(d.status)} ${priorityBadge(priority)}${chip(`kind: ${d.kind ?? "task"}`, { cls: "kind" })}${chip(`source: ${source}`)}${chips([...new Set([...areas, ...(fm.labels ?? [])])])}${extra}<span class="idp">${esc(`${d.repo}-${ref}`)}</span></div>`;
  const fields = `<section class="dp-panel dp-prose edit-only" aria-label="Fields"><div class="dp-fields">` +
    `<label>Priority ${choose("priority", PRIORITIES, priority)}</label><label>Source ${choose("source", SOURCES, source)}</label>` +
    `<label>Areas <input name="areas" ${FORM} aria-label="areas" placeholder="comma separated" value="${esc(areas.join(", "))}"></label></div></section>`;
  const blocked = d.blockers?.length ? `<div class="dp-blocked"><span class="quiet">Waits on</span>${blockersHtml(d.blockers, d.repo, d.ref ?? d.id)}</div>` : "";
  const goals = d.goals ?? [];
  const part = (id, title, name, text) => (text || !goals.length
    ? `<section class="dp-panel dp-prose${text ? "" : " edit-only"}" aria-labelledby="h-${id}"><div class="dp-ph"><h2 id="h-${id}">${title}</h2></div><div class="md view-only" id="${id}">${linkSpecs(md(text ?? ""), d.repo, d.specs)}</div><textarea class="edit-only body-edit" name="${name}" ${FORM} rows="12" aria-label="${title}">${esc(text ?? "")}</textarea></section>`
    : "");
  const noteRow = (n) => {
    const e = noteEvent(n), it = e ? noteItem(e) : { tag: "note", tone: "quiet", html: esc(n.replace(/^- /, "")) };
    return `<li class="dp-ev"><span class="dp-at">${esc(e ? when(new Date(e.at)) : "")}</span><span>${tag(it.tag, it.tone)}</span><div class="dp-evt">${it.html}</div></li>`;
  };
  const folded = tracker ? [] : d.notes.filter(isMachineNote), shown = tracker ? d.notes : d.notes.filter((n) => !isMachineNote(n));
  const fold_ = folded.length ? `<details class="notes-fold"><summary>${folded.length} machine ${folded.length === 1 ? "note" : "notes"}</summary><ul class="notes">${folded.map(noteRow).join("")}</ul></details>` : "";
  const notes = (d.notes.length ? (shown.length ? `<ul class="notes">${shown.map(noteRow).join("")}</ul>` : "") + fold_ : empty("No notes.")) + renderNoteForm(d, ref);
  const parts = d.commits.some((c) => c.part);
  const commits = d.commits.length
    ? dataTable(`<th>Commit</th><th>Subject</th>${parts ? "<th>Part</th>" : ""}<th>Date</th>`, d.commits.map((c) => {
      const sha = c.hash.slice(0, 7);
      return `<tr><td>${c.commitUrl ? idLink(sha, c.commitUrl) : `<code>${esc(sha)}</code>`}</td><td class="wide" title="${esc(c.subject)}">${esc(c.subject)}</td>${parts ? `<td>${c.part ? idLink(localId(c.part, d.repo), `#/jobs/${encodeURIComponent(c.part)}`) : ""}</td>` : ""}<td class="time">${esc(when(c.date))}</td></tr>`;
    }).join(""))
    : empty("No commit on main names this issue in its trailers.");
  const segments = issueSegments(d);
  return `<div class="page dp-page issue-page">${crumb(inventory, place)}` + issueHead(d, ref) + pills + fields + blocked + (d.ask ? askRow(d.ask) : "") +
    issueKpis(d, segments) + renderTimeline(segments) +
    part("request", "Description", "request", d.request) + part("spec", "Spec", "spec", d.spec) +
    `<div class="dp-detail">${fold("Notes", esc(d.notes.length), notes)}${fold("Commits", esc(d.commits.length), commits)}</div></div>`;
}

// Interaction: the shell renders with innerHTML and has no hooks, so the view
// listens on the document. Filters live in the route's query, the form posts.
if (typeof document !== "undefined") {
  const here = () => hashOptions(new URLSearchParams(location.hash.split("?")[1] ?? ""));
  document.addEventListener("click", (e) => {
    const t = e.target.closest ? e.target : null;
    const sort = t?.closest("#issues-table button[data-sort]");
    if (sort) {
      const key = sort.dataset.sort, cur = here().sort;
      const dir = cur?.key === key ? -cur.dir : DOWN_FIRST.has(key) ? -1 : 1;
      return setQuery({ sort: key, dir: dir > 0 ? "asc" : "desc" });
    }
    const seg = t?.closest("#inv-filters .seg button");
    if (seg) return setQuery({ [seg.closest(".seg").dataset.name]: seg.dataset.value, limit: "" });
    const win = t?.closest("#inv-scope .seg button");
    if (win) { storeWindow(win.dataset.value); return setQuery({ window: win.dataset.value }); }
    const more = t?.closest("#issues-table button[data-more]");
    if (more) setQuery({ limit: String(here().limit + Number(more.dataset.more)) });
  });
  document.addEventListener("change", (e) => {
    const f = e.target.closest?.("#inv-filters select[name], #inv-scope select[name]");
    if (f) { if (f.name === "project") storeProject(f.value); setQuery({ [f.name]: f.value, limit: "" }); }
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
