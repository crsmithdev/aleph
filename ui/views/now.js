// The Now view: the factory's front page. Each render function takes the
// /api/state object and returns an HTML string. No DOM, so tests can call them.
// The page's click handler (index.html) runs the buttons `act` makes.
import { denyReasons, diffHtml, elapsed, esc, idLink, money, openDiffs, shortModel, when } from "../lib.js";
import { proseDecision } from "../decision.js";
import { act, actMsg, checkFacts, fact, itemId, landCard, shell as jobCard, trailerLine } from "./cards.js";

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
    `<div class="cols"><section id="lands" aria-labelledby="h-lands">${renderLands(s)}</section>` +
    `<section id="jobs" aria-labelledby="h-jobs">${renderJobs(s)}</section></div></div>`,
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

/** The row of metric cards: Issues (every open issue), Lands (active), Running / cap, Queued, Untriaged. */
export function renderMetrics(s) {
  const card = (href, k, n, tone = "") => `<a class="metric${tone ? " " + tone : ""}" href="#${href}"><span class="k">${k}</span><span class="v">${n}</span></a>`;
  const lands = s.landing ?? s.delivered.filter((j) => j.state === "running").length;
  const cap = s.factory?.liveCap > 0 ? ` <span class="of">/ ${s.factory.liveCap}</span>` : "";
  return `<div class="metrics">` +
    card("issues", "Issues", s.openIssues ?? (s.issues ?? []).length) +
    card("lands", "Lands", lands, "done") +
    card("jobs", "Running", `${s.running.length}${cap}`, "run") +
    card("jobs-queued", "Queued", s.waiting.length) +
    card("issues", "Untriaged", s.newIssues ?? (s.issues ?? []).length) + `</div>`;
}

export const FINE = ["Everything is fine.", "All is well.", "Everything is running smoothly.", "The factory is humming along."];
const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

/** The status sentence: all fine, or a count of what needs attention and the items as links; notices under it, muted. */
export function renderLede(s) {
  const f = s.factory;
  const problems = []; // [tone, html]
  const notices = [];
  if (s.needs.length) problems.push(["warning", `<a href="#issues">${s.needs.length} ${s.needs.length === 1 ? "job needs" : "jobs need"} you</a>`]);
  if (s.stuck.length) problems.push(["error", `<a href="#issues">${s.stuck.length} ${s.stuck.length === 1 ? "job is" : "jobs are"} stuck or failed</a>`]);
  const needing = s.needsIssues ?? [];
  if (needing.length) problems.push(["warning", `<a href="#issues">${needing.length} ${needing.length === 1 ? "issue needs" : "issues need"} a decision</a>`]);
  const props = s.proposals ?? [];
  if (props.length) problems.push(["warning", `<a href="#issues">${props.length} ${props.length === 1 ? "proposal waits" : "proposals wait"} for Yes or No</a>`]);
  const health = [...(f.health || [])];
  if (f.probe && !f.probe.ok && !health.some((l) => /probe/.test(l))) health.push(`health: the sandbox probe at ${f.probe.at} failed: ${(f.probe.failed || []).join("; ")}`);
  for (const l of health) {
    const text = l.replace(/^health:\s*/, "");
    if (/passed on rerun/.test(text)) { notices.push(text); continue; }
    problems.push(["error", `<a href="#issues">${esc(text)}</a>`]);
  }
  if (f.hold) problems.push(["error", `<a href="#issues">${esc(f.hold)}</a>`]);
  if (f.paused) problems.push(["warning", "The factory is paused"]);
  if (f.dayCap > 0 && f.runsToday >= f.dayCap) problems.push(["warning", "The day cap is reached"]);
  const n = problems.length;
  const note = notices.map((x) => `<span class="notice">${esc(x)}</span>`).join("");
  if (!n) return `<span class="say fine">${FINE[Math.floor((Date.parse(s.now) || Date.now()) / 600000) % FINE.length]}</span>${note}`;
  const tone = problems.some(([t]) => t === "error") ? "error" : "warning";
  const count = `${n < 10 ? NUMBER_WORDS[n] : n} ${n === 1 ? "thing needs" : "things need"} your attention.`;
  return `<span class="say ${tone}">${count} ${problems.map(([, h]) => h).join(". ")}.</span>${note}`;
}

const cards = (html) => `<div class="cards">${html}</div>`;

/** The one folded "Details" of an Issues row; `key` keeps it open across refreshes. */
const more = (key, body) => `<details class="more" data-keep="more:${esc(key)}"><summary>Details</summary><div class="body">${body}</div></details>`;

/** The details of a held or stuck job: everything the row's one sentence leaves out. */
function details(s, j, extra = "") {
  const parts = extra + (j.question ? `<p class="quiet q">${esc(j.question)}</p>` : "") +
    `<dl class="facts">${fact("Started", esc(when(j.started, new Date(s.now))))}${j.phase ? fact("Phase", esc(j.phase)) : ""}${j.cost !== undefined ? fact("Cost", esc(money(j.cost))) : ""}${j.model ? fact("Model", esc(shortModel(j.model))) : ""}${checkFacts(j)}</dl>` +
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

const queuedCard = (w) => jobCard("small", "run-row", `<div class="ih"><span class="id">${esc(w.repo)}-${esc(w.id)}</span><span class="t">${esc(w.title)}</span></div><div class="run-meta">Queued</div>`);

/** Lands: land runs in progress first, then the latest landed. */
export function renderLands(s) {
  const rows = s.delivered.map((j) => landCard(j, "full", s.now)).join("");
  return section("lands", "Lands", s.delivered.length, rows ? cards(rows) : empty("Nothing has landed yet."));
}

/** The firefighter's role row: what it did in the last 24 hours, newest first, from the factory log. */
function firefighterCard(s, lines) {
  const items = [...lines].reverse().map((l) => `<li><span class="num">${esc(when(l.at, new Date(s.now)))}</span> ${esc(l.line.replace(/^firefighter:?\s*/, ""))}</li>`).join("");
  return jobCard("small", "run-row firefighter", `<div class="ih"><span class="t">Firefighter</span></div><div class="run-meta"><span class="badge quiet">role</span></div><ul class="ff-lines">${items}</ul>`);
}

/** Jobs: the running ones (when there are any), the firefighter's role row (when it acted in 24 hours), then the Queued list, always. */
export function renderJobs(s) {
  const group = (id, t, n, html) => `<div class="grp" id="jobs-${id}"><h3>${esc(t)}<span class="count">${n}</span></h3>${html}</div>`;
  const ff = s.factory?.firefighter ?? [];
  const body = (s.running.length ? group("running", "Running", s.running.length, cards(s.running.map((j) => runningCard(s, j)).join(""))) : "") +
    (ff.length ? group("firefighter", "Firefighter", ff.length, cards(firefighterCard(s, ff))) : "") +
    group("queued", "Queued", s.waiting.length, s.waiting.length ? cards(s.waiting.map(queuedCard).join("")) : empty("Nothing queued."));
  return section("jobs", "Jobs", s.running.length + s.waiting.length, body, 0);
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

/** One Issues row: the id, the title, one sentence of why Chris is needed, the buttons; `fold` is the one Details behind the row. */
function row(kind, why, id, href, ttl, buttons, fold = "") {
  return `<article class="issue-row ${kind}" data-kind="${kind}"><div class="row-main">` +
    `${id ? `${href ? idLink(id, href) : `<span class="id">${esc(id)}</span>`} ` : ""}${ttl ? `<span class="t">${esc(ttl)}</span> ` : ""}<span class="verb">${esc(why)}</span></div>` +
    `<div class="actions">${buttons}</div>${fold}</article>`;
}

/** The one Details behind a held or stuck row: the whole reason, the reviewer's note and Diff (held), then the job's details. */
const fold = (s, j, held) => details(s, j, held
  ? `${holdReason(j) ? `<p class="quiet q">${esc(holdReason(j))}</p>` : ""}${reviewNote(j) ? `<p class="quiet q">Reviewer: ${esc(reviewNote(j))}</p>` : ""}<div class="actions">${act("diff", j.name, "Diff")}</div><div class="diff-panel" data-diff-for="${esc(j.name)}"${openDiffs.has(j.name) ? `>${diffHtml(openDiffs.get(j.name))}` : " hidden>"}</div>`
  : j.reason ? `<p class="quiet q">${esc(j.reason)}</p>` : "");

const jobHref = (j) => `#/jobs/${encodeURIComponent(j.name)}`;
const heldRow = (s) => (j) => row("held", oneSentence(holdReason(j)) || "Review the run, then land or drop it.", j.name, jobHref(j), j.item?.title || "", `${act("land", j.name, "Land", true)}${act("drop", j.name, "Drop")}${actMsg(j.name)}`, fold(s, j, true));
const stuckRow = (s) => (j) => row("stuck", `${j.state === "failed" ? "Failed" : "Stuck"}${j.reason ? ` with ${oneSentence(j.reason).replace(/\.$/, "")}` : ""}.`, j.name, jobHref(j), j.item?.title || "", `${act("recheck", j.name, "Re-check")}${act("drop", j.name, "Drop")}${actMsg(j.name)}`, fold(s, j, false));
const open = (i) => `<a class="act" href="${esc(i.href)}">Open</a>`;
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

/** The Approve buttons (recommended first, primary), the optional reason and Deny. */
function decideButtons(i, d, prose) {
  const [repo, n] = i.id.split(/-(?=\d+$)/);
  const at = `data-repo="${esc(repo)}" data-id="${esc(n)}"`;
  const btn = (verb, label, extra = "", primary = false) =>
    `<button class="act${primary ? " primary" : ""}" type="button" data-act="${verb}" ${at}${extra} data-label="${esc(label)}">${esc(label)}</button>`;
  const approve = d
    ? [...d.options].sort((a, b) => (b.label === d.recommended) - (a.label === d.recommended))
        .map((o) => btn("decide", `Approve ${o.label}`, ` data-option="${esc(o.label)}"`, o.label === d.recommended)).join("")
    : prose.recommendation ? btn("decide", "Approve recommendation", ' data-recommendation="1"', true) : "";
  return approve + `<input class="reason" type="text" name="reason" maxlength="200" placeholder="Reason to deny (optional)" aria-label="Reason to deny ${esc(i.id)}" ${at} value="${esc(denyReasons.get(i.id) ?? "")}">` + btn("deny", "Deny");
}

/** A needs-chris row: the id, the title, the question as one sentence, the buttons; the options, the context and the rest are folded in Details. */
function decideRow(i) {
  const d = i.decision;
  const prose = d ? null : proseDecision(i.question);
  const body = d ? decisionBody(d) : prose.paragraphs.length ? proseBody(prose) : "";
  const ask = oneSentence(d ? d.question : prose.paragraphs[0] ?? i.question) || "Your decision is needed.";
  return row("decide", ask, i.id, i.href, i.title, `${decideButtons(i, d, prose || { recommendation: null })}${open(i)}`, body ? more(i.id, body) : "");
}
const KIND_WORDS = { check: "a check", "claude-md": "a CLAUDE.md line", skill: "a skill change" };
const isUrl = (u) => /^https?:\/\//.test(u);

/** A proposal row: the lesson sentence, Yes and No; the signals are folded in Details. */
function proposalRow(p) {
  const signals = (p.signals ?? []).map((g) => `<li>${esc(g.at)} ${esc(g.source)}: ${esc(g.quote)}${isUrl(g.link) ? ` <a href="${esc(g.link)}">link</a>` : ""}</li>`).join("");
  return row("decide", p.sentence, p.id, "", `Proposal: ${KIND_WORDS[p.kind] ?? KIND_WORDS.skill}`,
    `${act("approve", p.id, "Yes", true)}${act("decline", p.id, "No")}${actMsg(p.id)}`, signals ? more(p.id, `<ul>${signals}</ul>`) : "");
}
const errorRow = (l) => row("error", `${/main is red/.test(l) ? "Fix" : "Check"}: ${l}`, "", "", "", "");

/** Issues: the rows that need Chris (held, stuck or failed runs, needs-chris issues, errors). Issues that wait for triage are the factory's, so they are only a count on the Untriaged card. */
export function renderIssues(s) {
  const errors = errorLines(s);
  const rows = s.needs.map(heldRow(s)).concat(s.stuck.map(stuckRow(s)), (s.needsIssues ?? []).map(decideRow), (s.proposals ?? []).map(proposalRow), errors.map(errorRow));
  return section("issues", "Issues", rows.length, rows.length ? `<div class="rows">${rows.join("")}</div>` : empty("No issues."), 0);
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
