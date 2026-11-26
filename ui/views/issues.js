// The Issues view: the list of every repo's issues (Open, Parked, Closed) and its flow (a figure band and four charts).
// `data` is /api/issues: { issues, projects }. The issue detail (renderIssue) is routed at #/issues/:repo/:n.
import { issueApi, postJson, scope, kept, hashQuery } from "./lib/address.js";
import { undecided } from "./lib/decisions.js";
import { cardPct, count, plural, dur, money, when } from "./lib/format.js";
import { actButton, editable, fold, runNowButton, say, blockersHtml, badge, statusRow, tag, priorityBadge, chip, chips, crumb, cell, miss, row, shaLink, heads, pagedTable, esc, field, idLink, inputBox, form as formOf, selectBox, wireEdit, toc, wireToc, md, pageHead } from "./lib/html.js";
import { buckets, DAY, quantile } from "../../lib/windows.ts";
import { panelOf } from "./lib/chart.js";
import { browse, inspector } from "./lib/browse.js";
import { factsLine, figureBand, pageViews } from "./lib/page.js";
import { detailPanel, fromTo, gaps, laneRow, eventHtml, noteEvent, panel, renderKpis, renderTimeline, spans } from "./lib/timeline.js";
import { askCard } from "./lib/ask-cards.js";
import { investigateButton, investigationPanel } from "./lib/investigation.js";
import { CLOSED, ISSUE_KINDS as KINDS, PRIORITIES, SOURCES, shortText, shortId, issueHref, issueKey, jobHref, runWord } from "../../lib/naming.ts";

export const view = {
  path: "/issues",
  title: "Issues",
  icon: "list-check",
  group: "factory",
  order: 0,
  api: "/api/issues",
  render: (d, _params, query) => renderIssues(d, query),
  mount: (root, d) => mount(root, d),
};

/** The old addresses: `#/inventory` keeps its filters; `#/projects` and `#/contents` become `#/issues`. The detail routes are left alone. */
export function redirect(hash) {
  const [path, qs] = String(hash ?? "").replace(/^#/, "").split("?");
  const old = path.replace(/\/$/, "");
  if (old === "/inventory") return `#/issues${qs ? `?${qs}` : ""}`;
  return old === "/projects" || old === "/contents" ? "#/issues" : null;
}

/** A row's own number: `910` for an issue, `910.1` for a sub-issue. */
const own = (r) => r.ref;
export const ref = (r) => `${r.repo}-${own(r)}`;
export const href = (r) => issueHref(ref(r));

/** An ISO UTC time from the store as ms; 0 for none. */
const isoMs = (s) => Date.parse(s ?? "") || 0;

/** The issue rows from the API data. */
export function issueRows(d) {
  return (d?.issues ?? []).map((r) => ({ status: r.status, id: ref(r), project: r.repo, title: r.title, kind: r.kind ?? "task", labels: r.labels ?? [], priority: r.priority ?? "medium", notes: r.notes ?? 0, runs: r.runs ?? 0, cost: r.cost ?? 0, own: r.own ?? { runs: 0, cost: 0 }, createdTime: r.createdTime ?? null, closedTime: r.closedTime ?? null, atTime: r.updatedTime ?? null, href: href(r), repo: r.repo, n: own(r), stage: r.stage ?? r.status, why: r.why ?? "", source: r.source ?? "chris", everParked: !!r.everParked, part: !!r.parent, parent: r.parent ? `${r.repo}-${r.parent}` : null }));
}

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

/** Whether a stored time is inside the span of `b`, the buckets of a window. */
const within = (b) => (time) => { const t = isoMs(time); return t >= b.since && t < b.until; };

/** The seconds from filed to closed of each row closed inside `inside`, leaving out a row that was ever parked: its wait was not work. */
const closeSpans = (rows, inside) => rows.filter((r) => CLOSED.includes(r.status) && !r.everParked && inside(r.closedTime) && isoMs(r.createdTime))
  .map((r) => (isoMs(r.closedTime) - isoMs(r.createdTime)) / 1000).filter((s) => s >= 0);

/** The numbers over `rows` in the window: open and parked now, filed, closed and dropped in it, and the time to close. */
export function stats(rows, now = new Date(), window = "week") {
  const b = buckets(window, now.getTime());
  // `at` is the window; `prior` is the window before it.
  const at = within(b), prior = within(buckets(window, b.since - 1));
  const closedIn = (inside) => rows.filter((r) => CLOSED.includes(r.status) && inside(r.closedTime)).length;
  const spans = closeSpans(rows, at), before = closeSpans(rows, prior);
  return {
    open: rows.filter((r) => r.status === "open").length, parked: rows.filter((r) => r.status === "parked").length,
    filed: rows.filter((r) => at(r.createdTime)).length, filedBefore: rows.filter((r) => prior(r.createdTime)).length,
    closed: closedIn(at), closedBefore: closedIn(prior), dropped: rows.filter((r) => r.status === "dropped" && at(r.closedTime)).length,
    p50: quantile(spans, 0.5), p90: quantile(spans, 0.9), p50Before: quantile(before, 0.5),
  };
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

/** The window's buckets: at the start of each, how many rows were filed and not yet closed (the backlog), and how many were filed at all (the total). */
export function levels(rows, win = "month", now = new Date()) {
  const ats = buckets(win, now.getTime()).starts, made = rows.map((r) => [isoMs(r.createdTime), isoMs(r.closedTime)]).filter(([from]) => from);
  return { ats, backlog: ats.map((t) => made.filter(([from, to]) => from <= t && (!to || t < to)).length), total: ats.map((t) => made.filter(([from]) => from <= t).length) };
}

/** The window's buckets: how many rows each source filed in each. */
export function sources(rows, win = "month", now = new Date()) {
  const b = buckets(win, now.getTime()), out = { ats: b.starts, counts: Object.fromEntries(SOURCES.map((k) => [k, b.starts.map(() => 0)])) };
  for (const r of rows) {
    const i = b.slotOf(isoMs(r.createdTime));
    if (i >= 0 && out.counts[r.source]) out.counts[r.source][i]++;
  }
  return out;
}

/** For each kind, the p50 and p90 from created to closed over the rows closed inside the window and never parked; null for a kind with none. `unit` is "hours" when a row counts and every value is under 2 days; else "days". */
export function closeTimes(rows, win = "month", now = new Date()) {
  const out = { kinds: KINDS, unit: "days", p50: [], p90: [] };
  const at = within(buckets(win, now.getTime()));
  const spans = KINDS.map((k) => closeSpans(rows.filter((r) => r.kind === k), at).map((s) => s * 1000));
  const hours = spans.flat().length > 0 && spans.flat().every((ms) => ms < 2 * DAY);
  if (hours) out.unit = "hours";
  for (const xs of spans) {
    const per = xs.map((ms) => ms / (hours ? 3600000 : DAY));
    out.p50.push(quantile(per, 0.5));
    out.p90.push(quantile(per, 0.9));
  }
  return out;
}

/** Filed and closed per bucket: a flow, drawn as two lines so neither hides the other. */
export const flowFrame = (f, win) => ({
  measure: { name: "Issues Filed and Closed", unit: "count", agg: "sum" },
  over: { kind: "time", window: win },
  by: { keys: [{ key: "filed", name: "filed", color: "series-1" }, { key: "closed", name: "closed", color: "done" }] },
  rows: f.ats.map((at, i) => ({ at, filed: f.filed[i], closed: f.closed[i] })),
  form: "lines",
});

/** Filed per bucket, by source. Each source keeps its colour in every window. */
export const sourceFrame = (s, win) => ({
  measure: { name: "Issues Filed", unit: "count", agg: "sum" },
  over: { kind: "time", window: win },
  by: { name: "Source", keys: SOURCES.map((k, i) => ({ key: k, name: k, color: `series-${i + 1}` })) },
  rows: s.ats.map((at, i) => ({ at, ...Object.fromEntries(SOURCES.map((k) => [k, s.counts[k][i]])) })),
});

/** The backlog and the total per bucket: two levels on one count axis. */
export const levelFrame = (l, win) => ({
  measure: { name: "Backlog and Total", unit: "count", agg: "max" },
  over: { kind: "time", window: win },
  by: { keys: [{ key: "backlog", name: "backlog", color: "series-1" }, { key: "total", name: "total", color: "muted" }] },
  rows: l.ats.map((at, i) => ({ at, backlog: l.backlog[i], total: l.total[i] })),
  form: "lines",
});

/** The p50 and the p90 from filed to closed, per kind, in the unit `closeTimes` chose. */
export const closeFrame = (c) => {
  const scale = c.unit === "hours" ? 3600 : 86400;
  return {
    measure: { name: "Time to Close", unit: "seconds", agg: "max" },
    over: { kind: "category", name: "Kind" },
    by: { keys: [{ key: "p50", name: "p50" }, { key: "p90", name: "p90", color: "muted" }] },
    rows: c.kinds.map((k, i) => ({ name: k, p50: c.p50[i] == null ? null : c.p50[i] * scale, p90: c.p90[i] == null ? null : c.p90[i] * scale })),
    form: "grouped",
  };
};

/** Each Issues chart panel: its key and its frame. */
/** The key of an Issues chart panel: its frame, its kept form and its kept hidden series are its own. */
export const chartKey = (k) => `issues/${k}`;

/** Each chart's frame over `rows` in the window. */
const framesOf = (rows, win, now) => ({
  flow: flowFrame(flow(rows, win, now), win), source: sourceFrame(sources(rows, win, now), win),
  close: closeFrame(closeTimes(rows, win, now)), levels: levelFrame(levels(rows, win, now), win),
});


/** The four chart panels, in one row of equal panels. */
const renderCharts = (rows, win, now) => `<div class="quad">${Object.entries(framesOf(rows, win, now)).map(([k, f]) => panelOf(chartKey(k), f)).join("")}</div>`;

const HIGH_FIRST = [...PRIORITIES].reverse();

/** The cost of an issue's jobs; "" for none (Decision 6: a row hides its zero). */
const spent = (r) => (r.cost ? esc(money(r.cost)) : "");

/** The row's title and only what differs from the defaults: no medium, no task, no aleph. */
const mainOf = (r) => `<span class="t" title="${esc(r.title)}">${esc(r.title)}</span>` +
  `${r.priority !== "medium" ? priorityBadge(r.priority) : ""}${r.kind !== "task" ? chip(r.kind) : ""}${r.project !== "aleph" ? chip(r.project) : ""}${chips(r.labels)}`;

/** The inspector of one issue: its state and facts. Its jobs, request and notes are on its page. */
function inspect(r, at) {
  const shut = isoMs(r.closedTime);
  const kv = [
    ["Project", esc(r.project)], ["Kind", esc(r.kind)], ["Source", esc(r.source)],
    ["Filed", esc(when(r.createdTime, new Date(at)))], ["Closed", esc(when(r.closedTime, new Date(at)))],
    [shut ? "Took" : "Age", esc(dur(((shut || at) - isoMs(r.createdTime)) / 1000))],
    ["Cost", spent(r)], ["Jobs", r.runs ? esc(count(r.runs)) : ""], ["Notes", r.notes ? esc(count(r.notes)) : ""],
  ];
  return inspector({ id: shortId(r.id), title: r.title, status: statusRow(badge(r.stage), priorityBadge(r.priority), chips(r.labels)), rows: kv, href: r.href });
}

/** The closed issues the list draws, newest first: the search and the filters reach the rest. */
const CLOSED_SHOWN = 40;

/** The project a filed search goes to: the project filter's, else aleph, else the first. */
export const fileProject = (project, projects = []) => project || (projects.includes("aleph") ? "aleph" : projects[0] ?? "");

/** The groups of the list: Open, Parked, then the newest closed issues. A done row is a muted word: done is the default end. */
export function groups(rows, at) {
  const by = (key) => (a, b) => isoMs(b[key]) - isoMs(a[key]);
  const line = (r, cells) => ({ key: r.id, lead: idLink(shortId(r.id), r.href), main: mainOf(r), cells, inspect: () => inspect(r, at), text: `${r.id} ${r.title} ${r.project} ${r.kind} ${r.labels.join(" ")}`, data: { project: r.project, kind: r.kind } });
  const age = (r) => esc(dur((at - isoMs(r.createdTime)) / 1000));
  const open = rows.filter((r) => r.status === "open").sort(by("atTime")), parked = rows.filter((r) => r.status === "parked").sort(by("atTime"));
  const shut = rows.filter((r) => CLOSED.includes(r.status)).sort(by("closedTime"));
  return [
    { title: "Open", count: count(open.length), heads: ["", "Cost", "Age"], rows: open.map((r) => line(r, [badge(r.stage), spent(r), age(r)])) },
    { title: "Parked", count: count(parked.length), heads: ["", "Cost", "Age"], rows: parked.map((r) => line(r, ["", spent(r), age(r)])) },
    {
      title: "Closed", count: count(shut.length), heads: ["", "Cost", "Took"], cap: CLOSED_SHOWN,
      rows: shut.map((r) => line(r, [r.status === "done" ? `<span class="quiet">done</span>` : badge(r.status), spent(r), esc(dur((isoMs(r.closedTime) - isoMs(r.createdTime)) / 1000))])),
    },
  ];
}

function listView(d) {
  const rows = issueRows(d), at = Date.now(), s = stats(rows, new Date(at));
  const shown = [...new Set(rows.map((r) => r.project))].sort(), kinds = [...new Set(rows.map((r) => r.kind))].sort();
  return factsLine([[count(s.open), "open"], [count(s.parked), "parked"], [count(s.closed), "closed this week"], [dur(s.p50), "to close, p50"]]) +
    browse({ id: "issues", label: "Issues", search: "Search or file an issue", hint: "Ctrl+Enter files", filters: [{ label: "Project", name: "project", options: shown }, { label: "Kind", name: "kind", options: kinds }], groups: groups(rows, at) });
}

/** The figures of the Flow band, each against what came before. */
function figures(rows, win, now) {
  const s = stats(rows, now, win), level = levels(rows, win, now).backlog, [first, last] = [level[0], level.at(-1)];
  return [
    { k: "Filed", v: count(s.filed), cmp: `${count(s.closed)} closed` },
    { k: "Time to Close", v: dur(s.p50), cmp: s.p50Before == null ? "" : `${dur(s.p50Before)} the ${win} before`, ...(s.p50 == null || s.p50Before == null ? {} : { trend: s.p50 > s.p50Before ? "warn" : "good" }), title: `p50; p90 ${dur(s.p90)}` },
    { k: "Backlog", v: count(last), cmp: `${count(first)} at start`, trend: last < first ? "good" : "warn" },
    { k: "Dropped", v: cardPct(s.closed ? s.dropped / s.closed : null), cmp: `${count(s.dropped)} of ${count(s.closed)}` },
  ];
}

/** The rows in the project of the head's scope. */
const inScope = (rows, project) => (project ? rows.filter((r) => r.project === project) : rows);

function flowView(d, query) {
  const { project, window: win } = scope(query), now = new Date();
  const rows = inScope(issueRows(d), project);
  return figureBand(figures(rows, win, now)) + renderCharts(rows, win, now);
}

const projectsOf = (d) => [...new Set([...(d?.projects ?? []), ...(d?.issues ?? []).map((r) => r.repo)])].sort();

const BODY_TEMPLATE = "## Outcome\n\n\n\n## Oracle\n\n\n\n## Time box\n\n";

/** Each panel draws the frame of the window shown; its form and hidden series are its own. */
function draw(root, d) {
  const { project, window: win } = scope(hashQuery());
  for (const [k, f] of Object.entries(framesOf(inScope(issueRows(d), project), win, new Date()))) {
    const el = root.querySelector(`aleph-chart[key="${chartKey(k)}"]`);
    if (el) el.frame = f;
  }
}

/** Set while a filing POST runs, so a second Enter does not file the issue twice. */
let filing = false;
/** Files the search text as a new issue and opens it; the error shows beside `el`. */
async function fileFromSearch(el, title, repo) {
  if (filing) return;
  filing = true;
  try {
    const data = await postJson("/api/issues", { repo, title, body: BODY_TEMPLATE, labels: [], after: "", media: [] });
    location.hash = `/issues/${encodeURIComponent(repo)}/${data.added}`;
  } catch (err) { say(el, `Could not file it: ${err.message}`); } finally { filing = false; }
}

/** Draws the charts and wires the head's scope. Ctrl+Enter in the search box files the search text. */
export function mount(root, d) {
  scope(hashQuery()).wire(root);
  if (root.querySelector?.(".chartbox")) draw(root, d);
  const list = root.querySelector?.('section[aria-label="Issues"]');
  if (!list) return;
  // A property, not a listener: a redraw keeps `list`, and each mount replaces the last one's handler.
  list.onkeydown = (e) => {
    const title = e.target.value?.trim();
    // Plain Enter stays with the search; Cmd+Enter is the Mac's Ctrl+Enter.
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || e.isComposing || !e.target.matches?.('input[type="search"]') || !title) return;
    fileFromSearch(e.target, title, fileProject(kept("browse.issues", {}).f?.project, projectsOf(d)));
  };
}

/** The Issues page: the List and Flow views. */
export const renderIssues = (d, query = new URLSearchParams()) => pageViews({ title: "Issues", path: "/issues", query, views: [
  { id: "list", label: "List", draw: () => listView(d) },
  { id: "flow", label: "Flow", scope: true, draw: () => flowView(d, query) },
] });

/** The body as the page shows it: the `## Request` heading goes, because the section has its own heading. */
export const description = (body) => String(body ?? "").replace(/^\s*## Request[ \t]*\r?\n+/, "");

/** Each `docs/specs/<file>.md` that this project has becomes a link to its Spec page. */
const linkSpecs = (html, repo, files = []) => html.replace(/docs\/specs\/([\w.-]+\.md)/g, (m, f) => (files.includes(f) ? `<a href="#/specs/${encodeURIComponent(repo)}/${encodeURIComponent(f)}">${m}</a>` : m));

const choose = (name, all, cur) => selectBox(name, name, !cur || all.includes(cur) ? all : [cur, ...all], cur, { attrs: ` ${FORM}` });

const FORM = 'form="issue-edit"';

/** The head of the Issue page: the title and the Edit button, or the title's input and Save and Cancel. */
const issueHead = (d, ref) => pageHead("", {
  after: `<h1>${editable(esc(d.title), inputBox("title", d.title, { attrs: ` class="title-edit" ${FORM} required aria-label="Title"` }))}</h1>`,
  aside: runNowButton(d.repo, ref, d.runNow) + investigateButton(issueKey(d.id), d.investigations) + actButton("Edit", { editor: "start" }, { cls: "view-only" }) +
  `<form id="issue-edit" data-ui="issue-edit" class="edit-only" data-repo="${esc(d.repo)}" data-ref="${esc(ref)}"><span class="act-msg" role="status"></span> ${actButton("Cancel", { editor: "cancel" })} ${actButton("Save", {}, { primary: true, type: "submit" })}</form>` });

/** The form that appends a note. */
/** The file input of the media forms: paste or drop onto its form adds to it too. */
const mediaInput = `<input type="file" name="media" multiple accept="image/png,image/jpeg,image/gif,image/webp,application/pdf">`;

/** The issue's media: each image as a thumbnail that opens the file, each PDF as a link; then the attach form. */
function renderMedia(d, ref) {
  const url = (name) => `${issueApi(d.repo, ref)}/media/${encodeURIComponent(name)}`;
  const items = (d.media ?? []).map((name) => /\.pdf$/i.test(name)
    ? `<li><a class="media-doc" href="${url(name)}" target="_blank" rel="noopener">${esc(name)}</a></li>`
    : `<li><a href="${url(name)}" target="_blank" rel="noopener"><img src="${url(name)}" alt="${esc(name)}" loading="lazy"></a></li>`).join("");
  return (items ? `<ul class="media-grid">${items}</ul>` : "") +
    formOf("issue-media", [field("Attach images or PDFs", mediaInput)], "Attach", ` data-repo="${esc(d.repo)}" data-ref="${esc(ref)}"`);
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

const renderNoteForm = (d, ref) => formOf("issue-note", [field("Add a note", `<textarea name="text" rows="3" required></textarea>`)], "Add note", ` data-repo="${esc(d.repo)}" data-ref="${esc(ref)}"`);

/** A note as an event: a machine note's tag is its prefix, any other note is tagged "note". */
const noteItem = (e) => ({ at: e.at, tag: e.tag ?? "note", tone: "quiet", html: esc(shortText(e.text)) });

/** The filing time: the store's, else the created date unless a job that day starts the issue (midnight would draw a false wait). */
function filedAt(d, runs) {
  const created = Date.parse(d.frontmatter?.created);
  const sameDay = runs.length && new Date(created).toDateString() === new Date(runs[0].start).toDateString();
  return d.timeline?.filed ? Date.parse(d.timeline.filed) : (created >= 0 && !sameDay ? created : runs[0]?.start ?? NaN);
}

const ends = (runs) => (runs.length ? Math.max(...runs.map((x) => x.end)) : NaN);
const kinds = (runs) => [...new Set(runs.map((x) => runWord(x.r.kind)))].join(", ");

/**
 * The Timeline's segments for an issue. With sub-issues: Before the split (the issue's own jobs before its sub-issues start),
 * Sub-issues (one row per sub-issue), After the sub-issues (to the close). Without: one Work row. Notes are events at their time.
 */
export function issueSegments(d, now = Date.now()) {
  const id = `${d.repo}-${d.ref}`, parts = d.parts, open = !CLOSED.includes(d.status);
  const all = spans(d.timeline?.runs ?? [], now), filed = filedAt(d, all);
  const notes = (d.notes ?? []).map(noteEvent).filter(Boolean).map(noteItem);
  // A closed issue closes at its last stamped note after its jobs, else at its last job.
  const last = ends(all), closing = notes.filter((n) => !(n.at < last)).at(-1)?.at;
  const closed = open ? NaN : closing ?? last;
  const marks = [...(Number.isFinite(filed) ? [{ at: filed, tone: "made", tip: "filed" }] : []), ...(Number.isFinite(closed) ? [{ at: closed, tone: "done", tip: d.status }] : [])];
  // The issue's own job, when one has its name, is where its id links.
  const job = (d.jobs ?? []).find((j) => j.name === id);
  const headOf = (text) => `${job ? idLink(shortText(id), jobHref(job.id)) : idLink(shortText(id))}<span class="quiet t" title="${esc(text)}">${esc(text)}</span>`;
  const state = d.derived?.stage ?? d.status;
  // The hold records of a job name: why its waits waited.
  const holdsOf = (name) => (d.holds ?? []).filter((h) => h.name === name);
  if (!parts.length) {
    return [{ title: "Work", rows: [laneRow({ head: headOf(kinds(all) || (open ? "no job yet" : d.status)), runs: all, from: filed, to: open ? (all.some((x) => x.r.state === "running") ? NaN : now) : closed, marks, result: badge(state), events: notes, holds: holdsOf(id) })] }];
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
      return laneRow({ head: `<span>${idLink(shortText(g.id), job ? jobHref(job.id) : g.href)}${p}</span><a class="t" href="${esc(g.href)}" title="${esc(g.title)}">${esc(g.title)}</a>`, runs, from: split, to: runs.length || !open ? NaN : now, result: badge(g.stage), holds: holdsOf(job?.name) });
    }) },
  ];
  const later = notes.filter((n) => n.at >= first);
  if (after.length || later.length || !open) segments.push({ title: "After the Sub-issues", rows: [laneRow({ head: headOf(open ? kinds(after) : d.status), runs: after, from: lastPart, to: open ? NaN : closed, marks: marks.filter((m) => m.tone === "done"), result: badge(state), events: later, holds: holdsOf(id) })] });
  return segments;
}

/** The KPI strip of an issue: sub-issues or stage, elapsed, waiting, cost and commits. */
function issueKpis(d, segments, now = Date.now()) {
  const parts = d.parts, open = !CLOSED.includes(d.status), rows = segments.flatMap((s) => s.rows);
  const times = rows.flatMap((r) => [...r.bars.flatMap((b) => [b.start, b.end]), ...r.waits.flatMap((w) => [w.start, w.end]), ...(r.marks ?? []).map((m) => m.at)]).filter(Number.isFinite);
  const lo = Math.min(...times), hi = open ? now : Math.max(...times);
  // Waiting is the time no job ran, on the whole issue, so a sub-issue waiting beside a running sub-issue does not count.
  const all = spans(d.timeline?.runs ?? [], now), waits = times.length ? gaps(all, lo, hi) : [];
  const waited = waits.reduce((n, w) => n + w.end - w.start, 0), user = waits.filter((w) => w.user).reduce((n, w) => n + w.end - w.start, 0);
  const runs = all.length, cost = all.reduce((n, x) => n + (x.r.cost ?? 0), 0), done = parts.filter((g) => g.stage === "done").length;
  const commits = d.commits ?? [];
  return renderKpis([
    parts.length ? { k: "Sub-issues done", v: esc(`${done} of ${parts.length}`), sub: esc(parts.filter((g) => g.stage !== "done").map((g) => `${shortText(g.id)} ${g.stage}`).join(", ")) }
      : { k: "Stage", v: esc(d.derived?.stage ?? d.status), text: true, sub: open ? esc(d.derived?.why ?? "") : "" },
    { k: open ? "Open for" : "Elapsed", v: times.length ? esc(dur((hi - lo) / 1000)) : miss("No job or note gave a time"), sub: times.length ? esc(fromTo(lo, hi)) : "" },
    { k: "Waiting", v: times.length ? esc(dur(waited / 1000)) : miss("No job or note gave a time"), sub: user ? esc(`${dur(user / 1000)} for the user's answer`) : "" },
    { k: "Cost", v: esc(money(cost)), sub: esc(plural(runs, "job")) },
    { k: "Commits", v: commits.length ? commits.slice(0, 3).map((c) => shaLink(c.hash, c.commitUrl)).join(" ") : miss("No commit on main yet"), text: commits.length > 0, sub: commits.length > 3 ? esc(`${commits.length} on main`) : commits.length ? "on main" : "" },
  ]);
}

/** A chosen ref in the picker: its id, and a button that removes it. */
const refChip = (key, id, title) =>
  `<span class="chip ref-chip" data-key="${esc(key)}" title="${esc(title)}">${esc(shortText(id))} <button type="button" class="ref-x" aria-label="Remove ${esc(shortText(id))}">×</button></span>`;

/** The Refs field of edit mode: the chosen refs, a search over every issue by id and title, and the keys the form sends. */
function refsPicker(d) {
  const refs = d.refs ?? [];
  return `<div class="field ref-field"><span>Refs</span><div class="ref-picker" data-self="${esc(issueKey(d.id))}">` +
    `<input type="hidden" name="refs" ${FORM} value="${esc(refs.map((r) => r.key).join(","))}">` +
    `<span class="ref-chosen">${refs.map((r) => refChip(r.key, r.id, r.title)).join("")}</span>` +
    `<input type="search" class="ref-search" placeholder="id or title" autocomplete="off" role="combobox" aria-label="Find an issue to reference" aria-expanded="false" aria-controls="ref-hits">` +
    `<ul class="ref-hits" id="ref-hits" role="listbox" hidden></ul></div></div>`;
}

/** The issues that fit `q` best, at most `max`, leaving out the keys in `skip`: each `{ key, id, title, status, hits }`. */
export function refHits(rows, q, skip, max = 8) {
  return rows.filter((r) => !skip.has(issueKey(r.n))).flatMap((r) => { const m = fuzzyMatch(q, r); return m ? [{ r, m }] : []; })
    .sort((a, b) => b.m.score - a.m.score).slice(0, max)
    .map(({ r, m }) => ({ key: issueKey(r.n), id: r.id, title: r.title, status: r.status, hits: m.hits }));
}

/** Front-matter keys the page shows elsewhere, or that are the store's own. */
const HIDE = ["labels", "id", "from", "closed_as", "parked", "closed_why", "closed_at", "since", "ask", "reason", "question", "options", "recommended", "why", "plan", "intake", "tracker", "after", "refs", "created", "updated", "title", "headline", "situation", "details", "effects", "recommend", "priority", "source", "areas", "kind"];

/** The Issue page: the header and its pills, the KPI strip, the Timeline, the Description and the Spec, then Notes and Commits. Shared with views/issue.js. */
export function renderIssue(d) {
  const fm = d.frontmatter ?? {};
  const areas = d.labels ?? [], priority = d.priority ?? "medium", source = d.source ?? (d.issue ? "agent" : "user");
  const tracker = fm.tracker === "true";
  const ref = d.ref, inventory = "#/issues", project = [d.repo, `#/issues?project=${encodeURIComponent(d.repo)}`];
  const place = d.issue ? [project, ["issues", inventory], [shortText(d.issue.id), d.issue.href], [ref]] : [project, ["issues", inventory], [ref]];
  // Front matter the page shows nowhere else: a chip each.
  const extra = Object.entries(fm).filter(([k]) => !HIDE.includes(k)).map(([k, v]) => chip(`${k}: ${Array.isArray(v) ? v.join(", ") : v}`)).join("");
  const pills = statusRow(d.derived ? badge(d.derived.stage) : badge(d.status), priorityBadge(priority), `${chip(`kind: ${d.kind ?? "task"}`, { cls: "kind" })}${chip(`source: ${source}`)}${chips([...new Set([...areas, ...(fm.labels ?? [])])])}${extra}${idLink(shortText(`${d.repo}-${ref}`))}`);
  const fields = `<section class="dp-panel dp-prose edit-only" aria-label="Fields"><div class="dp-fields">` +
    field("Priority", choose("priority", HIGH_FIRST, priority)) + field("Source", choose("source", SOURCES, source)) +
    field("Areas", inputBox("areas", areas.join(", "), { attrs: ` ${FORM} aria-label="areas" placeholder="comma separated"` })) + refsPicker(d) + `</div></section>`;
  const blocked = d.blockers?.length ? `<div class="dp-blocked"><span class="quiet">Waits on</span>${blockersHtml(d.blockers, d.repo, d.ref)}</div>` : "";
  // Plain references: they hold nothing, so each row shows the issue's status, not a wait.
  // The picker shows the refs in edit mode, so these lines show only in view mode.
  const linked = (label, rows) => (rows?.length ? `<div class="dp-blocked view-only"><span class="quiet">${label}</span>${blockersHtml(rows.map((r) => ({ ...r, state: r.status })), d.repo, d.ref)}</div>` : "");
  const references = linked("Refs", d.refs) + linked("Referenced by", d.referencedBy);
  const partList = d.parts;
  const part = (id, title, name, text) => (text || !partList.length
    ? panel(id, title, `<div class="md view-only" id="${id}">${linkSpecs(md(text ?? ""), d.repo, d.specs)}</div><textarea class="edit-only body-edit" name="${name}" ${FORM} rows="12" aria-label="${title}">${esc(text ?? "")}</textarea>`, "", text ? "" : " edit-only")
    : "");
  const noteRow = (n) => {
    const e = noteEvent(n), it = e ? noteItem(e) : { tag: n.tag ?? "note", tone: "quiet", html: esc(shortText(n.text)) };
    return eventHtml({ at: e?.at, ...it }, { el: "li", clamped: false });
  };
  const folded = tracker ? [] : d.notes.filter((n) => n.tag), shown = tracker ? d.notes : d.notes.filter((n) => !n.tag);
  const machineNotes = folded.length ? fold(plural(folded.length, "machine note"), `<ul class="notes">${folded.map(noteRow).join("")}</ul>`, { cls: "notes-fold" }) : "";
  const notes = (shown.length ? `<ul class="notes">${shown.map(noteRow).join("")}</ul>` : "") + machineNotes + renderNoteForm(d, ref);
  const parts = d.commits.some((c) => c.part);
  const commits = d.commits.length
    ? pagedTable(heads(["Commit", "Subject", ...(parts ? ["Sub-issue"] : []), "Committed"], ["Committed"]), d.commits.map((c) => {
      return row([`<td>${shaLink(c.hash, c.commitUrl)}</td>`, cell(c.subject, { wide: true }), ...(parts ? [`<td>${c.part ? idLink(shortText(c.part), issueHref(c.part)) : ""}</td>`] : []), `<td class="time">${esc(when(c.date))}</td>`]);
    }))
    : "";
  const segments = issueSegments(d), timeline = renderTimeline(segments);
  // An entry for each panel the view shows: an empty Description or Spec shows only while editing.
  const contents = [timeline && ["h-timeline", "Timeline"], d.request && ["h-request", "Description"], d.spec && ["h-spec", "Spec"], d.investigations?.length && ["h-investigation", "Investigation"],
    ["issue-media", "Media"], ["issue-notes", "Notes"], commits && ["issue-commits", "Commits"]].filter(Boolean);
  return `<div class="page dp-page issue-page editable">${crumb(inventory, place)}` + issueHead(d, ref) + pills + toc(contents, fields + blocked + references + undecided(d.ask ? [d.ask] : [], [`${d.repo}-${ref}`]).map((a) => askCard(a)).join("") +
    issueKpis(d, segments) + timeline +
    part("request", "Description", "request", d.request) + part("spec", "Spec", "spec", d.spec) + investigationPanel(d.investigations, d.repo) +
    `<div class="dp-detail">${detailPanel("Media", esc(count((d.media ?? []).length)), renderMedia(d, ref), "issue-media")}${detailPanel("Notes", esc(count(d.notes.length)), notes, "issue-notes")}${commits && detailPanel("Commits", esc(count(d.commits.length)), commits, "issue-commits")}</div>`) + `</div>`;
}

// Interaction: the shell renders with innerHTML and has no hooks, so the view
// listens on the document. The forms post.
if (typeof document !== "undefined") {
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest && e.target.closest('form[data-ui="issue-edit"], form[data-ui="issue-note"]');
    if (!form) return;
    e.preventDefault();
    const edit = form.dataset.ui === "issue-edit", el = form.elements;
    const body = edit
      ? { title: el.title.value, priority: el.priority.value, source: el.source.value, areas: el.areas.value, description: el.request?.value ?? "", spec: el.spec?.value ?? "", refs: el.refs.value.split(",").filter(Boolean) }
      : { text: el.text.value };
    try {
      await postJson(`${issueApi(form.dataset.repo, form.dataset.ref)}/${edit ? "edit" : "note"}`, body);
      location.reload();
    } catch (err) { say(form.querySelector("button"), `Could not save it: ${err.message}`); }
  });
}

if (typeof document !== "undefined") {
  // The Refs picker: every issue loads once, on the first focus of the search box.
  let refRows = null;
  const pickerOf = (el) => el.closest?.(".ref-picker");
  const chosen = (p) => new Set([p.dataset.self, ...p.querySelectorAll(".ref-chip")].map((c) => (typeof c === "string" ? c : c.dataset.key)));
  const sync = (p) => { p.querySelector('input[name="refs"]').value = [...p.querySelectorAll(".ref-chip")].map((c) => c.dataset.key).join(","); };
  const close = (p) => { const ul = p.querySelector(".ref-hits"); ul.hidden = true; ul.innerHTML = ""; p.querySelector(".ref-search").setAttribute("aria-expanded", "false"); };
  const pick = (p, li) => {
    p.querySelector(".ref-chosen").insertAdjacentHTML("beforeend", refChip(li.dataset.key, li.dataset.id, li.dataset.title));
    sync(p);
    const box = p.querySelector(".ref-search");
    box.value = "";
    close(p);
    box.focus();
  };
  const show = async (p) => {
    const box = p.querySelector(".ref-search"), q = box.value.trim(), ul = p.querySelector(".ref-hits");
    if (!q) return close(p);
    const rows = await (refRows ??= fetch("/api/issues", { cache: "no-store" }).then((r) => r.json()).then(issueRows).catch(() => (refRows = null, [])));
    if (box.value.trim() !== q) return;
    const hits = refHits(rows, q, chosen(p));
    ul.innerHTML = hits.length
      ? hits.map((h, i) => `<li role="option" id="ref-hit-${i}" aria-selected="${i === 0}" data-key="${esc(h.key)}" data-id="${esc(h.id)}" data-title="${esc(h.title)}"><span class="mono">${esc(shortText(h.id))}</span> ${markHits(h.title, h.hits)} ${tag(h.status)}</li>`).join("")
      : `<li class="quiet" aria-disabled="true">No match</li>`;
    ul.hidden = false;
    box.setAttribute("aria-expanded", "true");
  };
  document.addEventListener("focusin", (e) => { if (e.target.matches?.(".ref-search")) refRows ??= fetch("/api/issues", { cache: "no-store" }).then((r) => r.json()).then(issueRows).catch(() => (refRows = null, [])); });
  document.addEventListener("input", (e) => { const p = e.target.matches?.(".ref-search") && pickerOf(e.target); if (p) show(p); });
  document.addEventListener("keydown", (e) => {
    const p = e.target.matches?.(".ref-search") && pickerOf(e.target);
    if (!p) return;
    const opts = [...p.querySelectorAll('.ref-hits li[role="option"]')], at = opts.findIndex((o) => o.getAttribute("aria-selected") === "true");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!opts.length) return;
      const next = (at + (e.key === "ArrowDown" ? 1 : opts.length - 1)) % opts.length;
      opts.forEach((o, i) => o.setAttribute("aria-selected", String(i === next)));
      e.target.setAttribute("aria-activedescendant", opts[next].id);
    } else if (e.key === "Enter") {
      // Enter picks the selected issue; it must not submit the edit form.
      e.preventDefault();
      if (at >= 0) pick(p, opts[at]);
    } else if (e.key === "Escape") close(p);
  });
  // mousedown, not click: the search box's blur would close the list before a click lands.
  document.addEventListener("mousedown", (e) => {
    const li = e.target.closest?.('.ref-hits li[role="option"]');
    if (li) { e.preventDefault(); pick(pickerOf(li), li); }
  });
  document.addEventListener("click", (e) => {
    const x = e.target.closest?.(".ref-x");
    if (!x) return;
    const p = pickerOf(x);
    x.closest(".ref-chip").remove();
    sync(p);
  });
  document.addEventListener("focusout", (e) => { const p = e.target.matches?.(".ref-search") && pickerOf(e.target); if (p) close(p); });

  const MEDIA_FORMS = 'form[data-ui="issue-media"]';
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

const issueView = {
  path: "/issues/:repo/:n",
  title: "Issue",
  group: "factory",
  api: (params) => issueApi(params.repo, params.n),
  render: renderIssue,
  // On the page itself, not the shell's container, which outlives the page.
  mount: (root) => { const page = root.querySelector(".issue-page"); if (page) { wireEdit(page); wireToc(root); } },
};
export const views = [view, issueView];
