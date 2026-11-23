// The Status view: the factory's front page. Each render function takes the /api/factory object, with what `more`
// adds, and returns an HTML string. No DOM, so tests can call them. The page's click handler (router.js) runs the
// buttons `act` makes. The layout is page A of docs/mocks/status-redesign: the work, the event log and Memory in the
// main column; Problems, Efficiency and Flow in the rail.
import { hashQuery, scope, setQuery } from "./lib/address.js";
import { undecided } from "./lib/decisions.js";
import { cardPct, clock, count, dur, hours, pct, plural, when } from "./lib/format.js";
import { actButton, barList, barRow, card, cell, dataTable, empty, error, esc, filterBar, heads, iconHead, idLink, legendHtml, linkButton, loadingLine, meter, pageHead, pager, priorityBadge, repoIdLink, row, searchBox, sectionHead, sideStats, splitCard, subHead, tag, tiles, tone } from "./lib/html.js";
import { factsOf, issueHref, jobHref, NAMES, shortText, shownId } from "../../lib/naming.ts";
import { panelOf } from "./lib/chart.js";
import { bucketOf, flowOf, statusCards, usable, waitingOf } from "./lib/flow-parts.js";
import { actMsg, alertCard, askAlert, itemId } from "./lib/ask-cards.js";
import { laneRow, renderLanes, spans } from "./lib/timeline.js";
import { offered } from "./lib/memory-health.js";
import { verdict } from "../../lib/status-words.ts";
import { get, redraw } from "./lib/router.js";

export const view = {
  path: "/",
  title: "Status",
  group: "factory",
  order: -3,
  icon: "gauge-high",
  api: (_params, q = new URLSearchParams()) => { const s = scope(q); return s.url(`/api/factory?window=${s.window}`); },
  live: true,
  // `more` adds /api/flow for the window with its baseline, the Memory page's data, the runs of the last hour and a page of the event log; the page draws without them first.
  render: (s, _params, q) => { page.state = s; const w = scope(q).window, f = s.flow ?? null; return `<div class="page sp">${renderStatusLine(s, page.stale, w)}${tiles("Scorecard", statusCards(s, f, { memory: s.memory ?? null }), "scorecard")}<div class="rail"><div class="rail-main">${renderMotion(s)}${renderLog(s.log ?? null, q)}${renderMemory(s.memory ?? null, s.now)}</div><div class="stack">${renderProblems(s, page.stale)}${renderEfficiency(f)}${renderFlow(f, s)}</div></div></div>`; },
  more: async (s, q) => { const [flow, memory, jobs, log] = await Promise.all([flowOf(scope(q).window, q, true), memoryOf(q), jobsOf(q), logOf(q)]); return { ...s, flow, memory, jobs, log }; },
  // The shell calls this when the out-of-date verdict changes: the sentence is drawn again from the last state.
  outOfDate: (root, b) => { page.stale = b; const el = root.querySelector(".shead .say"); if (el && page.state) el.outerHTML = renderLede(page.state, b); },
  mount: (root, s, q) => {
    scope(q).wire(root); wireLog(root, s);
    const f = usable(s.flow), m = s.memory && !s.memory.error ? s.memory : null;
    if (f) root.querySelector('aleph-chart[key="status/landed"]').frame = landedFrame(f);
    if (m) root.querySelector('aleph-chart[key="status/offers"]').frame = offersFrame(m, Date.parse(s.now));
  },
};

/** What the page keeps between draws: the last rendered state and the shell's out-of-date verdict. */
const page = { state: null, stale: false };

/** The JSON of `url`, or `{ error }` naming `what` when the load fails. */
async function load(url, what) {
  try {
    const res = await get(url);
    if (!res.ok) throw new Error(`Could not load ${what} (${res.status}).`);
    return await res.json();
  } catch (e) { return { error: e.message }; }
}

/** /api/memory in the project of `q` with /api/memory/processes as `processes`, as the Memory page combines them. */
async function memoryOf(q) {
  const [m, processes] = await Promise.all([load(scope(q).url("/api/memory"), "Memory"), load("/api/memory/processes", "Memory")]);
  return m.error ? m : processes.error ? processes : { ...m, processes };
}

/** The runs of the last hour in the project of `q`: the lanes of the issues that run now. */
const jobsOf = async (q) => { const d = await load(scope(q).url("/api/jobs?window=hour&limit=500"), "the runs"); return d.error ? d : d.jobs; };

/** A page of the event log for the window, kind, search and page of `q`. */
function logOf(q) {
  const s = scope(q), out = new URLSearchParams({ window: s.window });
  for (const k of ["kind", "q", "page"]) if (q.get(k)) out.set(k, q.get(k));
  return load(s.url(`/api/log?${out}`), "the events");
}

// ---- The head ----

/** The page head: the time and the status sentence in the status tone, then the window control with Pause or Resume next to it. It has no title: the head is the factory's status at a glance. */
function renderStatusLine(s, stale = false, w = "day") {
  const bar = scope().bar({ value: w, after: renderControls(s) });
  return pageHead("", { head: "shead", after: `<span class="asof">${esc(when(s.now))}</span>${renderLede(s, stale)}`, aside: bar });
}

/** The status sentence of `verdict`, each part a link to its card but the plain ones. */
export function renderLede(s, stale = false) {
  const v = verdict(s, stale);
  const parts = v.parts.map((p) => (p.href ? `<a href="${p.href}">${esc(p.text)}</a>` : esc(p.text))).join("; ");
  return `<span class="say ${v.tone === "alert" ? "error" : v.tone === "ask" ? "warning" : v.tone}">${esc(v.head)}${parts}.</span>`;
}

/** The Pause or Resume button of the page head. */
export function renderControls(s) {
  return s.factory.paused ? ctl("resume", "Resume") : ctl("pause", "Pause");
}
const ctl = (verb, label) =>
  actButton(label, { act: verb, path: `/api/factory/${verb}`, ...(verb === "pause" ? { confirm: "1" } : {}), label }, { cls: "warn" });

// ---- Issues in Motion ----

/** The lanes of the issues with a live run: each issue's runs of the last hour on one axis from the first of them to now. `jobs` are /api/jobs rows. */
export function lanesOf(jobs, now) {
  const by = Map.groupBy(jobs.filter((j) => j.issue), (j) => `${j.repo} ${j.issue}`);
  const live = [...by.values()].filter((js) => js.some((j) => j.state === "running"));
  const runs = live.map((js) => spans(js.map((j) => ({ ...j, href: jobHref(j.id) })), now));
  const from = Math.min(...runs.flat().map((r) => r.start));
  const rows = runs.sort((a, b) => a[0].start - b[0].start).map((rs) => {
    const { r } = rs[0], title = esc(r.title);
    return laneRow({ head: `<span class="t" title="${title}">${idLink(shownId(r.issue, r.repo), issueHref(r.issue, r.repo))} ${title}</span>`, runs: rs });
  });
  return { rows, from, count: live.length };
}

/** The Issues in Motion card: the lanes, then the issues that wait, by what they wait on. `s.jobs` is null while it loads, or `{ error }`. */
export function renderMotion(s) {
  const box = (body, n) => card("Issues in Motion", body + renderWaiting(s), { count: n, id: "motion" });
  if (!s.jobs) return box(loadingLine("the runs"));
  if (s.jobs.error) return box(error(s.jobs.error));
  const now = Date.parse(s.now), l = lanesOf(s.jobs, now);
  return box(renderLanes(l.rows, l.from, now) || empty(), count(l.count));
}

/** What a hold waits on: the issues an `after` waits for, else the hold's facts. */
const holdOn = (q) => (q.waits?.length ? q.waits.map((w) => (w.href ? idLink(shortText(w.id, q.repo), w.href) : esc(shortText(w.id, q.repo)))).join(" ") : esc(shortText(factsOf(q.ev ?? {}), q.repo)));

/** The Waiting section: one row per hold, its word, what it waits on, its issues and how long the oldest has waited. Nothing when nothing waits. */
export function renderWaiting(s) {
  const waiting = waitingOf(s);
  if (!waiting.length) return "";
  const groups = Map.groupBy(waiting, (q) => `${q.kind} ${holdOn(q)}`);
  const rows = [...groups.values()].map((qs) => {
    const held = qs.map((q) => Date.parse(q.heldAt ?? "")).filter(Number.isFinite);
    const issues = qs.map((q) => { const id = `${q.repo}-${q.id}`; return `${repoIdLink(id, issueHref(id))} ${esc(q.title)}`; }).join(" · ");
    // The cell's text is escaped once already, so the title takes it with the tags cut.
    return row([`<td>${tag(qs[0].kind, "quiet")}</td>`, `<td>${holdOn(qs[0])}</td>`, `<td class="wide" title="${issues.replace(/<[^>]*>/g, "")}">${issues}</td>`, cell(held.length ? dur((Date.parse(s.now) - Math.min(...held)) / 1000) : "–", { num: true })]);
  });
  return sectionHead("Waiting", { count: count(waiting.length), level: 3 }) + dataTable(heads(["Hold", "On", "Issues"]) + iconHead("stopwatch", "Waited"), rows.join(""));
}

// ---- Events ----

/** The kinds the log filters by, as `/api/log` names them. */
const KINDS = [["", "All"], ["problem", "Problems"], ["landed", "Landed"], ["ask", "Asks"], ["hold", "Holds"]];

/** One event of the log: its time, its word, its issue and title, its job, who did it and how long the run took. */
const logRow = (r) => row([`<td class="time lead">${esc(clock(r.at))}</td>`, `<td>${tag(r.action, r.action === "started" ? "run" : tone(r.action))}</td>`, `<td>${r.issue ? idLink(r.issue.id, r.issue.to) : ""}</td>`,
  cell(r.title, { wide: true }), `<td>${r.job ? idLink(r.job.id, r.job.to) : ""}</td>`, cell(r.by), cell(r.took == null ? "" : dur(r.took), { num: true })]);

/** The log's filter, table and pager: the part that a filter, a search or a page turn draws again. `log` is null while it loads, or `{ error }`. */
function logBody(log, q) {
  const bar = filterBar([{ label: "Show", bare: true, name: "kind", value: q.get("kind") ?? "", options: KINDS.map(([value, label]) => ({ value, label })) }]);
  if (!log) return bar + loadingLine("the events");
  if (log.error) return bar + error(log.error);
  if (!log.rows.length) return bar + empty();
  const head = iconHead("clock", "Time", { num: false }) + heads(["Event", "Issue", "Title", "Job", "By"]) + iconHead("stopwatch", "Took");
  return bar + dataTable(head, log.rows.map(logRow).join("")) + pager(Number(q.get("page")) || 1, log.total);
}

/** The Events card: the search, then the log's filter, table and pager. */
export const renderLog = (log, q = new URLSearchParams()) =>
  card("Events", `${searchBox("status-log", q.get("q") ?? "", "Search ids and titles")}<div id="log">${logBody(log, q)}</div>`, { count: log?.total === undefined ? undefined : count(log.total), id: "events" });

/** A filter, a search or a page turn sets the address and loads that page of the log alone; the page then draws again from the state. */
function wireLog(root, s) {
  const card = root.querySelector("#events");
  if (!card || card._wired) return;
  card._wired = true;
  const go = async (changes) => { setQuery(changes); s.log = await logOf(hashQuery()); redraw(); };
  let typing;
  card.addEventListener("click", (e) => {
    const k = e.target.closest?.(".seg button"), p = e.target.closest?.(".pager button[data-page]");
    if (k) go({ kind: k.dataset.value, page: "" });
    if (p) go({ page: p.dataset.page });
  });
  card.addEventListener("input", (e) => {
    if (!e.target.matches?.('input[type="search"]')) return;
    clearTimeout(typing);
    typing = setTimeout(() => go({ q: e.target.value.trim(), page: "" }), 200);
  });
}

// ---- Memory ----

/** The offers of recall per day over the last 7 days, from each note's 30 days of history. */
export const offersFrame = (m, now) => {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const rows = Array.from({ length: 7 }, (_, i) => ({ at: new Date(day.getTime() - (6 - i) * 86_400_000).toISOString(), offers: m.notes.reduce((n, x) => n + (x.history?.[29 - (6 - i)] ?? 0), 0) }));
  return { measure: { name: "Offers", unit: "count", agg: "sum" }, over: { kind: "time", window: "week" }, by: { name: "Kind", keys: [{ key: "offers", name: "Offers", color: "muted" }] }, rows, form: "columns", legend: false };
};

/** The Memory card at `now`: the start context against its budget and the offers per day; the six counts of the Memory page on the side. `m` is null while it loads, or `{ error }`. */
export function renderMemory(m, now) {
  if (!m) return card("Memory", loadingLine("the memory"), { id: "memory" });
  if (m.error) return card("Memory", error(m.error), { id: "memory" });
  const start = barList(Object.entries(m.start).map(([k, s]) => barRow(`${esc(k)} <span class="count">${count(s.core.length)} lines</span>`, (s.bytes / s.budget) * 100, `${count(s.bytes)} / ${count(s.budget)} B`, { top: s.bytes / s.budget >= FULL })).join(""));
  const stale = m.processes.decay.stale, late = stale.filter((x) => x.over > 30).length;
  const stats = sideStats([
    { k: "Notes", v: count(m.total) },
    { k: "Offered", v: count(m.notes.filter((n) => offered(n, Date.parse(now))).length), title: "Notes that recall offered to an agent in 7 days" },
    { k: "Never offered", v: count(m.notes.filter((n) => !n.read).length), title: "Notes that recall never offered" },
    { k: "Unoffered reads", v: count(m.misses?.unoffered_reads), title: "Wiki reads in 7 days that no offer preceded" },
    { k: "Refused", v: count(m.lint.refuse.length), state: m.lint.refuse.length ? "failed" : "", title: "Notes that lint refuses" },
    { k: "Stale", v: count(stale.length), note: `${count(late)} late`, title: `${count(stale.length)} notes past their re-check date, ${count(late)} by more than 30 days` },
  ]);
  return splitCard("Memory", `${subHead("Start Context")}${start}${subHead("Offers per Day")}${panelOf("status/offers", offersFrame(m, Date.parse(now)), "", { bare: true })}`, stats, { id: "memory" });
}
/** The share of the start budget at which the start context counts as full, as `/api/attention` counts it. */
const FULL = 0.95;

// ---- Problems ----

/** A job's ID linked to its page; a job with no ID links its item. */
const jobLink = (j) => (j.id ? idLink(shownId(j.id), jobHref(j.id)) : itemId(j));

/** One plain sentence of what went wrong for an errored job, from its cause; a time box or a stall takes its length from `limit`, in seconds. */
const errorSentence = (j) => {
  const span = j.limit ? (j.limit % 60 === 0 ? [j.limit / 60, "minute"] : [j.limit, "second"]) : null;
  const check = j.checkName ? `The check ${j.checkName}` : "A check";
  return {
    timeout: `The worker ran past its ${span ? `${span[0]}-${span[1]} ` : ""}time box and was stopped.`,
    stalled: `The worker gave no output${span ? ` for ${span[0]} ${span[1]}s` : ""} and was stopped.`,
    check: `${check} failed.`,
    infra: j.checkName ? `${check} gave no verdict.` : "A factory step failed outside the work.",
    "no-commit": "The worker made no commit.",
    locked: "Another run held the job's lock.",
    credit: "The API account ran out of credit.",
    conflict: "The branch has a merge conflict with main.",
    moved: "Main moved during the land.",
    review: "The reviewer held the change.",
    unanswered: "The agent ended without an answer.",
  }[j.cause] ?? (j.state === "failed" ? "The run failed." : "The run stopped.");
};

/** An errored job as an alert: what stopped it, and Wait for its blocker or Re-check, then Drop. */
function errorAlert(j, now) {
  const b = j.blocker, blocker = b && shortText(b.id, j.repo), path = (verb) => `/api/jobs/${encodeURIComponent(j.id)}/${verb}`;
  const first = b ? actButton(`Wait for ${blocker}`, { act: "wait", name: j.name, path: path("wait"), body: JSON.stringify({ on: b.id }), label: `Wait for ${blocker}` }, { primary: true, kind: "small" })
    : actButton("Re-check", { act: "recheck", name: j.name, path: path("recheck"), label: "Re-check" }, { kind: "small" });
  const drop = actButton("Drop", { act: "drop", name: j.name, path: path("drop"), confirm: "1", label: "Drop" }, { kind: "small" });
  return alertCard({ card: "unstick", kind: "Error", title: `${jobLink(j)} ${esc(j.item?.title || j.name)}${j.item?.priority ? ` ${priorityBadge(j.item.priority)}` : ""}`, detail: b ? `Waits on ${blocker}: ${b.title}` : errorSentence(j), tag: j.cause ?? j.state, side: dur((Date.parse(now) - Date.parse(j.run?.started ?? j.started)) / 1000), acts: first + drop + actMsg(j.name) });
}

/** The backend hold as an alert, with the backend's own link when its error names one. */
function backendAlert(b) {
  const link = b.why.match(/https?:\/\/\S+/)?.[0];
  return alertCard({ card: "unstick", kind: "Backend", title: `${esc(b.via)} is down`, detail: b.why, acts: link ? linkButton("Credits", link) : "" });
}

/** A start context at FULL of its budget as an alert. */
function memoryAlert(m) {
  const s = m.start.aleph;
  return alertCard({ card: "need", kind: "Memory", title: "Start context near its budget", detail: `${count(s.budget - s.bytes)} B left in aleph`, tag: `${count(s.core.length)} lines`, side: pct((s.bytes / s.budget) * 100), acts: linkButton("Memory", "#/memory?view=health") });
}

/** The Problems card: each thing that needs the user as a compact alert. The factory's alerts, the Asks, the errored jobs, a backend that is down and a full start context. */
export function renderProblems(s, stale = false) {
  const m = s.memory && !s.memory.error ? s.memory : null;
  const alerts = [
    ...verdict(s, stale).errors.map((l) => alertCard({ card: "unstick", kind: "Alert", title: esc(l.text) })),
    ...undecided(s.asks).map((i) => askAlert(i, s.now)),
    ...(s.errored ?? []).map((j) => errorAlert(j, s.now)),
    ...(s.factory.backend ? [backendAlert(s.factory.backend)] : []),
    ...(m && m.start.aleph.bytes >= FULL * m.start.aleph.budget ? [memoryAlert(m)] : []),
  ];
  return card("Problems", alerts.length ? `<div class="alerts">${alerts.join("")}</div>` : empty(), { count: count(alerts.length), id: "problems" });
}

// ---- Efficiency and Flow ----

/** The stages the Failed Runs and Time by Phase rows name. */
const STAGES = ["intake", "build", "review", "recheck", "land"];

/** The lost hours of the window by cause, over every lost class, largest first; the causes past the first four fold into Other. */
function lostCauses(d) {
  const by = new Map();
  for (const c of d.classes.filter((x) => x.lost)) for (const k of c.causes) by.set(k.name, (by.get(k.name) ?? 0) + k.hours);
  const all = [...by].sort((a, b) => b[1] - a[1]), rest = all.slice(4).reduce((n, [, h]) => n + h, 0);
  return rest > 0 ? [...all.slice(0, 4), ["Other", rest]] : all;
}

/** Rows of `[label, value, shown]` as a bar list on the scale of the largest; empty() with none. */
const bars = (rows) => {
  const most = Math.max(...rows.map((r) => r[1]));
  return rows.length ? barList(rows.map(([label, v, shown], i) => barRow(label, (v / most) * 100, shown, { top: i === 0 })).join("")) : empty();
};

/** The Efficiency card: the agent hours of the window by outcome on one bar, then the lost hours by cause and the failed runs by stage. `d` is /api/flow, null while it loads, or `{ error }`. */
export function renderEfficiency(d) {
  if (!d) return card("Efficiency", loadingLine("the efficiency"), { id: "efficiency" });
  if (d.error) return card("Efficiency", error(d.error), { id: "efficiency" });
  const f = d.figures, classes = d.classes.filter((c) => c.hours > 0), all = f.kept + f.hours;
  const bar = meter(classes.map((c) => ({ pct: (c.hours / all) * 100, cls: `seg-${c.key}` })), classes.map((c) => `${c.key} ${hours(c.hours)}`).join(", "));
  const legend = legendHtml(classes.map((c) => [`${c.key} ${hours(c.hours)}`, `seg-${c.key}`]));
  const lost = bars(lostCauses(d).map(([name, h]) => [esc(name), h, hours(h)]));
  // The bar is the count of failed runs: Recheck's 9 of 13 is not a rate to read alone.
  const failed = bars(d.stages.rows.filter((r) => STAGES.includes(r.stage) && r.unusable > 0).sort((a, b) => b.unusable - a.unusable).map((r) => [esc(NAMES[r.stage]), r.unusable, `${count(r.unusable)} of ${count(r.runs)}`]));
  return card("Efficiency", `${bar}${legend}${subHead("Lost Time by Cause")}${lost}${subHead("Failed Runs by Stage")}${failed}`, { aside: `${hours(f.kept)} of ${hours(all)} reached main`, id: "efficiency" });
}

/** The issues landed in each bucket of the window: each landed issue at its filing plus its lead time. */
export const landedFrame = (d) => {
  const starts = d.buckets.map((b) => Date.parse(b.at)), ends = d.times.filter((t) => t.outcome === "landed").map((t) => Date.parse(t.filed) + t.lead * 1000);
  const rows = starts.map((at, i) => ({ at: d.buckets[i].at, landed: ends.filter((t) => t >= at && t < (starts[i + 1] ?? Infinity)).length }));
  return { measure: { name: "Landed", unit: "count", agg: "sum" }, over: { kind: "time", window: d.window }, by: { name: "Outcome", keys: [{ key: "landed", name: "Landed", color: "done" }] }, rows, form: "columns", legend: false };
};

/** The phase of a live run: a review and a recheck run inside Implement, as /api/flow counts them. */
const phaseOf = (kind) => (kind === "intake" || kind === "land" ? kind : "implement");

/** The Flow card: the window's issues in and out, each phase's p90 with the issues in it now, and the issues landed per bucket. `d` is /api/flow, null while it loads, or `{ error }`. */
export function renderFlow(d, s) {
  if (!d) return card("Flow", loadingLine("the flow"), { id: "flow" });
  if (d.error) return card("Flow", error(d.error), { id: "flow" });
  const f = d.figures, now = { intake: 0, queue: waitingOf(s).length, implement: 0, land: 0 };
  for (const j of s.running) now[phaseOf(j.run.kind)]++;
  const keys = Object.keys(now), slow = Math.max(...keys.map((k) => d.phases[k].p90 ?? 0));
  const phases = barList(keys.map((k) => barRow(`${esc(NAMES[k === "implement" ? "build" : k])} <span class="count">${count(now[k])}</span>`, slow ? ((d.phases[k].p90 ?? 0) / slow) * 100 : 0, d.phases[k].count ? dur(d.phases[k].p90) : "–", { top: d.phases[k].p90 === slow })).join(""));
  const stats = sideStats([
    { k: "Filed", v: count(f.filed) }, { k: "Landed", v: count(f.landed), state: "landed" }, { k: "Dropped", v: count(f.dropped) },
    { k: "First Pass", v: cardPct(d.issues.firstPass), title: "Landed issues whose first run landed" },
    { k: "Open", v: count(d.open.open), note: d.open.parked ? `+${count(d.open.parked)}` : "", title: `${plural(d.open.open, "open issue")}, ${plural(d.open.parked, "parked issue")}` },
    { k: "Asks", v: count(d.asks.count), note: `${count(d.asks.manual)} yours`, title: `${count(d.asks.count)} Asks in the window, ${count(d.asks.manual)} answered by the user` },
  ]);
  const landed = landedFrame(d);
  return card("Flow", `${stats}${subHead("Time by Phase, p90")}${phases}${subHead(`Landed per ${bucketOf(d)[0].toUpperCase()}${bucketOf(d).slice(1)}`)}${panelOf("status/landed", landed, "", { bare: true })}`, { id: "flow", cls: "flow" });
}

