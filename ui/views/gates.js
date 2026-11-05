// The Automation view: metrics, caps, schedules, rules and the log. Each render function takes the /api/gates object and returns an HTML
// string, so tests can call them. The shell's click handler (index.html) runs the Pause and Resume buttons
// and the Waiting-for-you buttons; `mount` runs the rule switches.
import { badge, card, tag, dataTable, empty, esc, hashQuery, heads, chip, idLink, pageHead, sectionHead, small, tile, tiles, when } from "../lib.js";
import { askRow } from "./now.js";

export const view = {
  path: "/automation",
  title: "Automation",
  // Next to Status in the sidebar: both say what holds the factory now.
  group: "factory",
  order: -2,
  icon: "shield-halved",
  api: "/api/gates",
  refresh: 60,
  render: (d, _params, q) => renderGates(d, q),
  mount: (root) => mount(root),
};

/** `#/gates` (with or without a query) is now `#/automation`. */
export const redirect = (hash) => {
  const [path, qs] = String(hash ?? "").split("?");
  return path === "#/gates" ? `#/automation${qs ? `?${qs}` : ""}` : null;
};

/** The name and the one line of each Ask reason. A reason not listed shows its key. */
export const REASONS = {
  "held-path": ["Lands on held paths", "A run that changes a held path, after its checks and review pass."],
  review: ["Reviewer holds", "The reviewer held the run and no fix rounds are left."],
  question: ["Questions", "A run or an intake stopped on a choice that the spec leaves open."],
  "no-commit": ["Runs with no commit", "The last 3 runs of a goal ended with nothing committed."],
  "part-dropped": ["Dropped parts", "A part of an issue was dropped and no other part is open."],
  "intake-failed": ["Failed intake", "Intake of an issue failed twice."],
  rescue: ["Rescue of a stuck run", "A stuck run with more than one way out."],
  "run-cap": ["Run cap", "A goal started 3 times in one hour."],
  "proposal-check": ["Proposed checks", "The correction memory proposes a check for a repo."],
  "proposal-claude-md": ["Proposed CLAUDE.md lines", "The correction memory proposes a line in a CLAUDE.md."],
  "proposal-skill": ["Proposed skill changes", "The correction memory proposes a change to a skill."],
};

/** The label of an automatic mode: what it does. */
export const MODES = { recommended: "Recommended", retry: "Retry", start: "Start", land: "Land", approve: "Approve" };
const modeLabel = (m) => MODES[m] ?? m.replace(/^./, (c) => c.toUpperCase());

/** The log's actors, in filter order, with the badge tone of each. */
export const BY = { You: "need", Rule: "done", Director: "parked", Firefighter: "stuck", Gate: "run" };

export function renderGates(d, q = new URLSearchParams()) {
  return `<div class="page gates">${pageHead("Automation")}` +
    renderNow(d) + renderSchedules(d) + renderMonitor(d) + renderWaiting(d) + renderRepeats(d) + renderRules(d) +
    `<div class="gates-two">${renderCaps(d)}${renderHeld(d)}</div>` + renderLog(d, q.get("by")) + `</div>`;
}

/** The environment variable that overrides each cap in caps.json. */
const CAP_ENV = { live: "ALEPH_LIVE_CAP", run: "ALEPH_RUN_CAP" };
/** A number input and a Save button for one cap; a note when its environment variable overrides caps.json. */
function capForm(f, key, label, value) {
  const env = CAP_ENV[key], over = !!f.capEnv?.[key];
  return `<form class="capform" data-cap="${key}"><label class="sr-only" for="cap-${key}">${esc(label)}</label>` +
    `<input id="cap-${key}" name="${key}" type="number" min="1" step="1" inputmode="numeric" value="${esc(value)}" required>` +
    `<button class="act" type="submit" data-label="Save">Save</button>` +
    (over ? `<small class="cap-env">${esc(env)} is set: an edit has no effect while that variable is set.</small>` : "") + `</form>`;
}

/** The metric tiles: the automation rate, the gate catches and the held time, each over the log's window. */
export function renderNow(d) {
  const m = d.metrics, win = `last ${m.days} days`;
  const t = (k, v, note) => tile({ k, v, body: small(note) });
  const tilesHtml = [
    t("Automation rate", m.rate ? `${m.rate.percent}%` : "–", m.rate ? `${m.rate.auto} of ${m.rate.total} Asks decided without Chris, ${win}` : `no Ask decided, ${win}`),
    t("Gate catches", `${m.catches.fired} / ${m.catches.fixed}`, `checks and reviews that sent a build back, against those a later build fixed, ${win}`),
    t("Repeat answers", String(d.repeats.length), `kinds of Ask that Chris answered the same way 3 or more times, ${win}`),
    t("Held time", `${m.held.goals} goals, ${m.held.hours} h`, `goals held, and hours in a hold, ${win}`),
  ].join("");
  return `<section id="gates-now">${tiles("Metrics", tilesHtml)}</section>`;
}

/** The controls panel: the Pause or Resume button, then the live cap and the run cap, each with its use against its limit and a form to edit it. */
export function renderCaps(d) {
  const f = d.factory;
  const ctl = f.paused
    ? `<button class="act primary" type="button" data-act="resume" data-label="Resume the factory">Resume the factory</button>`
    : `<button class="act" type="button" data-act="pause" data-label="Pause the factory">Pause the factory</button>`;
  const row = (key, label, use, limit, note) => `<div class="cap-row"><b>${esc(label)}</b><span>${esc(use)} / ${esc(limit)}</span><small>${esc(note)}</small>${capForm(f, key, label, limit)}</div>`;
  return card("Controls", `<div class="caps">` +
    row("live", "Live cap", f.liveRuns, f.liveCap, "live runs against the cap") +
    row("run", "Run cap", f.runStarts ?? 0, f.runCap, "the most starts any one goal made in the last hour") + `</div>${ctl}`, { id: "gates-caps" });
}

/** The newest monitor report: a summary that expands to every finding and the reader's reply, or why there is no reading. */
export function renderMonitor(d) {
  const m = d.monitor, head = sectionHead("Monitor");
  if (!m) return `<section id="monitor" aria-label="Monitor">${head}<p>The monitor has not run.</p></section>`;
  const n = m.findings.length, first = n ? ` First: ${esc(m.findings[0])}` : "";
  const summary = `${esc(m.day)}: ${n} ${n === 1 ? "finding" : "findings"}.${first}`;
  const body = (n ? `<ol class="findings">${m.findings.map((f) => `<li>${esc(f)}</li>`).join("")}</ol>` : "") +
    (m.text ? `<pre class="reader">${esc(m.text)}</pre>` : m.error ? `<p>No reading: ${esc(m.error)}</p>` : "");
  return `<section id="monitor" aria-label="Monitor">${head}<details><summary>${summary}</summary>${body}</details></section>`;
}

/** The tick, the suite and the monitor: when each last ran and what came of it. */
export function renderSchedules(d) {
  const rows = d.schedules.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.last ? when(s.last) : "has not run"}</td><td>${s.result ? esc(s.result) : ""}</td></tr>`).join("");
  return `<section id="gates-schedules" aria-label="Schedules">${sectionHead("Schedules")}${dataTable(heads(["Schedule", "Last run", "Result"]), rows)}</section>`;
}

/** The Asks routed to Chris, as the Status page's cards. */
export function renderWaiting(d) {
  const rows = d.asks.map((i) => askRow(i, d.now)).join("");
  return `<section id="gates-waiting" aria-label="Waiting for you">${sectionHead("Waiting for you", { count: d.asks.length })}` +
    (rows ? `<div class="list">${rows}</div>` : empty("Nothing waits for you.")) + `</section>`;
}

/** Each kind of Ask that Chris answered the same way 3 or more times, with a button that makes the answer the rule when it is the reason's automatic mode. */
export function renderRepeats(d) {
  const rows = d.repeats.map((r) => `<tr><td>${esc(REASONS[r.reason]?.[0] ?? r.reason)}</td><td>${esc(r.answer)}</td><td class="num">${r.count}</td><td>` +
    (r.mode ? `<button class="act" type="button" data-rule="${esc(r.reason)}" data-mode="${esc(r.mode)}" data-label="Make it a rule">Make it a rule</button>` : "") + `</td></tr>`).join("");
  return `<section id="gates-repeats" aria-label="Repeat answers">${sectionHead("Repeat answers", { count: d.repeats.length })}` +
    (rows ? dataTable(heads(["Ask", "Answer", "Times", ""], ["Times"]), rows) : empty("No answer repeats.")) + `</section>`;
}

/** One row per Ask reason: who decides it. Ask me, or the reason's one automatic mode. */
export function renderRules(d) {
  const rows = d.rules.map((r) => {
    const [name, desc] = REASONS[r.reason] ?? [r.reason, ""];
    const g = r.granted;
    let control = "", hint = "";
    if (r.places) {
      hint = r.places.length ? `Granted for ${r.places.join(", ")}.` : "";
      control = `<p class="quiet note">Set per target from the proposal.</p>`;
    } else {
      const seg = (mode, label, on) => `<button type="button" data-rule="${esc(r.reason)}" data-mode="${esc(mode)}" aria-pressed="${on}">${esc(label)}</button>`;
      control = `<div class="seg" role="group" aria-label="Who decides ${esc(name)}">${seg("", "Ask me", !g)}${r.mode ? seg(r.mode, modeLabel(r.mode), g?.action === r.mode) : ""}</div>`;
      if (!r.mode) hint = "No automatic mode.";
      if (g && g.action !== r.mode) hint = `always.json grants ${g.action}. Ask me removes it${r.mode ? `; ${modeLabel(r.mode)} replaces it` : ""}.`;
    }
    const num = (n) => `<td class="num">${n}</td>`;
    const dec = r.decided, out = r.outcome;
    return `<tr class="rule" data-reason="${esc(r.reason)}"><td class="rule-main"><b>${esc(name)}</b> <code>${esc(r.reason)}</code>${desc ? `<p class="quiet">${esc(desc)}</p>` : ""}</td><td>${control}${hint ? `<p class="hint">${esc(hint)}</p>` : ""}</td>${num(r.fired)}<td>${dec.rule} rule, ${dec.director} director, ${dec.chris} Chris</td><td>${out.fixed} fixed, ${out.none} no change</td></tr>`;
  }).join("");
  return `<section id="rules" aria-label="Rules">${sectionHead("Rules")}${dataTable(heads(["Rule", "Who decides", "Fired", "Decided by", "Outcome"]), rows, { id: "rules-table" })}</section>`;
}

/** The held paths: the security paths of gate.ts (every repo) and the globs each repo names in the registry. Read-only. */
export function renderHeld(d) {
  const repos = d.repoHeld ?? [];
  const rows = repos.length
    ? repos.map((r) => `<div class="held-repo"><b>${esc(r.repo)}</b> <div class="held">${r.held.map((p) => chip(p, { el: "code" })).join("")}</div></div>`).join("")
    : `<p class="quiet">No repo names held paths.</p>`;
  return card("Held paths", `<p class="quiet">The security paths and a repo's held paths wait for Chris after the reviewer passes the run. A test is never held.</p>` +
    `<div class="held-repo"><b>Every repo</b> <div class="held">${d.held.map((p) => chip(p, { el: "code" })).join("")}</div></div>${rows}`);
}

/** An item of the log as a link: an issue ref to its page, `rule` to the Rules. */
function itemLink(item) {
  if (item === "rule") return `<a href="#rules">rule</a>`;
  const m = /^(.+)-(\d+(?:\.\d+)?)$/.exec(item);
  return m ? idLink(item, `#/issues/${encodeURIComponent(m[1])}/${encodeURIComponent(m[2])}`) : esc(item || "–");
}

/** The log, newest first, filtered by `by` (you, rule, firefighter, gate) from the address. */
export function renderLog(d, by) {
  const pick = Object.keys(BY).find((k) => k.toLowerCase() === by) ?? "All";
  const chips = ["All", ...Object.keys(BY)].map((k) => `<a class="fchip" href="#/automation${k === "All" ? "" : `?by=${k.toLowerCase()}`}"${k === pick ? ' aria-current="true"' : ""}>${esc(k)}</a>`).join("");
  const entries = d.log.entries.filter((e) => pick === "All" || e.by === pick);
  const rows = entries.map((e) => `<tr><td class="time">${esc(e.count ? `${when(e.first)} – ${when(e.at)}` : when(e.at))}</td><td>${tag(e.by, BY[e.by])}</td><td>${itemLink(e.item)}</td><td class="what">${esc(e.what)}${e.count ? ` <span class="quiet">×${e.count}</span>` : ""}</td></tr>`).join("");
  return `<section id="gates-log" aria-label="Log">${sectionHead("Log")}` +
    `<nav class="fchips" aria-label="Filter the log">${chips}</nav>` +
    (rows ? dataTable(heads(["When", "By", "Item", "What"]), rows) : empty("No entry in this window.")) + `</section>`;
}

const post = (url, body) => fetch(url, { method: "POST", headers: { "X-Aleph-UI": "1", "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

/** Load /api/gates again and draw the page with it. */
async function redraw(root) {
  const res = await fetch("/api/gates", { cache: "no-store" });
  if (!res.ok) return;
  root.innerHTML = renderGates(await res.json(), hashQuery());
}

/** A message beside the element, for a failed action. */
function say(el, text) {
  let n = el.parentElement.querySelector(".act-msg");
  if (!n) { n = document.createElement("span"); n.className = "act-msg"; n.setAttribute("role", "alert"); el.after(n); }
  n.textContent = text;
}

/** The rule switches. `root.onclick`, so a refresh does not add a second handler and the shell clears it on a route change. */
export function mount(root) {
  root.onsubmit = async (e) => {
    const form = e.target.closest?.("form.capform");
    if (!form) return;
    e.preventDefault();
    const key = form.dataset.cap, btn = form.querySelector("button");
    btn.disabled = true;
    try {
      const res = await post("/api/gates/caps", { [key]: Number(form.elements[key].value) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.statusText);
    } catch (err) { btn.disabled = false; say(btn, `Could not save the cap: ${err.message}`); return; }
    await redraw(root);
  };
  root.onclick = async (e) => {
    const r = e.target.closest?.("button[data-rule]");
    if (r) {
      if (r.getAttribute("aria-pressed") === "true") return;
      const seg = r.parentElement, buttons = [...seg.querySelectorAll("button")];
      buttons.forEach((b) => { b.disabled = true; });
      const { rule, mode } = r.dataset;
      try {
        const res = mode ? await post(`/api/standing/${encodeURIComponent(rule)}`, { action: mode }) : await post(`/api/gates/revoke/${encodeURIComponent(rule)}`);
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || res.statusText);
      } catch (err) { buttons.forEach((b) => { b.disabled = false; }); say(seg, `Could not change the rule: ${err.message}`); return; }
      await redraw(root);
      return;
    }
  };
}
