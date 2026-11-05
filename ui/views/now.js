// The Now view: the factory's front page. Each render function takes the
// /api/state object and returns an HTML string. No DOM, so tests can call them.
// The page's click handler (index.html) runs the buttons `act` makes.
import { tiles, badge, card, sectionHead, meter, dataTable, blockersHtml, denyReasons, diffHtml, dur, costHtml, empty, error, esc, hashQuery, idLink, mean, keepProject, keepWindow, loadingLine, pageHead, projectNow, scopeBar, WINDOW_DAYS, windowOf, wireScope, withProject, localId, pct, openDiffs, priorityBadge, repoIdLink, repoOf, shortModel, sortHead, sortRows, nextSort, tag, when } from "../lib.js";
import { bar, loadSpeed, speedOf, statusCards, usable } from "./speed.js";
import { oneSentence } from "../decision.js";
import { act, actMsg, checkFacts, fact, itemId, shell as jobCard, trailerLine } from "./cards.js";

export const view = {
  path: "/",
  title: "Status",
  group: "factory",
  order: -3,
  icon: "gauge-high",
  api: (_params, q = new URLSearchParams()) => withProject("/api/state", q),
  refresh: 60,
  live: true,
  render: (s, _params, q) => { lastState = s; const w = windowOf(q); return `<div class="page sp">${renderStatusLine(s, outOfDateNow, w)}${renderNeeds(s)}${tiles("Scorecard", renderTiles(s, usable(w), w), "scorecard")}${renderOutcome(speedOf(w))}<div class="insights">${renderStages(s)}${renderHolds(s)}${renderMonitor(s)}</div>${renderLanes(s, w)}</div>`; },
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

/** The outcome bar. `d` is null while it loads, `{ error }` on a failed load. */
export function renderOutcome(d) {
  const outcome = (body) => card("Agent Time", body, { id: "outcome", label: "Agent time" });
  if (!d) return outcome(loadingLine("the outcomes"));
  if (d.error) return outcome(`<p>${esc(d.error)}</p>`);
  return outcome(bar(d));
}

const MONITOR_ROWS = 10;
const pctOf = (n) => pct(n === null ? null : n * 100);
const TRAIL = { stages: "Trailing 7 days", holds: "Mean per day over the trailing 7 days" };
/** A cell: the day's value, a bar scaled to the table's largest day value (`max`, null for no bar), and the trailing 7 days in the tooltip. */
const pairCell = (p, f, max, tip) =>
  `<td class="num" title="${esc(`${tip}: ${f(p.trailing)}`)}">${max === null ? f(p.day) : `<span class="vpair">${meter(max > 0 ? ((p.day ?? 0) / max) * 100 : 0)}${f(p.day)}</span>`}</td>`;

/** The rows by `sort` ({key, dir}), at most 10. `cols` maps a sort key to the row's value. */
function sorted(rows, cols, sort) {
  return sortRows(rows, cols, sort).slice(0, MONITOR_ROWS);
}

const STAGE_COLS = { stage: (r) => r.stage, runs: (r) => r.runsPerItem.day ?? -1, unusable: (r) => r.unusable.day ?? -1 };
const HOLD_COLS = { kind: (r) => r.kind, goals: (r) => r.goals.day ?? -1, hours: (r) => r.hours.day ?? -1 };
const SORTS = { stages: { key: "runs", dir: -1 }, holds: { key: "goals", dir: -1 } };

/** The monitor's Stages table: the day's value with a bar for runs per item; the trailing 7 days is in each cell's tooltip. At most 10 rows. */
export function renderStages(s, sort = SORTS.stages) {
  const all = s.factory?.monitor?.stages ?? [];
  const max = Math.max(0, ...all.map((r) => r.runsPerItem.day ?? 0));
  const rows = sorted(all, STAGE_COLS, sort).map((r) =>
    `<tr><td>${esc(r.stage)}</td>${pairCell(r.runsPerItem, mean, max, TRAIL.stages)}${pairCell(r.unusable, pctOf, null, TRAIL.stages)}</tr>`).join("");
  const h = (label, key, num) => sortHead(label, key, sort, { num });
  const head = h("Stage", "stage") + h("Runs per Item", "runs", true) + h("No Usable Result", "unusable", true);
  return card("Stages", rows ? dataTable(head, rows) : empty("No stage ran."), { id: "stages" });
}

/** The monitor's Holds table: the day's value with a bar for goals; the trailing 7-day mean per day is in each cell's tooltip. At most 10 rows. */
export function renderHolds(s, sort = SORTS.holds) {
  const all = s.factory?.monitor?.holds ?? [];
  const max = Math.max(0, ...all.map((r) => r.goals.day ?? 0));
  const rows = sorted(all, HOLD_COLS, sort).map((r) =>
    `<tr><td>${esc(r.kind)}</td>${pairCell(r.goals, mean, max, TRAIL.holds)}${pairCell(r.hours, mean, null, TRAIL.holds)}</tr>`).join("");
  const h = (label, key, num) => sortHead(label, key, sort, { num });
  const head = h("Kind", "kind") + h("Affected Issues", "goals", true) + h("Took", "hours", true);
  return card("Holds", rows ? dataTable(head, rows) : empty("No hold record."), { id: "holds" });
}

/** Sort a monitor table when its header is clicked: the same key flips the direction, a new text key goes up, a new number key down. */
function wireSorts(root, s) {
  root.querySelector(".insights")?.addEventListener?.("click", (e) => {
    const b = e.target.closest?.("#stages button[data-sort], #holds button[data-sort]");
    if (!b) return;
    const id = b.closest("section").id, key = b.dataset.sort, cur = SORTS[id];
    SORTS[id] = nextSort(cur, key, new Set(["runs", "unusable", "goals", "hours"]));
    root.querySelector(`#${id}`).outerHTML = (id === "stages" ? renderStages : renderHolds)(s, SORTS[id]);
  });
}

/** A finding as HTML: **text** and each number or percentage in bold; all other text escaped. */
export function findingHtml(text) {
  return esc(text).split(/\*\*(.+?)\*\*/).map((part, i) => i % 2 ? `<b>${part}</b>`
    : part.replace(/(&#?\w+;)|(\$?\d+(?:[.,]\d+)*%?)/g, (m, entity) => (entity ? m : `<b>${m}</b>`))).join("");
}

/** The monitor's newest daily report: the reader's findings in rank order. Nothing before the first report. */
export function renderMonitor(s) {
  const m = s.factory?.monitor;
  if (!m) return "";
  const said = m.error ? error(`No reading: ${m.error}`, "The monitor reads again at its next run.")
    : m.findings.length ? `<ol class="findings">${m.findings.map((f) => `<li>${findingHtml(f)}</li>`).join("")}</ol>`
    : empty("Nothing looks off.");
  return card("Monitor", said, { id: "monitor", aside: `<span class="asof">${esc(m.day)}</span>`, label: `Monitor ${m.day}` });
}

/** Fetch the window with its baseline in one request, then fill the scorecard. */
export async function mountStatus(root, s, fetcher = fetch, q) {
  const w = windowOf(q ?? (typeof location === "undefined" ? undefined : hashQuery()));
  keepWindow(w);
  keepProject(projectNow());
  wireScope(root);
  wireSorts(root, s);
  await loadSpeed(w, fetcher, true);
  const tiles = root.querySelector("#scorecard");
  if (tiles) tiles.innerHTML = renderTiles(s, usable(w), w);
  const outcome = root.querySelector("#outcome");
  if (outcome) outcome.outerHTML = renderOutcome(speedOf(w));
}

/** The count of a section: `N / cap` where a cap applies. */
const section = (id, title, n, body, cap) =>
  sectionHead(title, { id, count: n === null ? null : `${n}${cap > 0 ? ` of ${cap}` : ""}` }) + body;

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

/** The Running lane's rows: intake, land and agent runs. The flow card counts only the live agent runs, as the cap does. */
const runningCount = (s) => (s.runningIssues ?? []).length + (s.running ?? []).length;

/** The page head: the time and the status sentence in place of a title, then the window control with Pause or Resume next to it. */
export function renderStatusLine(s, stale = false, w = "day") {
  const bar = scopeBar(projectNow(), w, [], { after: renderControls(s) });
  return `<header class="ph shead"><span class="asof">${renderAsOf(s)}</span>${renderLede(s, stale)}<div class="aside">${bar}</div></header>`;
}

export const FINE = "Everything is running smoothly";
const JOBS_UNHEALTHY = "jobs are unhealthy";
const MAX_SAID = 3;
/** The weekly usage, in percent, from which the status sentence says how high it is. The raw value is compared, so 89.6 is not yet. */
const WEEKLY_WARN = 90;

/** Health lines that are counts for later, not problems: they stay off the headline and the cards. */
const QUIET_HEALTH = /passed on rerun|holds \d+ flake notes?/;
/** A red main or a red CI of a repo other than aleph: that repo's trouble, not the factory's, so a warning. */
const OTHER_REPO_RED = /^(?!aleph )\S+ (main is red|CI on main has failed)/;
/** Health lines that are warnings, not alerts: the status sentence says them in the warning colour, and they make no card. */
const isWarn = (l) => /full suite took/.test(l) || OTHER_REPO_RED.test(l.replace(/^health:\s*/, ""));

/** What the status sentence says for an error line, most serious first. A line with no entry is said as it is, after these. */
const ALERTS = [
  [/ CI on main has failed/, "GitHub CI is broken"],
  [/main is red/, "the build is failing on main"],
  [/the factory tick has stopped/, "the factory tick has stopped"],
  // No line says this one: a stuck job adds it. It is here for its rank.
  [/(?!)/, JOBS_UNHEALTHY],
  [/did not land|land run of/, "lands are stuck"],
  [/can start, but no run started/, "queued jobs are not starting"],
  [/did not move to jobs/, "new issues are not becoming jobs"],
];
const alertRank = (t) => { const k = ALERTS.findIndex(([, said]) => said === t); return k < 0 ? ALERTS.length : k; };

/** The status sentence: "Alert: " and what is wrong; otherwise what asks for you, which leads, or the fine sentence, then a weekly usage of WEEKLY_WARN or more and the warning health lines; at most MAX_SAID parts, each a link but the usage and warning parts, which are plain text. The Awaiting-you cards list everything. Notices (a check that passed on rerun) are not shown here; `aleph report` has the health line. */
export function renderLede(s, stale = false) {
  const f = s.factory;
  const alerts = new Set(errorLines(s).map((l) => ALERTS.find(([re]) => re.test(l))?.[1] ?? l.replace(/\.$/, "")));
  if (s.stuck.length) alerts.add(JOBS_UNHEALTHY);
  const said = [...alerts].sort((a, b) => alertRank(a) - alertRank(b)).map((t) => [t, t === JOBS_UNHEALTHY && s.stuck.length ? "#jobs-stuck" : "#awaiting"]);
  // An Ask still with the director does not need Chris yet.
  const asks = (s.asks ?? []).filter((a) => a.escalated !== false);
  // With no alert, no pause and a fresh status, the Ask part leads the sentence, so it starts with a capital.
  if (asks.length) said.push([alerts.size || f.paused || stale ? "your attention is needed" : "Your attention is needed", "#awaiting"]);
  const alert = alerts.size > 0;
  if (f.paused && alert) said.push(["the factory is paused", ""]);
  const week = s.usage?.now?.seven_day;
  if (week >= WEEKLY_WARN) said.push([`weekly usage is at ${pct(week)}`, ""]);
  for (const l of f.health || []) if (isWarn(l)) said.push([l.replace(/^health:\s*/, ""), ""]);
  const parts = said.slice(0, MAX_SAID).map(([t, href]) => (href ? `<a href="${href}">${esc(t)}</a>` : esc(t))).join("; ");
  if (stale) return `<span class="say error">Alert: this status is out of date${parts ? `; ${parts}` : ""}.</span>`;
  if (alert) return `<span class="say error">Alert: ${parts}.</span>`;
  if (asks.length && !f.paused) return `<span class="say warning">${parts}.</span>`;
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
    (failed(j) ? `<p class="quiet q">Last check that failed: <b>${esc(failed(j).name)}</b>, ${esc(dur(failed(j).seconds))}</p>` : "") +
    (j.stat ? `<div class="ev one"><div><h4>Diff</h4><pre class="stat">${statLines(j.stat)}</pre></div></div>` : "") +
    trailerLine(j, s.now) +
    (j.defaults.length ? `<h4>Defaults taken</h4><ul>${j.defaults.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "") +
    (j.followups.length ? `<h4>Follow-ups</h4><ul>${j.followups.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "");
  return more(j.name, parts);
}

const failed = (j) => (j.checks || []).findLast((c) => !c.ok);

/** The time from `since` to `to` as `dur` writes it; "–" when the work was never picked up. */
export function span(since, to) {
  const ms = Date.parse(to) - Date.parse(since);
  if (!since || !(ms >= 0)) return "–";
  return dur(ms / 1000);
}

/** The "3/4" link of a part to its parent; "" for a card that is no part. */
const partLink = (p) => (p ? `<a class="part" href="${esc(p.href)}" title="Part ${p.n} of ${p.m} of ${esc(p.parent)}">${p.n}/${p.m}</a>` : "");

/** The meta row, line 1 of every card: id, status chip, priority chip, "n/m", date, duration. `chips` is HTML. */
function metaRow({ id, chips, part, at, since, now, end, blocked }) {
  return `<div class="ih">${id}${chips}${partLink(part)}<span class="num date">${esc(when(at) || "–")}</span><span class="num dur">${esc(span(since, end ?? now))}</span>${blocked ? `<span class="blocked">blocked: ${esc(blocked)}</span>` : ""}</div>`;
}

/** The title of a card: one line, an ellipsis after that. */
const titleOf = (title, href) => (href ? `<a href="${esc(href)}" class="t" title="${esc(title)}">${esc(title)}</a>` : `<span class="t" title="${esc(title)}">${esc(title)}</span>`);

/** An item card of a lane: the 2-line face (the meta row, then the title on 1 line); `below` is HTML after the face. */
function laneCard(cls, row, title, href, below = "") {
  return `<article class="job-card small lane-card ${cls}">${row}${titleOf(title, href)}${below}</article>`;
}

/** A lane: header with the count, its cards or one quiet line. */
const lane = (id, title, n, rows, none, cap = 0) =>
  `<section id="lane-${id}" class="lane" aria-labelledby="h-${id}">${section(id, title, n, rows ? cards(rows, "one") : empty(none), cap)}</section>`;

/** Done: the done parts and issues /api/state sends, newest first, each its own card. */
function doneLane(s, win) {
  const rows = (s.done ?? []).map((i) =>
    laneCard("done-row", metaRow({ id: repoIdLink(i.id, i.href), chips: badge("done") + priorityBadge(i.priority), part: i.part, at: i.finished, since: i.since, now: s.now, end: i.finished }), i.title, i.href)).join("");
  const from = Date.parse(s.now) - WINDOW_DAYS[win] * 86_400_000;
  const total = (s.doneStamps ?? []).filter((d) => d.at >= from).length;
  return lane("done", "Done", (s.done ?? []).length, rows, "Nothing is done yet.", total);
}

function queuedLane(s) {
  const rows = (s.queued ?? []).map((w) => {
    const dead = (w.waits ?? []).filter((b) => b.dead);
    const id = repoIdLink(`${w.repo}-${w.id}`, `#/issues/${encodeURIComponent(w.repo)}/${encodeURIComponent(w.id)}`, w.repo);
    const blocked = w.waits?.[0]?.id ?? w.on;
    return laneCard("queued-row", metaRow({ id, chips: (blocked ? "" : badge(w.stage ?? "queued")) + priorityBadge(w.priority), part: w.part, at: w.at, since: w.since, now: s.now, blocked }), w.title, "",
      dead.length ? `<div class="blockers">${blockersHtml(dead, w.repo, w.id)}</div>` : "");
  }).join("");
  return lane("queued", "Queued", (s.queued ?? []).length, rows, "Nothing is queued.");
}

/** A parent that waits to close: all its parts are done. */
function runningIssue(i, now) {
  return laneCard("run-row issue-run", metaRow({ id: repoIdLink(i.id, i.href), chips: badge(i.stage) + priorityBadge(i.priority), at: i.at, since: i.since, now }), i.title, i.href);
}

const TIERS = { haiku: "low", sonnet: "medium", opus: "high" };

function runningLane(s) {
  const issues = (s.runningIssues ?? []).map((i) => runningIssue(i, s.now)).join("");
  const rows = issues + (s.running ?? []).map((j) => {
    const run = j.run ?? { kind: "build", started: j.started };
    const worker = run.kind === "agent" || run.kind === "build";
    const kind = worker ? "worker" : run.kind === "plan" ? "planner" : run.kind;
    const tier = TIERS[j.tier ?? shortModel(j.model)];
    const label = worker ? ["worker", tier, j.model && shortModel(j.model)].filter(Boolean).join(" · ") : kind;
    return laneCard(`run-row kind-${kind}`, metaRow({ id: itemId(j), chips: `${tag(label, "run", j.phase || kind)}` + priorityBadge(j.item?.priority), part: j.part, at: run.started, since: j.started, now: s.now }), j.item?.title || j.name, jobHref(j));
  }).join("");
  return lane("running", "Running", s.factory.liveRuns ?? runningCount(s), rows, "Nothing is running.", s.factory.liveCap ?? 0);
}

/** The three lanes: Running, Queued, Done. */
export function renderLanes(s, win = "week") {
  return `<div class="lanes">${runningLane(s)}${queuedLane(s)}${doneLane(s, win)}</div>`;
}

/** Awaiting you: the asks, each marked input or approval, then the stuck and failed jobs; absent when nothing awaits Chris. */
export function renderNeeds(s) {
  const asks = (s.asks ?? []).map((i) => askRow(i, s.now)).concat(errorLines(s).map(errorRow));
  if (!asks.length && !s.stuck.length) return "";
  const group = (id, n, html, wrap) => (n ? `<div class="grp" id="${id}">${wrap(html)}</div>` : "");
  return `<section id="needs" class="needs" aria-labelledby="h-needs">${sectionHead("Alerts", { id: "needs", count: asks.length + s.stuck.length })}` +
    group("awaiting", asks.length, asks.join(""), list) + group("jobs-stuck", s.stuck.length, s.stuck.map(stuckRow(s)).join(""), list) + `</section>`;
}

/** How long past due a next tick may be before the tick counts as dead: covers an old state and a late timer. */
const TICK_GRACE_MS = 5 * 60_000;

/** Lines of the factory's own trouble that are errors: health (a red main among them) and a stopped tick; each once. */
function errorLines(s) {
  const f = s.factory;
  const out = (f.health || []).map((l) => l.replace(/^health:\s*/, "")).filter((l) => !QUIET_HEALTH.test(l) && !isWarn(l));
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

const jobHref = (j) => `#/jobs/${encodeURIComponent(j.name)}`;
/** A stuck, failed or error card in the Ask card structure and the red tone: `meta` and the fold sit inside the box; `body` follows the fold. */
const alertCard = (kind, key, meta, title, problem, body = "") =>
  `<article class="job-card small issue-row ${kind}" data-kind="${kind}" data-card="unstick">` +
  `<div class="ask-box">${meta}<details class="ask-fold" data-keep="ask:${esc(key)}"><summary class="ask-head"><span class="ask-dot" aria-hidden="true"></span><span class="t"><b class="ask-kind">${kind === "error" ? "Error" : "Stuck"}:</b> <span class="ask-title">${esc(title)}</span></span></summary><p class="situation">${esc(problem)}</p></details>${body}</div></article>`;
const stuckRow = (s) => (j) => {
  const b = j.blocker;
  const blocker = b && localId(b.id, j.repo);
  const why = b ? `Waits on ${blocker}: ${b.title}.` : `${j.condition === "failed" ? "Failed" : "Stuck"}${j.reason ? ` with ${oneSentence(j.reason).replace(/\.$/, "")}` : ""}.`;
  const first = b ? act("wait", j.name, `Wait for ${blocker}`, true).replace('data-label=', `data-on="${esc(b.id)}" data-label=`) : act("recheck", j.name, "Re-check");
  const meta = metaRow({ id: repoIdLink(j.name, jobHref(j), j.repo), chips: j.item?.priority ? priorityBadge(j.item.priority) : "", part: j.part, at: j.run?.started ?? j.started, since: j.started, now: s.now });
  const opt = (button, hint) => `<div class="choice">${button}<div class="choice-text"><span class="effect">${code(hint)}</span></div></div>`;
  return alertCard("stuck", j.name, meta, j.item?.title || j.name, why,
    `<div class="actions choices">${opt(first, b ? `Makes the issue run after ${blocker} and drops the stuck job; nothing starts until ${blocker} lands.` : "Runs the job again.")}${opt(act("drop", j.name, "Drop"), "Discards the run's branch; the issue stays open.")}${actMsg(j.name)}</div>` +
    agentLine(j) + (b ? `<p class="quiet q">Waits on <a href="${esc(b.href)}">${esc(b.id)}</a>: ${esc(b.title)}</p>` : "") + fold(s, j));
};
/** Text with `inline code` as <code>, everything else escaped. */
const code = (t) => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>");

/** The options, recommended mark and context of a decision with fields. */
function decisionBody(d) {
  return `<p class="dq">${code(d.question)}</p>` +
    `<ul class="opts">${d.options.map((o) => `<li${o.label === d.recommended ? ' class="rec"' : ""}><b>${code(o.label)}</b>${o.label === d.recommended ? ` ${tag("Recommended", "run")}` : ""} <span class="line">${code(o.line)}</span></li>`).join("")}</ul>` +
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


/** The three kinds of Ask card and their labels. An item without a `card` reads as Approve for an approval, else Decide. */
export const CARD_LABEL = { approve: "Approve", decide: "Decide", unstick: "Unstick" };
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
  return `<article class="job-card small issue-row ${esc(i.reason)}" data-kind="${esc(i.kind)}" data-card="${card}" data-reason="${esc(i.reason)}">` +
    `<div class="ask-box">${meta}<details class="ask-fold" data-keep="ask:${esc(key)}">${head}${desc}</details>` +
    (choices.length || msg ? `<div class="actions choices">${choices.join("")}${msg}</div>` : "") +
    askDetails(i) + `</div></article>`;
}

/** An error line as a card: the head alone, because the page has no action that fixes it. */
const errorRow = (l) => alertCard("error", l, "", `${/main is red/.test(l) ? "Fix" : "Check"}: ${l}`, "");

/** "10/28 14:05": the time of the state. */
export const renderAsOf = (s) => when(s.now);

/** The Pause or Resume button of the page head. */
export function renderControls(s) {
  return s.factory.paused ? ctl("resume", "Resume") : ctl("pause", "Pause");
}
const ctl = (verb, label) =>
  `<button class="act warn" type="button" data-act="${verb}" data-label="${esc(label)}">${esc(label)}</button>`;
