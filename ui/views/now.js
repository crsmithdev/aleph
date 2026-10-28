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
    renderBanner(s) +
    `<div class="page">${renderMetrics(s)}<p class="lede">${renderLede(s)}</p><p class="asof">${renderAsOf(s)}</p>` +
    `<div class="grid"><div>` +
    `<section id="needs" aria-labelledby="h-needs">${renderNeeds(s)}</section>` +
    `<section id="stuck" aria-labelledby="h-stuck">${renderStuck(s)}</section>` +
    `<section id="delivered" aria-labelledby="h-del">${renderDelivered(s)}</section>` +
    `</div><aside class="rail">` +
    `<section id="controls" aria-labelledby="h-ctl">${renderControls(s)}</section>` +
    `<section id="running" aria-labelledby="h-run">${renderRunning(s)}</section>` +
    `<section id="waiting" aria-labelledby="h-wait">${renderWaiting(s)}</section>` +
    `</aside></div></div>`,
};

const count = (n) => `<span class="count">${n}</span>`;
const section = (id, title, n, body, aside = "") =>
  `<div class="sh"><h2 id="h-${id}">${esc(title)}</h2>${count(n)}${aside ? `<span class="aside">${esc(aside)}</span>` : ""}</div>${body}`;

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

/** The commit trailers of a job in a `pre.trailers` block, each key in `<b>`; empty when it has none. */
const trailerBlock = (j) =>
  j.trailers?.length ? `<div class="ev one"><div><h4>Trailers</h4><pre class="trailers">${j.trailers.map((t) => `<b>${esc(t.key)}:</b> ${esc(t.value)}`).join("\n")}</pre></div></div>` : "";

/** An empty section on this page: one quiet line. */
const empty = (line) => `<div class="empty"><p class="hint">${esc(line)}</p></div>`;
const BOX_MIN = 40;
const STAT_FILES = 12;

/** One banner naming what stops or endangers the factory: the health lines first, then the cap and the pause. */
export function renderBanner(s) {
  const f = s.factory;
  const lines = [...f.health];
  if (f.probe && !f.probe.ok && !lines.some((l) => /probe/.test(l))) lines.push(`health: the sandbox probe at ${f.probe.at} failed: ${(f.probe.failed || []).join("; ")}`);
  if (f.hold) lines.push(f.hold);
  if (f.paused) lines.push("The factory is paused; no new run starts. Start it with aleph resume.");
  if (f.dayCap > 0 && f.runsToday >= f.dayCap) lines.push(`The day cap is reached: ${f.runsToday} of ${f.dayCap} runs today; no new run starts.`);
  if (!lines.length) return "";
  return `<div class="banner" role="alert">${lines.map((l, i) => `<p${i ? "" : ' class="first"'}>${esc(l)}</p>`).join("")}</div>`;
}

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

/** The row of metric cards: a count per section, each a link to it. */
export function renderMetrics(s) {
  const card = (href, k, n, tone) => `<a class="metric${n && tone ? ` ${tone}` : ""}" href="#${href}"><span class="k">${k}</span><span class="v">${n}</span></a>`;
  return `<div class="metrics">` +
    card("running", "Running", s.running.length) +
    card("waiting", "Waiting", s.waiting.length) +
    card("stuck", "Stuck", s.stuck.length, "stuck") +
    card("needs", "Need attention", s.needs.length, "need") + `</div>`;
}

export function renderLede(s) {
  const n = (a) => (a.length ? String(a.length) : "none");
  if (s.needs.length) return `<a href="#needs" class="need">${s.needs.length} ${s.needs.length === 1 ? "job needs" : "jobs need"} you.</a> ${s.running.length} running, ${n(s.stuck)} stuck.`;
  return `Nothing needs you. <a href="#running">${s.running.length} running</a>, ${n(s.stuck)} stuck, ${s.waiting.length ? `${s.waiting.length} waiting` : "no goal waiting"}.`;
}

export function renderNeeds(s) {
  const fold = s.needs.length >= 3;
  const cards = s.needs.map((j, i) => {
    const why = j.reason || j.needs || "needs you";
    const head = `<div class="ih">${itemId(j)}${title(j)}</div>`;
    const card = (inner) => fold
      ? `<details class="need-card need-fold" data-keep="need:${esc(j.name)}"${i === 0 ? " open" : ""}><summary><span class="why">${esc(why)}</span>${itemId(j)}<span class="t">${esc(j.item?.title || j.name)}</span></summary>${inner}</details>`
      : `<article class="need-card"><span class="why">${esc(why)}</span>${inner}</article>`;
    return card((fold ? "" : head) +
      `<dl class="facts">${fact("Started", esc(clock(j.started)))}${j.cost !== undefined ? fact("Cost", esc(money(j.cost))) : ""}${j.model ? fact("Model", esc(j.model)) : ""}${checkFacts(j)}</dl>` +
      (j.question ? `<p class="quiet q">${esc(j.question)}</p>` : "") +
      (j.stat ? `<div class="ev one"><div><h4>Diff</h4><pre class="trailers">${statLines(j.stat)}</pre></div></div>` : "") +
      trailerBlock(j) +
      (j.defaults.length ? `<details open><summary>Defaults taken<span class="peek">${j.defaults.length}</span></summary><div class="body"><ul>${j.defaults.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></div></details>` : "") +
      (j.followups.length ? `<details><summary>Follow-ups<span class="peek">${j.followups.length}</span></summary><div class="body"><ul>${j.followups.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></div></details>` : "") +
      `<div class="actions">${act("diff", j.name, "Diff")}${act("land", j.name, "Land", true)}${act("drop", j.name, "Drop")}${actMsg(j.name)}</div>` +
      `<div class="diff-panel" data-diff-for="${esc(j.name)}"${openDiffs.has(j.name) ? `>${diffHtml(openDiffs.get(j.name))}` : " hidden>"}</div>`);
  }).join("");
  return section("needs", "Needs you", s.needs.length, cards || empty("Nothing needs you."));
}

const failed = (j) => (j.checks || []).findLast((c) => !c.ok);

export function renderStuck(s) {
  const rows = s.stuck.map((j) =>
    `<article class="del"><div class="ih">${itemId(j)}${title(j)}<span class="badge stuck">${esc(j.state === "failed" ? "Failed" : "Stuck")}</span></div>` +
    (j.reason ? `<p class="quiet q">${esc(j.reason)}</p>` : "") +
    (failed(j) ? `<p class="quiet q">Last check that failed: <b>${esc(failed(j).name)}</b>, ${esc(failed(j).seconds)} s</p>` : "") +
    `<dl class="facts">${fact("Started", esc(clock(j.started)))}${j.phase ? fact("Phase", esc(j.phase)) : ""}${j.cost !== undefined ? fact("Cost", esc(money(j.cost))) : ""}</dl>` +
    `<div class="actions">${act("recheck", j.name, "Re-check")}${act("drop", j.name, "Drop")}${actMsg(j.name)}</div></article>`).join("");
  return section("stuck", "Stuck", s.stuck.length, rows || empty("No run is stuck."));
}

export function renderRunning(s) {
  const rows = s.running.map((j) =>
    `<div class="run-row"><div class="ih">${itemId(j)}<span class="badge run">${esc(j.phase || j.state)}</span></div>` +
    `<div class="t">${esc(j.item?.title || j.name)}</div>` +
    `<div class="run-meta"><span class="num">Started ${esc(clock(j.started))}, ${Date.parse(s.now) - Date.parse(j.started) > BOX_MIN * 60_000 ? `<span class="over">${esc(span(j.started, s.now))} ago, past the time box</span>` : `${esc(span(j.started, s.now) || "0 min")} ago`}</span></div></div>`).join("");
  return section("run", "Running", s.running.length, rows || empty("Nothing is running."));
}

/** "14:05" for a land today, "26 Oct 14:05" for an older one. */
const landedAt = (iso, now) =>
  new Date(iso).toDateString() === new Date(now).toDateString() ? clock(iso)
    : `${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${clock(iso)}`;

export function renderDelivered(s) {
  const rows = s.delivered.map((j) => {
    const sha = j.commit ? esc(j.commit.slice(0, 7)) : "";
    const commit = j.commit ? (j.commitUrl ? `<a href="${esc(j.commitUrl)}"><code>${sha}</code></a>` : `<code>${sha}</code>`) : "";
    return `<article class="del"><div class="ih">${itemId(j)}${title(j)}<span class="badge done">Landed</span></div>` +
      `<dl class="facts">${commit ? fact("Commit", commit) : ""}${j.ended ? fact("Landed", esc(landedAt(j.ended, s.now))) : ""}${j.cost !== undefined ? fact("Cost", esc(money(j.cost))) : ""}${checkFacts(j)}</dl>` +
      trailerBlock(j) +
      (j.check === "open" || actMessages.has(j.name) ? `<div class="actions">${j.check === "open" ? act("checked", j.name, "Checked", true) : ""}${actMsg(j.name)}</div>` : "") + `</article>`;
  }).join("");
  return section("del", "Delivered", s.delivered.length, rows || empty("Nothing has landed yet."), "the last 10, on origin/main");
}

export function renderWaiting(s) {
  const rows = s.waiting.map((w) => `<div class="run-row"><div class="ih"><span class="id">${esc(w.repo)}-${esc(w.id)}</span></div><div class="t">${esc(w.title)}</div></div>`).join("");
  return section("wait", "Waiting", s.waiting.length, rows || empty("No goal waits to start."));
}

export function renderAsOf(s) {
  return `As of ${esc(new Date(s.now).toLocaleString([], { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }))}.`;
}

/** The Controls panel: pause or resume. */
export function renderControls(s) {
  return `<div class="sh"><h2 id="h-ctl">Controls</h2></div>` +
    `<div class="actions">${s.factory.paused ? ctl("resume", "Resume", true) : ctl("pause", "Pause")}</div>`;
}
const ctl = (verb, label, primary = false) =>
  `<button class="act${primary ? " primary" : ""}" type="button" data-act="${verb}" data-label="${esc(label)}">${esc(label)}</button>`;
