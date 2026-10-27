// The Now view: the factory's front page. Each render function takes the
// /api/state object and returns an HTML string. No DOM, so tests can call them.
import { clock, cmd, empty, esc, money, span } from "../lib.js";

export const view = {
  path: "/",
  title: "Now",
  group: "factory",
  order: 0,
  api: "/api/state",
  refresh: 15,
  render: (s) =>
    `<header class="strip">${renderHeader(s)}</header>` +
    `<div class="page"><p class="lede">${renderLede(s)}</p><p class="asof">${renderAsOf(s)}</p>` +
    `<div class="grid"><div>` +
    `<section id="needs" aria-labelledby="h-needs">${renderNeeds(s)}</section>` +
    `<section id="stuck" aria-labelledby="h-stuck">${renderStuck(s)}</section>` +
    `<section id="delivered" aria-labelledby="h-del">${renderDelivered(s)}</section>` +
    `</div><aside class="rail">` +
    `<section id="running" aria-labelledby="h-run">${renderRunning(s)}</section>` +
    `<section id="waiting" aria-labelledby="h-wait">${renderWaiting(s)}</section>` +
    `<section id="ticks" aria-labelledby="h-ticks">${renderTicks(s)}</section>` +
    `</aside></div></div>`,
};

const count = (n) => `<span class="count">${n}</span>`;
const section = (id, title, n, body, aside = "") =>
  `<div class="sh"><h2 id="h-${id}">${esc(title)}</h2>${count(n)}${aside ? `<span class="aside">${esc(aside)}</span>` : ""}</div>${body}`;

const itemId = (j) => `<span class="id">${esc(j.name)}</span>`;
const title = (j) => `<h3>${esc(j.item?.title || j.name)}</h3>`;
const fact = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;

export function renderHeader(s) {
  const f = s.factory;
  const pips = Array.from({ length: Math.min(f.dayCap, 40) }, (_, i) => `<i${i < f.runsToday ? ' class="on"' : ""}></i>`).join("");
  const next = f.nextTick ? `${esc(clock(f.nextTick))}<small>${Date.parse(f.nextTick) > Date.parse(s.now) ? `in ${esc(span(s.now, f.nextTick))}` : "due"}</small>` : "unknown";
  const probe = f.probe ? `${f.probe.ok ? "Passed" : "Failed"}<small>${f.probe.ok ? `at ${esc(clock(f.probe.at))}` : esc((f.probe.failed || []).join(", "))}</small>` : "none yet";
  const cell = (k, v, cls = "") => `<div class="cell"><div class="k">${k}</div><div class="v${cls}">${v}</div></div>`;
  const health = f.health.length
    ? cell("Health", f.health.map((l) => `<small>${esc(l)}</small>`).join(""), " health")
    : "";
  return `<div class="strip-in"><div class="cells">` +
    cell("Factory", f.paused ? `<span class="dot off"></span>Paused<small>start: <code>aleph resume</code></small>` : `<span class="dot"></span>On<small>stop: <code>aleph pause</code></small>`) +
    cell("Next tick", next, " num") +
    cell("Runs today", `${f.runsToday} of ${f.dayCap}<span class="pips" aria-hidden="true">${pips}</span>`, " num") +
    cell("Cost today", `${money(f.costToday)}<small>at the API price</small>`, " num") +
    cell("Sandbox probe", probe, " num") +
    health + `</div></div>`;
}

export function renderLede(s) {
  const n = (a) => (a.length ? String(a.length) : "none");
  if (s.needs.length) return `<a href="#needs" class="need">${s.needs.length} ${s.needs.length === 1 ? "job needs" : "jobs need"} you.</a> ${s.delivered.length} delivered, ${s.running.length} running, ${n(s.stuck)} stuck.`;
  return `Nothing needs you. <a href="#delivered">${s.delivered.length} delivered</a>, <a href="#running">${s.running.length} running</a>, ${n(s.stuck)} stuck, ${s.waiting.length ? `${s.waiting.length} waiting` : "no goal waiting"}.`;
}

export function renderNeeds(s) {
  const cards = s.needs.map((j) => {
    const why = j.reason || j.needs || "needs you";
    return `<article class="need-card"><span class="why">${esc(why)}</span>` +
      `<div class="ih">${itemId(j)}${title(j)}</div>` +
      `<dl class="facts">${fact("Started", esc(clock(j.started)))}${j.cost !== undefined ? fact("Cost", esc(money(j.cost))) : ""}${j.model ? fact("Model", esc(j.model)) : ""}</dl>` +
      (j.question ? `<p class="quiet q">${esc(j.question)}</p>` : "") +
      (j.stat ? `<div class="ev one"><div><h4>Diff</h4><pre class="trailers">${esc(j.stat)}</pre></div></div>` : "") +
      (j.defaults.length ? `<details open><summary>Defaults taken<span class="peek">${j.defaults.length}</span></summary><div class="body"><ul>${j.defaults.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></div></details>` : "") +
      (j.followups.length ? `<details><summary>Follow-ups<span class="peek">${j.followups.length}</span></summary><div class="body"><ul>${j.followups.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></div></details>` : "") +
      `<div class="actions">${cmd(`aleph land ${j.name}`, { primary: true })}${cmd(`aleph drop ${j.name}`)}</div></article>`;
  }).join("");
  return section("needs", "Needs you", s.needs.length, cards || empty("Nothing needs you.", "A run that stops on a held path or a question shows up here."));
}

export function renderStuck(s) {
  const rows = s.stuck.map((j) =>
    `<article class="del"><div class="ih">${itemId(j)}${title(j)}<span class="badge stuck">${esc(j.state === "failed" ? "Failed" : "Stuck")}</span></div>` +
    (j.reason ? `<p class="quiet q">${esc(j.reason)}</p>` : "") +
    `<dl class="facts">${fact("Started", esc(clock(j.started)))}${j.phase ? fact("Phase", esc(j.phase)) : ""}${j.cost !== undefined ? fact("Cost", esc(money(j.cost))) : ""}</dl>` +
    `<div class="actions">${cmd(`aleph drop ${j.name}`)}</div></article>`).join("");
  return section("stuck", "Stuck", s.stuck.length, rows || empty("No run is stuck.", "A run that fails its checks or stops without a result shows up here."));
}

export function renderRunning(s) {
  const rows = s.running.map((j) =>
    `<div class="run-row"><div class="ih">${itemId(j)}<span class="badge run">${esc(j.phase || j.state)}</span></div>` +
    `<div class="t">${esc(j.item?.title || j.name)}</div>` +
    `<div class="run-meta"><span class="num">Started ${esc(clock(j.started))}, ${esc(span(j.started, s.now) || "0 min")} ago</span></div></div>`).join("");
  return section("run", "Running", s.running.length, rows || empty("Nothing is running.", "The next tick starts a run for each open goal."));
}

export function renderDelivered(s) {
  const rows = s.delivered.map((j) => {
    const sha = j.commit ? esc(j.commit.slice(0, 7)) : "";
    const commit = j.commit ? (j.commitUrl ? `<a href="${esc(j.commitUrl)}"><code>${sha}</code></a>` : `<code>${sha}</code>`) : "";
    return `<article class="del"><div class="ih">${itemId(j)}${title(j)}<span class="badge done">Landed</span></div>` +
      `<dl class="facts">${commit ? fact("Commit", commit) : ""}${j.ended ? fact("Landed", esc(clock(j.ended))) : ""}${j.cost !== undefined ? fact("Cost", esc(money(j.cost))) : ""}</dl>` +
      (j.commit ? `<div class="actions">${cmd(`git show ${j.commit.slice(0, 7)}`)}</div>` : "") + `</article>`;
  }).join("");
  return section("del", "Delivered today", s.delivered.length, rows || empty("Nothing has landed today.", "A landed run shows up here with its commit."), "on origin/main");
}

export function renderWaiting(s) {
  const rows = s.waiting.map((w) => `<div class="run-row"><div class="ih"><span class="id">${esc(w.repo)}-${esc(w.id)}</span></div><div class="t">${esc(w.title)}</div></div>`).join("");
  return section("wait", "Waiting", s.waiting.length, rows || empty("No goal waits to start.", "Run <code>/aleph:goal</code> to add one. The next tick picks it up."));
}

export function renderTicks(s) {
  const rows = s.ticks.slice().reverse().map((t) =>
    `<li><span class="tm">${esc(clock(t.at))}</span><span${/started none/.test(t.line) ? ' class="idle"' : ""}>${esc(t.line)}</span></li>`).join("");
  return `<div class="sh"><h2 id="h-ticks">Ticks today</h2></div>` + (rows ? `<ul class="ticks">${rows}</ul>` : empty("No tick yet today.", "The timer fires every half hour."));
}

export function renderAsOf(s) {
  return `As of ${esc(new Date(s.now).toLocaleString([], { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }))}.`;
}
