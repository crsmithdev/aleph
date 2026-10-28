// The Now view: the factory's front page. Each render function takes the
// /api/state object and returns an HTML string. No DOM, so tests can call them.
// The page's click handler (index.html) runs the buttons `act` makes.
import { actMessages, clock, cmd, diffHtml, esc, money, openDiffs, span } from "../lib.js";

export const view = {
  path: "/",
  title: "Status",
  group: "factory",
  order: 0,
  api: "/api/state",
  refresh: 15,
  render: (s) =>
    `<div class="page">${renderMetrics(s)}<p class="lede">${renderLede(s)}</p><div class="head">${renderControls(s)}<span class="sep" aria-hidden="true">|</span><p class="asof">${renderAsOf(s)}</p></div>` +
    `<div class="grid"><div>` +
    `<section id="needs" aria-labelledby="h-needs">${renderNeeds(s)}</section>` +
    `<section id="delivered" aria-labelledby="h-del">${renderLands(s)}</section>` +
    `</div><aside class="rail">` +
    `<section id="running" aria-labelledby="h-run">${renderRunning(s)}</section>` +
    `<section id="waiting" aria-labelledby="h-wait">${renderWaiting(s)}</section>` +
    `</aside></div></div>`,
};

/** The count of a section: `N / cap` where a cap applies. */
const section = (id, title, n, body, cap) =>
  `<div class="sh"><h2 id="h-${id}">${esc(title)}</h2><span class="count">${n}${cap > 0 ? ` / ${cap}` : ""}</span></div>${body}`;

const itemId = (j) => `<span class="id">${esc(j.name)}</span>`;
const title = (j) => `<h3>${esc(j.item?.title || j.name)}</h3>`;
/** A button the page wires to /api/<verb>/<name>; Land and Drop ask for a second click. */
const actMsg = (name) => (actMessages.has(name) ? `<span class="act-msg" role="alert">${esc(actMessages.get(name))}</span>` : "");

const act = (verb, name, label, primary = false) =>
  `<button class="act${primary ? " primary" : ""}" type="button" data-act="${verb}" data-name="${esc(name)}" data-label="${esc(label)}">${esc(label)}</button>`;
const fact = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
/** The checks of a run as facts: `Tests 71 s ✓`. */
const checkFacts = (j) =>
  (j.checks || []).map((c) => fact(c.name.charAt(0).toUpperCase() + c.name.slice(1), `${esc(String(c.seconds))} s ${c.ok ? "✓" : "✗"}`)).join("");

/** The trailers of a job as one small line: `Item aleph-114 · Job 20261027-… · Held-by Chris`; empty when it has none. */
const trailerLine = (j) =>
  j.trailers?.length ? `<p class="trailers-line">${j.trailers.map((t) => `${esc(t.key)} ${esc(t.value)}`).join(" · ")}</p>` : "";

/** One job card, large (id and title, facts, a trailers line) or small (two lines). */
const jobCard = (size, cls, inner, tag = "article") => `<${tag} class="job-card ${size} ${cls}">${inner}</${tag}>`;

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

/** The row of metric cards: a count per section, each a link to it; Landed and Triaged are velocity cards. */
export function renderMetrics(s) {
  const card = (href, k, n, tone) => `<a class="metric${n && tone ? ` ${tone}` : ""}" href="#${href}"><span class="k">${k}</span><span class="v">${n}</span></a>`;
  const vcard = (href, k, v) => `<a class="metric" href="#${href}"><span class="k">${k}</span><span class="v">${v?.day ?? 0}</span><span class="sub">${velocity(v)}</span></a>`;
  return `<div class="metrics">` +
    card("running", "Running", s.running.length) +
    card("waiting", "Waiting", s.waiting.length) +
    card("needs", "Need attention", s.needs.length + s.stuck.length, "need") +
    card("running", "Landing", s.landing ?? 0) +
    card("waiting", "New", s.newIssues ?? 0) +
    vcard("delivered", "Landed", s.velocity?.landed) +
    vcard("delivered", "Triaged", s.velocity?.triaged) + `</div>`;
}

export const FINE = ["Everything is fine.", "All is well.", "Nothing needs you.", "All quiet."];
const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

/** The status sentence: all fine, or a count of what needs attention and the items as links; notices under it, muted. */
export function renderLede(s) {
  const f = s.factory;
  const problems = []; // [tone, html]
  const notices = [];
  if (s.needs.length) problems.push(["warning", `<a href="#needs">${s.needs.length} ${s.needs.length === 1 ? "job needs" : "jobs need"} you</a>`]);
  if (s.stuck.length) problems.push(["error", `<a href="#needs">${s.stuck.length} ${s.stuck.length === 1 ? "job is" : "jobs are"} stuck or failed</a>`]);
  const health = [...(f.health || [])];
  if (f.probe && !f.probe.ok && !health.some((l) => /probe/.test(l))) health.push(`health: the sandbox probe at ${f.probe.at} failed: ${(f.probe.failed || []).join("; ")}`);
  for (const l of health) {
    const text = l.replace(/^health:\s*/, "");
    if (/passed on rerun/.test(text)) notices.push(text);
    else problems.push(["error", `<a href="#needs">${esc(text)}</a>`]);
  }
  if (f.hold) problems.push(["error", `<a href="#needs">${esc(f.hold)}</a>`]);
  if (f.paused) problems.push(["warning", "The factory is paused"]);
  if (f.dayCap > 0 && f.runsToday >= f.dayCap) problems.push(["warning", "The day cap is reached"]);
  const n = problems.length;
  const small = notices.length ? `<span class="notices">${notices.map((l) => `<span class="notice">${esc(l)}</span>`).join("")}</span>` : "";
  if (!n) return `<span class="say fine">${FINE[Math.floor(Math.random() * FINE.length)]}</span>${small}`;
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

/** Needs attention: the held runs first, then the stuck and failed ones. */
export function renderNeeds(s) {
  return section("needs", "Needs attention", s.needs.length + s.stuck.length, renderHeld(s) + renderStuck(s) || empty("Nothing needs attention."));
}

function renderHeld(s) {
  const fold = s.needs.length >= 3;
  const cards = s.needs.map((j, i) => {
    const why = j.reason || j.needs || "needs you";
    const head = `<div class="ih">${itemId(j)}${title(j)}</div>`;
    const card = (inner) => fold
      ? `<details class="job-card big need-card need-fold" data-keep="need:${esc(j.name)}"${i === 0 ? " open" : ""}><summary><span class="why">${esc(why)}</span>${itemId(j)}<span class="t">${esc(j.item?.title || j.name)}</span></summary>${inner}</details>`
      : `<article class="job-card big need-card"><span class="why">${esc(why)}</span>${inner}</article>`;
    return card((fold ? "" : head) + agentLine(j) +
      `<dl class="facts">${fact("Started", esc(clock(j.started)))}${j.cost !== undefined ? fact("Cost", esc(money(j.cost))) : ""}${j.model ? fact("Model", esc(j.model)) : ""}${checkFacts(j)}</dl>` +
      (j.question ? `<p class="quiet q">${esc(j.question)}</p>` : "") +
      (j.stat ? `<div class="ev one"><div><h4>Diff</h4><pre class="stat">${statLines(j.stat)}</pre></div></div>` : "") +
      trailerLine(j) +
      reviewLine(j) +
      (j.defaults.length ? `<details open><summary>Defaults taken<span class="peek">${j.defaults.length}</span></summary><div class="body"><ul>${j.defaults.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></div></details>` : "") +
      (j.followups.length ? `<details><summary>Follow-ups<span class="peek">${j.followups.length}</span></summary><div class="body"><ul>${j.followups.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></div></details>` : "") +
      `<div class="actions">${act("diff", j.name, "Diff")}${act("land", j.name, "Land", true)}${act("drop", j.name, "Drop")}${actMsg(j.name)}</div>` +
      `<div class="diff-panel" data-diff-for="${esc(j.name)}"${openDiffs.has(j.name) ? `>${diffHtml(openDiffs.get(j.name))}` : " hidden>"}</div>`);
  }).join("");
  return cards;
}

const failed = (j) => (j.checks || []).findLast((c) => !c.ok);

function renderStuck(s) {
  const rows = s.stuck.map((j) =>
    `<article class="job-card big del"><div class="ih">${itemId(j)}${title(j)}<span class="badge stuck">${esc(j.state === "failed" ? "Failed" : "Stuck")}</span></div>` + agentLine(j) +
    (j.reason ? `<p class="quiet q">${esc(j.reason)}</p>` : "") +
    (failed(j) ? `<p class="quiet q">Last check that failed: <b>${esc(failed(j).name)}</b>, ${esc(failed(j).seconds)} s</p>` : "") +
    `<dl class="facts">${fact("Started", esc(clock(j.started)))}${j.phase ? fact("Phase", esc(j.phase)) : ""}${j.cost !== undefined ? fact("Cost", esc(money(j.cost))) : ""}</dl>` + trailerLine(j) +
    `<div class="actions">${act("recheck", j.name, "Re-check")}${act("drop", j.name, "Drop")}${actMsg(j.name)}</div></article>`).join("");
  return rows;
}

export function renderRunning(s) {
  const rows = s.running.map((j) => {
    const run = j.run ?? { kind: "agent", started: j.started };
    const kind = run.kind === "agent" ? "worker" : run.kind;
    const over = run.kind === "agent" && Date.parse(s.now) - Date.parse(run.started) > BOX_MIN * 60_000;
    const ago = over ? `<span class="over">${esc(span(run.started, s.now))} ago, past the time box</span>` : `${esc(span(run.started, s.now) || "0 min")} ago`;
    return jobCard("small", "run-row", `<div class="ih">${itemId(j)}<span class="t">${esc(j.item?.title || j.name)}</span></div>` +
      `<div class="run-meta"><span class="badge run">${esc(kind)}${j.phase && j.phase !== kind ? ` · ${esc(j.phase)}` : ""}</span> <span class="num">Started ${esc(clock(run.started))}, ${ago}</span></div>`, "div");
  }).join("");
  return section("run", "Running", s.running.length, rows || empty("Nothing is running."), s.factory.liveCap);
}

/** "14:05" for a land today, "26 Oct 14:05" for an older one. */
const landedAt = (iso, now) =>
  new Date(iso).toDateString() === new Date(now).toDateString() ? clock(iso)
    : `${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${clock(iso)}`;

/** Lands: land runs in progress first, then the latest landed. */
export function renderLands(s) {
  const rows = s.delivered.map((j) => {
    const landed = j.state === "landed";
    const sha = j.commit ? esc(j.commit.slice(0, 7)) : "";
    const commit = j.commit ? (j.commitUrl ? `<a href="${esc(j.commitUrl)}"><code>${sha}</code></a>` : `<code>${sha}</code>`) : "";
    return jobCard("big", "del", `<div class="ih">${itemId(j)}${title(j)}<span class="badge ${landed ? "done" : "run"}">${landed ? "Landed" : "Landing"}</span></div>` +
      `<dl class="facts">${commit ? fact("Commit", commit) : ""}${landed && j.ended ? fact("Landed", esc(landedAt(j.ended, s.now))) : ""}${!landed ? fact("Started", esc(clock(j.started))) : ""}${j.cost !== undefined ? fact("Cost", esc(money(j.cost))) : ""}${checkFacts(j)}</dl>` +
      trailerLine(j) +
      (j.check === "open" || actMessages.has(j.name) ? `<div class="actions">${j.check === "open" ? act("checked", j.name, "Checked", true) : ""}${actMsg(j.name)}</div>` : ""));
  }).join("");
  return section("del", "Lands", s.delivered.length, rows || empty("Nothing has landed yet."));
}
export const renderDelivered = renderLands;

export function renderWaiting(s) {
  const rows = s.waiting.map((w) => jobCard("small", "run-row", `<div class="ih"><span class="id">${esc(w.repo)}-${esc(w.id)}</span><span class="t">${esc(w.title)}</span></div><div class="run-meta">Waiting to start</div>`, "div")).join("");
  return section("wait", "Waiting", s.waiting.length, rows || empty("No goal waits to start."));
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
