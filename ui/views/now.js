// The Now view: the factory's front page. Each render function takes the
// /api/factory object and returns an HTML string. No DOM, so tests can call them.
// The page's click handler (router.js) runs the buttons `act` makes.
import { get } from "../router.js";
import { actButton, jobHref, clock, codeText, contentText, shownId, facts, tiles, badge, card, sectionHead, meter, dataTable, blockersHtml, denyReasons, diffHtml, dur, costHtml, empty, error, esc, hashQuery, idLink, mean, keepProject, keepWindow, loadingLine, pageHead, projectNow, scopeBar, windowOf, wireScope, withProject, localId, openDiffs, issueHref, parseId, priorityBadge, repoIdLink, shortModel, sortHead, sortRows, nextSort, tag, when } from "../lib.js";
import { NAMES } from "../../lib/naming.ts";
import { bar, loadSpeed, speedOf, statusCards, usable } from "./speed.js";
import { act, actMsg, checkFacts, itemId, shell as jobCard, trailerLine } from "./cards.js";
import { verdict } from "../../lib/status-words.ts";

export const view = {
  path: "/",
  title: "Status",
  group: "factory",
  order: -3,
  icon: "gauge-high",
  // The asks come from /api/automation, the one answer that carries them.
  api: (_params, q = new URLSearchParams()) => [withProject(`/api/factory?window=${windowOf(q)}`, q), withProject(`/api/automation?window=${windowOf(q)}`, q)],
  combine: ([s, a]) => ({ ...s, asks: a.asks }),
  refresh: 60,
  live: true,
  render: (s, _params, q) => { lastState = s; const w = windowOf(q); return `<div class="page sp">${renderStatusLine(s, outOfDateNow, w)}${tiles("Scorecard", renderTiles(s, usable(w), w), "scorecard")}<div class="rail"><div class="rail-main">${renderOutcome(speedOf(w))}${renderPipeline(speedOf(w))}${renderLanes(s)}</div>${renderHerald(s)}</div></div>`; },
  // The shell calls this when the out-of-date verdict changes: the sentence is drawn again from the last state.
  outOfDate: (root, b) => { outOfDateNow = b; const el = root.querySelector(".shead .say"); if (el && lastState) el.outerHTML = renderLede(lastState, b); },
  mount: (root, s, q) => mountStatus(root, s, fetch, q),
  // An event from the stream goes into the Herald at once; the reload that follows draws it from the state.
  event: (root, ev) => {
    streamed.push(ev);
    if (streamed.length > HERALD_KEEP) streamed.shift();
    const h = root.querySelector("#herald");
    if (h && lastState) h.outerHTML = renderHerald(lastState);
  },
};

let lastState = null, outOfDateNow = false;

const EFFICIENCY = "#/flow", PERFORMANCE = "#/factory/jobs";
/** A link to another page that keeps the window; week is the default and stays out of the address. */
const withWindow = (href, win) => (win === "week" ? href : `${href}?window=${win}`);

/** The scorecard: lost time, completion, landed, queue wait, usage. `d` is /api/flow for the window `win` with its baseline, or null while it loads. */
export function renderTiles(s, d, win = d?.window ?? "week") {
  return statusCards(s, d, { efficiency: withWindow(EFFICIENCY, win), performance: withWindow(PERFORMANCE, win) });
}

/** The outcome bar. `d` is null while it loads, `{ error }` on a failed load. */
function renderOutcome(d) {
  const outcome = (body) => card("Agent Time", body, { id: "outcome", label: "Agent time" });
  if (!d) return outcome(loadingLine("the outcomes"));
  if (d.error) return outcome(`<p>${esc(d.error)}</p>`);
  return outcome(bar(d));
}

/** The pipeline stages in order, with their names; the monitor's other roles (facts, director, monitor…) are not stages of an issue. */
const PIPE = Object.fromEntries(["intake", "triage", "plan", "spec-check", "build", "review", "recheck", "land"].map((k) => [k, NAMES[k]]));
/** The Pipeline card for the window: each stage with its runs per issue and p90 runtime. `d` is /api/flow for the window, null while it loads, or `{ error }`. */
export function renderPipeline(d) {
  const box = (body, aside = "") => card("Pipeline", body, { id: "pipeline", aside });
  if (!d) return box(loadingLine("the pipeline"));
  if (d.error) return box(error(d.error));
  const by = new Map((d.stages?.rows ?? []).map((r) => [r.stage, r]));
  const node = ([k, name]) => {
    const r = by.get(k), n = r?.items ? r.runs / r.items : null, tip = r ? `${name}: ${r.runs} runs on ${r.items} issues${r.unusable ? `, ${r.unusable} failed` : ""}` : `${name}: no run`;
    return `<div class="pnode${n === null ? " idle" : ""}" title="${esc(tip)}"><span class="pn">${esc(k)}</span>` +
      `<span class="pv">${n === null ? "–" : `${mean(n)}<span class="pu"> / issue</span>`}</span><span class="pt">${n === null ? "idle" : esc(dur(r.p90))}</span></div>`;
  };
  return box(`<div class="pflow" role="group" aria-label="Stages">${Object.entries(PIPE).map(node).join("")}</div>`, `<span class="asof">runs / issue · p90 runtime</span>`);
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

/** The events the stream sent since the page loaded, oldest first; the Herald merges them with the state's. */
let streamed = [];
const HERALD_KEEP = 50;

/** The events of the state and of the stream, each once, newest first. */
export function heraldEvents(s, more = streamed) {
  const key = (e) => `${e.at} ${e.by} ${e.subject} ${e.action} ${(e.on ?? []).join(",")}`;
  const all = new Map([...(s.herald?.events ?? []), ...more].map((e) => [key(e), e]));
  return [...all.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, HERALD_KEEP);
}

/** The tone of an event's row: a start runs, a wait asks, a failure warns, an end is fine; any other action is quiet. */
const TONES = { running: "run", reran: "run", waiting: "ask", escalated: "ask", failed: "warning", returned: "warning", red: "warning", passed: "fine", landed: "fine", done: "fine", filed: "fine", answered: "fine" };

/** An event's row: the time, the action in its tone, the subject's ID, then the issue's title, the sub and the content, and the note quiet after them. */
export function eventRow(ev, titles = {}) {
  const tone = TONES[ev.action] ?? "quiet";
  const to = issueHref(ev.subject), title = titles[ev.subject] ?? "";
  const id = to ? idLink(shownId(ev.subject), to, { title: title || undefined }) : esc(shownId(ev.subject));
  const what = [ev.sub, contentText(ev)].filter(Boolean).join(" ");
  return `<div class="event-row ${tone}" data-by="${esc(ev.by)}">` +
    `<span class="event-time">${esc(clock(ev.at) || when(ev.at))}</span>` +
    `<span class="event-tone ${tone}">${esc(ev.action)}</span>` +
    `<span class="event-id">${id}</span>` +
    `<span class="event-body">${title ? `<span class="event-title" title="${esc(title)}">${esc(title)}</span>` : ""}${what ? `<span class="event-what">${esc(what)}</span>` : ""}${ev.note ? `<span class="reason">${esc(ev.note)}</span>` : ""}</span></div>`;
}

/** The Herald panel: sticky alerts on top, rolling event history stream below. */
export function renderHerald(s) {
  const cur = verdict(s, outOfDateNow);
  // An error is not pinned: the newest event already says it, and is marked live instead.
  const asks = (s.asks ?? []).map((i) => askRow(i, s.now));
  const stuck = (s.stuck ?? []).map(stuckRow(s));
  const errs = cur.errors, errors = errs.length;
  const pinnedCount = asks.length + stuck.length + errors;
  const group = (id, n, html, wrap) => (n ? `<div class="grp" id="${id}">${wrap(html)}</div>` : "");

  const sticky = asks.length + stuck.length > 0
    ? `<section id="needs" class="needs herald-sticky" aria-label="Alerts">` +
        group("awaiting", asks.length, asks.join(""), list) +
        group("jobs-stuck", stuck.length, stuck.join(""), list) +
      `</section>`
    : "";

  // The server's history; the page's own verdict on top when it differs, as for a project's scope or an out-of-date state.
  const history = [...(s.herald?.history ?? [])];
  if (history[0]?.text !== cur.text || history[0]?.tone !== cur.tone) history.unshift({ at: s.now, tone: cur.tone, label: cur.label, text: cur.text });

  const status = history.map((ev, i) => ({ at: ev.at ?? "", html:
    `<div class="event-row ${esc(ev.tone)}${i === 0 && errors ? " live" : ""}">` +
      `<span class="event-time">${esc(ev.at ? (clock(ev.at) || when(ev.at)) : "")}</span>` +
      `<span class="event-tone ${esc(ev.tone)}">${esc(ev.label || ev.tone)}</span><span class="event-id"></span>` +
      `<span class="event-body ${esc(ev.tone)}">${esc(eventText(ev))}${(i === 0 && errors ? errs.map((l) => l.text) : ev.reason ? [ev.reason] : []).filter((l) => !ev.text.includes(l)).map((l) => `<span class="reason">${esc(l)}</span>`).join("")}</span>` +
    `</div>` }));
  // The status changes and the events in one feed, newest first; the live status row stays on top.
  const live = errors ? status.shift() : null;
  const rows = [...status, ...heraldEvents(s).map((ev) => ({ at: ev.at, html: eventRow(ev, s.herald?.titles) }))].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  const feed = (live ? [live, ...rows] : rows).map((r) => r.html).join("");

  const m = s.factory?.monitor;
  const monitorFindings = m?.findings?.length
    ? `<details class="more herald-findings" data-keep="herald:findings"><summary>Daily Monitor (${esc(m.day)})</summary><ol class="findings">${m.findings.map((f) => `<li>${findingHtml(f)}</li>`).join("")}</ol></details>`
    : "";

  // A stuck job or an error outranks an Ask: the badge takes the worst alert's tone.
  const badgeHtml = pinnedCount > 0 ? tag(`${pinnedCount} active`, stuck.length || errors ? "stuck" : "need") : tag("Calm", "done");

  return `<section id="herald" class="card herald-card" aria-label="Herald">` +
    `<div class="sh"><h2 id="h-herald">Herald</h2><div class="aside">${badgeHtml}</div></div>` +
    sticky +
    `<div class="herald-feed">${feed}</div>` +
    monitorFindings +
  `</section>`;
}

/** An event's text without what the row already shows: the tone label before it, and the "health: " of each health line. */
const eventText = (ev) => {
  const head = `${ev.label || ev.tone}: `;
  return (ev.text.startsWith(head) ? ev.text.slice(head.length) : ev.text).replace(/(^|; )health: /g, "$1");
};

function wireHeraldJump(root) {
  root.querySelector?.(".shead .say")?.addEventListener?.("click", (e) => {
    if (e.target.closest?.("a")) return;
    const herald = root.querySelector?.("#herald");
    if (herald) {
      herald.scrollIntoView?.({ behavior: "smooth", block: "center" });
      herald.classList?.add("pulsing");
      setTimeout(() => herald.classList?.remove("pulsing"), 1200);
    }
  });
}

/** Fetch the window with its baseline in one request, then fill the scorecard. */
export async function mountStatus(root, s, fetcher = get, q) {
  const w = windowOf(q ?? (typeof location === "undefined" ? undefined : hashQuery()));
  keepWindow(w);
  keepProject(projectNow());
  wireScope(root);
  wireHeraldJump(root);
  await loadSpeed(w, fetcher, true);
  const tiles = root.querySelector("#scorecard");
  if (tiles) tiles.innerHTML = renderTiles(s, usable(w), w);
  const outcome = root.querySelector("#outcome");
  if (outcome) outcome.outerHTML = renderOutcome(speedOf(w));
  const pipe = root.querySelector("#pipeline");
  if (pipe) pipe.outerHTML = renderPipeline(speedOf(w));
}


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


/** The page head: the time and the status sentence in place of a title, then the window control with Pause or Resume next to it. */
function renderStatusLine(s, stale = false, w = "day") {
  const bar = scopeBar(projectNow(), w, [], { after: renderControls(s) });
  return `<header class="ph shead"><span class="asof">${renderAsOf(s)}</span>${renderLede(s, stale)}<div class="aside">${bar}</div></header>`;
}

/** The status sentence of `verdict`, each part a link to its card but the plain ones. */
export function renderLede(s, stale = false) {
  const v = verdict(s, stale);
  const parts = v.parts.map((p) => (p.href ? `<a href="${p.href}">${esc(p.text)}</a>` : esc(p.text))).join("; ");
  return `<span class="say ${v.tone === "alert" ? "error" : v.tone === "ask" ? "warning" : v.tone}">${esc(v.head)}${parts}.</span>`;
}

const list = (html) => `<div class="list">${html}</div>`;

/** The one folded "Details" of an Issues row; `key` keeps it open across refreshes. */
const more = (key, body) => `<details class="more" data-keep="more:${esc(key)}"><summary>Details</summary><div class="body">${body}</div></details>`;

/** The details of a held or stuck job: everything the row's one sentence leaves out. */
function details(s, j, extra = "") {
  const parts = extra + (j.question ? `<p class="quiet q">${esc(j.question)}</p>` : "") +
    facts([["Started", esc(when(j.started, new Date(s.now)))], ["Phase", esc(j.phase)], ["Cost", j.cost !== undefined && costHtml(j.cost, j.wk)], ["Model", j.model && esc(shortModel(j.model))], ...checkFacts(j)]) +
    (failed(j) ? `<p class="quiet q">Last check that failed: <b>${esc(failed(j).name)}</b>, ${esc(dur(failed(j).seconds))}</p>` : "") +
    (j.stat ? `<div class="ev one"><div><h4>Diff</h4><pre class="stat">${statLines(j.stat)}</pre></div></div>` : "") +
    trailerLine(j, s.now) +
    (j.defaults.length ? `<h4>Defaults taken</h4><ul>${j.defaults.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "") +
    (j.followups.length ? `<h4>Follow-ups</h4><ul>${j.followups.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "");
  return more(j.name, parts);
}

const failed = (j) => (j.checks || []).findLast((c) => !c.ok);

/** What a card's line says for a hold: the action word and the event's content, as `busy a1372 → issues.js` or `after a9`. */
const holdLine = (ev) => (ev ? [ev.action, contentText(ev)].filter(Boolean).join(" ") : "");

/** The "3/4" link of a part to its parent; "" for a card that is no part. */
const partLink = (p) => (p ? `<a class="part" href="${esc(p.href)}" title="Sub-issue ${p.n} of ${p.m} of ${esc(p.parent)}">${p.n}/${p.m}</a>` : "");

/** The meta row, line 1 of every card: id, status chip, priority chip, "n/m", date, duration, the hold. `chips` is HTML. */
function metaRow({ id, chips, part, at, since, now, end, hold }) {
  return `<div class="ih">${id}${chips}${partLink(part)}<span class="num date">${esc(when(at) || "–")}</span><span class="num dur">${esc(span(since, end ?? now))}</span>${hold ? `<span class="blocked">${esc(hold)}</span>` : ""}</div>`;
}

/** The time from `since` to `to` as `dur` writes it; "–" when the work was never picked up. */
export function span(since, to) {
  const ms = Date.parse(to) - Date.parse(since);
  if (!since || !(ms >= 0)) return "–";
  return dur(ms / 1000);
}

/** The count of a section: `N of cap` where a cap applies. */
const section = (id, title, n, body, cap) =>
  sectionHead(title, { id, count: n === null ? null : `${n}${cap > 0 ? ` of ${cap}` : ""}` }) + body;

const cards = (html, cls = "") => `<div class="cards${cls ? " " + cls : ""}">${html}</div>`;

/** The title of a card: one line, an ellipsis after that. */
const titleOf = (title, href) => (href ? `<a href="${esc(href)}" class="t" title="${esc(title)}">${esc(title)}</a>` : `<span class="t" title="${esc(title)}">${esc(title)}</span>`);

/** An item card of a lane: the 2-line face (the meta row, then the title on 1 line); `below` is HTML after the face. */
function laneCard(cls, row, title, href, below = "") {
  return `<article class="job-card small lane-card ${cls}">${row}${titleOf(title, href)}${below}</article>`;
}

/** A lane: header with the count, its cards or one quiet line. */
const lane = (id, title, n, rows, none, cap = 0) =>
  `<section id="lane-${id}" class="lane" aria-labelledby="h-${id}">${section(id, title, n, rows ? cards(rows, "one") : empty(none), cap)}</section>`;

/** Done: the done parts and issues /api/factory sends, newest first, each its own card. */
function doneLane(s) {
  const rows = (s.done ?? []).map((i) =>
    laneCard("done-row", metaRow({ id: repoIdLink(i.id, i.href), chips: badge("done") + priorityBadge(i.priority), part: i.part, at: i.finished, since: i.since, now: s.now, end: i.finished }), i.title, i.href)).join("");
  return lane("done", "Done", (s.done ?? []).length, rows, "Nothing is done yet.", s.doneCount ?? 0);
}

function queuedLane(s) {
  const rows = (s.queued ?? []).map((w) => {
    const dead = (w.waits ?? []).filter((b) => b.dead);
    const id = repoIdLink(`${w.repo}-${w.id}`, issueHref(`${w.repo}-${w.id}`), w.repo);
    const hold = holdLine(w.ev);
    return laneCard("queued-row", metaRow({ id, chips: (hold ? "" : badge(w.stage ?? "queued")) + priorityBadge(w.priority), part: w.part, at: w.at, since: w.since, now: s.now, hold }), w.title, "",
      dead.length ? `<div class="blockers">${blockersHtml(dead, w.repo, w.id)}</div>` : "");
  }).join("");
  return lane("queued", "Queued", (s.queued ?? []).length, rows, "Nothing is queued.");
}

/** A parent that waits to close: all its parts are done. */
function runningIssue(i, now) {
  return laneCard("run-row issue-run", metaRow({ id: repoIdLink(i.id, i.href), chips: badge(i.stage) + priorityBadge(i.priority), at: i.at, since: i.since, now }), i.title, i.href);
}

const TIERS = { haiku: "low", sonnet: "medium", opus: "high" };

/** The Running lane's rows: intake, land and agent runs. The count is the live agent runs, as the cap counts them. */
function runningLane(s) {
  const issues = (s.runningIssues ?? []).map((i) => runningIssue(i, s.now)).join("");
  const rows = issues + (s.running ?? []).map((j) => {
    const run = j.run ?? { kind: "build", started: j.started };
    const worker = run.kind === "agent" || run.kind === "build";
    const kind = worker ? "worker" : run.kind === "plan" ? "planner" : run.kind;
    const tier = TIERS[j.tier ?? shortModel(j.model)];
    const label = worker ? ["worker", tier, j.model && shortModel(j.model)].filter(Boolean).join(" · ") : kind;
    return laneCard(`run-row kind-${kind}`, metaRow({ id: itemId(j), chips: `${tag(label, "run", j.phase || kind)}` + priorityBadge(j.item?.priority), part: j.part, at: run.started, since: j.started, now: s.now }), j.item?.title || j.name, jobHref(j.id));
  }).join("");
  return lane("running", "Running", s.factory.liveRuns ?? (s.runningIssues ?? []).length + (s.running ?? []).length, rows, "Nothing is running.", s.factory.liveCap ?? 0);
}

/** The three lanes: Running, Queued, Done. */
export function renderLanes(s) {
  return `<div class="lanes">${runningLane(s)}${queuedLane(s)}${doneLane(s)}</div>`;
}


/** Awaiting you: the asks, each marked input or approval, then the stuck and failed jobs; absent when nothing awaits Chris. */
export function renderNeeds(s) {
  const asks = (s.asks ?? []).map((i) => askRow(i, s.now)).concat(verdict(s).errors.map(errorRow));
  if (!asks.length && !s.stuck.length) return "";
  const group = (id, n, html, wrap) => (n ? `<div class="grp" id="${id}">${wrap(html)}</div>` : "");
  return `<section id="needs" class="needs" aria-labelledby="h-needs">${sectionHead("Alerts", { id: "needs", count: asks.length + s.stuck.length })}` +
    group("awaiting", asks.length, asks.join(""), list) + group("jobs-stuck", s.stuck.length, s.stuck.map(stuckRow(s)).join(""), list) + `</section>`;
}

/** The agent line of a held or stuck job: a live run exists for it. */
const agentLine = (j) => (j?.agent ? `<span class="agent">Agent working</span>` : "");
/** One Jobs card in the compact size: the id, the title, one sentence of why, the buttons; `jobDetails` is the one Details behind it. */
/** The one Details behind a stuck row: the blocker, the whole reason, then the job's details. */
const jobDetails = (s, j) => details(s, j,
  (j.blocker ? `<p class="quiet q">Blocker <a href="${esc(j.blocker.href)}">${esc(j.blocker.id)}</a>: ${esc(j.blocker.title)}</p>` : "") +
  (j.reason ? `<p class="quiet q">${esc(j.reason)}</p>` : ""));

/** A stuck, failed or error card in the Ask card structure and the red tone: `meta` and the fold sit inside the box; `body` follows the fold. An empty `problem` leaves the situation line out. */
const alertCard = (kind, key, meta, title, problem, body = "") =>
  askShell(kind, `data-kind="${kind}" data-card="unstick"`, key, meta, kind === "error" ? "Error" : "Stuck", title, "", problem ? `<p class="situation">${esc(problem)}</p>` : "", body);
/** The Ask card structure: the article with `cls` and `attrs`, then the box with `meta`, the fold of `label`, `title` and `tag` over `desc`, and `rest`. */
const askShell = (cls, attrs, key, meta, label, title, tag, desc, rest) =>
  `<article class="job-card small issue-row ${cls}" ${attrs}>` +
  `<div class="ask-box">${meta}<details class="ask-fold" data-keep="ask:${esc(key)}"><summary class="ask-head"><span class="ask-dot" aria-hidden="true"></span><span class="t"><b class="ask-kind">${esc(label)}:</b> <span class="ask-title">${esc(title)}</span></span>${tag ? `<span class="ask-tag">${esc(tag)}</span>` : ""}</summary>${desc}</details>${rest}</div></article>`;
/** One plain sentence of what went wrong for a stuck job, from its cause; a time box or a stall takes its length from the reason. */
const stuckSentence = (j) => {
  const span = /(\d+)[- ](minute|second)/.exec(j.reason ?? "");
  const check = j.checkName ? `The check ${j.checkName}` : "A check";
  return {
    timeout: `The worker ran past its ${span ? `${span[1]}-${span[2]} ` : ""}time box and was stopped.`,
    stalled: `The worker gave no output${span ? ` for ${span[1]} ${span[2]}s` : ""} and was stopped.`,
    check: `${check} failed.`,
    infra: j.checkName ? `${check} gave no verdict.` : "A factory step failed outside the work.",
    "no-commit": "The worker made no commit.",
    locked: "Another run held the job's lock.",
    credit: "The API account ran out of credit.",
    conflict: "The branch has a merge conflict with main.",
    moved: "Main moved during the land.",
    review: "The reviewer held the change.",
    unanswered: "The agent ended without an answer.",
  }[j.cause] ?? (j.condition === "failed" ? "The run failed." : "The run stopped.");
};
const stuckRow = (s) => (j) => {
  const b = j.blocker;
  const blocker = b && localId(b.id, j.repo);
  const hold = b ? holdLine({ action: "after", on: [b.id] }) : stuckSentence(j);
  const first = b ? actButton(`Wait for ${blocker}`, { act: "wait", name: j.name, job: j.id, on: b.id, label: `Wait for ${blocker}` }, { primary: true }) : actButton("Re-check", { act: "recheck", name: j.name, job: j.id, label: "Re-check" });
  const meta = metaRow({ id: repoIdLink(j.name, jobHref(j.id), j.repo), chips: j.item?.priority ? priorityBadge(j.item.priority) : "", part: j.part, at: j.run?.started ?? j.started, since: j.started, now: s.now });
  const opt = (button, hint) => `<div class="choice">${button}<div class="choice-text"><span class="effect">${codeText(hint)}</span></div></div>`;
  return alertCard("stuck", j.name, meta, j.item?.title || j.name, hold,
    `<div class="actions choices">${opt(first, b ? `Makes the issue run after ${blocker} and drops the stuck job; nothing starts until ${blocker} lands.` : "Runs the job again.")}${opt(actButton("Drop", { act: "drop", name: j.name, job: j.id, label: "Drop" }), "Discards the job's branch; the issue stays open.")}${actMsg(j.name)}</div>` +
    agentLine(j) + jobDetails(s, j));
};

/** The options, recommended mark and context of a decision with fields. */
function decisionBody(d) {
  return `<p class="dq">${codeText(d.question)}</p>` +
    `<ul class="opts">${d.options.map((o) => `<li${o.label === d.recommended ? ' class="rec"' : ""}><b>${codeText(o.label)}</b>${o.label === d.recommended ? ` ${tag("Recommended", "run")}` : ""} <span class="line">${codeText(o.line)}</span></li>`).join("")}</ul>` +
    (d.why?.length ? `<ul class="why">${d.why.map((w) => `<li>${codeText(w)}</li>`).join("")}</ul>` : "");
}

const isUrl = (u) => /^https?:\/\//.test(u);

/** One button of an ask row: the action's args as data attributes. */
function actionButton(a) {
  return actButton(a.label, { act: a.act, ...a.args, label: a.label }, { primary: a.primary });
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
const CARD_LABEL = { approve: "Approve", decide: "Decide", unstick: "Unstick" };
const cardOf = (i) => (CARD_LABEL[i.card] ? i.card : i.kind === "approval" ? "approve" : "decide");

/** One choice of an Ask card: the button, then what it does and the recommended mark, shown when the card is open. */
const askChoice = (a, input) =>
  `<div class="choice${a.recommended ? " rec" : ""}">${actionButton(a)}<div class="choice-text"><span class="effect">${codeText(a.hint)}</span>${a.recommended ? '<span class="rec-note">Recommended</span>' : ""}${input}</div></div>`;

/**
 * An Ask card from a server `asks` entry. Compact: the meta row, the title (the kind, then the headline, and the tag
 * that names the stop) and the buttons. A click on the title opens it: the description, what each button does with
 * the recommended one marked, and Technical details, closed until opened. Choices in order: positive, positive [auto-yes], negative.
 */
export function askRow(i, now = new Date().toISOString()) {
  const acts = i.actions ?? [];
  const inputFor = (a) => {
    if (a.act === "deny") {
      const p = parseId(i.id);
      const n = p ? `${p.n}${p.sub === undefined ? "" : `.${p.sub}`}` : "";
      return `<input class="reason" type="text" name="reason" maxlength="200" placeholder="Reason (optional)" hidden aria-label="Reason to deny ${esc(i.id)}" data-repo="${esc(p?.repo ?? "")}" data-id="${esc(n)}" value="${esc(denyReasons.get(i.id) ?? "")}">`;
    }
    return a.act === "answer" ? `<input class="reason" type="text" name="answer" maxlength="500" placeholder="Your answer" hidden aria-label="Answer for ${esc(i.id)}">` : "";
  };
  const choices = acts.map((a) => askChoice(a, inputFor(a)));
  if (i.always) choices.splice(acts.length ? 1 : 0, 0, `<div class="choice">${actButton(i.always.label, { act: "always", reason: i.always.reason ?? i.reason, action: i.always.action, first: acts[0]?.act ?? "", label: i.always.label }, { cls: "always" })}<div class="choice-text"><span class="effect">${codeText(i.always.hint)}</span></div></div>`);
  const card = cardOf(i), key = i.key ?? i.id, msg = i.key?.startsWith("run:") ? actMsg(i.id) : "";
  const idHtml = i.href ? repoIdLink(i.id, i.href, i.repo) : `<span class="id">${esc(i.id)}</span>`;
  const meta = metaRow({ id: idHtml, chips: i.priority ? priorityBadge(i.priority) : "", part: i.part, at: i.at, since: i.since, now });
  const desc = `<p class="situation">${esc(localId(i.situation ?? i.problem, i.repo))}${i.escalated === false ? ' <span class="muted">With the director: it decides this Ask or sends it to you with its case text.</span>' : ""}</p>`;
  return askShell(esc(i.reason), `data-kind="${esc(i.kind)}" data-card="${card}" data-reason="${esc(i.reason)}"`, key, meta, CARD_LABEL[card], localId(i.headline || i.title, i.repo), i.tag, desc,
    (choices.length || msg ? `<div class="actions choices">${choices.join("")}${msg}</div>` : "") + askDetails(i));
}

/** An error line as a card: the action word and the line, because the page has no action that fixes it. */
const errorRow = (l) => alertCard("error", l.text, "", `${l.key === "red-main" ? "fix" : "check"} ${l.text}`, "");

/** "10/28 14:05": the time of the state. */
const renderAsOf = (s) => when(s.now);

/** The Pause or Resume button of the page head. */
export function renderControls(s) {
  return s.factory.paused ? ctl("resume", "Resume") : ctl("pause", "Pause");
}
const ctl = (verb, label) =>
  actButton(label, { act: verb, label }, { cls: "warn" });
