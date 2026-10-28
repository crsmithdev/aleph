// The Now view: the factory's front page. Each render function takes the
// /api/state object and returns an HTML string. No DOM, so tests can call them.
// The page's click handler (index.html) runs the buttons `act` makes.
import { actMessages, clock, cmd, diffHtml, esc, money, openDiffs, span } from "../lib.js";
import { act, actMsg, checkFacts, fact, issueCard, itemId, landCard, shell as jobCard, title, trailerLine, triageCard } from "./cards.js";

export const view = {
  path: "/",
  title: "Status",
  group: "factory",
  order: 0,
  api: "/api/state",
  refresh: 15,
  render: (s) =>
    `<div class="page">${renderMetrics(s)}<p class="lede">${renderLede(s)}</p><div class="head">${renderControls(s)}<span class="sep" aria-hidden="true">|</span><p class="asof">${renderAsOf(s)}</p></div>` +
    `<div class="pipeline">` +
    [["issues", renderIssues], ["triage", renderTriage], ["lands", renderLands], ["jobs", renderJobs]]
      .map(([id, f]) => `<section id="${id}" aria-labelledby="h-${id}">${f(s)}</section>`).join("") +
    `</div></div>`,
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

/** "12 · 9/day": a 24-hour count and the 7-day daily average under it. */
const velocity = (v) => {
  const avg = Math.round((v?.avg ?? 0) * 10) / 10;
  return `${v?.day ?? 0} · ${avg}/day`;
};

/** The row of metric cards: a count per section (Jobs by state), each a link to it; Landed and Triaged are velocity cards. */
export function renderMetrics(s) {
  const card = (href, k, n, tone) => `<a class="metric${n && tone ? ` ${tone}` : ""}" href="#${href}"><span class="k">${k}</span><span class="v">${n}</span></a>`;
  const vcard = (href, k, v) => `<a class="metric" href="#${href}"><span class="k">${k}</span><span class="v">${v?.day ?? 0}</span><span class="sub">${velocity(v)}</span></a>`;
  return `<div class="metrics">` +
    card("issues", "Issues", (s.issues ?? []).length) +
    card("triage", "Triage", (s.triage ?? []).length) +
    card("lands", "Lands", s.delivered.length) +
    card("jobs", "Needs you", s.needs.length, "need") +
    card("jobs", "Stuck or failed", s.stuck.length, "stuck") +
    card("jobs", "Running", s.running.length) +
    card("jobs", "Waiting", s.waiting.length) +
    vcard("lands", "Landed", s.velocity?.landed) +
    vcard("triage", "Triaged", s.velocity?.triaged) + `</div>`;
}

export const FINE = ["Everything is fine.", "All is well.", "Everything is running smoothly.", "The factory is humming along."];
const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

/** The status sentence: all fine, or a count of what needs attention and the items as links; notices under it, muted. */
export function renderLede(s) {
  const f = s.factory;
  const problems = []; // [tone, html]
  const notices = [];
  if (s.needs.length) problems.push(["warning", `<a href="#jobs">${s.needs.length} ${s.needs.length === 1 ? "job needs" : "jobs need"} you</a>`]);
  if (s.stuck.length) problems.push(["error", `<a href="#jobs">${s.stuck.length} ${s.stuck.length === 1 ? "job is" : "jobs are"} stuck or failed</a>`]);
  const health = [...(f.health || [])];
  if (f.probe && !f.probe.ok && !health.some((l) => /probe/.test(l))) health.push(`health: the sandbox probe at ${f.probe.at} failed: ${(f.probe.failed || []).join("; ")}`);
  for (const l of health) {
    const text = l.replace(/^health:\s*/, "");
    if (/passed on rerun/.test(text)) notices.push(text);
    else problems.push(["error", `<a href="#jobs">${esc(text)}</a>`]);
  }
  if (f.hold) problems.push(["error", `<a href="#jobs">${esc(f.hold)}</a>`]);
  if (f.paused) problems.push(["warning", "The factory is paused"]);
  if (f.dayCap > 0 && f.runsToday >= f.dayCap) problems.push(["warning", "The day cap is reached"]);
  const n = problems.length;
  const small = notices.length ? `<span class="notices">${notices.map((l) => `<span class="notice">${esc(l)}</span>`).join("")}</span>` : "";
  if (!n) return `<span class="say fine">${FINE[Math.floor((Date.parse(s.now) || Date.now()) / 600000) % FINE.length]}</span>${small}`;
  const tone = problems.some(([t]) => t === "error") ? "error" : "warning";
  const count = `${n < 10 ? NUMBER_WORDS[n] : n} ${n === 1 ? "thing needs" : "things need"} your attention.`;
  return `<span class="say ${tone}">${count} ${problems.map(([, h]) => h).join(". ")}.</span>${small}`;
}

const REVIEW2 = { land: "Review: land", back: "Review: back", chris: "Review: for you", pending: "Review running", error: "Review failed" };

/** The review2 verdict and its reason, above the buttons. */
function reviewLine(j) {
  const r = j.review2;
  if (!r) return "";
  return `<p class="review2 quiet" data-verdict="${esc(r.verdict)}"><strong>${esc(REVIEW2[r.verdict] ?? r.verdict)}</strong>${r.reason ? `: ${esc(r.reason)}` : ""}</p>`;
}

/** "Agent working" when a live run exists for the job, else "No agent working". */
const agentLine = (j) => `<p class="agent ${j.agent ? "on" : "off"}">${j.agent ? "Agent working" : "No agent working"}</p>`;

const cards = (html) => `<div class="cards">${html}</div>`;

/** The details of a held or stuck job, folded under its compact card. */
function details(j) {
  const parts = (j.question ? `<p class="quiet q">${esc(j.question)}</p>` : "") +
    `<dl class="facts">${fact("Started", esc(clock(j.started)))}${j.phase ? fact("Phase", esc(j.phase)) : ""}${j.cost !== undefined ? fact("Cost", esc(money(j.cost))) : ""}${j.model ? fact("Model", esc(j.model)) : ""}${checkFacts(j)}</dl>` +
    (failed(j) ? `<p class="quiet q">Last check that failed: <b>${esc(failed(j).name)}</b>, ${esc(failed(j).seconds)} s</p>` : "") +
    (j.stat ? `<div class="ev one"><div><h4>Diff</h4><pre class="stat">${statLines(j.stat)}</pre></div></div>` : "") +
    trailerLine(j) +
    (j.defaults.length ? `<h4>Defaults taken</h4><ul>${j.defaults.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "") +
    (j.followups.length ? `<h4>Follow-ups</h4><ul>${j.followups.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "");
  return `<details class="more" data-keep="more:${esc(j.name)}"><summary>Details</summary><div class="body">${parts}</div></details>`;
}

const failed = (j) => (j.checks || []).findLast((c) => !c.ok);

/** A held or stuck job as a compact card: line 1 id, title, badge; line 2 the reason, the agent line, the review; its buttons; its details. */
function attentionCard(j, held) {
  const why = held ? j.reason || j.needs || "needs you" : j.reason || "";
  const badge = held ? `<span class="badge need">Needs you</span>` : `<span class="badge stuck">${esc(j.state === "failed" ? "Failed" : "Stuck")}</span>`;
  const buttons = held
    ? `${act("diff", j.name, "Diff")}${act("land", j.name, "Land", true)}${act("drop", j.name, "Drop")}`
    : `${act("recheck", j.name, "Re-check")}${act("drop", j.name, "Drop")}`;
  return jobCard("small", held ? "need-card" : "stuck-card",
    `<div class="ih">${itemId(j)}${title(j)}${badge}</div>` +
    `<div class="run-meta">${why ? `<span class="why">${esc(why)}</span> ` : ""}${agentLine(j)}${held ? reviewLine(j) : ""}</div>` +
    `<div class="actions">${buttons}${actMsg(j.name)}</div>` + details(j) +
    (held ? `<div class="diff-panel" data-diff-for="${esc(j.name)}"${openDiffs.has(j.name) ? `>${diffHtml(openDiffs.get(j.name))}` : " hidden>"}</div>` : ""));
}

function runningCard(s, j) {
  const run = j.run ?? { kind: "agent", started: j.started };
  const kind = run.kind === "agent" ? "worker" : run.kind;
  const over = run.kind === "agent" && Date.parse(s.now) - Date.parse(run.started) > BOX_MIN * 60_000;
  const ago = over ? `<span class="over">${esc(span(run.started, s.now))} ago, past the time box</span>` : `${esc(span(run.started, s.now) || "0 min")} ago`;
  return jobCard("small", "run-row", `<div class="ih">${itemId(j)}<span class="t">${esc(j.item?.title || j.name)}</span></div>` +
    `<div class="run-meta"><span class="badge run">${esc(kind)}${j.phase && j.phase !== kind ? ` \u00b7 ${esc(j.phase)}` : ""}</span> <span class="num">Started ${esc(clock(run.started))}, ${ago}</span> ${agentLine(j)}</div>`);
}

const waitingCard = (w) => jobCard("small", "run-row", `<div class="ih"><span class="id">${esc(w.repo)}-${esc(w.id)}</span><span class="t">${esc(w.title)}</span></div><div class="run-meta">Waiting to start</div>`);

/** Issues: filed recently and not yet triaged, as full Issue cards. */
export function renderIssues(s) {
  const rows = (s.issues ?? []).map((i) => issueCard(i, "full")).join("");
  return section("issues", "Issues", (s.issues ?? []).length, rows ? cards(rows) : empty("No new issues."));
}

/** Triage: runs in progress first, then the latest finished, with their outcome. */
export function renderTriage(s) {
  const rows = (s.triage ?? []).map((t) => triageCard(t, "full", s.now)).join("");
  return section("triage", "Triage", (s.triage ?? []).length, rows ? cards(rows) : empty("No issue has been triaged yet."));
}

/** Lands: land runs in progress first, then the latest landed. */
export function renderLands(s) {
  const rows = s.delivered.map((j) => landCard(j, "full", s.now)).join("");
  return section("lands", "Lands", s.delivered.length, rows ? cards(rows) : empty("Nothing has landed yet."));
}

/** The job groups, the ones that need attention first: [id, title, count, cards html]. */
function jobGroups(s) {
  return [
    ["needs", "Needs you", s.needs.length, s.needs.map((j) => attentionCard(j, true)).join("")],
    ["stuck", "Stuck or failed", s.stuck.length, s.stuck.map((j) => attentionCard(j, false)).join("")],
    ["running", "Running", s.running.length, s.running.map((j) => runningCard(s, j)).join("")],
    ["waiting", "Waiting", s.waiting.length, s.waiting.map(waitingCard).join("")],
  ];
}

/** Jobs by state: needs you, stuck or failed, running, waiting; a group with no job is left out. */
export function renderJobs(s) {
  const groups = jobGroups(s).filter(([, , n]) => n);
  const total = groups.reduce((a, [, , n]) => a + n, 0);
  const body = groups.map(([id, t, n, html]) => `<div class="grp" id="jobs-${id}"><h3>${esc(t)}<span class="count">${n}</span></h3>${cards(html)}</div>`).join("");
  return section("jobs", "Jobs", total, body || empty("No job is open and no goal waits."), 0);
}

/** "09:05": the time of the state, 24-hour, no date. */
export function renderAsOf(s) {
  return esc(clock(s.now));
}

/** The Pause or Resume button of the page head. */
export function renderControls(s) {
  return s.factory.paused ? ctl("resume", "Resume", true) : ctl("pause", "Pause");
}
const ctl = (verb, label, primary = false) =>
  `<button class="act${primary ? " primary" : ""}" type="button" data-act="${verb}" data-label="${esc(label)}">${esc(label)}</button>`;
