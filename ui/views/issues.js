// The Issues view: a browser for the issues of every repo: tiles, three charts, filters, fuzzy search, a sortable
// table and a form that files an issue. `data` is /api/issues: { issues, projects, tests }.
// The issue detail (renderIssue) is routed at #/issues/:repo/:n.
import { actButton, issueApi, issueHref, jobHref, postJson, say, count, days, barList, barRow, blockersHtml, badge, tag, priorityBadge, card, chip, chips, crumb, dataTable, heads, pagedTable, day, dur, empty, esc, filterBar, idLink, labelName, localId, localMs, md, money, onTile, pageHead, pager, projectKeysOnce, searchBox, setQuery as setHash, hashQuery, limitOf, sortRows as sortBy, wireTable, cardTrend, sortHead, statCard, tiles, when, scope, remember } from "../lib.js";
import { buckets, DAY, FACTORY, quantile } from "../../lib/windows.ts";
import { panelOf } from "../chart.js";
import { shortId } from "../../lib/naming.ts";
import { askCard } from "./cards.js";
import { costText, detailPanel, fromTo, gaps, laneRow, noteEvent, panel, renderKpis, renderTimeline, spans } from "../timeline.js";

export const view = {
  path: "/issues",
  title: "Issues",
  icon: "list-check",
  group: "factory",
  order: -1,
  api: "/api/issues",
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
const DEFAULT_STATUS = "open";
const statusOf = (s) => (s === null || s === undefined || s === "" ? DEFAULT_STATUS : s === "any" ? "" : s);

/** The filters and the sort, from the route's query: ?status=open&project=x&stage=x&priority=x&label=x&q=text&sort=title&dir=asc&limit=100. With a search and no sort, the best match comes first. */
export function hashOptions(q = new URLSearchParams()) {
  const s = scope(q);
  return {
    limit: limitOf(q, PAGE),
    status: statusOf(q.get("status")), project: s.project, stage: q.get("stage") ?? "", priority: q.get("priority") ?? "", label: q.get("label") ?? "", q: q.get("q") ?? "", tile: q.get("tile") || "open", window: s.window,
    sort: q.get("sort") ? { key: q.get("sort"), dir: q.get("dir") === "asc" ? 1 : -1 } : null,
  };
}

/** A row's own number: `910` for an issue, `910.1` for a sub-issue. */
const own = (r) => r.ref ?? r.id;
export const ref = (r) => `${r.repo}-${own(r)}`;
export const href = (r) => issueHref(ref(r));

/** A Factory window, or week for any other value. */
const winOf = (w) => (FACTORY.includes(w) ? w : "week");
const ms = (s) => Date.parse(s) || 0;
/** A store date `YYYY-MM-DD` as local midnight in ms, as the CLI writes it; 0 for none. */
/** An ISO UTC time from the store as ms; 0 for none. */
const isoMs = (s) => Date.parse(s ?? "") || 0;
const dayMs = (s) => (/^\d{4}-\d\d-\d\d/.test(String(s ?? "")) ? localMs(String(s).slice(0, 10)) : 0);

/** The issue rows from the API data. */
export function issueRows(d) {
  return (d?.issues ?? []).map((r) => ({ status: r.status, id: ref(r), project: r.repo, title: r.title, kind: r.kind ?? "task", labels: r.labels ?? [], priority: r.priority ?? "medium", notes: r.notes ?? 0, runs: r.runs ?? 0, cost: r.cost ?? 0, own: r.own ?? { runs: 0, cost: 0 }, createdTime: r.createdTime ?? null, closedTime: r.closedTime ?? null, atTime: r.updatedTime ?? null, href: href(r), repo: r.repo, n: own(r), stage: r.stage ?? r.status, why: r.why ?? "", part: !!r.parent, parent: r.parent ? `${r.repo}-${r.parent}` : null }));
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
function fuzzyToken(t, s) {
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
function markHits(title, hits = []) {
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
  const q = (o.q ?? "").trim(), at = within(buckets(winOf(o.window), Date.now()));
  const inTile = (r) => skip.includes("tile") || (o.tile === "filed" ? at(r.createdTime) : o.tile === "closed" ? CLOSED.includes(r.status) && at(r.closedTime) : true);
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

// Column order: time, id, title, state badge, project, labels, numbers. [key, label, { num }]
export const COLUMNS = [["updated", "Updated"], ["id", "Id"], ["title", "Title"], ["stage", "Stage"], ["project", "Project"], ["priority", "Priority"], ["labels", "Labels"], ["notes", "Notes", { num: true }], ["runs", "Jobs", { num: true }], ["cost", "Cost", { num: true }], ["age", "Age", { num: true }]];
const RANK = { critical: 4, high: 3, medium: 2, low: 1 };
const SORT = {
  project: (r) => r.project, stage: (r) => r.stage, id: (r) => String(r.n), title: (r) => r.title, labels: (r) => r.labels.join(","), updated: (r) => updatedMs(r),
  priority: (r) => RANK[r.priority] ?? 0, notes: (r) => r.notes, runs: (r) => r.runs, cost: (r) => r.cost, age: (r) => -isoMs(r.createdTime),
};
/** The keys that start with the largest first. */
const DOWN_FIRST = new Set(["updated", "priority", "notes", "runs", "cost", "age"]);
const UPDATED = { key: "updated", dir: -1 };

/** The rows ordered by `sort` = { key, dir } (dir 1 up, -1 down). Ties keep newest first; rows that tie on that too keep their order going down and reverse it going up. */
export function sortRows(rows, sort = UPDATED) {
  const at = new Map(rows.map((r, i) => [r, i]));
  return sortBy(rows, SORT, { key: SORT[sort.key] ? sort.key : "updated", dir: sort.dir }, (a, b) => ms(b.at) - ms(a.at) || (at.get(a) - at.get(b)) * -sort.dir);
}

/** With a search and no chosen sort, the best match first. */
const ordered = (rows, o) => (o.sort || !(o.q ?? "").trim() ? sortRows(rows, o.sort ?? UPDATED) : [...rows].sort((a, b) => b.score - a.score || ms(b.at) - ms(a.at)));

/** The rows with each child moved under its parent, in their order. A child whose parent is not in the rows keeps its place. */
export function nest(rows) {
  const ids = new Set(rows.map((r) => r.id)), under = (r) => r.parent && ids.has(r.parent);
  const kids = Map.groupBy(rows.filter(under), (r) => r.parent);
  return rows.filter((r) => !under(r)).flatMap((r) => [r, ...(kids.get(r.id) ?? [])]);
}

/** A store date as the table shows it: "Oct 20" this year, "2025-12-03" another; "" for none. */
export function dateText(s, now = new Date()) {
  const t = dayMs(s);
  if (!t) return "";
  return day(new Date(t), now);
}

/** When a row last changed, in ms. */
const updatedMs = (r) => isoMs(r.atTime);
/** The Updated cell: the local minute as `when()` gives it; "" for none. */
export const updatedText = (r) => (updatedMs(r) ? when(new Date(updatedMs(r))) : "");

/** The days since a store time, as "12d"; a closed issue counts to its closing. "" for none. */
export function ageText(r, now = Date.now()) {
  const from = isoMs(r.createdTime);
  if (!from) return "";
  return `${Math.max(0, Math.floor(((r.status === "open" ? now : isoMs(r.closedTime) || now) - from) / DAY))}d`;
}

/** One issue row; a sub-issue is indented under its parent. */
export function renderRow(r) {
  return `<tr class="rowlink${r.part ? " part-row" : ""}" data-repo="${esc(r.repo)}" data-n="${r.n}" data-annotate="${esc(shortId(`${r.repo}-${r.n}`))}"><td class="time">${esc(updatedText(r))}</td><td>${idLink(localId(`${r.repo}-${r.n}`, r.repo), r.href)}</td>` +
    `<td class="wide"><a href="${esc(r.href)}">${markHits(r.title, r.hits)}</a></td>` +
    `<td title="${esc(r.why ?? "")}">${badge(r.stage ?? r.status)}</td><td>${esc(r.project)}</td><td>${priorityBadge(r.priority)}</td><td>${chip(r.kind ?? "task", { cls: "kind" })}${chips(r.labels)}</td>` +
    `<td class="num">${r.notes}</td><td class="num">${r.runs}</td><td class="num">${r.cost ? esc(money(r.cost)) : ""}</td><td class="num">${esc(ageText(r))}</td></tr>`;
}

export function renderTable(rows, o = {}) {
  const all = nest(ordered(filterRows(rows, o), o));
  if (!all.length) return empty("Nothing matches.", "Loosen the filters, or file an issue below.");
  const shown = all.slice(0, o.limit ?? PAGE);
  const sort = o.sort ?? ((o.q ?? "").trim() ? null : UPDATED);
  const head = COLUMNS.map(([k, label, c]) => (SORT[k] ? sortHead(label, k, sort, c) : heads([label], c?.num ? [label] : []))).join("");
  return `${dataTable(head, shown.map(renderRow).join(""))}${pager(shown.length, all.length, PAGE)}`;
}

// ---- The tiles and charts ----

/** Whether a stored time is inside the span of `b`, the buckets of a window. */
const within = (b) => (time) => { const t = isoMs(time); return t >= b.since && t < b.until; };

/** The numbers over `rows`: what the status and stage filters leave out still counts here, so the tiles do not empty when the table narrows. */
export function stats(rows, now = new Date(), window = "week") {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), b = buckets(window, now.getTime());
  // `at` is the window; `prior` is the window before it.
  const at = within(b), prior = within(buckets(window, b.since - 1));
  const open = rows.filter((r) => r.status === "open");
  const ages = open.map((r) => isoMs(r.createdTime)).filter(Boolean).map((t) => (today - t) / DAY);
  const closedIn = (inside) => rows.filter((r) => CLOSED.includes(r.status) && inside(r.closedTime));
  const closed = closedIn(at);
  const stages = {};
  for (const r of open) stages[r.stage] = (stages[r.stage] ?? 0) + 1;
  return {
    total: rows.length, open: open.length, stages,
    filed: rows.filter((r) => at(r.createdTime)).length, filedBefore: rows.filter((r) => prior(r.createdTime)).length,
    closed: closed.length, done: closed.filter((r) => r.status === "done").length, dropped: closed.filter((r) => r.status === "dropped").length, closedBefore: closedIn(prior).length,
    medianAge: quantile(ages, 0.5), oldest: ages.length ? Math.max(...ages) : null,
    runs: rows.reduce((n, r) => n + r.own.runs, 0), cost: rows.reduce((n, r) => n + r.own.cost, 0),
  };
}

/** The change from the period before: more closed is good, more filed is warn. */
const change = (now, before, w, lowerIsGood) => cardTrend(now, before, before, { kind: "relative", lowerIsGood, tip: `${before} the ${w} before` });

export function renderTiles(s, key = "open", win = "week") {
  const w = winOf(win);
  const on = (k) => ({ key: k, on: key === k });
  return tiles("Issue numbers",
    statCard({ k: "Open", v: count(s.open), v2: count(s.total), q: ["open", "in store"], ...on("open") }) +
    statCard({ k: "Filed", v: count(s.filed), trend: change(s.filed, s.filedBefore, w, true), note: `${s.filedBefore} the ${w} before`, ...on("filed") }) +
    statCard({ k: "Closed", v: count(s.closed), v2: count(s.dropped), q: ["closed", "dropped"], trend: change(s.closed, s.closedBefore, w, false), ...on("closed") }) +
    statCard({ k: "Open Age", v: days(s.medianAge), ...(s.oldest == null ? {} : { v2: days(s.oldest), q: ["open age", "oldest"] }), ...on("age") }) +
    statCard({ k: "Jobs", v: count(s.runs), v2: money(s.cost), q: ["jobs", "recorded cost"], ...on("runs") }));
}

/** The window's buckets (60 minutes, 24 hours, 7 or 30 days): the time of each and how many rows were filed and closed in it. A stored time counts to its minute. */
export function flow(rows, window = "month", now = new Date()) {
  const b = buckets(window, now.getTime()), out = { ats: b.starts, filed: b.starts.map(() => 0), closed: b.starts.map(() => 0) };
  for (const r of rows) {
    const f = b.slotOf(isoMs(r.createdTime)), c = b.slotOf(isoMs(r.closedTime));
    if (f >= 0) out.filed[f]++;
    if (c >= 0 && CLOSED.includes(r.status)) out.closed[c]++;
  }
  return out;
}

const PRIORITY_ORDER = ["low", "medium", "high", "critical"];
/** The window's buckets: how many rows were open at the start of each, per priority. A row is open from its created time to its closed time. */
export function backlog(rows, win = "month", now = new Date()) {
  const ats = buckets(win, now.getTime()).starts;
  const open = (p, t) => rows.filter((r) => {
    if (r.priority !== p) return false;
    const from = isoMs(r.createdTime), to = isoMs(r.closedTime);
    return from && from <= t && (!to || t < to);
  }).length;
  return { ats, counts: Object.fromEntries(PRIORITY_ORDER.map((p) => [p, ats.map((t) => open(p, t))])) };
}

const KINDS = ["task", "bug", "check", "proposal", "flake"];
/** For each kind, the p50 and p90 from created to closed over the rows closed inside the window; null for a kind with none. `unit` is "hours" when a row counts and every value is under 2 days; else "days". */
export function closeTimes(rows, win = "month", now = new Date()) {
  const out = { kinds: KINDS, unit: "days", p50: [], p90: [] };
  const at = within(buckets(win, now.getTime()));
  const spans = KINDS.map((k) => rows.filter((r) => r.kind === k && CLOSED.includes(r.status) && isoMs(r.createdTime) && isoMs(r.closedTime) && at(r.closedTime)).map((r) => isoMs(r.closedTime) - isoMs(r.createdTime)));
  const hours = spans.flat().length > 0 && spans.flat().every((ms) => ms < 2 * DAY);
  if (hours) out.unit = "hours";
  for (const xs of spans) {
    const per = xs.map((ms) => ms / (hours ? 3600000 : DAY));
    out.p50.push(quantile(per, 0.5));
    out.p90.push(quantile(per, 0.9));
  }
  return out;
}

/** The open backlog per bucket, by priority, with the filed and closed counts of the same buckets. */
export const backlogFrame = (b, f, win) => ({
  measure: { name: "Open Backlog, Filed and Closed", unit: "count", agg: "max" },
  over: { kind: "time", window: win },
  by: { keys: [...PRIORITY_ORDER.map((p) => ({ key: p, name: p })), { key: "filed", name: "Filed" }, { key: "closed", name: "Closed" }] },
  rows: b.ats.map((at, i) => ({ at, ...Object.fromEntries(PRIORITY_ORDER.map((p) => [p, b.counts[p][i]])), filed: f.filed[i], closed: f.closed[i] })),
  form: "area",
  note: "Open issues over time, by priority, with the filed and closed counts of each bucket.",
});

/** The suite records of `tests` ({ project: records }) of `project` (all when empty) within the window: one row per run time, the test count of each project and the tests that passed only on rerun. */
export function testsFrame(tests, project = "", win = "month", now = new Date()) {
  const at = within(buckets(winOf(win), now.getTime())), keys = [], rows = new Map();
  for (const [k, records] of Object.entries(tests ?? {})) {
    if (project && k !== project) continue;
    keys.push({ key: `${k} tests`, name: `${k} tests` }, { key: `${k} passed on rerun`, name: `${k} passed on rerun` });
    for (const r of records) {
      const t = Date.parse(r.at);
      if (!at(r.at)) continue;
      const row = rows.get(t) ?? { at: t };
      row[`${k} tests`] = r.ran;
      row[`${k} passed on rerun`] = r.rerunPassed;
      rows.set(t, row);
    }
  }
  return { measure: { name: "Tests", unit: "count", agg: "sum" }, over: { kind: "time", window: win }, by: { keys }, rows: [...rows.values()].sort((a, b) => a.at - b.at), form: "lines", note: "Tests per suite run, and the tests that passed only on rerun." };
}

/** The p50 and the p90 from filed to closed, per kind, in the unit `closeTimes` chose. */
export const closeFrame = (c) => {
  const scale = c.unit === "hours" ? 3600 : 86400;
  return {
    measure: { name: "Time to Close", unit: "seconds", agg: "max" },
    over: { kind: "category" },
    by: { keys: [{ key: "p50", name: "p50" }, { key: "p90", name: "p90", color: "muted" }] },
    rows: c.kinds.map((k, i) => ({ name: k, p50: (c.p50[i] ?? 0) * scale, p90: (c.p90[i] ?? 0) * scale })),
    form: "grouped",
    note: `${c.unit === "hours" ? "Hours" : "Days"} from filed to closed: the p50 and the p90 of each kind.`,
  };
};

/** Each Issues chart panel: its key and its frame. */
export const FRAMES = { backlog: backlogFrame, close: closeFrame, tests: testsFrame };
/** The key of an Issues chart panel: its frame, its kept form and its kept hidden series are its own. */
export const chartKey = (k) => `issues/${k}`;

/** What the filters set when a tile is selected, so the table shows the issues behind the number. */
const TILE_FILTER = {
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
    return card("Issues by Jobs", top.length ? barList(top.map((r) => barRow(`<a href="${esc(r.href)}">${esc(r.title)}</a>`, (r.runs / max) * 100, `${r.runs} · ${esc(money(r.cost))}`)).join("")) : empty("No issue has a job."), { label: "Issues by jobs" });
  }
  return "";
}

/** The three chart panels under the tiles, on every tile. The backlog and the Tests charts take two columns. */
const renderCharts = (o, rows, tests) => {
  const win = winOf(o.window), now = new Date();
  return `<div class="trio">${panelOf(chartKey("backlog"), backlogFrame(backlog(rows, win, now), flow(rows, win, now), win), "wide")}` +
    panelOf(chartKey("close"), closeFrame(closeTimes(rows, win, now))) +
    panelOf(chartKey("tests"), testsFrame(tests, o.project, win, now), "wide") + `</div>`;
};

// ---- The filters ----

const PRIORITY_OPTIONS = [{ value: "", label: "All" }, "critical", "high", "medium", "low"];

/** The project filter scopes the tiles too: a select in the page head, each option with the count the other filters leave. */
export function renderProjects(projects, rows, o = {}) {
  const left = filterRows(rows, o, ["project"]);
  const n = (p) => left.filter((r) => !p || r.project === p).length;
  return scope().bar({ project: o.project ?? "", value: o.window ?? "week", more: projects, label: (p) => `${p || "All"} (${n(p)})` });
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
function renderLive(projects, rows, o, tests) {
  const shown = filterRows(rows, o).length;
  // The tiles and charts follow project, label, priority and search, not status, stage or the selected tile.
  const scoped = filterRows(rows, o, ["status", "stage", "tile"]);
  return {
    scope: renderProjects(projects, rows, o),
    filters: renderFilters(rows, o),
    numbers: renderTiles(stats(scoped, new Date(), winOf(o.window)), o.tile, o.window),
    detail: renderCharts(o, scoped, tests) + renderDetail(scoped, o),
    count: shown,
    window: `last ${winOf(o.window)}`,
    table: renderTable(rows, o),
  };
}

const projectsOf = (d) => [...new Set([...(d?.projects ?? []), ...(d?.issues ?? []).map((r) => r.repo)])].sort();

const BODY_TEMPLATE = "## Outcome\n\n\n\n## Oracle\n\n\n\n## Time box\n\n";

/** The Project select's options, one per registry key, `project` selected. */
function projectOptions(keys, project) {
  return keys.map((k) => `<option value="${esc(k)}"${k === project ? " selected" : ""}>${esc(k)}</option>`).join("");
}

let live = null;
/** Change the query in place: replaceState fires no hashchange, so the shell does not fetch and render again. */
const setQuery = (changes) => { setHash(changes); refill(); };

function draw(root) {
  const rows = filterRows(live.rows, live.o(), ["status", "stage", "tile"]);
  const win = live.o().window, now = new Date();
  // Each panel draws the frame of the window shown; its form and hidden series are its own.
  for (const [k, f] of Object.entries({ backlog: backlogFrame(backlog(rows, win, now), flow(rows, win, now), win), close: closeFrame(closeTimes(rows, win, now)), tests: testsFrame(live.tests, live.o().project, win, now) })) {
    const el = root.querySelector(`aleph-chart[key="${chartKey(k)}"]`);
    if (el) el.frame = f;
  }
}

/** Fill what follows the filters. A filter changes no route, so nothing fetches again. */
function refill() {
  const root = live?.root;
  if (!root?.isConnected) return;
  const parts = renderLive(live.projects, live.rows, live.o(), live.tests);
  for (const [id, html] of [["inv-scope", parts.scope], ["inv-filters", parts.filters], ["inv-numbers", parts.numbers], ["inv-detail", parts.detail], ["issues-table", parts.table]]) root.querySelector(`#${id}`).innerHTML = html;
  root.querySelector("header.ph .count").textContent = parts.window;
  root.querySelector('section[aria-label="Issues"] .sh .count').textContent = parts.count;
  draw(root);
}

/** Draws the charts, keeps the data for the filters, and fills the form's Project select from the registry's keys. */
export async function mount(root, d) {
  live = { root, tests: d?.tests, rows: issueRows(d), projects: projectsOf(d), o: () => hashOptions(hashQuery()) };
  if (root.querySelector?.(".chartbox")) draw(root);
  const table = root.querySelector?.('section[aria-label="Issues"]');
  if (table) wireTable(table, { redraw: refill, sortOf: (h) => hashOptions(new URLSearchParams(h)).sort ?? ((h.q ?? "").trim() ? null : UPDATED), downFirst: DOWN_FIRST, page: PAGE, search: "inv-search" });
  onTile(root.querySelector?.("#inv-numbers"), (k) => {
    setQuery(TILE_FILTER[k]);
    root.querySelector(`button[data-tile="${k}"]`)?.focus();
  });
  const select = root.querySelector?.('select[name="repo"]');
  if (!select) return;
  const keys = await projectKeysOnce();
  if (keys.length) select.innerHTML = projectOptions(keys, select.value);
}

function renderForm(rows, o = {}) {
  const repos = [...new Set(rows.map((r) => r.repo))];
  return `<details class="new"><summary>File an issue</summary>` +
    `<form data-ui="issue-form" class="stack">` +
    `<label>Project <select name="repo" required>${projectOptions(o.keys ?? repos, o.project)}</select></label>` +
    `<label>Title <input name="title" required></label>` +
    `<label>Text <textarea name="body" rows="12">${esc(BODY_TEMPLATE)}</textarea></label>` +
    `<label>Media ${mediaInput}</label>` +
    `<label>Labels <input name="labels" placeholder="comma separated"></label>` +
    `<label><input type="checkbox" name="spec"> The text is a spec: build it in the factory</label>` +
    `<label>After <input name="after" placeholder="repo-n, repo-n.k"></label>` +
    `${actButton("File issue", {}, { primary: true, type: "submit" })} <span class="act-msg" role="status"></span></form></details>`;
}

export function renderIssues(d, o = {}) {
  const rows = issueRows(d), parts = renderLive(projectsOf(d), rows, o, d?.tests);
  return `<div class="page sp contents">${pageHead("Issues", { count: parts.window, aside: `<div id="inv-scope">${parts.scope}</div>` })}` +
    `<div id="inv-numbers">${parts.numbers}</div><div id="inv-detail">${parts.detail}</div>` +
    renderForm(d?.issues ?? [], o) +
    `${card("Issues", `${searchBox("inv-search", o.q, "Search titles, ids, projects, labels")}` +
    `<div id="inv-filters" data-ui="contents-filter">${parts.filters}</div>` +
    `<div id="issues-table">${parts.table}</div>`, { count: parts.count })}</div>`;
}

/** The body as the page shows it: the `## Request` heading goes, because the section has its own heading. */
export const description = (body) => String(body ?? "").replace(/^\s*## Request[ \t]*\r?\n+/, "");

/** Each `docs/specs/<file>.md` that this project has becomes a link to its Spec page. */
const linkSpecs = (html, repo, files = []) => html.replace(/docs\/specs\/([\w.-]+\.md)/g, (m, f) => (files.includes(f) ? `<a href="#/specs/${encodeURIComponent(repo)}/${encodeURIComponent(f)}">${m}</a>` : m));

const PRIORITIES = ["critical", "high", "medium", "low"], SOURCES = ["chris", "worker", "deps", "memory", "agent"];
const choose = (name, all, cur) => `<select name="${name}" ${FORM} aria-label="${name}">${(all.includes(cur) || !cur ? all : [cur, ...all]).map((o) => `<option${o === cur ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;

/** One value and its editor in one place: edit mode shows the editor. The controls join the form in the head by `form=`. */
const editable = (shown, editor) => `<span class="view-only">${shown}</span><span class="edit-only">${editor}</span>`;
const FORM = 'form="issue-edit"';

/** The head of the Issue page: the title and the Edit button, or the title's input and Save and Cancel. */
const issueHead = (d, ref) => pageHead(d.title, { cls: "view-only",
  after: `<input class="edit-only title-edit" name="title" ${FORM} required aria-label="Title" value="${esc(d.title)}">`,
  aside: actButton("Edit", { edit: "start" }, { cls: "view-only" }) +
  `<form id="issue-edit" data-ui="issue-edit" class="edit-only" data-repo="${esc(d.repo)}" data-ref="${esc(ref)}"><span class="act-msg" role="status"></span> ${actButton("Cancel", { edit: "cancel" })} ${actButton("Save", {}, { primary: true, type: "submit" })}</form>` });

/** The form that appends a note. */
/** The file input of the media forms: paste or drop onto its form adds to it too. */
const mediaInput = `<input type="file" name="media" multiple accept="image/png,image/jpeg,image/gif,image/webp,application/pdf">`;

/** The issue's media: each image as a thumbnail that opens the file, each PDF as a link; then the attach form. */
function renderMedia(d, ref) {
  const url = (name) => `${issueApi(d.repo, ref)}/media/${encodeURIComponent(name)}`;
  const items = (d.media ?? []).map((name) => /\.pdf$/i.test(name)
    ? `<li><a class="media-doc" href="${url(name)}" target="_blank" rel="noopener">${esc(name)}</a></li>`
    : `<li><a href="${url(name)}" target="_blank" rel="noopener"><img src="${url(name)}" alt="${esc(name)}" loading="lazy"></a></li>`).join("");
  return (items ? `<ul class="media-grid">${items}</ul>` : empty("No media.")) +
    `<form data-ui="issue-media" class="stack" data-repo="${esc(d.repo)}" data-ref="${esc(ref)}">` +
    `<label>Attach images or PDFs ${mediaInput}</label>` +
    `${actButton("Attach", {}, { type: "submit" })} <span class="act-msg" role="status"></span></form>`;
}

/** The files of a form's media input as `{ name, data }`, `data` in base64. */
async function mediaOf(form) {
  const files = [...(form.elements.media?.files ?? [])];
  return Promise.all(files.map(async (f) => {
    const bytes = new Uint8Array(await f.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { name: f.name || `pasted.${(f.type.split("/")[1] || "png")}`, data: btoa(bin) };
  }));
}

/** Add `files` to the media input of `form`. */
function addMedia(form, files) {
  const input = form?.elements?.media;
  if (!input || !files.length) return false;
  const dt = new DataTransfer();
  for (const f of [...input.files, ...files]) dt.items.add(f);
  input.files = dt.files;
  return true;
}

const renderNoteForm = (d, ref) => `<form data-ui="issue-note" class="stack" data-repo="${esc(d.repo)}" data-ref="${esc(ref)}">` +
  `<label>Add a note <textarea name="text" rows="3" required></textarea></label>` +
  `${actButton("Add note", {}, { type: "submit" })} <span class="act-msg" role="status"></span></form>`;

/** Machine note prefixes, matched after the `- ` and the stamp are removed. */
const MACHINE = /^(?:intake|triage|acceptance|planner|standing|always|firefighter|sealed checks|its goals are all done):/;
/** The notes a person or a job needs to read, which stay visible. */
const READ = /^(?:intake: for Chris:|triage: for Chris:|triage: a live check:|acceptance rerun by hand)/;
/** True when a note (`{ at, text }`) is a machine line: the prefix at the start of its text. */
const isMachineNote = (n) => MACHINE.test(n.text) && !READ.test(n.text);

/** A note as an event: a machine note's prefix is its tag, any other note is tagged "note". */
function noteItem(e) {
  const m = /^([a-z ]+): (.*)$/s.exec(e.text);
  return m && isMachineNote(e) ? { at: e.at, tag: m[1], tone: "quiet", html: esc(localId(m[2])) } : { at: e.at, tag: "note", tone: "quiet", html: esc(localId(e.text)) };
}

/** The filing time: the store's, else the created date unless a job that day starts the issue (midnight would draw a false wait). */
function filedAt(d, runs) {
  const created = Date.parse(d.frontmatter?.created_time);
  const sameDay = runs.length && new Date(created).toDateString() === new Date(runs[0].start).toDateString();
  return d.timeline?.filed ? Date.parse(d.timeline.filed) : (created >= 0 && !sameDay ? created : runs[0]?.start ?? NaN);
}

const ends = (runs) => (runs.length ? Math.max(...runs.map((x) => x.end)) : NaN);
const kinds = (runs) => [...new Set(runs.map((x) => (x.r.kind === "build" ? "build" : x.r.kind)))].join(", ");

/**
 * The Timeline's segments for an issue. With sub-issues: Before the split (the issue's own jobs before its sub-issues start),
 * Sub-issues (one row per sub-issue), After the sub-issues (to the close). Without: one Work row. Notes are events at their time.
 */
export function issueSegments(d, now = Date.now()) {
  const id = `${d.repo}-${d.ref ?? d.id}`, parts = d.goals ?? [], open = !CLOSED.includes(d.status);
  const all = spans(d.timeline?.runs ?? [], now), filed = filedAt(d, all);
  const notes = (d.notes ?? []).map(noteEvent).filter(Boolean).map(noteItem);
  // A closed issue closes at its last stamped note after its jobs, else at its last job.
  const last = ends(all), closing = notes.filter((n) => !(n.at < last)).at(-1)?.at;
  const closed = open ? NaN : closing ?? last;
  const marks = [...(Number.isFinite(filed) ? [{ at: filed, tone: "made", tip: "filed" }] : []), ...(Number.isFinite(closed) ? [{ at: closed, tone: "done", tip: d.status }] : [])];
  // The issue's own job, when one has its name, is where its id links.
  const job = (d.jobs ?? []).find((j) => j.name === id);
  const headOf = (text) => `${job ? idLink(localId(id, d.repo), jobHref(job.id)) : `<span class="idp">${esc(localId(id, d.repo))}</span>`}<span class="quiet t">${esc(text)}</span>`;
  const state = d.derived?.stage ?? d.status;
  // The hold records of a job name: why its waits waited.
  const holdsOf = (name) => (d.holds ?? []).filter((h) => h.name === name);
  if (!parts.length) {
    return [{ title: "Work", rows: [laneRow({ head: headOf(kinds(all) || (open ? "no job yet" : d.status)), runs: all, from: filed, to: open ? (all.some((x) => x.r.condition === "running") ? NaN : now) : closed, marks, result: badge(state), events: notes, holds: holdsOf(id) })] }];
  }
  const ofPart = (g) => all.filter((x) => x.r.issue === g.id), partRuns = parts.flatMap(ofPart);
  const first = partRuns.length ? Math.min(...partRuns.map((x) => x.start)) : Infinity;
  const own = all.filter((x) => !partRuns.includes(x)), before = own.filter((x) => x.start < first), after = own.filter((x) => x.start >= first);
  const split = Number.isFinite(ends(before)) ? ends(before) : filed, lastPart = ends(partRuns);
  const done = parts.filter((g) => g.stage === "done").length;
  const segments = [
    { title: "Before the Split", rows: [laneRow({ head: headOf(kinds(before) || "filed"), runs: before, from: filed, marks: marks.filter((m) => m.tone === "made"), result: tag(`split in ${parts.length}`), events: notes.filter((n) => n.at < first), holds: holdsOf(id) })] },
    { title: "Sub-issues", aside: `${done} of ${parts.length} done`, rows: parts.map((g) => {
      const runs = ofPart(g);
      const job = g.jobs?.at(-1), p = g.priority && g.priority !== "medium" ? ` ${priorityBadge(g.priority)}` : "";
      return laneRow({ head: `<span>${idLink(localId(g.id, d.repo), job ? jobHref(job.id) : g.href)}${p}</span><a class="t" href="${esc(g.href)}" title="${esc(g.title)}">${esc(g.title)}</a>`, runs, from: split, to: runs.length || !open ? NaN : now, result: badge(g.stage), holds: holdsOf(job?.name) });
    }) },
  ];
  const later = notes.filter((n) => n.at >= first);
  if (after.length || later.length || !open) segments.push({ title: "After the Sub-issues", rows: [laneRow({ head: headOf(open ? kinds(after) : d.status), runs: after, from: lastPart, to: open ? NaN : closed, marks: marks.filter((m) => m.tone === "done"), result: badge(state), events: later, holds: holdsOf(id) })] });
  return segments;
}

const title = (s) => String(s).replace(/^./, (c) => c.toUpperCase());

/** The KPI strip of an issue: sub-issues or stage, elapsed, waiting, cost and commits. */
function issueKpis(d, segments, now = Date.now()) {
  const parts = d.goals ?? [], open = !CLOSED.includes(d.status), rows = segments.flatMap((s) => s.rows);
  const times = rows.flatMap((r) => [...r.bars.flatMap((b) => [b.start, b.end]), ...r.waits.flatMap((w) => [w.start, w.end]), ...(r.marks ?? []).map((m) => m.at)]).filter(Number.isFinite);
  const lo = Math.min(...times), hi = open ? now : Math.max(...times);
  // Waiting is the time no job ran, on the whole issue, so a sub-issue waiting beside a running sub-issue does not count.
  const all = spans(d.timeline?.runs ?? [], now), waits = times.length ? gaps(all, lo, hi) : [];
  const waited = waits.reduce((n, w) => n + w.end - w.start, 0), chris = waits.filter((w) => w.chris).reduce((n, w) => n + w.end - w.start, 0);
  const runs = all.length, cost = all.reduce((n, x) => n + (x.r.cost ?? 0), 0), done = parts.filter((g) => g.stage === "done").length;
  const commits = d.commits ?? [];
  const sha = (c) => (c.commitUrl ? idLink(c.hash.slice(0, 7), c.commitUrl) : `<code>${esc(c.hash.slice(0, 7))}</code>`);
  return renderKpis([
    parts.length ? { k: "Sub-issues done", v: esc(`${done} of ${parts.length}`), sub: esc(parts.filter((g) => g.stage !== "done").map((g) => `${localId(g.id, d.repo)} ${title(g.stage)}`).join(", ")) }
      : { k: "Stage", v: esc(d.derived?.stage ?? d.status), sub: "" },
    { k: open ? "Open for" : "Elapsed", v: esc(times.length ? dur((hi - lo) / 1000) : "–"), sub: times.length ? esc(fromTo(lo, hi)) : "" },
    { k: "Waiting", v: esc(times.length ? dur(waited / 1000) : "–"), sub: chris ? esc(`${dur(chris / 1000)} for your answer`) : "" },
    { k: "Cost", v: esc(costText(cost)), sub: esc(runs === 1 ? "1 job" : `${runs} jobs`) },
    { k: "Commits", v: commits.length ? commits.slice(0, 3).map(sha).join(" ") : "–", text: commits.length > 0, sub: commits.length > 3 ? esc(`${commits.length} on main`) : commits.length ? "on main" : "" },
  ]);
}

/** Front-matter keys the page shows elsewhere, or that are the store's own. */
const HIDE = ["labels", "id", "from", "closed_as", "parked", "closed_why", "closed_at", "closed_time", "created_time", "since", "ask", "reason", "question", "options", "recommended", "why", "plan", "intake", "tracker", "after", "created", "updated", "title", "headline", "situation", "details", "effects", "recommend", "priority", "source", "areas", "kind"];

/** The Issue page: the header and its pills, the KPI strip, the Timeline, the Description and the Spec, then Notes and Commits. Shared with views/issue.js. */
export function renderIssue(d) {
  const fm = d.frontmatter ?? {};
  const areas = d.labels ?? [], priority = d.priority ?? "medium", source = fm.source ?? (d.issue ? "agent" : "chris");
  const tracker = fm.tracker === "true";
  const ref = String(d.ref ?? d.id), inventory = "#/issues", project = [d.repo, `#/issues?project=${encodeURIComponent(d.repo)}`];
  const place = d.issue ? [project, ["issues", inventory], [localId(d.issue.id, d.repo), d.issue.href], [ref]] : [project, ["issues", inventory], [ref]];
  // Front matter the page shows nowhere else: a chip each.
  const extra = Object.entries(fm).filter(([k]) => !HIDE.includes(k)).map(([k, v]) => chip(`${k}: ${Array.isArray(v) ? v.map(labelName).join(", ") : v}`)).join("");
  const pills = `<div class="status-row">${d.derived ? badge(d.derived.stage) : badge(d.status)} ${priorityBadge(priority)}${chip(`kind: ${d.kind ?? "task"}`, { cls: "kind" })}${chip(`source: ${source}`)}${chips([...new Set([...areas, ...(fm.labels ?? [])])])}${extra}<span class="idp">${esc(localId(`${d.repo}-${ref}`, d.repo))}</span></div>`;
  const fields = `<section class="dp-panel dp-prose edit-only" aria-label="Fields"><div class="dp-fields">` +
    `<label>Priority ${choose("priority", PRIORITIES, priority)}</label><label>Source ${choose("source", SOURCES, source)}</label>` +
    `<label>Areas <input name="areas" ${FORM} aria-label="areas" placeholder="comma separated" value="${esc(areas.join(", "))}"></label></div></section>`;
  const blocked = d.blockers?.length ? `<div class="dp-blocked"><span class="quiet">Waits on</span>${blockersHtml(d.blockers, d.repo, d.ref ?? d.id)}</div>` : "";
  const partList = d.goals ?? [];
  const part = (id, title, name, text) => (text || !partList.length
    ? panel(id, title, `<div class="md view-only" id="${id}">${linkSpecs(md(text ?? ""), d.repo, d.specs)}</div><textarea class="edit-only body-edit" name="${name}" ${FORM} rows="12" aria-label="${title}">${esc(text ?? "")}</textarea>`, "", text ? "" : " edit-only")
    : "");
  const noteRow = (n) => {
    const e = noteEvent(n), it = e ? noteItem(e) : { tag: "note", tone: "quiet", html: esc(localId(n.text)) };
    return `<li class="dp-ev"><span class="dp-at">${esc(e ? when(new Date(e.at)) : "")}</span><span>${tag(it.tag, it.tone)}</span><div class="dp-evt">${it.html}</div></li>`;
  };
  const folded = tracker ? [] : d.notes.filter(isMachineNote), shown = tracker ? d.notes : d.notes.filter((n) => !isMachineNote(n));
  const machineNotes = folded.length ? `<details class="notes-fold"><summary>${folded.length} machine ${folded.length === 1 ? "note" : "notes"}</summary><ul class="notes">${folded.map(noteRow).join("")}</ul></details>` : "";
  const notes = (d.notes.length ? (shown.length ? `<ul class="notes">${shown.map(noteRow).join("")}</ul>` : "") + machineNotes : empty("No notes.")) + renderNoteForm(d, ref);
  const parts = d.commits.some((c) => c.part);
  const commits = d.commits.length
    ? pagedTable(heads(["Committed", "Commit", "Subject", ...(parts ? ["Sub-issue"] : [])]), d.commits.map((c) => {
      const sha = c.hash.slice(0, 7);
      return `<tr><td class="time">${esc(when(c.date))}</td><td>${c.commitUrl ? idLink(sha, c.commitUrl) : `<code>${esc(sha)}</code>`}</td><td class="wide" title="${esc(c.subject)}">${esc(c.subject)}</td>${parts ? `<td>${c.part ? idLink(localId(c.part, d.repo), issueHref(c.part)) : ""}</td>` : ""}</tr>`;
    }))
    : empty("No commit on main names this issue in its trailers.");
  const segments = issueSegments(d);
  return `<div class="page dp-page issue-page">${crumb(inventory, place)}` + issueHead(d, ref) + pills + fields + blocked + (d.ask ? askCard(d.ask) : "") +
    issueKpis(d, segments) + renderTimeline(segments) +
    part("request", "Description", "request", d.request) + part("spec", "Spec", "spec", d.spec) +
    `<div class="dp-detail">${detailPanel("Media", esc((d.media ?? []).length), renderMedia(d, ref))}${detailPanel("Notes", esc(d.notes.length), notes)}${detailPanel("Commits", esc(d.commits.length), commits)}</div></div>`;
}

// Interaction: the shell renders with innerHTML and has no hooks, so the view
// listens on the document. Filters live in the route's query, the form posts.
if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const t = e.target.closest ? e.target : null;
    const seg = t?.closest("#inv-filters .seg button");
    if (seg) return setQuery({ [seg.closest(".seg").dataset.name]: seg.dataset.value, limit: "" });
    const win = t?.closest("#inv-scope .seg button");
    if (win) { remember("window", win.dataset.value); return setQuery({ window: win.dataset.value }); }
  });
  document.addEventListener("change", (e) => {
    const f = e.target.closest?.("#inv-filters select[name], #inv-scope select[name]");
    if (f) { remember(f.name, f.value); setQuery({ [f.name]: f.value, limit: "" }); }
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
    try {
      await postJson(`${issueApi(form.dataset.repo, form.dataset.ref)}/${edit ? "edit" : "note"}`, body);
      location.reload();
    } catch (err) { say(form.querySelector("button"), `Could not save it: ${err.message}`); }
  });
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest && e.target.closest('form[data-ui="issue-form"]');
    if (!form) return;
    e.preventDefault();
    const v = (n) => form.elements[n].value.trim();
    const labels = v("labels").split(",").map((s) => s.trim()).filter(Boolean);
    if (form.elements.spec.checked && !labels.includes("spec")) labels.push("spec");
    try {
      const data = await postJson("/api/issues", { repo: v("repo"), title: v("title"), body: form.elements.body.value, labels, after: v("after"), media: await mediaOf(form) });
      location.hash = `/issues/${encodeURIComponent(v("repo"))}/${data.added}`;
    } catch (err) { say(form.querySelector("button"), `Could not file it: ${err.message}`); }
  });
}

if (typeof document !== "undefined") {
  const MEDIA_FORMS = 'form[data-ui="issue-form"], form[data-ui="issue-media"]';
  const accepted = (f) => /^image\/(png|jpeg|gif|webp)$|^application\/pdf$/.test(f.type);
  // A pasted screenshot goes to the media input of the form it was pasted in.
  document.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter(accepted);
    if (addMedia(e.target.closest?.(MEDIA_FORMS), files)) e.preventDefault();
  });
  document.addEventListener("dragover", (e) => { if (e.target.closest?.(MEDIA_FORMS)) e.preventDefault(); });
  document.addEventListener("drop", (e) => {
    const form = e.target.closest?.(MEDIA_FORMS);
    if (!form) return;
    e.preventDefault();
    addMedia(form, [...(e.dataTransfer?.files ?? [])].filter(accepted));
  });
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest && e.target.closest('form[data-ui="issue-media"]');
    if (!form) return;
    e.preventDefault();
    try {
      const media = await mediaOf(form);
      if (!media.length) return say(form.querySelector("button"), "Pick, paste or drop a file first.");
      await postJson(`${issueApi(form.dataset.repo, form.dataset.ref)}/media`, { media });
      location.reload();
    } catch (err) { say(form.querySelector("button"), `Could not attach it: ${err.message}`); }
  });
}

export const issueView = {
  path: "/issues/:repo/:n",
  title: "Issue",
  group: "factory",
  api: (params) => issueApi(params.repo, params.n),
  render: renderIssue,
};
export const views = [view, issueView];
