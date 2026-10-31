// The Now view: the factory's front page. Each render function takes the
// /api/state object and returns an HTML string. No DOM, so tests can call them.
// The page's click handler (index.html) runs the buttons `act` makes.
import { denyReasons, diffHtml, elapsed, costHtml, esc, idLink, openDiffs, shortModel, when } from "../lib.js";
import { efficiency, mountSpeed, renderPicker, setWindow, speedData, speedTop } from "./speed.js";
import { act, actMsg, checkFacts, fact, itemId, shell as jobCard, trailerLine } from "./cards.js";

export const view = {
  path: "/",
  title: "Status",
  group: "factory",
  order: 0,
  api: "/api/state",
  refresh: 15,
  render: (s, _params, query) => {
    setWindow(query);
    return `<div class="page">${renderStatusLine(s)}${renderNeeds(s)}${renderFlow(s, speedData())}` +
      `<div class="status-grid"><div class="speedrow"><section id="speed" aria-label="Performance">${speedTop()}</section><section id="efficiency" aria-label="Efficiency">${efficiency()}</section></div>${renderLanes(s)}</div></div>`;
  },
  mount: (root) => mountSpeed(root),
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
/** The Running lane's rows: planner, land and agent runs. The flow card counts only the live agent runs, as the cap does. */
const runningCount = (s) => (s.running ?? []).length;
/** Land runs live now, not the landed ones the Lands list also shows. */
const liveLands = (s) => s.delivered.filter((j) => j.state === "landing").length;

/** The weekly and 5-hour usage as text with the weekly reset time; "usage unknown" when the endpoint gave nothing. */
export function renderUsage(s) {
  const cur = s.usage?.now;
  if (!cur) return `<span class="quiet">usage unknown</span>`;
  const reset = cur.seven_day_resets_at && !Number.isNaN(Date.parse(cur.seven_day_resets_at)) ? `<span class="quiet">resets ${esc(when(cur.seven_day_resets_at, new Date(s.now)))}</span>` : "";
  return `<span class="cnt">Week ${esc(Math.round(cur.seven_day))}%</span><span class="cnt">5-hour ${esc(Math.round(cur.five_hour))}%</span>${reset}`;
}

/** The status line: the time, the status sentence, the page time picker, Pause or Resume. */
export function renderStatusLine(s) {
  return `<p class="lede"><span class="asof">${renderAsOf(s)}</span>${renderLede(s)}${renderPicker()}${renderControls(s)}</p>`;
}

/** The 7-day % since the last reset as an SVG polyline over the 0-100 % scale. */
export function usageLine(series) {
  if (!series || series.length < 2) return "";
  const t0 = Date.parse(series[0].at), span = Math.max(1, Date.parse(series.at(-1).at) - t0);
  const pts = series.map((p) => `${(((Date.parse(p.at) - t0) / span) * 300).toFixed(1)},${(40 - (Math.min(100, p.seven_day) / 100) * 40).toFixed(1)}`).join(" ");
  return `<svg class="usage-line" viewBox="0 0 300 40" preserveAspectRatio="none" role="img" aria-label="7-day usage since the last reset"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}

export const FINE = ["Everything is fine.", "All is well.", "Everything is running smoothly.", "The factory is humming along."];

/** The status sentence: all fine, or one sentence that lists what needs attention, each part a link. Notices (a check that passed on rerun) are not shown here; `aleph report` has the health line. */
/** Health lines that are counts for later, not problems: they stay off the headline and the cards. */
const QUIET_HEALTH = /passed on rerun|holds \d+ flake notes?/;

export function renderLede(s) {
  const f = s.factory;
  const problems = []; // [tone, text, href]
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
    if (QUIET_HEALTH.test(text)) continue;
    problems.push(["error", text.replace(/\.$/, ""), "#jobs-needs"]);
  }
  if (f.hold) problems.push(["error", f.hold.replace(/\.$/, ""), "#jobs-needs"]);
  if (f.paused) problems.push(["warning", "the factory is paused", ""]);
  if (f.dayCap > 0 && f.runsToday >= f.dayCap) problems.push(["warning", "the day cap is reached", ""]);
  if (!problems.length) return `<span class="say fine">${FINE[Math.floor((Date.parse(s.now) || Date.now()) / 600000) % FINE.length]}</span>`;
  const tone = problems.some(([t]) => t === "error") ? "error" : "warning";
  const parts = problems.map(([, t, href], k) => {
    const text = k === 0 ? t[0].toUpperCase() + t.slice(1) : t;
    return href ? `<a href="${href}">${esc(text)}</a>` : esc(text);
  });
  const sentence = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `<span class="say ${tone}">${sentence}.</span>`;
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

const STATUS_TONE = { "waiting on Chris": "need", "needs you": "need", stuck: "stuck", building: "run", landing: "run", queued: "run", landed: "done", done: "done" };
const statusBadge = (st) => `<span class="badge ${STATUS_TONE[st] ?? "quiet"}">${esc(st)}</span>`;
const RUN_KIND = { agent: "work", land: "land", triage: "triage", plan: "plan", facts: "facts" };

/** One job of a Done package, as a link to its page; a land adds its commit. */
function doneJob(j) {
  const kind = j.run?.kind ?? "agent";
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
const lane = (id, title, n, rows, none) =>
  `<section id="lane-${id}" class="lane" aria-labelledby="h-${id}">${section(id, title, n, rows ? cards(rows, "one") : empty(none), 0)}</section>`;

/** Done: the last 10 done issues, newest first; the issue heads its card, its triage, work and land jobs and commits are links. */
function doneLane(s) {
  const d = new Date(s.now);
  const rows = (s.done ?? []).map((i) => {
    const jobs = [...i.jobs].sort((a, b) => Date.parse(a.started) - Date.parse(b.started));
    return laneCard("done-row", idLink(i.id, i.href), statusBadge("done"), i.finished ? when(i.finished, d) : "", i.title, i.href, jobs.map(doneJob).join(""));
  }).join("");
  return lane("done", "Done", (s.done ?? []).length, rows, "Nothing is done yet.");
}

/** Incoming: the new issues, newest first, each with its stage. */
function incomingLane(s) {
  const d = new Date(s.now);
  const rows = (s.issues ?? []).map((i) =>
    laneCard("incoming-row", idLink(i.id, i.href), statusBadge(i.status), i.created ? when(i.created, d) : "", i.title, i.href, "")).join("");
  return lane("incoming", "Incoming", incomingCount(s), rows, "No untriaged issues.");
}

/** Why a queued goal waits: links to what it waits on, the ask for Chris, or the reason text. */
function waitMeta(w) {
  if (!w.why) return "Queued";
  if (w.kind === "waits_on" && w.waits?.length)
    return `Waits on ${w.waits.map((x) => `<a href="${esc(x.href)}">${esc(x.id)}</a>${x.state ? ` <span class="badge quiet">${esc(x.state)}</span>` : ""}`).join(", ")}`;
  if (w.kind === "needs-chris" && w.ask?.href) return `<a href="${esc(w.ask.href)}">${esc(w.why)}</a>`;
  return esc(w.why);
}

function queuedLane(s) {
  const rows = (s.waiting ?? []).map((w) => laneCard("queued-row", idLink(`${w.repo}-${w.id}`, `#/issues/${encodeURIComponent(w.repo)}/${encodeURIComponent(w.id)}`), statusBadge("queued"), "", w.title, "", waitMeta(w))).join("");
  return lane("queued", "Queued", (s.waiting ?? []).length, rows, "Nothing is waiting.");
}

function runningLane(s) {
  const d = new Date(s.now);
  const rows = (s.running ?? []).map((j) => {
    const run = j.run ?? { kind: "agent", started: j.started };
    const kind = run.kind === "agent" ? "worker" : run.kind === "plan" ? "planner" : run.kind;
    const over = run.kind === "agent" && Date.parse(s.now) - Date.parse(run.started) > BOX_MIN * 60_000;
    return laneCard("run-row", itemId(j), `<span class="badge run">${esc(kind)}${j.phase && j.phase !== kind ? ` \u00b7 ${esc(j.phase)}` : ""}</span>`, when(run.started, d), j.item?.title || j.name, jobHref(j),
      `<span class="num"><span class="elapsed" data-since="${esc(run.started)}">${esc(elapsed(run.started, s.now))}</span> elapsed</span>${over ? ` <span class="over">past the time box</span>` : ""}`);
  }).join("");
  return lane("running", "Running", runningCount(s), rows, "Nothing is running.");
}

/** The four lanes: Running, Queued, Done, Incoming. */
export function renderLanes(s) {
  return `<div class="lanes">${runningLane(s)}${queuedLane(s)}${doneLane(s)}${incomingLane(s)}</div>`;
}

/** The untriaged issues: all of them when the state counts them, else the ones listed. */
const incomingCount = (s) => Math.max(s.newIssues ?? 0, (s.issues ?? []).length);

/** The flow strip: Incoming, Queued, Running, Done, then the Context card. `sp` is /api/speed for the picked window (Done counts its lands); null while it loads. */
export function renderFlow(s, sp = null) {
  const stage = (lane, k, n, of, id = "") =>
    `<div class="stage"><a class="stage-main" href="#lane-${lane}"><span class="k">${k}</span><span class="v"${id ? ` id="${id}"` : ""}>${n}${of ? `<span class="of"> of ${of}</span>` : ""}</span></a></div>`;
  return `<div class="flow" id="flow">` +
    stage("incoming", "Incoming", incomingCount(s), 0) +
    stage("queued", "Queued", (s.waiting ?? []).length, 0) +
    stage("running", "Running", s.factory.liveRuns ?? 0, s.factory.liveCap > 0 ? s.factory.liveCap : 0) +
    stage("done", "Done", sp && !sp.error ? sp.done : "\u2013", 0, "done-n") + renderContext(s) + `</div>`;
}

/** The Context card: "37% weekly (+2%) / 12% 5 hours". The +N% is the weekly % used in the last 5 hours; it is absent with no snapshot near 5 hours ago. */
export function renderContext(s) {
  const cur = s.usage?.now;
  const head = `<div class="stage context" id="context"><span class="k">Context</span><div class="ctx">`;
  if (!cur) return `${head}<span class="quiet">usage unknown</span></div></div>`;
  const pct = (n) => (Number.isFinite(n) ? `${Math.round(n)}%` : "\u2013");
  const gain = s.usage?.last5h;
  const stat = (k, v, after = "") => `<span class="cnt"><span class="n">${esc(v)}</span> ${esc(k)}${after}</span>`;
  const gained = gain === null || gain === undefined ? "" : ` (+${Math.round(gain)}%)`;
  return head + stat("weekly", pct(cur.seven_day), gained) + `<span class="sep">/</span>` + stat("5 hours", pct(cur.five_hour)) + `</div></div>`;
}

/** Needs you: the needs-you rows, then the stuck and failed jobs; absent when nothing needs Chris. */
export function renderNeeds(s) {
  const needs = (s.attention ?? []).map(attentionRow).concat(errorLines(s).map(errorRow));
  if (!needs.length && !s.stuck.length) return "";
  const group = (id, t, n, html, wrap) => (n ? `<div class="grp" id="jobs-${id}"><h3>${esc(t)}<span class="count">${n}</span></h3>${wrap(html)}</div>` : "");
  return `<section id="needs" class="needs" aria-labelledby="h-needs"><div class="sh"><h2 id="h-needs">Needs you</h2><span class="count">${needs.length + s.stuck.length}</span></div>` +
    group("needs", "Needs you", needs.length, needs.join(""), list) + group("stuck", "Stuck or failed", s.stuck.length, s.stuck.map(stuckRow(s)).join(""), cards) + `</section>`;
}

/** Lines of the factory's own trouble that are errors: health (a red main among them), the hold, a failed probe; each once. The hold is left out when its stuck run has a row of its own. */
function errorLines(s) {
  const f = s.factory;
  const out = (f.health || []).map((l) => l.replace(/^health:\s*/, "")).filter((l) => !QUIET_HEALTH.test(l));
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
/** The one Details behind a held or stuck row: the whole reason, the reviewer's note and Diff (held), then the job's details. */
const fold = (s, j, held) => details(s, j, held
  ? `${holdReason(j) ? `<p class="quiet q">${esc(holdReason(j))}</p>` : ""}${reviewNote(j) ? `<p class="quiet q">Reviewer: ${esc(reviewNote(j))}</p>` : ""}<div class="actions">${act("diff", j.name, "Diff")}</div><div class="diff-panel" data-diff-for="${esc(j.name)}"${openDiffs.has(j.name) ? `>${diffHtml(openDiffs.get(j.name))}` : " hidden>"}</div>`
  : j.reason ? `<p class="quiet q">${esc(j.reason)}</p>` : "");

const jobHref = (j) => `#/jobs/${encodeURIComponent(j.name)}`;
const stuckRow = (s) => (j) => {
  const b = j.blocker;
  const why = b ? `Waits on ${b.id}: ${b.title}.` : `${j.state === "failed" ? "Failed" : "Stuck"}${j.reason ? ` with ${oneSentence(j.reason).replace(/\.$/, "")}` : ""}.`;
  const first = b ? act("wait", j.name, `Wait for ${b.id}`, true).replace('data-label=', `data-on="${esc(b.id)}" data-label=`) : act("recheck", j.name, "Re-check");
  return `<article class="job-card small issue-row stuck" data-kind="stuck">${needHead("stuck", j.name, jobHref(j), j.item?.title || "", why)}${reviewBadge(j)}${agentLine(j)}` +
    `<div class="actions choices">${choice(first, b ? `Sets waiting_on to ${b.id} and drops the stuck job; nothing starts until ${b.id} lands.` : "Runs the job again.")}${choice(act("drop", j.name, "Drop"), "Discards the run's branch; the issue stays open.")}${actMsg(j.name)}</div>` +
    (b ? `<p class="quiet q">Waits on <a href="${esc(b.href)}">${esc(b.id)}</a>: ${esc(b.title)}</p>` : "") + fold(s, j, false) + `</article>`;
};
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

const KIND_TAG = { approval: "Approval", decision: "Decision", input: "Input", stuck: "Stuck", error: "Error" };
/** The head of every Needs-you card: the kind's tag, the id and title, the one sentence of the problem. */
const needHead = (kind, id, href, title, problem) =>
  `<div class="row-main"><span class="kind-tag">${KIND_TAG[kind]}</span> ${!id ? "" : href ? idLink(id, href) : `<span class="id">${esc(id)}</span>`} ${title ? `<span class="t">${esc(title)}</span>` : ""}</div>` +
  `<p class="problem">${esc(problem)}</p>`;
/** One choice of a card: the button, what it does, and any input that belongs to it. */
const choice = (button, hint, input = "") => `<div class="choice">${button}<span class="effect">${code(hint)}</span>${input}</div>`;

/** A Needs-you card from a server `attention` item: the head, then the choices in order: positive, positive [auto-yes], negative. Details last. */
function attentionRow(i) {
  const acts = i.actions ?? [];
  const inputFor = (a) => {
    if (a.act === "deny") {
      const [repo, n] = i.id.split(/-(?=\d+$)/);
      return `<input class="reason" type="text" name="reason" maxlength="200" placeholder="Reason (optional)" aria-label="Reason to deny ${esc(i.id)}" data-repo="${esc(repo)}" data-id="${esc(n)}" value="${esc(denyReasons.get(i.id) ?? "")}">`;
    }
    return a.act === "answer" ? `<input class="reason" type="text" name="answer" maxlength="500" placeholder="Your answer" aria-label="Answer for ${esc(i.id)}">` : "";
  };
  const choices = acts.map((a) => choice(actionButton(a), a.hint, inputFor(a)));
  if (i.always) choices.splice(acts.length ? 1 : 0, 0, choice(`<button class="act always" type="button" data-act="always" data-reason="${esc(i.always.reason ?? i.reason)}" data-action="${esc(i.always.action)}" data-first="${esc(acts[0]?.act ?? "")}" data-label="${esc(i.always.label)}">${esc(i.always.label)}</button>`, i.always.hint));
  return `<article class="job-card small issue-row ${esc(i.reason)}" data-kind="${esc(i.kind)}" data-reason="${esc(i.reason)}">` +
    needHead(i.kind, i.id, i.href, i.title, i.problem) +
    `<div class="actions choices">${choices.join("")}${RUN_REASONS.includes(i.reason) ? actMsg(i.id) : ""}</div>` + attentionDetails(i) + `</article>`;
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
