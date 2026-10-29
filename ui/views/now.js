// The Now view: the factory's front page. Each render function takes the
// /api/state object and returns an HTML string. No DOM, so tests can call them.
// The page's click handler (index.html) runs the buttons `act` makes.
import { denyReasons, diffHtml, elapsed, costHtml, esc, idLink, openDiffs, shortModel, when } from "../lib.js";
import { act, actMsg, checkFacts, fact, issueCard, itemId, landCard, shell as jobCard, triageCard, trailerLine } from "./cards.js";

export const view = {
  path: "/",
  title: "Status",
  group: "factory",
  order: 0,
  api: "/api/state",
  refresh: 15,
  render: (s) =>
    `<div class="page">${renderMetrics(s)}<p class="lede">${renderLede(s)}</p><div class="head"><p class="asof">${renderAsOf(s)}</p>${renderControls(s)}</div>` +
    `<section id="issues" aria-labelledby="h-issues">${renderIssues(s)}</section>` +
    `<section id="lands" aria-labelledby="h-lands">${renderLands(s)}</section>` +
    `<section id="triage" aria-labelledby="h-triage">${renderTriage(s)}</section>` +
    `<section id="jobs" aria-labelledby="h-jobs">${renderJobs(s)}</section>` +
    `<section id="queued" aria-labelledby="h-queued">${renderQueued(s)}</section></div>`,
};

/** The count of a section: `N / cap` where a cap applies. */
const section = (id, title, n, body, cap) =>
  `<div class="sh"><h2 id="h-${id}">${esc(title)}</h2><span class="count">${n}${cap > 0 ? ` / ${cap}` : ""}</span></div>${body}`;

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

/** How many cards the running group holds: the running jobs. */
const runningCount = (s) => s.running.length;
/** Land runs live now, not the landed ones the Lands list also shows. */
const liveLands = (s) => s.delivered.filter((j) => j.state === "landing").length;
/** The needs-you group's rows: held runs, needs-chris issues, proposals, errors. */
const needsCount = (s) => (s.attention ?? []).length + errorLines(s).length;

/** The row of metric cards, each a link to its section: Lands live now, Needs you, Stuck, Failed, Running, Queued, and Weekly usage. */
export function renderMetrics(s) {
  const card = (href, k, n, tone = "") => `<a class="metric${tone ? " " + tone : ""}" href="#${href}"><span class="k">${k}</span><span class="v">${n}</span></a>`;
  const failed = s.stuck.filter((j) => j.state === "failed").length;
  return `<div class="metrics">` +
    card("lands", "Lands", liveLands(s), "done") +
    card("jobs-needs", "Needs you", needsCount(s)) +
    card("jobs-stuck", "Stuck", s.stuck.length - failed) +
    card("jobs-stuck", "Failed", failed) +
    card("jobs-running", "Running", runningCount(s), "run") +
    card("queued", "Queued", s.waiting.length) + renderUsage(s) + `</div>`;
}

/** Weekly usage as the last metric card: the 7-day % now, with the 5-hour % and the reset time on its second line; "usage unknown" when the endpoint gave nothing. */
export function renderUsage(s) {
  const cur = s.usage?.now;
  if (!cur) return `<a class="metric usage" href="#/"><span class="k">Weekly usage</span><span class="v">\u2013</span><span class="quiet">usage unknown</span></a>`;
  const reset = cur.seven_day_resets_at ? ` \u00b7 resets ${esc(when(cur.seven_day_resets_at, new Date(s.now)))}` : "";
  return `<a class="metric usage" href="#/"><span class="k">Weekly usage</span><span class="v">${esc(Math.round(cur.seven_day))}%</span>` +
    `<span class="quiet">5-hour ${esc(Math.round(cur.five_hour))}%${reset}</span></a>`;
}

/** The 7-day % since the last reset as an SVG polyline over the 0-100 % scale. */
export function usageLine(series) {
  if (!series || series.length < 2) return "";
  const t0 = Date.parse(series[0].at), span = Math.max(1, Date.parse(series.at(-1).at) - t0);
  const pts = series.map((p) => `${(((Date.parse(p.at) - t0) / span) * 300).toFixed(1)},${(40 - (Math.min(100, p.seven_day) / 100) * 40).toFixed(1)}`).join(" ");
  return `<svg class="usage-line" viewBox="0 0 300 40" preserveAspectRatio="none" role="img" aria-label="7-day usage since the last reset"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}

export const FINE = ["Everything is fine.", "All is well.", "Everything is running smoothly.", "The factory is humming along."];

/** The status sentence: all fine, or one sentence that lists what needs attention, each part a link; notices under it, muted. */
export function renderLede(s) {
  const f = s.factory;
  const problems = []; // [tone, text, href]
  const notices = [];
  const att = s.attention ?? [];
  const isRun = (i) => ["held", "review", "question"].includes(i.reason);
  const isProposal = (i) => i.reason.startsWith("proposal-");
  const runs = att.filter(isRun).length, issues = att.filter((i) => !isRun(i) && !isProposal(i)).length, props = att.filter(isProposal).length;
  const failed = s.stuck.filter((j) => j.state === "failed").length, stuck = s.stuck.length - failed;
  if (runs) problems.push(["warning", `${runs} ${runs === 1 ? "job needs" : "jobs need"} you`, "#jobs-needs"]);
  if (stuck) problems.push(["error", `${stuck} ${stuck === 1 ? "job is" : "jobs are"} stuck`, "#jobs-stuck"]);
  if (failed) problems.push(["error", `${failed} ${failed === 1 ? "job has" : "jobs have"} failed`, "#jobs-stuck"]);
  if (issues) problems.push(["warning", `${issues} ${issues === 1 ? "issue needs" : "issues need"} a decision`, "#jobs-needs"]);
  if (props) problems.push(["warning", `${props} ${props === 1 ? "proposal waits" : "proposals wait"} for Yes or No`, "#jobs-needs"]);
  const health = [...(f.health || [])];
  if (f.probe && !f.probe.ok && !health.some((l) => /probe/.test(l))) health.push(`health: the sandbox probe at ${f.probe.at} failed: ${(f.probe.failed || []).join("; ")}`);
  for (const l of health) {
    const text = l.replace(/^health:\s*/, "");
    if (/passed on rerun/.test(text)) { notices.push(text); continue; }
    problems.push(["error", text.replace(/\.$/, ""), "#jobs-needs"]);
  }
  if (f.hold) problems.push(["error", f.hold.replace(/\.$/, ""), "#jobs-needs"]);
  if (f.paused) problems.push(["warning", "the factory is paused", ""]);
  if (f.dayCap > 0 && f.runsToday >= f.dayCap) problems.push(["warning", "the day cap is reached", ""]);
  const note = notices.map((x) => `<span class="notice">${esc(x)}</span>`).join("");
  if (!problems.length) return `<span class="say fine">${FINE[Math.floor((Date.parse(s.now) || Date.now()) / 600000) % FINE.length]}</span>${note}`;
  const tone = problems.some(([t]) => t === "error") ? "error" : "warning";
  const parts = problems.map(([, t, href], k) => {
    const text = k === 0 ? t[0].toUpperCase() + t.slice(1) : t;
    return href ? `<a href="${href}">${esc(text)}</a>` : esc(text);
  });
  const sentence = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `<span class="say ${tone}">${sentence}.</span>${note}`;
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

function runningCard(s, j) {
  const run = j.run ?? { kind: "agent", started: j.started };
  const kind = run.kind === "agent" ? "worker" : run.kind === "plan" ? "planner" : run.kind;
  const over = run.kind === "agent" && Date.parse(s.now) - Date.parse(run.started) > BOX_MIN * 60_000;
  return jobCard("small", "run-row", `<div class="ih">${itemId(j)}<span class="t">${esc(j.item?.title || j.name)}</span></div>` +
    `<div class="run-meta"><span class="badge run">${esc(kind)}${j.phase && j.phase !== kind ? ` \u00b7 ${esc(j.phase)}` : ""}</span> <span class="num">Started ${esc(when(run.started, new Date(s.now)))} \u00b7 ` +
    `<span class="elapsed" data-since="${esc(run.started)}">${esc(elapsed(run.started, s.now))}</span> elapsed</span>` +
    `${over ? ` <span class="over">past the time box</span>` : ""}</div>`);
}

const queuedCard = (w) => jobCard("small", "run-row", `<div class="ih"><span class="id">${esc(w.repo)}-${esc(w.id)}</span><span class="t">${esc(w.title)}</span></div><div class="run-meta">Waiting</div>`);

/** Lands: land runs in progress first, then the latest landed. */
export function renderLands(s) {
  const rows = s.delivered.map((j) => landCard(j, "full", s.now)).join("");
  return section("lands", "Lands", s.delivered.length, rows ? cards(rows, "one") : empty("Nothing has landed yet."));
}

/** Triage: triage runs in progress first, then the latest finished, with their outcome. */
export function renderTriage(s) {
  const rows = (s.triage ?? []).map((j) => triageCard(j, "full", s.now)).join("");
  return section("triage", "Triage", (s.triage ?? []).length, rows ? cards(rows, "one") : empty("Nothing has been triaged yet."));
}

const FF_SHOWN = 3;

/** The item a firefighter log line acted on: the first `repo-N` id in it. */
const ffItem = (text) => /\b([a-z][\w]*-\d+)\b/.exec(text)?.[1] ?? "";

/** One firefighter action as a line: time, action, the item as a link, a short reason. */
function ffLine(s, l) {
  const text = l.line.replace(/^firefighter:?\s*/, "");
  const m = /^(did|needs-chris|tell|failed|malformed reply):?\s*(.*)$/.exec(text);
  const action = m ? m[1] : "note", rest = m ? m[2] : text;
  const id = ffItem(rest);
  const [repo, n] = id ? id.split(/-(?=\d+$)/) : [];
  const reason = oneSentence(id ? rest.replace(id, "") : rest).replace(/^[\s,:;-]+/, "");
  return `<li><span class="num">${esc(when(l.at, new Date(s.now)))}</span> <b>${esc(action)}</b> ` +
    `${id ? idLink(id, `#/issues/${encodeURIComponent(repo)}/${n}`) + " " : ""}<span class="why">${esc(reason.length > 90 ? `${reason.slice(0, 89).trimEnd()}\u2026` : reason)}</span></li>`;
}

/** The firefighter as one full-width row: its state, the time of its last action, its last 3 actions, the whole log folded under Details. */
function firefighterRow(s, lines) {
  const newest = [...lines].reverse();
  const live = s.running.some((j) => j.name === "firefighter" || j.run?.kind === "firefighter");
  const last = newest[0];
  return `<article class="job-card small firefighter ff-row"><div class="ih"><span class="t">Firefighter</span> <span class="badge ${live ? "run" : "quiet"}">${live ? "running" : "idle"}</span> ` +
    `<span class="num">last action ${esc(when(last.at, new Date(s.now)))}</span></div>` +
    `<ul class="ff-lines">${newest.slice(0, FF_SHOWN).map((l) => ffLine(s, l)).join("")}</ul>` +
    more("firefighter", `<ul class="ff-lines">${newest.map((l) => `<li><span class="num">${esc(when(l.at, new Date(s.now)))}</span> ${esc(l.line.replace(/^firefighter:?\s*/, ""))}</li>`).join("")}</ul>`) + `</article>`;
}

/** Jobs by state: needs you, stuck or failed, running; each group is there even when empty, so its metric card has a target. */
export function renderJobs(s) {
  const group = (id, t, n, html, none, wrap = cards) => `<div class="grp" id="jobs-${id}"><h3>${esc(t)}<span class="count">${n}</span></h3>${n ? wrap(html) : empty(none)}</div>`;
  const ff = s.factory?.firefighter ?? [];
  const needs = (s.attention ?? []).map(attentionRow).concat(errorLines(s).map(errorRow));
  const body = group("needs", "Needs you", needs.length, needs.join(""), "Nothing needs you.", list) +
    group("stuck", "Stuck or failed", s.stuck.length, s.stuck.map(stuckRow(s)).join(""), "Nothing is stuck or failed.") +
    group("running", "Running", runningCount(s), s.running.map((j) => runningCard(s, j)).join(""), "Nothing is running.") +
    (ff.length ? `<div class="grp" id="jobs-firefighter">${firefighterRow(s, ff)}</div>` : "");
  return section("jobs", "Jobs", needsCount(s) + s.stuck.length + runningCount(s), body, 0) + renderStanding(s);
}

/** Waiting: the goals with no job yet, as a section of its own below Jobs; one card each. */
export function renderQueued(s) {
  return section("queued", "Queued", s.waiting.length, s.waiting.length ? cards(s.waiting.map(queuedCard).join(""), "one") : empty("Nothing is waiting."), 0);
}

/** Lines of the factory's own trouble that are errors: health (a red main among them), the hold, a failed probe; each once. The hold is left out when its stuck run has a row of its own. */
function errorLines(s) {
  const f = s.factory;
  const out = (f.health || []).map((l) => l.replace(/^health:\s*/, "")).filter((l) => !/passed on rerun/.test(l));
  if (f.probe && !f.probe.ok && !(f.health || []).some((l) => /probe/.test(l))) out.push(`the sandbox probe at ${f.probe.at} failed: ${(f.probe.failed || []).join("; ")}`);
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

/** What the reviewer said of a held run, in words; "" while the review runs. */
function reviewNote(j) {
  const r = j.review2;
  return !r ? "the reviewer gave no verdict"
    : r.verdict === "pending" ? ""
    : r.verdict === "land" ? `the reviewer says land${r.reason ? `: ${r.reason}` : ""}`
    : r.verdict === "back" ? `the reviewer sent it back${r.reason ? `: ${r.reason}` : ""}`
    : r.verdict === "chris" ? `the reviewer left it to you${r.reason ? `: ${r.reason}` : ""}`
    : r.verdict === "error" ? "the review failed"
    : `review: ${r.verdict}`;
}

/** The hold reason of a held run, whole. */
const holdReason = (j) => j.reason || (j.needs && j.needs !== "held" && j.needs !== "review" ? j.needs : "");

/** The agent line of a held or stuck job: a live run exists for it. */
const agentLine = (j) => (j?.agent ? `<span class="agent">Agent working</span>` : "");
/** The review2 badge of a held job. */
const reviewBadge = (j) => {
  const v = j?.review2?.verdict;
  return v ? `<span class="badge ${v === "land" ? "done" : v === "pending" ? "run" : "need"} review2">Review: ${esc(v)}</span>` : "";
};

/** One Jobs card in the compact size: the id, the title, one sentence of why, the buttons; `fold` is the one Details behind it. */
function row(kind, why, id, href, ttl, buttons, fold = "", j = null) {
  return `<article class="job-card small issue-row ${kind}" data-kind="${kind}"><div class="row-main">` +
    `${id ? `${href ? idLink(id, href) : `<span class="id">${esc(id)}</span>`} ` : ""}${ttl ? `<span class="t">${esc(ttl)}</span> ` : ""}<span class="verb">${esc(why)}</span>${reviewBadge(j)}${agentLine(j)}</div>` +
    `<div class="actions">${buttons}</div>${fold}</article>`;
}

/** The one Details behind a held or stuck row: the whole reason, the reviewer's note and Diff (held), then the job's details. */
const fold = (s, j, held) => details(s, j, held
  ? `${holdReason(j) ? `<p class="quiet q">${esc(holdReason(j))}</p>` : ""}${reviewNote(j) ? `<p class="quiet q">Reviewer: ${esc(reviewNote(j))}</p>` : ""}<div class="actions">${act("diff", j.name, "Diff")}</div><div class="diff-panel" data-diff-for="${esc(j.name)}"${openDiffs.has(j.name) ? `>${diffHtml(openDiffs.get(j.name))}` : " hidden>"}</div>`
  : j.reason ? `<p class="quiet q">${esc(j.reason)}</p>` : "");

const jobHref = (j) => `#/jobs/${encodeURIComponent(j.name)}`;
const stuckRow = (s) => (j) => row("stuck", `${j.state === "failed" ? "Failed" : "Stuck"}${j.reason ? ` with ${oneSentence(j.reason).replace(/\.$/, "")}` : ""}.`, j.name, jobHref(j), j.item?.title || "", `${act("recheck", j.name, "Re-check")}${act("drop", j.name, "Drop")}${actMsg(j.name)}`, fold(s, j, false), j);
/** Text with `inline code` as <code>, everything else escaped. */
const code = (t) => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>");

/** The options, recommended mark and context of a decision with fields. */
function decisionBody(d) {
  return `<p class="dq">${code(d.question)}</p>` +
    `<ul class="opts">${d.options.map((o) => `<li${o.label === d.recommended ? ' class="rec"' : ""}><b>${code(o.label)}</b>${o.label === d.recommended ? ' <span class="badge run">Recommended</span>' : ""} <span class="line">${code(o.line)}</span></li>`).join("")}</ul>` +
    (d.why?.length ? `<ul class="why">${d.why.map((w) => `<li>${code(w)}</li>`).join("")}</ul>` : "");
}

/** A needs-chris note without fields: its paragraphs, the recommendation sentence picked out. */
function proseBody(p) {
  return p.paragraphs.map((t) => `<p class="dp${t === p.recommendation ? " rec" : ""}">${code(t)}</p>`).join("");
}

const isUrl = (u) => /^https?:\/\//.test(u);
const RUN_REASONS = ["held", "review", "question"];

/** One button of an attention row: the action's args as data attributes. */
function actionButton(a) {
  const args = Object.entries(a.args ?? {}).map(([k, v]) => ` data-${esc(k)}="${esc(v)}"`).join("");
  return `<button class="act${a.primary ? " primary" : ""}" type="button" data-act="${esc(a.act)}"${args} data-label="${esc(a.label)}">${esc(a.label)}</button>`;
}

/** The one folded Details of an attention row: the raw note, the options, the signals, the stat and the review note. */
function attentionDetails(i) {
  const d = i.details ?? {};
  const isRun = RUN_REASONS.includes(i.reason);
  const sig = (d.signals ?? []).map((g) => `<li>${esc(g.at)} ${esc(g.source)}: ${esc(g.quote)}${isUrl(g.link) ? ` <a href="${esc(g.link)}">link</a>` : ""}</li>`).join("");
  const body = (d.note ? `<p class="quiet q">${esc(d.note)}</p>` : "") +
    (d.decision ? decisionBody(d.decision) : "") +
    (sig ? `<ul>${sig}</ul>` : "") +
    (d.review2 ? `<p class="quiet q">Reviewer: ${esc(d.review2.verdict)}${d.review2.reason ? `: ${esc(d.review2.reason)}` : ""}</p>` : "") +
    (d.stat ? `<div class="ev one"><div><h4>Diff</h4><pre class="stat">${statLines(d.stat)}</pre></div></div>` : "") +
    (isRun ? `<div class="actions">${act("diff", i.id, "Diff")}</div><div class="diff-panel" data-diff-for="${esc(i.id)}"${openDiffs.has(i.id) ? `>${diffHtml(openDiffs.get(i.id))}` : " hidden>"}</div>` : "");
  return body ? more(i.key ?? i.id, body) : "";
}

/** A Needs-you row from a server `attention` item: the id and title, the Problem, the named buttons with their hints, Always, Details. */
function attentionRow(i) {
  const acts = i.actions ?? [];
  const buttons = acts.map(actionButton);
  const deny = acts.findIndex((a) => a.act === "deny");
  if (deny >= 0) {
    const [repo, n] = i.id.split(/-(?=\d+$)/);
    buttons.splice(deny, 0, `<input class="reason" type="text" name="reason" maxlength="200" placeholder="Reason to deny (optional)" aria-label="Reason to deny ${esc(i.id)}" data-repo="${esc(repo)}" data-id="${esc(n)}" value="${esc(denyReasons.get(i.id) ?? "")}">`);
  }
  const ans = acts.findIndex((a) => a.act === "answer");
  if (ans >= 0) buttons.splice(ans, 0, `<input class="reason" type="text" name="answer" maxlength="500" placeholder="Your answer" aria-label="Answer for ${esc(i.id)}">`);
  const always = i.always ? `<button class="act always" type="button" data-act="always" data-reason="${esc(i.reason)}" data-action="${esc(i.always.action)}" data-first="${esc(acts[0]?.act ?? "")}" data-label="${esc(i.always.label)}">${esc(i.always.label)}</button>` : "";
  return `<article class="job-card small issue-row ${esc(i.reason)}" data-reason="${esc(i.reason)}"><div class="row-main">` +
    `${i.href ? idLink(i.id, i.href) : `<span class="id">${esc(i.id)}</span>`} ${i.title ? `<span class="t">${esc(i.title)}</span>` : ""}</div>` +
    `<p class="problem">${esc(i.problem)}</p>` +
    `<div class="actions">${buttons.join("")}${RUN_REASONS.includes(i.reason) ? actMsg(i.id) : ""}</div>` +
    (acts.length ? `<p class="hints">${acts.map((a) => `<span>${code(a.hint)}</span>`).join("")}</p>` : "") +
    (always ? `<div class="actions">${always}</div>` : "") + attentionDetails(i) + `</article>`;
}

/** An error line as a row: the Problem sentence, no buttons and no Always. */
const errorRow = (l) => `<article class="job-card small issue-row error" data-kind="error"><p class="problem">${esc(`${/main is red/.test(l) ? "Fix" : "Check"}: ${l}`)}</p></article>`;

/** The folded "Standing permissions" section: what Chris has let the factory do without asking, each with Revoke. */
export function renderStanding(s) {
  const st = s.standing ?? [];
  const d = new Date(s.now);
  const rows = st.map((g) => `<li><span>${esc(g.reason)}: ${esc(g.action)}, since ${esc(when(g.at, d))}${g.handed ? `, ${g.handed} ${g.handed === 1 ? "item" : "items"} with the firefighter` : ""}</span> ` +
    `<button class="act" type="button" data-act="revoke" data-reason="${esc(g.reason)}" data-label="Revoke">Revoke</button></li>`).join("");
  return `<details class="standing" data-keep="standing"><summary>Standing permissions</summary><div class="body">${st.length ? `<ul class="standing-list">${rows}</ul>` : `<p class="hint">None.</p>`}</div></details>`;
}


/** Issues: the issues filed recently that are not yet triaged, as Issue cards. */
export function renderIssues(s) {
  const rows = (s.issues ?? []).map((i) => issueCard(i, "full")).join("");
  return section("issues", "Issues", (s.issues ?? []).length, rows ? cards(rows) : empty("No new issues."), 0);
}

/** "Oct 28 09:17": the time of the state, as every Status time reads (a date for another year). */
export function renderAsOf(s) {
  const d = new Date(s.now);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The Pause or Resume button of the page head. */
export function renderControls(s) {
  return s.factory.paused ? ctl("resume", "Resume", true) : ctl("pause", "Pause");
}
const ctl = (verb, label, primary = false) =>
  `<button class="act${primary ? " primary" : ""}" type="button" data-act="${verb}" data-label="${esc(label)}">${esc(label)}</button>`;
