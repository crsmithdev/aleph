// The Now view: the factory's front page. Each render function takes the
// /api/state object and returns an HTML string. No DOM, so tests can call them.
// The page's click handler (index.html) runs the buttons `act` makes.
import { actButton, clock, codeText, contentText, facts, tiles, badge, card, sectionHead, meter, dataTable, denyReasons, diffHtml, dur, costHtml, empty, error, esc, hashQuery, idLink, mean, keep, kept, keepProject, keepWindow, loadingLine, pageHead, projectNow, scopeBar, windowOf, wireScope, withProject, localId, openDiffs, parseId, priorityBadge, repoIdLink, shortModel, sortHead, sortRows, nextSort, tag, when } from "../lib.js";
import { NAMES } from "../../lib/naming.ts";
import { bar, loadSpeed, speedOf, statusCards, usable } from "./speed.js";
import { act, actMsg, checkFacts, itemId, shell as jobCard, trailerLine } from "./cards.js";
import { ALERT, ASK, FINE, isAlert, isWarn, JOBS_UNHEALTHY, labelOf, lead, PAUSED, TICK_STOPPED, WEEKLY_WARN, weekly } from "./status-words.js";

export const view = {
  path: "/",
  title: "Status",
  group: "factory",
  order: -3,
  icon: "gauge-high",
  api: (_params, q = new URLSearchParams()) => withProject("/api/state", q),
  refresh: 60,
  live: true,
  render: (s, _params, q) => { lastState = s; const w = windowOf(q); return `<div class="page sp">${renderStatusLine(s, outOfDateNow, w)}${tiles("Scorecard", renderTiles(s, usable(w), w), "scorecard")}<div class="rail"><div class="rail-main">${renderOutcome(speedOf(w))}${renderPipeline(speedOf(w))}</div>${renderHerald(s)}</div></div>`; },
  // The shell calls this when the out-of-date verdict changes: the sentence is drawn again from the last state.
  outOfDate: (root, b) => { outOfDateNow = b; const el = root.querySelector(".shead .say"); if (el && lastState) el.outerHTML = renderLede(lastState, b); },
  mount: (root, s, q) => mountStatus(root, s, fetch, q),
};

let lastState = null, outOfDateNow = false;

const EFFICIENCY = "#/factory/efficiency", PERFORMANCE = "#/factory/jobs";
/** A link to another page that keeps the window; week is the default and stays out of the address. */
const withWindow = (href, win) => (win === "week" ? href : `${href}?window=${win}`);

/** The scorecard: lost time, completion, landed, queue wait, usage. `d` is /api/speed for the window `win` with its baseline, or null while it loads. */
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
/** The stage the Pipeline card shows the worst issues of; "" for all stages. It stays per reader through keep(). */
const PIPE_KEY = "status/pipeline";
const pipeOn = () => { const k = kept(PIPE_KEY, ""); return Object.hasOwn(PIPE, k) ? k : ""; };

/**
 * The Pipeline card for the window: each stage with its runs per issue and p90 runtime, and a button that picks it;
 * then the picked stage's (or all stages') Reliability, the issues with the most failed runs, and Performance, the
 * issues with the most time. `d` is /api/speed for the window, null while it loads, or `{ error }`.
 */
export function renderPipeline(d, on = pipeOn()) {
  const box = (body, aside = "") => card("Pipeline", body, { id: "pipeline", aside });
  if (!d) return box(loadingLine("the pipeline"));
  if (d.error) return box(error(d.error));
  const by = new Map((d.stages?.rows ?? []).map((r) => [r.stage, r]));
  const node = ([k, name]) => {
    const r = by.get(k), n = r?.items ? r.runs / r.items : null, tip = r ? `${name}: ${r.runs} runs on ${r.items} issues${r.unusable ? `, ${r.unusable} failed` : ""}` : `${name}: no run`;
    return `<button type="button" class="pnode${n === null ? " idle" : ""}" data-stage="${esc(k)}" aria-pressed="${k === on}" title="${esc(tip)}"><span class="pn">${esc(k)}</span>` +
      `<span class="pv">${n === null ? "–" : `${mean(n)}<span class="pu"> / issue</span>`}</span><span class="pt">${n === null ? "idle" : esc(dur(r.p90))}</span></button>`;
  };
  const w = d.stages?.worst?.[on || "all"] ?? { errors: [], slow: [] }, name = on ? PIPE[on] : "Pipeline";
  const row = (t, value) => `<div class="worst-row">${repoIdLink(t.issue, t.href)}<span class="t" title="${esc(t.title ?? t.issue)}">${esc(t.title ?? t.issue)}</span><span class="num">${value}</span></div>`;
  const list = (title, what, rows, none) => `<div class="worst"><div class="worst-head"><span>${esc(title)}</span><span>${what}</span></div>${rows.join("") || empty(none)}</div>`;
  const worst = `<div class="worsts">` +
    list(`${name} Reliability`, "failed runs", w.errors.map((t) => row(t, `${t.unusable} of ${t.runs}`)), "No run failed in this window.") +
    list(`${name} Performance`, "time in all runs", w.slow.map((t) => row(t, esc(dur(t.secs)))), "No run ended in this window.") + `</div>`;
  return box(`<div class="pflow" role="group" aria-label="Stages">${Object.entries(PIPE).map(node).join("")}</div>${worst}`, `<span class="asof">runs / issue · p90 runtime</span>`);
}

/** A click on a stage picks it, and a click on the picked stage picks all stages; the card is drawn again from the last speed. The listener sits on `.rail`, which each render replaces. */
function wirePipeline(root, w) {
  root.querySelector?.(".rail")?.addEventListener?.("click", (e) => {
    const b = e.target.closest?.("#pipeline button[data-stage]");
    if (!b) return;
    keep(PIPE_KEY, b.dataset.stage === pipeOn() ? "" : b.dataset.stage);
    root.querySelector("#pipeline").outerHTML = renderPipeline(speedOf(w));
    root.querySelector(`#pipeline button[data-stage="${b.dataset.stage}"]`)?.focus();
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

let clientEvents = [];

/** Extract the plain-text status line verdict and reasons from state. */
export function statusVerdict(s, stale = false) {
  const safe = { factory: {}, stuck: [], asks: [], ...s };
  const html = renderLede(safe, stale);
  const m = html.match(/^<span class="say (\w+)">([\s\S]*?)<\/span>$/);
  const toneClass = m ? m[1] : "fine";
  const raw = m ? m[2] : html;
  const text = raw.replace(/<[^>]+>/g, "").trim();
  const tone = toneClass === "error" ? "alert" : toneClass === "warning" ? (text.startsWith(lead(ASK)) ? "ask" : "warning") : "fine";
  return { tone, label: labelOf(tone, text), text, toneClass };
}

/** Record a client-side transition if state changed. */
function trackStatusEvent(s, stale = false) {
  const v = statusVerdict(s, stale);
  const last = clientEvents[0];
  if (!last || last.text !== v.text || last.tone !== v.tone) {
    clientEvents.unshift({
      at: s.now || new Date().toISOString(),
      tone: v.tone,
      label: v.label,
      text: v.text,
    });
    if (clientEvents.length > 50) clientEvents.pop();
  }
}

/** The Herald panel: sticky alerts on top, rolling event history stream below. */
export function renderHerald(s) {
  const cur = statusVerdict(s, outOfDateNow);
  trackStatusEvent(s, outOfDateNow);
  // An error is not pinned: the newest event already says it, and is marked live instead.
  const asks = (s.asks ?? []).map((i) => askRow(i, s.now));
  const stuck = (s.stuck ?? []).map(stuckRow(s));
  const errs = errorLines(s), errors = errs.length;
  const pinnedCount = asks.length + stuck.length + errors;
  const group = (id, n, html, wrap) => (n ? `<div class="grp" id="${id}">${wrap(html)}</div>` : "");

  const sticky = asks.length + stuck.length > 0
    ? `<section id="needs" class="needs herald-sticky" aria-label="Alerts">` +
        group("awaiting", asks.length, asks.join(""), list) +
        group("jobs-stuck", stuck.length, stuck.join(""), list) +
      `</section>`
    : "";

  let history = (s.herald?.history?.length ? s.herald.history : clientEvents).map((x) => ({ ...x }));
  if (!history.length) {
    history = [{ at: s.now || new Date().toISOString(), tone: cur.tone, label: cur.label, text: cur.text }];
  } else if (history[0].text.replace(/\.$/, "") !== cur.text.replace(/\.$/, "") || (history[0].text === cur.text && history[0].tone !== cur.tone)) {
    const diff = Math.abs(Date.parse(history[0].at || "") - Date.parse(s.now || ""));
    if (diff < 60000 && history[0].text.startsWith(cur.text.split(";")[0])) {
      history[0] = { at: history[0].at || s.now, tone: cur.tone, label: cur.label, text: cur.text };
    } else {
      history.unshift({ at: s.now || new Date().toISOString(), tone: cur.tone, label: cur.label, text: cur.text });
    }
  }

  const feed = history.map((ev, i) =>
    `<div class="event-row ${esc(ev.tone)}${i === 0 && errors ? " live" : ""}">` +
      `<span class="event-time">${esc(ev.at ? (clock(ev.at) || when(ev.at)) : "")}</span>` +
      `<span class="event-tone ${esc(ev.tone)}"><span class="event-dot ${esc(ev.tone)}"></span>${esc(ev.label || ev.tone)}</span>` +
      `<span class="event-body ${esc(ev.tone)}">${esc(eventText(ev))}${(i === 0 && errors ? errs : ev.reason ? [ev.reason] : []).filter((l) => !ev.text.includes(l)).map((l) => `<span class="reason">${esc(l)}</span>`).join("")}</span>` +
    `</div>`
  ).join("");

  const tab = (k, label, n) => `<button type="button" role="tab" data-herald-tab="${k}" aria-selected="${heraldTab === k}">${label} <span class="count">${n}</span></button>`;
  const issues = heraldIssues(s);
  const m = s.factory?.monitor;
  const monitorFindings = m?.findings?.length
    ? `<details class="more herald-findings" data-keep="herald:findings"><summary>Daily Monitor (${esc(m.day)})</summary><ol class="findings">${m.findings.map((f) => `<li>${findingHtml(f)}</li>`).join("")}</ol></details>`
    : "";

  // A stuck job or an error outranks an Ask: the badge takes the worst alert's tone.
  const badgeHtml = pinnedCount > 0 ? tag(`${pinnedCount} active`, stuck.length || errorLines(s).length ? "stuck" : "need") : tag("Calm", "done");

  return `<section id="herald" class="card herald-card" aria-label="Herald">` +
    `<div class="sh"><h2 id="h-herald">Herald</h2><div class="aside">${badgeHtml}</div></div>` +
    sticky +
    `<div class="tabs herald-tabs" role="tablist">${tab("events", "Events", history.length)}${tab("issues", "Issues", issues.n)}</div>` +
    `<div class="herald-feed">${heraldTab === "issues" ? issues.html : feed}</div>` +
    monitorFindings +
  `</section>`;
}

/** An event's text without what the row already shows: the tone label before it, and the "health: " of each health line. */
const eventText = (ev) => {
  const head = `${ev.label || ev.tone}: `;
  return (ev.text.startsWith(head) ? ev.text.slice(head.length) : ev.text).replace(/(^|; )health: /g, "$1");
};

/** The Herald tab on show; it stays across refreshes. */
let heraldTab = "events";

/** The Issues tab: one column of three lists. Running (pinned), Queued, and Done today against all three, folded. */
export function heraldIssues(s) {
  // Today is the local day, as every time on the page is local.
  const day = new Date(s.now).toDateString();
  const row = (id, chip, title) => `<div class="hi-row">${id}${chip}<span class="t" title="${esc(title)}">${esc(title)}</span></div>`;
  const running = [
    ...(s.runningIssues ?? []).map((i) => row(repoIdLink(i.id, i.href), badge(i.stage), i.title)),
    ...(s.running ?? []).map((j) => row(itemId(j), badge("running"), j.item?.title || j.name)),
  ];
  const queued = (s.queued ?? []).map((w) => row(repoIdLink(`${w.repo}-${w.id}`, `#/issues/${encodeURIComponent(w.repo)}/${encodeURIComponent(w.id)}`, w.repo), badge(w.stage ?? "queued"), w.title));
  const done = (s.done ?? []).filter((i) => i.finished && new Date(i.finished).toDateString() === day).map((i) => row(repoIdLink(i.id, i.href), badge("landed"), i.title));
  const total = running.length + queued.length + done.length;
  const sec = (title, n, rows, cls = "") => `<div class="hi-sec ${cls}"><div class="hi-head">${title} <span class="count">${n}</span></div>${rows.join("")}</div>`;
  // Done is folded and quiet by default; a reader who opens it keeps it open.
  const doneSec = `<details class="hi-sec hi-done" data-keep="herald:done"><summary class="hi-head">Done <span class="count">${done.length} / ${total}</span></summary>${done.join("")}</details>`;
  return { n: total, html: total ? sec("Running", running.length, running, "pin") + sec("Queued", queued.length, queued) + doneSec : empty("No issue is in flight.") };
}

/** A click on a Herald tab shows that tab; the panel is drawn again from the last state. The listener sits on `.rail`, which each render replaces, so listeners do not pile up. */
function wireHeraldTabs(root) {
  root.querySelector?.(".rail")?.addEventListener?.("click", (e) => {
    const b = e.target.closest?.("[data-herald-tab]");
    if (!b || !lastState) return;
    heraldTab = b.dataset.heraldTab;
    const h = root.querySelector("#herald");
    if (h) h.outerHTML = renderHerald(lastState);
  });
}

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
export async function mountStatus(root, s, fetcher = fetch, q) {
  const w = windowOf(q ?? (typeof location === "undefined" ? undefined : hashQuery()));
  keepWindow(w);
  keepProject(projectNow());
  wireScope(root);
  wireHeraldTabs(root);
  wireHeraldJump(root);
  wirePipeline(root, w);
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

const MAX_SAID = 3;

/** What the status sentence says for an error line, most serious first. A line with no entry is said as it is, after these. */
const ALERTS = [
  [/ CI on main has failed/, "GitHub CI is broken"],
  [/main is red/, "the build is failing on main"],
  [new RegExp(TICK_STOPPED), TICK_STOPPED],
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
  if (asks.length) said.push([alerts.size || f.paused || stale ? ASK : lead(ASK), "#awaiting"]);
  const alert = alerts.size > 0;
  if (f.paused && alert) said.push([PAUSED, ""]);
  const week = s.usage?.now?.seven_day;
  if (week >= WEEKLY_WARN) said.push([weekly(week), ""]);
  for (const l of f.health || []) if (isWarn(l)) said.push([localId(l.replace(/^health:\s*/, "")), ""]);
  const parts = said.slice(0, MAX_SAID).map(([t, href]) => (href ? `<a href="${href}">${esc(t)}</a>` : esc(t))).join("; ");
  if (stale) return `<span class="say error">${ALERT}this status is out of date${parts ? `; ${parts}` : ""}.</span>`;
  if (alert) return `<span class="say error">${ALERT}${parts}.</span>`;
  if (asks.length && !f.paused) return `<span class="say warning">${parts}.</span>`;
  const head = f.paused ? lead(PAUSED) : FINE;
  return `<span class="say ${parts || f.paused ? "warning" : "fine"}">${head}${parts ? `; ${parts}` : ""}.</span>`;
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

/** The meta row, line 1 of every card: id, status chip, priority chip, "n/m", date, duration. `chips` is HTML. */
function metaRow({ id, chips, part, at, since, now, end }) {
  return `<div class="ih">${id}${chips}${partLink(part)}<span class="num date">${esc(when(at) || "–")}</span><span class="num dur">${esc(span(since, end ?? now))}</span></div>`;
}

/** The time from `since` to `to` as `dur` writes it; "–" when the work was never picked up. */
export function span(since, to) {
  const ms = Date.parse(to) - Date.parse(since);
  if (!since || !(ms >= 0)) return "–";
  return dur(ms / 1000);
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
  const out = (f.health || []).map((l) => l.replace(/^health:\s*/, "")).filter(isAlert).map((l) => localId(l));
  if (f.nextTick !== undefined && f.tickInProgress !== true) {
    if (f.nextTick === null) out.push(`${TICK_STOPPED}: aleph-tick.timer has no next run`);
    else if (Date.parse(s.now) - Date.parse(f.nextTick) > TICK_GRACE_MS) out.push(`${TICK_STOPPED}: aleph-tick.timer was due at ${f.nextTick}`);
  }
  return [...new Set(out)];
}

/** The agent line of a held or stuck job: a live run exists for it. */
const agentLine = (j) => (j?.agent ? `<span class="agent">Agent working</span>` : "");
/** One Jobs card in the compact size: the id, the title, one sentence of why, the buttons; `jobDetails` is the one Details behind it. */
/** The one Details behind a stuck row: the blocker, the whole reason, then the job's details. */
const jobDetails = (s, j) => details(s, j,
  (j.blocker ? `<p class="quiet q">Blocker <a href="${esc(j.blocker.href)}">${esc(j.blocker.id)}</a>: ${esc(j.blocker.title)}</p>` : "") +
  (j.reason ? `<p class="quiet q">${esc(j.reason)}</p>` : ""));

const jobHref = (j) => `#/jobs/${encodeURIComponent(j.name)}`;
/** A stuck, failed or error card in the Ask card structure and the red tone: `meta` and the fold sit inside the box; `body` follows the fold. An empty `problem` leaves the situation line out. */
const alertCard = (kind, key, meta, title, problem, body = "") =>
  askShell(kind, `data-kind="${kind}" data-card="unstick"`, key, meta, kind === "error" ? "Error" : "Stuck", title, "", problem ? `<p class="situation">${esc(problem)}</p>` : "", body);
/** The Ask card structure: the article with `cls` and `attrs`, then the box with `meta`, the fold of `label`, `title` and `tag` over `desc`, and `rest`. */
const askShell = (cls, attrs, key, meta, label, title, tag, desc, rest) =>
  `<article class="job-card small issue-row ${cls}" ${attrs}>` +
  `<div class="ask-box">${meta}<details class="ask-fold" data-keep="ask:${esc(key)}"><summary class="ask-head"><span class="ask-dot" aria-hidden="true"></span><span class="t"><b class="ask-kind">${esc(label)}:</b> <span class="ask-title">${esc(title)}</span></span>${tag ? `<span class="ask-tag">${esc(tag)}</span>` : ""}</summary>${desc}</details>${rest}</div></article>`;
const stuckRow = (s) => (j) => {
  const b = j.blocker;
  const blocker = b && localId(b.id, j.repo);
  // A failed check names the check, as the news lines do; any other cause stays the state and cause.
  const check = j.cause === "check" && contentText({ file: j.checkName });
  const hold = b ? holdLine({ action: "after", on: [b.id] }) : [j.condition, j.cause, check].filter(Boolean).join(" ");
  const first = b ? actButton(`Wait for ${blocker}`, { act: "wait", name: j.name, on: b.id, label: `Wait for ${blocker}` }, { primary: true }) : act("recheck", j.name, "Re-check");
  const meta = metaRow({ id: repoIdLink(j.name, jobHref(j), j.repo), chips: j.item?.priority ? priorityBadge(j.item.priority) : "", part: j.part, at: j.run?.started ?? j.started, since: j.started, now: s.now });
  const opt = (button, hint) => `<div class="choice">${button}<div class="choice-text"><span class="effect">${codeText(hint)}</span></div></div>`;
  return alertCard("stuck", j.name, meta, j.item?.title || j.name, hold,
    `<div class="actions choices">${opt(first, b ? `Makes the issue run after ${blocker} and drops the stuck job; nothing starts until ${blocker} lands.` : "Runs the job again.")}${opt(act("drop", j.name, "Drop"), "Discards the job's branch; the issue stays open.")}${actMsg(j.name)}</div>` +
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
const errorRow = (l) => alertCard("error", l, "", `${/main is red/.test(l) ? "fix" : "check"} ${l}`, "");

/** "10/28 14:05": the time of the state. */
const renderAsOf = (s) => when(s.now);

/** The Pause or Resume button of the page head. */
export function renderControls(s) {
  return s.factory.paused ? ctl("resume", "Resume") : ctl("pause", "Pause");
}
const ctl = (verb, label) =>
  actButton(label, { act: verb, label }, { cls: "warn" });
