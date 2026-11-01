// The Now view: the factory's front page. Each render function takes the
// /api/state object and returns an HTML string. No DOM, so tests can call them.
// The page's click handler (index.html) runs the buttons `act` makes.
import { barList, blockersHtml, denyReasons, diffHtml, dur, elapsed, costHtml, esc, idLink, localId, openDiffs, repoIdLink, repoOf, shortModel, small, tile, when } from "../lib.js";
import { causeRow, durShort, firstPassTile, loadSpeed, lostTile, mergeCauses, pctText, speedOf, trend, usable, usageAge, usageTile } from "./speed.js";
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
  render: (s) => { lastState = s; return `<div class="page sp">${renderStatusLine(s, outOfDateNow)}${renderNeeds(s)}<section id="scorecard" aria-label="Scorecard" class="tiles">${renderTiles(s, usable("week"), usable("day"))}</section>${renderLanes(s)}<section id="causes" class="card" aria-label="Causes of lost time">${renderCauses(speedOf("week"))}</section></div>`; },
  // The shell calls this when the out-of-date verdict changes: the sentence is drawn again from the last state.
  outOfDate: (root, b) => { outOfDateNow = b; const el = root.querySelector(".lede .say"); if (el && lastState) el.outerHTML = renderLede(lastState, b); },
  mount: (root, s) => mountStatus(root, s),
};

let lastState = null, outOfDateNow = false;

const EFFICIENCY = "#/factory/efficiency", PERFORMANCE = "#/factory/jobs";

/** The scorecard: lost time, lead time, first pass, lands, weekly usage. `d` is /api/speed for the week and `day` for the last 24 h; either is null while it loads. */
export function renderTiles(s, d, day) {
  const lead = d?.phases?.lead, dlead = day?.phases?.lead;
  const peak = lead ? Math.max(1, ...d.buckets.map((b) => b.lead ?? 0)) : 1;
  const spark = lead ? `<div class="spark" aria-hidden="true">${d.buckets.map((b) => `<i style="height:${((b.lead ?? 0) / peak) * 100}%"></i>`).join("")}</div>` : "";
  const leadTile = lead?.count
    ? tile({ k: "Lead time p50", v: durShort(lead.p50), body: small(`p90 ${dur(lead.p90)}`) + spark + trend(lead.p50, dlead?.count ? dlead.p50 : null, dur), href: PERFORMANCE })
    : tile({ k: "Lead time p50", v: "–", body: small(d ? "no issue landed" : "from filing to the last land"), href: PERFORMANCE });
  const lands = d
    ? tile({ k: "Lands", v: String(d.done), body: small(`issues landed, 7 days · ${d.kinds.land.count} land runs`) + small(`${day ? `${day.done} in the last 24 h, ` : ""}${Math.round(d.done / 7)} a day on average`), href: PERFORMANCE })
    : tile({ k: "Lands", v: "–", body: small("issues landed, 7 days"), href: PERFORMANCE });
  return lostTile(d, day, { href: EFFICIENCY }) + leadTile + firstPassTile(d, day, { href: EFFICIENCY }) + lands + usageTile(s, { href: "#/factory/agents" });
}

/** The ranked causes of lost time, largest first. `d` is null while it loads, `{ error }` on a failed load. */
export function renderCauses(d) {
  const title = `<h2>Causes of lost time, largest first</h2>`;
  if (!d) return `${title}<p role="status">Loading\u2026</p>`;
  if (d.error) return `${title}<p>${esc(d.error)}</p>`;
  const cs = mergeCauses(d);
  if (!cs.length) return `${title}<p>No agent time was lost in the last 7 days.</p>`;
  const sum = cs.reduce((a, x) => a + x.hours, 0), first = cs[0];
  return `${title}<p>The first cause is ${pctText(first.hours / sum)} of the loss: ${esc(first.name)}, ${first.runs} ${first.runs === 1 ? "run" : "runs"}.</p>${barList(cs.map((x, i) => causeRow(`<a href="${EFFICIENCY}">${esc(x.name)}</a>`, x, first.hours, i === 0)).join(""))}`;
}

/** Fetch the week and the last 24 h, then fill the scorecard and the causes. */
export async function mountStatus(root, s, fetcher = fetch) {
  await Promise.all([loadSpeed("week", fetcher), loadSpeed("day", fetcher)]);
  const tiles = root.querySelector("#scorecard"), causes = root.querySelector("#causes");
  if (tiles) tiles.innerHTML = renderTiles(s, usable("week"), usable("day"));
  if (causes) causes.innerHTML = renderCauses(speedOf("week"));
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
const runningCount = (s) => (s.runningIssues ?? []).length + (s.running ?? []).filter((j) => !j.issue).length;

/** The status line: the time, the status sentence, Pause or Resume. */
export function renderStatusLine(s, stale = false) {
  return `<p class="lede"><span class="asof">${renderAsOf(s)}</span>${renderLede(s, stale)}${renderControls(s)}</p>`;
}

export const FINE = "Everything is running smoothly";
const JOBS_UNHEALTHY = "jobs are unhealthy";
const MAX_SAID = 3;
/** The weekly usage, in percent, from which the status sentence says how high it is. The raw value is compared, so 89.6 is not yet. */
const WEEKLY_WARN = 90;

/** Health lines that are counts for later, not problems: they stay off the headline and the cards. */
const QUIET_HEALTH = /passed on rerun|holds \d+ flake notes?|most flaked in acceptance/;

/** What the status sentence says for an error line, most serious first. A line with no entry is said as it is, after these. */
const ALERTS = [
  [/ CI on main has failed/, "GitHub CI is broken"],
  [/main is red/, "the build is failing on main"],
  [/sandbox probe/, "the sandbox is broken"],
  [/the factory tick has stopped/, "the factory tick has stopped"],
  [/^Held: /, JOBS_UNHEALTHY],
  [/did not land|land run of/, "lands are stuck"],
  [/can start, but no run started/, "queued jobs are not starting"],
  [/did not move to jobs/, "new issues are not becoming jobs"],
  [/runs? wait for Chris/, "new runs wait for your answers"],
];
const alertRank = (t) => { const k = ALERTS.findIndex(([, said]) => said === t); return k < 0 ? ALERTS.length : k; };

/** The status sentence: "Alert: " and what is wrong, or the fine sentence, then what asks for you, the day cap and a weekly usage of WEEKLY_WARN or more; at most MAX_SAID parts, each a link but the day cap and usage parts, which are plain text. The Awaiting-you cards list everything. Notices (a check that passed on rerun) are not shown here; `aleph report` has the health line. */
export function renderLede(s, stale = false) {
  const f = s.factory;
  const alerts = new Set(errorLines(s).map((l) => ALERTS.find(([re]) => re.test(l))?.[1] ?? l.replace(/\.$/, "")));
  if (s.stuck.length) alerts.add(JOBS_UNHEALTHY);
  const said = [...alerts].sort((a, b) => alertRank(a) - alertRank(b)).map((t) => [t, t === JOBS_UNHEALTHY && s.stuck.length ? "#jobs-stuck" : "#awaiting"]);
  const asks = s.asks ?? [];
  if (asks.length) said.push(["your attention is needed", "#awaiting"]);
  const alert = alerts.size > 0;
  if (f.paused && alert) said.push(["the factory is paused", ""]);
  if (f.dayCap > 0 && f.runsToday >= f.dayCap) said.push(["the day cap is reached", ""]);
  const week = s.usage?.now?.seven_day;
  if (week >= WEEKLY_WARN) said.push([`weekly usage is at ${Math.round(week)}%`, ""]);
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

const STATUS_TONE = { awaiting: "need", stuck: "stuck", building: "run", landing: "run", planning: "run", queued: "run", blocked: "quiet", triaged: "quiet", new: "quiet", landed: "done", done: "done" };
const statusBadge = (st) => `<span class="badge ${STATUS_TONE[st] ?? "quiet"}">${esc(st)}</span>`;
const RUN_KIND = { agent: "build", build: "build", land: "land", triage: "triage", plan: "plan", facts: "facts" };

/** One job of a Done package, as a link to its page; a land adds its commit. */
function doneJob(j) {
  const kind = j.run?.kind ?? "build";
  const sha = j.commit ? (j.commitUrl ? ` <a href="${esc(j.commitUrl)}"><code>${esc(j.commit.slice(0, 7))}</code></a>` : ` <code>${esc(j.commit.slice(0, 7))}</code>`) : "";
  const out = kind === "triage" && j.outcome ? ` (${esc(j.outcome)})` : "";
  return `<span class="dj"><a href="${jobHref(j)}">${esc(RUN_KIND[kind] ?? kind)}</a>${out}${sha}</span>`;
}

/** An item card of a lane: id, state badge, time, title on at most 2 lines, one meta line. */
function laneCard(cls, id, badge, time, title, href, meta) {
  const t = href ? `<a href="${esc(href)}" class="t">${esc(title)}</a>` : `<span class="t">${esc(title)}</span>`;
  return `<article class="job-card small lane-card ${cls}"><div class="ih">${id}${badge}${time ? `<span class="num">${esc(time)}</span>` : ""}</div>${t}${meta ? `<div class="run-meta">${meta}</div>` : ""}</article>`;
}

/** A lane: header with the count, its cards or one quiet line. */
const lane = (id, title, n, rows, none, cap = 0) =>
  `<section id="lane-${id}" class="lane" aria-labelledby="h-${id}">${section(id, title, n, rows ? cards(rows, "one") : empty(none), cap)}</section>`;

const LATEST_DONE = 2;
/** Latest done: the last done issues, newest first; the issue heads its card, its triage, work and land jobs and commits are links. */
function doneLane(s) {
  const d = new Date(s.now);
  const rows = (s.done ?? []).slice(0, LATEST_DONE).map((i) => {
    const jobs = [...i.jobs].sort((a, b) => Date.parse(a.started) - Date.parse(b.started));
    return laneCard("done-row", repoIdLink(i.id, i.href), statusBadge("done"), i.finished ? when(i.finished, d) : "", i.title, i.href, jobs.map(doneJob).join(""));
  }).join("");
  return lane("done", "Latest done", null, rows, "Nothing is done yet.");
}

/** Why a queued goal waits: links to the goals it runs after, or the reason text. */
function waitMeta(w) {
  if (!w.why) return "Queued";
  if (w.kind === "waits_on" && w.waits?.length)
    return `<div class="blockers"><div>Blocked by</div>${blockersHtml(w.waits, w.repo, w.id)}</div>`;
  return esc(w.why);
}

function queuedLane(s) {
  const rows = (s.queued ?? []).map((w) => laneCard("queued-row", repoIdLink(`${w.repo}-${w.id}`, `#/issues/${encodeURIComponent(w.repo)}/${encodeURIComponent(w.id)}`, w.repo), statusBadge(w.stage ?? "queued"), "", w.title, "", waitMeta(w))).join("");
  return lane("queued", "Queued", (s.queued ?? []).length, rows, "Nothing is queued.");
}

/** An issue in Running: its title, "n of m parts", and its parts nested, each with its stage and its job. */
function runningIssue(i) {
  const goals = i.parts.map((g) =>
    `<li class="goal-row">${idLink(localId(g.id, repoOf(i.id)), g.href)} ${statusBadge(g.stage)} <span class="t">${esc(g.title)}</span>${g.job ? ` <a class="job" href="${esc(g.job.href)}">${esc(g.job.kind === "agent" || g.job.kind === "build" ? "build" : g.job.kind)}</a>` : ""}</li>`).join("");
  return `<article class="job-card small lane-card run-row issue-run" data-issue="${esc(i.id)}"><div class="ih">${repoIdLink(i.id, i.href)}${statusBadge(i.stage)}<span class="num">${i.of.n} of ${i.of.m} issues</span></div>` +
    `<a href="${esc(i.href)}" class="t">${esc(i.title)}</a><ul class="goals">${goals}</ul></article>`;
}

function runningLane(s) {
  const d = new Date(s.now);
  const issues = (s.runningIssues ?? []).map(runningIssue).join("");
  const rows = issues + (s.running ?? []).filter((j) => !j.issue).map((j) => {
    const run = j.run ?? { kind: "build", started: j.started };
    const worker = run.kind === "agent" || run.kind === "build";
    const kind = worker ? "worker" : run.kind === "plan" ? "planner" : run.kind;
    const over = worker && Date.parse(s.now) - Date.parse(run.started) > BOX_MIN * 60_000;
    return laneCard("run-row", itemId(j), `<span class="badge run">${esc(kind)}${j.phase && j.phase !== kind ? ` \u00b7 ${esc(j.phase)}` : ""}</span>`, when(run.started, d), j.item?.title || j.name, jobHref(j),
      `<span class="num"><span class="elapsed" data-since="${esc(run.started)}">${esc(elapsed(run.started, s.now))}</span> elapsed</span>${over ? ` <span class="over">past the time box</span>` : ""}`);
  }).join("");
  return lane("running", "Running", s.factory.liveRuns ?? runningCount(s), rows, "Nothing is running.", s.factory.liveCap ?? 0);
}

/** The three lanes: Running, Queued, Latest done. */
export function renderLanes(s) {
  return `<div class="lanes">${runningLane(s)}${queuedLane(s)}${doneLane(s)}</div>`;
}

/** Awaiting you: the asks, each marked input or approval, then the stuck and failed jobs; absent when nothing awaits Chris. */
export function renderNeeds(s) {
  const asks = (s.asks ?? []).map(askRow).concat(errorLines(s).map(errorRow));
  if (!asks.length && !s.stuck.length) return "";
  const group = (id, t, n, html, wrap) => (n ? `<div class="grp" id="${id}"><h3>${esc(t)}<span class="count">${n}</span></h3>${wrap(html)}</div>` : "");
  return `<section id="needs" class="needs" aria-labelledby="h-needs"><div class="sh"><h2 id="h-needs">Awaiting you</h2><span class="count">${asks.length + s.stuck.length}</span></div>` +
    group("awaiting", "Awaiting you", asks.length, asks.join(""), list) + group("jobs-stuck", "Stuck or failed", s.stuck.length, s.stuck.map(stuckRow(s)).join(""), cards) + `</section>`;
}

/** How long past due a next tick may be before the tick counts as dead: covers an old state and a late timer. */
const TICK_GRACE_MS = 5 * 60_000;

/** Lines of the factory's own trouble that are errors: health (a red main among them), the hold, a failed probe; each once. The hold is left out when its stuck run has a row of its own. */
function errorLines(s) {
  const f = s.factory;
  const out = (f.health || []).map((l) => l.replace(/^health:\s*/, "")).filter((l) => !QUIET_HEALTH.test(l));
  if (f.probe && !f.probe.ok && !(f.health || []).some((l) => /probe/.test(l))) out.push(`the sandbox probe at ${f.probe.at} failed: ${(f.probe.failed || []).join("; ")}`);
  if (f.nextTick !== undefined && f.tickInProgress !== true) {
    if (f.nextTick === null) out.push("the factory tick has stopped: aleph-tick.timer has no next run");
    else if (Date.parse(s.now) - Date.parse(f.nextTick) > TICK_GRACE_MS) out.push(`the factory tick has stopped: aleph-tick.timer was due at ${f.nextTick}`);
  }
  if (f.hold && !s.stuck.some((j) => f.hold.includes(j.name))) out.push(f.hold);
  return [...new Set(out)];
}

/** One plain sentence from a note: code spans, file paths and line numbers dropped, the first sentence, cut at 160 characters. */
export function oneSentence(text) {
  const t = String(text ?? "")
    .replace(/`([^`]*)`/g, (_, c) => (/[\/]|\.\w{1,5}$/.test(c) ? "" : c))
    .replace(/[\w.-]*\/[\w./-]+/g, "")
    .replace(/[\w-]+\.(?:js|ts|tsx|md|json|html|css|py|sh|ya?ml)\b(?::\d+(?:-\d+)?)?/g, "")
    .replace(/\(?\blines? \d+(?:-\d+)?\)?/gi, "")
    .replace(/\s+/g, " ").replace(/\s+([,.;:?!])/g, "$1").replace(/\(\s*\)/g, "").trim();
  const first = (/^.*?[.?!](?=\s|$)/.exec(t)?.[0] ?? t);
  if (/:$/.test(first)) return ""; // only a lead-in was left once the path went
  return first.length > 160 ? `${first.slice(0, 159).trimEnd()}\u2026` : first;
}

/** The agent line of a held or stuck job: a live run exists for it. */
const agentLine = (j) => (j?.agent ? `<span class="agent">Agent working</span>` : "");
/** One Jobs card in the compact size: the id, the title, one sentence of why, the buttons; `fold` is the one Details behind it. */
/** The one Details behind a stuck row: the whole reason, then the job's details. */
const fold = (s, j) => details(s, j, j.reason ? `<p class="quiet q">${esc(j.reason)}</p>` : "");

const jobHref = (j) => `#/jobs/${encodeURIComponent(j.name)}`;
const stuckRow = (s) => (j) => {
  const b = j.blocker;
  const blocker = b && localId(b.id, j.repo);
  const why = b ? `Waits on ${blocker}: ${b.title}.` : `${j.condition === "failed" ? "Failed" : "Stuck"}${j.reason ? ` with ${oneSentence(j.reason).replace(/\.$/, "")}` : ""}.`;
  const first = b ? act("wait", j.name, `Wait for ${blocker}`, true).replace('data-label=', `data-on="${esc(b.id)}" data-label=`) : act("recheck", j.name, "Re-check");
  return `<article class="job-card small issue-row stuck" data-kind="stuck">${needHead("stuck", j.name, jobHref(j), j.item?.title || "", why, j.repo)}${agentLine(j)}` +
    `<div class="actions choices">${choice(first, b ? `Makes the issue run after ${blocker} and drops the stuck job; nothing starts until ${blocker} lands.` : "Runs the job again.")}${choice(act("drop", j.name, "Drop"), "Discards the run's branch; the issue stays open.")}${actMsg(j.name)}</div>` +
    (b ? `<p class="quiet q">Waits on <a href="${esc(b.href)}">${esc(b.id)}</a>: ${esc(b.title)}</p>` : "") + fold(s, j) + `</article>`;
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

/** The one folded Details of an ask row: the raw note, the options, the signals, the stat and the review note. */
function askDetails(i) {
  const d = i.details ?? {};
  const isRun = i.key?.startsWith("run:");
  const sig = (d.signals ?? []).map((g) => `<li>${esc(g.at)} ${esc(g.source)}: ${esc(g.quote)}${isUrl(g.link) ? ` <a href="${esc(g.link)}">link</a>` : ""}</li>`).join("");
  const body = (d.note ? `<p class="quiet q">${esc(d.note)}</p>` : "") +
    (d.ask ? decisionBody(d.ask) : "") +
    (sig ? `<ul>${sig}</ul>` : "") +
    (d.review ? `<p class="quiet q">Reviewer: ${esc(d.review.call)}${d.review.reason ? `: ${esc(d.review.reason)}` : ""}</p>` : "") +
    (d.stat ? `<div class="ev one"><div><h4>Diff</h4><pre class="stat">${statLines(d.stat)}</pre></div></div>` : "") +
    (isRun ? `<div class="actions">${act("diff", i.id, "Diff")}</div><div class="diff-panel" data-diff-for="${esc(i.id)}"${openDiffs.has(i.id) ? `>${diffHtml(openDiffs.get(i.id))}` : " hidden>"}</div>` : "");
  return body ? more(i.key ?? i.id, body) : "";
}

const KIND_TAG = { approval: "Approval", input: "Input", stuck: "Stuck", error: "Error" };
/** The head of every Awaiting-you card: the kind's mark (input or approval), the id and title, the one sentence of the problem. */
const needHead = (kind, id, href, title, problem, repo = "", para = `<p class="problem">${esc(localId(problem, repo))}</p>`) =>
  `<div class="row-main"><span class="kind-tag">${KIND_TAG[kind]}</span> ${!id ? "" : href ? repoIdLink(id, href, repo) : `<span class="id">${esc(id)}</span>`} ${title ? `<span class="t">${esc(title)}</span>` : ""}</div>` + para;
/** One choice of a card: the button, what it does, and any input that belongs to it. */
const choice = (button, hint, input = "", recommended = false) =>
  `<div class="choice"><div class="choice-text"><span class="effect">${code(hint)}</span>${recommended ? ' <span class="badge run">Recommended</span>' : ""}${input}</div>${button}</div>`;

/** An Awaiting-you card from a server `asks` entry: the head, then the choices in order: positive, positive [auto-yes], negative. Details last. */
function askRow(i) {
  const acts = i.actions ?? [];
  const inputFor = (a) => {
    if (a.act === "deny") {
      const [repo, n] = i.id.split(/-(?=\d+(?:\.\d+)?$)/);
      return `<input class="reason" type="text" name="reason" maxlength="200" placeholder="Reason (optional)" hidden aria-label="Reason to deny ${esc(i.id)}" data-repo="${esc(repo)}" data-id="${esc(n)}" value="${esc(denyReasons.get(i.id) ?? "")}">`;
    }
    return a.act === "answer" ? `<input class="reason" type="text" name="answer" maxlength="500" placeholder="Your answer" hidden aria-label="Answer for ${esc(i.id)}">` : "";
  };
  const choices = acts.map((a) => choice(actionButton(a), a.hint, inputFor(a), !!a.recommended));
  if (i.always) choices.splice(acts.length ? 1 : 0, 0, choice(`<button class="act always" type="button" data-act="always" data-reason="${esc(i.always.reason ?? i.reason)}" data-action="${esc(i.always.action)}" data-first="${esc(acts[0]?.act ?? "")}" data-label="${esc(i.always.label)}">${esc(i.always.label)}</button>`, i.always.hint));
  return `<article class="job-card small issue-row ${esc(i.reason)}" data-kind="${esc(i.kind)}" data-reason="${esc(i.reason)}">` +
    needHead(i.kind, i.id, i.href, i.title, i.problem, i.repo, `<p class="situation">${esc(localId(i.situation ?? i.problem, i.repo))}${i.explained === false ? ' <span class="muted">The case text is missing; this is the fixed text for this reason.</span>' : ""}</p>`) +
    `<div class="actions choices">${choices.join("")}${i.key?.startsWith("run:") ? actMsg(i.id) : ""}</div>` + askDetails(i) + `</article>`;
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
  return s.factory.paused ? ctl("resume", "Resume", true) : ctl("pause", "Pause");
}
const ctl = (verb, label, primary = false) =>
  `<button class="act${primary ? " primary" : ""}" type="button" data-act="${verb}" data-label="${esc(label)}">${esc(label)}</button>`;
