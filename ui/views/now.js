// The Now view: the factory's front page. Each render function takes the
// /api/state object and returns an HTML string. No DOM, so tests can call them.
// The page's click handler (index.html) runs the buttons `act` makes.
import { barList, blockersHtml, denyReasons, diffHtml, dur, elapsed, costHtml, esc, filterBar, hashQuery, idLink, keepWindow, pageHead, WINDOW_DAYS, WINDOWS, windowOf, wireScope, localId, openDiffs, priorityBadge, repoIdLink, repoOf, shortModel, small, tile, when } from "../lib.js";
import { causeRow, loadSpeed, mergeCauses, pctText, period, speedOf, statusCards, usable } from "./speed.js";
import { oneSentence } from "../decision.js";
import { act, actMsg, checkFacts, fact, itemId, shell as jobCard, trailerLine } from "./cards.js";

export const view = {
  path: "/",
  title: "Status",
  group: "work",
  order: 0,
  icon: "gauge-high",
  api: "/api/state",
  refresh: 60,
  live: true,
  render: (s, _params, q) => { lastState = s; const w = windowOf(q); return `<div class="page sp">${renderStatusLine(s, outOfDateNow, w)}${renderNeeds(s)}<section id="scorecard" aria-label="Scorecard" class="tiles">${renderTiles(s, usable(w), w)}</section>${renderLanes(s)}<section id="causes" class="card" aria-label="Causes of lost time">${renderCauses(speedOf(w), w)}</section>${renderMonitor(s)}</div>`; },
  // The shell calls this when the out-of-date verdict changes: the sentence is drawn again from the last state.
  outOfDate: (root, b) => { outOfDateNow = b; const el = root.querySelector(".shead .say"); if (el && lastState) el.outerHTML = renderLede(lastState, b); },
  mount: (root, s, q) => mountStatus(root, s, fetch, q),
};

let lastState = null, outOfDateNow = false;

const EFFICIENCY = "#/factory/efficiency", PERFORMANCE = "#/factory/jobs";
/** A link to another page that keeps the window; week is the default and stays out of the address. */
const keep = (href, win) => (win === "week" ? href : `${href}?window=${win}`);

/** The scorecard: lost time, completion, landed, queue wait, usage. `d` is /api/speed for the window `win` with its baseline, or null while it loads. */
export function renderTiles(s, d, win = d?.window ?? "week") {
  return statusCards(s, d, { efficiency: keep(EFFICIENCY, win), performance: keep(PERFORMANCE, win) });
}

/** The ranked causes of lost time, largest first. `d` is null while it loads, `{ error }` on a failed load. */
export function renderCauses(d, win = d?.window ?? "week") {
  const title = `<h2>Causes of lost time, largest first</h2>`;
  if (!d) return `${title}<p role="status">Loading\u2026</p>`;
  if (d.error) return `${title}<p>${esc(d.error)}</p>`;
  const cs = mergeCauses(d);
  if (!cs.length) return `${title}<p>No agent time was lost in the last ${period({ window: win })}.</p>`;
  const sum = cs.reduce((a, x) => a + x.hours, 0), first = cs[0];
  return `${title}<p>The first cause is ${pctText(first.hours / sum)} of the loss: ${esc(first.name)}, ${first.runs} ${first.runs === 1 ? "run" : "runs"}.</p>${barList(cs.map((x, i) => causeRow(`<a href="${keep(EFFICIENCY, win)}">${esc(x.name)}</a>`, x, first.hours, i === 0)).join(""))}`;
}

/**
 * The monitor's newest daily report: the share of acceptance failures that led to a real fix, the reader's findings
 * in rank order, and the whole table behind a fold. Nothing before the first report.
 */
export function renderMonitor(s) {
  const m = s.factory?.monitor;
  if (!m) return "";
  const said = m.error ? `<p class="quiet">No reading: ${esc(m.error)}</p>`
    : m.findings.length ? `<ol class="findings">${m.findings.map((f) => `<li>${esc(f)}</li>`).join("")}</ol>`
    : `<p class="quiet">Nothing looks off.</p>`;
  return `<section id="monitor" class="card" aria-labelledby="h-monitor"><h2 id="h-monitor">Monitor, ${esc(m.day)}</h2><p>${esc(m.headline)}</p>${said}` +
    `<details class="more" data-keep="more:monitor"><summary>Table</summary><pre class="monitor-table">${esc(m.table)}</pre></details></section>`;
}

/** Fetch the window with its baseline in one request, then fill the scorecard and the causes. */
export async function mountStatus(root, s, fetcher = fetch, q) {
  const w = windowOf(q ?? (typeof location === "undefined" ? undefined : hashQuery()));
  keepWindow(w);
  wireScope(root);
  await loadSpeed(w, fetcher, true);
  const tiles = root.querySelector("#scorecard"), causes = root.querySelector("#causes");
  if (tiles) tiles.innerHTML = renderTiles(s, usable(w), w);
  if (causes) causes.innerHTML = renderCauses(speedOf(w), w);
}

/** The count of a section: `N / cap` where a cap applies. */
const section = (id, title, n, body, cap) =>
  `<div class="sh"><h2 id="h-${id}">${esc(title)}</h2>${n === null ? "" : `<span class="count">${n}${cap > 0 ? ` of ${cap}` : ""}</span>`}</div>${body}`;

/** An empty section on this page: one quiet line. */
const empty = (line) => `<div class="empty"><p class="hint">${esc(line)}</p></div>`;
const BOX_MIN = 40;
const STAT_FILES = 12;

/** The first STAT_FILES file lines of a diff stat, then "+N more files" and the summary line. */
function statLines(stat) {
  const all = stat.replace(/\n+$/, "").split("\n");
  const files = all.filter((l) => l.includes(" | "));
  if (files.length <= STAT_FILES) return esc(stat);
  const shown = new Set(files.slice(0, STAT_FILES));
  const kept = all.filter((l) => !l.includes(" | ") || shown.has(l));
  const summary = kept.filter((l) => !l.includes(" | "));
  return esc(kept.filter((l) => l.includes(" | ")).join("\n")) + `\n<b>+${files.length - STAT_FILES} more files</b>` + (summary.length ? "\n" + esc(summary.join("\n")) : "");
}

/** The Running lane's rows: planner, land and agent runs. The flow card counts only the live agent runs, as the cap does. */
const runningCount = (s) => (s.runningIssues ?? []).length + (s.running ?? []).length;

/** The page head: the time and the status sentence in place of a title, then the window control with Pause or Resume next to it. */
export function renderStatusLine(s, stale = false, w = "day") {
  const bar = filterBar([{ name: "window", value: w, options: WINDOWS }]).replace(/<\/div><\/div>$/, `${renderControls(s)}</div></div>`);
  return `<header class="ph shead"><span class="asof">${renderAsOf(s)}</span>${renderLede(s, stale)}<div class="aside">${bar}</div></header>`;
}

export const FINE = "Everything is running smoothly";
const JOBS_UNHEALTHY = "jobs are unhealthy";
const MAX_SAID = 3;
/** The weekly usage, in percent, from which the status sentence says how high it is. The raw value is compared, so 89.6 is not yet. */
const WEEKLY_WARN = 90;

/** Health lines that are counts for later, not problems: they stay off the headline and the cards. */
const QUIET_HEALTH = /passed on rerun|holds \d+ flake notes?|most flaked in acceptance/;
/** Health lines that are warnings, not alerts: the status sentence says them in the warning colour, and they make no card. */
const WARN_HEALTH = /full suite took|nightly acceptance run failed/;

/** What the status sentence says for an error line, most serious first. A line with no entry is said as it is, after these. */
const ALERTS = [
  [/ CI on main has failed/, "GitHub CI is broken"],
  [/main is red/, "the build is failing on main"],
  [/sandbox probe/, "the sandbox is broken"],
  [/the factory tick has stopped/, "the factory tick has stopped"],
  // No line says this one: a stuck job adds it. It is here for its rank.
  [/(?!)/, JOBS_UNHEALTHY],
  [/did not land|land run of/, "lands are stuck"],
  [/can start, but no run started/, "queued jobs are not starting"],
  [/did not move to jobs/, "new issues are not becoming jobs"],
];
const alertRank = (t) => { const k = ALERTS.findIndex(([, said]) => said === t); return k < 0 ? ALERTS.length : k; };

/** The status sentence: "Alert: " and what is wrong, or the fine sentence, then what asks for you and a weekly usage of WEEKLY_WARN or more and the warning health lines; at most MAX_SAID parts, each a link but the usage and warning parts, which are plain text. The Awaiting-you cards list everything. Notices (a check that passed on rerun) are not shown here; `aleph report` has the health line. */
export function renderLede(s, stale = false) {
  const f = s.factory;
  const alerts = new Set(errorLines(s).map((l) => ALERTS.find(([re]) => re.test(l))?.[1] ?? l.replace(/\.$/, "")));
  if (s.stuck.length) alerts.add(JOBS_UNHEALTHY);
  const said = [...alerts].sort((a, b) => alertRank(a) - alertRank(b)).map((t) => [t, t === JOBS_UNHEALTHY && s.stuck.length ? "#jobs-stuck" : "#awaiting"]);
  // An Ask still with the director does not need Chris yet.
  const asks = (s.asks ?? []).filter((a) => a.escalated !== false);
  if (asks.length) said.push(["your attention is needed", "#awaiting"]);
  const alert = alerts.size > 0;
  if (f.paused && alert) said.push(["the factory is paused", ""]);
  const week = s.usage?.now?.seven_day;
  if (week >= WEEKLY_WARN) said.push([`weekly usage is at ${Math.round(week)}%`, ""]);
  for (const l of f.health || []) if (WARN_HEALTH.test(l)) said.push([l.replace(/^health:\s*/, ""), ""]);
  const parts = said.slice(0, MAX_SAID).map(([t, href]) => (href ? `<a href="${href}">${esc(t)}</a>` : esc(t))).join("; ");
  if (stale) return `<span class="say error">Alert: this status is out of date${parts ? `; ${parts}` : ""}.</span>`;
  if (alert) return `<span class="say error">Alert: ${parts}.</span>`;
  const lead = f.paused ? "The factory is paused" : FINE;
  return `<span class="say ${parts || f.paused ? "warning" : "fine"}">${lead}${parts ? `; ${parts}` : ""}.</span>`;
}

const list = (html) => `<div class="list">${html}</div>`;
const cards = (html, cls = "") => `<div class="cards${cls ? " " + cls : ""}">${html}</div>`;

/** The one folded "Details" of an Issues row; `key` keeps it open across refreshes. */
const more = (key, body) => `<details class="more" data-keep="more:${esc(key)}"><summary>Details</summary><div class="body">${body}</div></details>`;

/** The details of a held or stuck job: everything the row's one sentence leaves out. */
function details(s, j, extra = "") {
  const parts = extra + (j.question ? `<p class="quiet q">${esc(j.question)}</p>` : "") +
    `<dl class="facts">${fact("Started", esc(when(j.started, new Date(s.now))))}${j.phase ? fact("Phase", esc(j.phase)) : ""}${j.cost !== undefined ? fact("Cost", costHtml(j.cost, j.wk)) : ""}${j.model ? fact("Model", esc(shortModel(j.model))) : ""}${checkFacts(j)}</dl>` +
    (failed(j) ? `<p class="quiet q">Last check that failed: <b>${esc(failed(j).name)}</b>, ${esc(failed(j).seconds)} s</p>` : "") +
    (j.stat ? `<div class="ev one"><div><h4>Diff</h4><pre class="stat">${statLines(j.stat)}</pre></div></div>` : "") +
    trailerLine(j, s.now) +
    (j.defaults.length ? `<h4>Defaults taken</h4><ul>${j.defaults.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "") +
    (j.followups.length ? `<h4>Follow-ups</h4><ul>${j.followups.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "");
  return more(j.name, parts);
}

const failed = (j) => (j.checks || []).findLast((c) => !c.ok);

const STATUS_TONE = { awaiting: "need", stuck: "stuck", working: "run", landing: "run", planning: "run", queued: "run", blocked: "quiet", triaged: "quiet", new: "quiet", landed: "done", done: "done" };
const statusBadge = (st) => `<span class="badge ${STATUS_TONE[st] ?? "quiet"}">${esc(st)}</span>`;

/** "11/02 10:36": the date of a card, in the reader's time; "–" for none. */
export function stamp(ts) {
  const d = new Date(ts);
  if (!ts || Number.isNaN(d.getTime())) return "–";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "4m", "1h05m", "2d4h": the time from `since` to `to`, in the least room; "–" when the work was never picked up. */
export function span(since, to) {
  const ms = Date.parse(to) - Date.parse(since);
  if (!since || !(ms >= 0)) return "–";
  const m = Math.floor(ms / 60_000), h = Math.floor(m / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d${h % 24}h`;
  return h ? `${h}h${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

/** The "3/4" link of a part to its parent; "" for a card that is no part. */
const partLink = (p) => (p ? `<a class="part" href="${esc(p.href)}" title="Part ${p.n} of ${p.m} of ${esc(p.parent)}">${p.n}/${p.m}</a>` : "");

/** The meta row, line 1 of every card: id, status chip, priority chip, "n/m", date, duration, then why it waits (it gives up space first; its tooltip holds the whole text). `chips` is HTML. */
function metaRow({ id, chips, part, at, since, now, end, why }) {
  return `<div class="ih">${id}${chips}${partLink(part)}<span class="num date">${esc(stamp(at))}</span><span class="num dur">${esc(span(since, end ?? now))}</span>${why ? `<span class="why" title="${esc(why)}">${esc(why)}</span>` : ""}</div>`;
}

/** The title of a card: at most 2 lines, an ellipsis after that. */
const titleOf = (title, href) => (href ? `<a href="${esc(href)}" class="t" title="${esc(title)}">${esc(title)}</a>` : `<span class="t" title="${esc(title)}">${esc(title)}</span>`);

/** An item card of a lane: the 3-line face (the meta row, then the title on 2 lines); `below` is HTML after the face. */
function laneCard(cls, row, title, href, below = "") {
  return `<article class="job-card small lane-card ${cls}">${row}${titleOf(title, href)}${below}</article>`;
}

/** A lane: header with the count, its cards or one quiet line. */
const lane = (id, title, n, rows, none, cap = 0) =>
  `<section id="lane-${id}" class="lane" aria-labelledby="h-${id}">${section(id, title, n, rows ? cards(rows, "one") : empty(none), cap)}</section>`;

const LATEST_DONE = 2;
/** Latest done: the last done parts and issues, newest first, each its own card. */
function doneLane(s) {
  const rows = (s.done ?? []).slice(0, LATEST_DONE).map((i) =>
    laneCard("done-row", metaRow({ id: repoIdLink(i.id, i.href), chips: statusBadge("done") + priorityBadge(i.priority), part: i.part, at: i.finished, since: i.since, now: s.now, end: i.finished }), i.title, i.href)).join("");
  return lane("done", "Latest done", null, rows, "Nothing is done yet.");
}

function queuedLane(s) {
  const rows = (s.queued ?? []).map((w) => {
    const dead = (w.waits ?? []).filter((b) => b.dead);
    const id = repoIdLink(`${w.repo}-${w.id}`, `#/issues/${encodeURIComponent(w.repo)}/${encodeURIComponent(w.id)}`, w.repo);
    return laneCard("queued-row", metaRow({ id, chips: statusBadge(w.stage ?? "queued") + priorityBadge(w.priority), part: w.part, at: w.at, since: w.since, now: s.now, why: w.why }), w.title, "",
      dead.length ? `<div class="blockers">${blockersHtml(dead, w.repo, w.id)}</div>` : "");
  }).join("");
  return lane("queued", "Queued", (s.queued ?? []).length, rows, "Nothing is queued.");
}

/** A parent that waits to close: all its parts are done. */
function runningIssue(i, now) {
  return laneCard("run-row issue-run", metaRow({ id: repoIdLink(i.id, i.href), chips: statusBadge(i.stage) + priorityBadge(i.priority), at: i.at, since: i.since, now, why: `${i.of.n} of ${i.of.m} parts done; waits to close` }), i.title, i.href);
}

function runningLane(s) {
  const issues = (s.runningIssues ?? []).map((i) => runningIssue(i, s.now)).join("");
  const rows = issues + (s.running ?? []).map((j) => {
    const run = j.run ?? { kind: "build", started: j.started };
    const worker = run.kind === "agent" || run.kind === "build";
    const kind = worker ? "worker" : run.kind === "plan" ? "planner" : run.kind;
    const over = worker && Date.parse(s.now) - Date.parse(run.started) > BOX_MIN * 60_000;
    return laneCard("run-row", metaRow({ id: itemId(j), chips: `<span class="badge run" title="${esc(j.phase || kind)}">${esc(kind)}</span>` + priorityBadge(j.item?.priority), part: j.part, at: run.started, since: j.started, now: s.now, why: over ? "past the time box" : "" }), j.item?.title || j.name, jobHref(j));
  }).join("");
  return lane("running", "Running", s.factory.liveRuns ?? runningCount(s), rows, "Nothing is running.", s.factory.liveCap ?? 0);
}

/** The three lanes: Running, Queued, Latest done. */
export function renderLanes(s) {
  return `<div class="lanes">${runningLane(s)}${queuedLane(s)}${doneLane(s)}</div>`;
}

/** Awaiting you: the asks, each marked input or approval, then the stuck and failed jobs; absent when nothing awaits Chris. */
export function renderNeeds(s) {
  const asks = (s.asks ?? []).map((i) => askRow(i, s.now)).concat(errorLines(s).map(errorRow));
  if (!asks.length && !s.stuck.length) return "";
  const group = (id, t, n, html, wrap) => (n ? `<div class="grp" id="${id}"><h3>${esc(t)}<span class="count">${n}</span></h3>${wrap(html)}</div>` : "");
  return `<section id="needs" class="needs" aria-labelledby="h-needs"><div class="sh"><h2 id="h-needs">Awaiting you</h2><span class="count">${asks.length + s.stuck.length}</span></div>` +
    group("awaiting", "Awaiting you", asks.length, asks.join(""), list) + group("jobs-stuck", "Stuck or failed", s.stuck.length, s.stuck.map(stuckRow(s)).join(""), cards) + `</section>`;
}

/** How long past due a next tick may be before the tick counts as dead: covers an old state and a late timer. */
const TICK_GRACE_MS = 5 * 60_000;

/** Lines of the factory's own trouble that are errors: health (a red main among them), a failed probe, a stopped tick; each once. */
function errorLines(s) {
  const f = s.factory;
  const out = (f.health || []).map((l) => l.replace(/^health:\s*/, "")).filter((l) => !QUIET_HEALTH.test(l) && !WARN_HEALTH.test(l));
  if (f.probe && !f.probe.ok && !(f.health || []).some((l) => /probe/.test(l))) out.push(`the sandbox probe at ${f.probe.at} failed: ${(f.probe.failed || []).join("; ")}`);
  if (f.nextTick !== undefined && f.tickInProgress !== true) {
    if (f.nextTick === null) out.push("the factory tick has stopped: aleph-tick.timer has no next run");
    else if (Date.parse(s.now) - Date.parse(f.nextTick) > TICK_GRACE_MS) out.push(`the factory tick has stopped: aleph-tick.timer was due at ${f.nextTick}`);
  }
  return [...new Set(out)];
}

/** The agent line of a held or stuck job: a live run exists for it. */
const agentLine = (j) => (j?.agent ? `<span class="agent">Agent working</span>` : "");
/** One Jobs card in the compact size: the id, the title, one sentence of why, the buttons; `fold` is the one Details behind it. */
/** The one Details behind a stuck row: the whole reason, then the job's details. */
const fold = (s, j) => details(s, j, j.reason ? `<p class="quiet q">${esc(j.reason)}</p>` : "");

/** The fold under a card's 3 lines: closed by default, kept open across a re-render by its data-keep key. */
const choiceFold = (key, body) => `<details class="cfold" data-keep="fold:${esc(key)}"><summary>Choices</summary><div class="body">${body}</div></details>`;

const jobHref = (j) => `#/jobs/${encodeURIComponent(j.name)}`;
const stuckRow = (s) => (j) => {
  const b = j.blocker;
  const blocker = b && localId(b.id, j.repo);
  const why = b ? `Waits on ${blocker}: ${b.title}.` : `${j.condition === "failed" ? "Failed" : "Stuck"}${j.reason ? ` with ${oneSentence(j.reason).replace(/\.$/, "")}` : ""}.`;
  const first = b ? act("wait", j.name, `Wait for ${blocker}`, true).replace('data-label=', `data-on="${esc(b.id)}" data-label=`) : act("recheck", j.name, "Re-check");
  return `<article class="job-card small issue-row stuck" data-kind="stuck">${needHead("stuck", j.name, jobHref(j), j.item?.title || "", why, j.repo, undefined, j.item?.priority, { at: j.run?.started ?? j.started, since: j.started, now: s.now, part: j.part })}` +
    choiceFold(j.name, agentLine(j) + `<div class="actions choices">${choice(first, b ? `Makes the issue run after ${blocker} and drops the stuck job; nothing starts until ${blocker} lands.` : "Runs the job again.")}${choice(act("drop", j.name, "Drop"), "Discards the run's branch; the issue stays open.")}${actMsg(j.name)}</div>` +
    (b ? `<p class="quiet q">Waits on <a href="${esc(b.href)}">${esc(b.id)}</a>: ${esc(b.title)}</p>` : "") + fold(s, j)) + `</article>`;
};
/** Text with `inline code` as <code>, everything else escaped. */
const code = (t) => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>");

/** The options, recommended mark and context of a decision with fields. */
function decisionBody(d) {
  return `<p class="dq">${code(d.question)}</p>` +
    `<ul class="opts">${d.options.map((o) => `<li${o.label === d.recommended ? ' class="rec"' : ""}><b>${code(o.label)}</b>${o.label === d.recommended ? ' <span class="badge run">Recommended</span>' : ""} <span class="line">${code(o.line)}</span></li>`).join("")}</ul>` +
    (d.why?.length ? `<ul class="why">${d.why.map((w) => `<li>${code(w)}</li>`).join("")}</ul>` : "");
}

const isUrl = (u) => /^https?:\/\//.test(u);

/** One button of an ask row: the action's args as data attributes. */
function actionButton(a) {
  const args = Object.entries(a.args ?? {}).map(([k, v]) => ` data-${esc(k)}="${esc(v)}"`).join("");
  return `<button class="act${a.primary ? " primary" : ""}" type="button" data-act="${esc(a.act)}"${args} data-label="${esc(a.label)}">${esc(a.label)}</button>`;
}

/** The Technical details of an ask card: what the limits moved out, the raw note, the options, the signals, the stat and the review note. Closed until opened. */
function askDetails(i) {
  const d = i.details ?? {};
  const isRun = i.key?.startsWith("run:");
  const sig = (d.signals ?? []).map((g) => `<li>${esc(g.at)} ${esc(g.source)}: ${esc(g.quote)}${isUrl(g.link) ? ` <a href="${esc(g.link)}">link</a>` : ""}</li>`).join("");
  const body = (i.more ?? []).map((t) => `<p class="quiet q">${esc(localId(t, i.repo))}</p>`).join("") +
    (d.note ? `<p class="quiet q">${esc(d.note)}</p>` : "") +
    (d.ask ? decisionBody(d.ask) : "") +
    (sig ? `<ul>${sig}</ul>` : "") +
    (d.review ? `<p class="quiet q">Reviewer: ${esc(d.review.call)}${d.review.reason ? `: ${esc(d.review.reason)}` : ""}</p>` : "") +
    (d.stat ? `<div class="ev one"><div><h4>Diff</h4><pre class="stat">${statLines(d.stat)}</pre></div></div>` : "") +
    (isRun ? `<div class="actions">${act("diff", i.id, "Diff")}</div><div class="diff-panel" data-diff-for="${esc(i.id)}"${openDiffs.has(i.id) ? `>${diffHtml(openDiffs.get(i.id))}` : " hidden>"}</div>` : "");
  return body ? `<details class="more" data-keep="more:${esc(i.key ?? i.id)}"><summary>Technical details</summary><div class="body">${body}</div></details>` : "";
}

const KIND_TAG = { approval: "Approval", input: "Input", stuck: "Stuck", error: "Error" };
/** The head of every Awaiting-you card: the kind's mark (input or approval), the id and title, the one sentence of the problem. */
const needHead = (kind, id, href, title, problem, repo = "", para = `<p class="problem">${esc(localId(problem, repo))}</p>`, priority = "", at = {}) => {
  const idHtml = !id ? "" : href ? repoIdLink(id, href, repo) : `<span class="id">${esc(id)}</span>`;
  const row = metaRow({ id: idHtml, chips: `<span class="kind-tag">${KIND_TAG[kind]}</span>` + (priority ? priorityBadge(priority) : ""), part: at.part, at: at.at, since: at.since, now: at.now });
  return row + (title ? `<span class="t">${esc(title)}</span>` : "") + para;
};
/** One choice of a card: the button, what it does, and any input that belongs to it. */
const choice = (button, hint, input = "", recommended = false) =>
  `<div class="choice"><div class="choice-text"><span class="effect">${code(hint)}</span>${recommended ? ' <span class="badge run">Recommended</span>' : ""}${input}</div>${button}</div>`;

/** The four kinds of Ask card and their labels. An item without a `card` reads as Approve for an approval, else Decide. */
export const CARD_LABEL = { approve: "Approve", decide: "Decide", unstick: "Unstick", hand: "By hand" };
const cardOf = (i) => (CARD_LABEL[i.card] ? i.card : i.kind === "approval" ? "approve" : "decide");

/** One choice of an Ask card: the button, then what it does and the recommended mark, shown when the card is open. */
const askChoice = (a, input) =>
  `<div class="choice${a.recommended ? " rec" : ""}">${actionButton(a)}<div class="choice-text"><span class="effect">${code(a.hint)}</span>${a.recommended ? '<span class="rec-note">Recommended</span>' : ""}${input}</div></div>`;

/**
 * An Ask card from a server `asks` entry. Compact: the meta row, the title (the kind, then the headline, and the tag
 * that names the stop) and the buttons. A click on the title opens it: the description, what each button does with
 * the recommended one marked, and Technical details, closed until opened. Choices in order: positive, positive [auto-yes], negative.
 */
export function askRow(i, now = new Date().toISOString()) {
  const acts = i.actions ?? [];
  const inputFor = (a) => {
    if (a.act === "deny") {
      const [repo, n] = i.id.split(/-(?=\d+(?:\.\d+)?$)/);
      return `<input class="reason" type="text" name="reason" maxlength="200" placeholder="Reason (optional)" hidden aria-label="Reason to deny ${esc(i.id)}" data-repo="${esc(repo)}" data-id="${esc(n)}" value="${esc(denyReasons.get(i.id) ?? "")}">`;
    }
    return a.act === "answer" ? `<input class="reason" type="text" name="answer" maxlength="500" placeholder="Your answer" hidden aria-label="Answer for ${esc(i.id)}">` : "";
  };
  const choices = acts.map((a) => askChoice(a, inputFor(a)));
  if (i.always) choices.splice(acts.length ? 1 : 0, 0, `<div class="choice"><button class="act always" type="button" data-act="always" data-reason="${esc(i.always.reason ?? i.reason)}" data-action="${esc(i.always.action)}" data-first="${esc(acts[0]?.act ?? "")}" data-label="${esc(i.always.label)}">${esc(i.always.label)}</button><div class="choice-text"><span class="effect">${code(i.always.hint)}</span></div></div>`);
  const card = cardOf(i), key = i.key ?? i.id, msg = i.key?.startsWith("run:") ? actMsg(i.id) : "";
  const idHtml = i.href ? repoIdLink(i.id, i.href, i.repo) : `<span class="id">${esc(i.id)}</span>`;
  const meta = metaRow({ id: idHtml, chips: i.priority ? priorityBadge(i.priority) : "", part: i.part, at: i.at, since: i.since, now });
  const head = `<summary class="ask-head"><span class="ask-dot" aria-hidden="true"></span><span class="t"><b class="ask-kind">${esc(CARD_LABEL[card])}:</b> <span class="ask-title">${esc(localId(i.headline || i.title, i.repo))}</span></span>${i.tag ? `<span class="ask-tag">${esc(i.tag)}</span>` : ""}</summary>`;
  const desc = `<p class="situation">${esc(localId(i.situation ?? i.problem, i.repo))}${i.escalated === false ? ' <span class="muted">With the director: it decides this Ask or sends it to you with its case text.</span>' : ""}</p>`;
  return `<article class="job-card small issue-row ${esc(i.reason)}" data-kind="${esc(i.kind)}" data-card="${card}" data-reason="${esc(i.reason)}">${meta}` +
    `<div class="ask-box"><details class="ask-fold" data-keep="ask:${esc(key)}">${head}${desc}</details>` +
    (choices.length || msg ? `<div class="actions choices">${choices.join("")}${msg}</div>` : "") +
    askDetails(i) + `</div></article>`;
}

/** An error line as a card: the head alone, because the page has no action that fixes it. */
const errorRow = (l) => `<article class="job-card small issue-row error" data-kind="error">${needHead("error", "", "", "", `${/main is red/.test(l) ? "Fix" : "Check"}: ${l}`)}</article>`;

/** "12:49 pm": the time of the state. */
export function renderAsOf(s) {
  const d = new Date(s.now), h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** The Pause or Resume button of the page head. */
export function renderControls(s) {
  return s.factory.paused ? ctl("resume", "Resume") : ctl("pause", "Pause");
}
const ctl = (verb, label) =>
  `<button class="act" type="button" data-act="${verb}" data-label="${esc(label)}">${esc(label)}</button>`;
