// The Gates view: what can stop, hold or ask. Each render function takes the /api/gates object and returns an HTML
// string, so tests can call them. The shell's click handler (index.html) runs the Pause, Resume and "Mark it checked"
// buttons and the Waiting-for-you buttons; `mount` runs the rule switches and "Mark all done".
import { badge, dataTable, empty, esc, hashQuery, heads, idLink, pageHead, repoIdLink, sectionHead, when } from "../lib.js";
import { askRow } from "./now.js";

export const view = {
  path: "/gates",
  title: "Gates",
  // Next to Status in the sidebar: both say what holds the factory now.
  group: "work",
  order: 0.5,
  icon: "shield-halved",
  api: "/api/gates",
  refresh: 60,
  render: (d, _params, q) => renderGates(d, q),
  mount: (root) => mount(root),
};

/** The name and the one line of each Ask reason. A reason not listed shows its key. */
export const REASONS = {
  "held-path": ["Lands on held paths", "A run that changes a held path, after its checks and review pass."],
  review: ["Reviewer holds", "The reviewer held the run and no fix rounds are left."],
  proposal: ["Proposals", "Work that is a proposal, before it starts."],
  question: ["Questions", "A run or a triage stopped on a choice that the spec leaves open."],
  "no-commit": ["Runs with no commit", "The last 3 runs of a goal ended with nothing committed."],
  "part-dropped": ["Dropped parts", "A part of an issue was dropped and no other part is open."],
  "triage-failed": ["Failed triage", "Triage of an issue failed twice."],
  "host-check": ["Host checks", "A check that the sandbox cannot run; it runs on this machine."],
  "spec-check": ["Spec checks", "The spec check found a spec that cannot be met as written."],
  rescue: ["Rescue of a stuck run", "A stuck run with more than one way out."],
  "run-cap": ["Run cap", "A goal started 3 times in one hour."],
  "acceptance-failed": ["Failed acceptance", "The Oracle still fails on main after a rerun."],
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
  return `<div class="page gates">${pageHead("Gates", { aside: "What can stop, hold or ask. Rules decide the routine; you see what is left." })}` +
    renderNow(d) + renderWaiting(d) + renderChores(d) + renderRules(d) +
    `<div class="gates-two">${renderHeld(d)}${renderSandbox(d)}</div>` + renderLog(d, q.get("by")) + `</div>`;
}

const tone = (bad, warn = false) => (bad ? "stop" : warn ? "warn" : "ok");
const gtile = (name, value, note, t, extra = "") =>
  `<div class="gtile"><div class="gt-head"><span>${esc(name)}</span><span class="gdot ${t}" role="img" aria-label="${t === "ok" ? "open" : t === "warn" ? "near its limit" : "closed"}"></span></div><b>${esc(value)}</b><small>${esc(note)}</small>${extra}</div>`;

/** The environment variable that overrides each cap in caps.json. */
const CAP_ENV = { live: "ALEPH_LIVE_CAP" };
/** A number input and a Save button for one cap; a note when its environment variable overrides caps.json. */
function capForm(f, key, label, value) {
  const env = CAP_ENV[key], over = !!f.capEnv?.[key];
  return `<form class="capform" data-cap="${key}"><label class="sr-only" for="cap-${key}">${esc(label)}</label>` +
    `<input id="cap-${key}" name="${key}" type="number" min="1" step="1" inputmode="numeric" value="${esc(value)}" required>` +
    `<button class="act" type="submit" data-label="Save">Save</button>` +
    (over ? `<small class="cap-env">${esc(env)} is set: an edit has no effect while that variable is set.</small>` : "") + `</form>`;
}

/** A per-goal gate's tile: how many queued goals it holds now. */
const goalTile = (name, n, note) => gtile(name, n ? `${n} held` : "none", note, tone(false, n > 0));

/** The 7 gates, in the order the dispatch asks them, with the pause control. */
export function renderNow(d) {
  const f = d.factory, p = f.probe, base = d.baseline ?? [], g = d.goalGates ?? {};
  const red = base.filter((b) => b.state === "red"), held = g.baseline ? `; ${g.baseline} held` : "";
  const tilesHtml = [
    gtile("Pause", f.paused ? "paused" : "running", f.paused ? "no run starts or lands" : "not paused", tone(f.paused)),
    gtile("Baseline", red.length ? "red" : base.length ? "green" : "none", ((red.length ? red : base).map((b) => b.line).join(", ") || "no baseline yet") + held, tone(red.length > 0, !!g.baseline)),
    gtile("Probe", !p ? "none" : p.ok ? "ok" : "failed", !p ? "no sandbox probe yet" : p.ok ? `sandbox probe ${when(p.at)}` : (p.failed ?? []).join("; "), tone(p && !p.ok, !p)),
    goalTile("Not ready", g["not-ready"], "done, waits on an issue, has an open job, or its planner or spec check runs"),
    gtile("Live cap", `${f.liveRuns} / ${f.liveCap}`, `cap ${f.liveCap} at once`, tone(f.liveRuns >= f.liveCap), capForm(f, "live", "Live cap", f.liveCap)),
    goalTile("Busy file", g["busy-file"], "an open job changes the same busy file"),
    goalTile("Loop guard", g["loop-guard"], "3 runs with no commit, or 3 starts in an hour: an Ask"),
  ].join("");
  const line = d.gated ? `Closed at ${d.gated.gate}: ${d.gated.text}.` : "Every goal passes these in order. All open.";
  const ctl = f.paused
    ? `<button class="act primary" type="button" data-act="resume" data-label="Resume the factory">Resume the factory</button>`
    : `<button class="act" type="button" data-act="pause" data-label="Pause the factory">Pause the factory</button>`;
  return `<section id="gates-now" aria-label="Gates now">${sectionHead("Gates now", { aside: esc(line) })}<div class="gtiles">${tilesHtml}</div><div class="actions">${ctl}</div></section>`;
}

/** The Asks routed to Chris, as the Status page's cards. Host chores are in their own section. */
export function renderWaiting(d) {
  const rows = d.asks.map((i) => askRow(i, d.now)).join("");
  return `<section id="gates-waiting" aria-label="Waiting for you">${sectionHead("Waiting for you", { count: d.asks.length, aside: "Asks whose rule is Ask me." })}` +
    (rows ? `<div class="list">${rows}</div>` : empty("Nothing waits for you.")) + `</section>`;
}

/** The host-check Asks as one checklist, each with its own "Mark it checked". */
export function renderChores(d) {
  const rows = d.chores.map((i) => {
    const a = (i.actions ?? []).find((x) => x.act === "checked");
    const btn = a?.args?.repo ? `<button class="act" type="button" data-act="checked" data-repo="${esc(a.args.repo)}" data-id="${esc(a.args.id)}" data-label="${esc(a.label)}" title="${esc(a.hint)}">${esc(a.label)}</button>` : "";
    return `<div class="chore" data-id="${esc(i.id)}"><div class="chore-main">${repoIdLink(i.id, i.href, i.repo)} <span class="t">${esc(i.title)}</span><p class="quiet">${esc(i.problem)}</p></div><span class="quiet num">${esc(when(i.at))}</span><div class="actions">${btn}</div></div>`;
  }).join("");
  const all = rows ? `<button class="act" type="button" data-gates="all-done" data-label="Mark all done">Mark all done</button>` : "";
  return `<section id="gates-chores" aria-label="Host chores">${sectionHead("Host chores", { count: d.chores.length, aside: `Steps on this machine that the sandbox cannot do. ${all}` })}` +
    (rows ? `<div class="chores">${rows}</div>` : empty("No host chore is open.")) + `</section>`;
}

/** One row per Ask reason: who decides it. Ask me, or the reason's one automatic mode. */
export function renderRules(d) {
  const rows = d.rules.map((r) => {
    const [name, desc] = REASONS[r.reason] ?? [r.reason, ""];
    const g = r.granted;
    let control = "", hint = "";
    if (r.places) {
      hint = r.places.length ? `Granted for ${r.places.join(", ")}.` : "";
      control = `<p class="quiet note">Set for each target from a proposal's [auto-yes] button.</p>`;
    } else {
      const seg = (mode, label, on) => `<button type="button" data-rule="${esc(r.reason)}" data-mode="${esc(mode)}" aria-pressed="${on}">${esc(label)}</button>`;
      control = `<div class="seg" role="group" aria-label="Who decides ${esc(name)}">${seg("", "Ask me", !g)}${r.mode ? seg(r.mode, modeLabel(r.mode), g?.action === r.mode) : ""}</div>`;
      if (!r.mode) hint = "No automatic mode: aleph has no rule that acts on this reason.";
      if (g && g.action !== r.mode) hint = `always.json grants ${g.action}. Ask me removes it${r.mode ? `; ${modeLabel(r.mode)} replaces it` : ""}.`;
    }
    return `<div class="rule" data-reason="${esc(r.reason)}"><div class="rule-main"><div><b>${esc(name)}</b> <code>${esc(r.reason)}</code></div>${desc ? `<p class="quiet">${esc(desc)}</p>` : ""}${hint ? `<p class="hint">${esc(hint)}</p>` : ""}</div>${control}</div>`;
  }).join("");
  return `<section id="rules" aria-label="Rules">${sectionHead("Rules", { aside: "Who decides each kind of Ask. Ask me puts it in Waiting for you; the other mode acts and writes a Rule line in the log." })}<div class="rules">${rows}</div></section>`;
}

/** The held paths: the security paths of gate.ts (every repo) and the globs each repo names in the registry. Read-only. */
export function renderHeld(d) {
  const chips = (l) => l.map((p) => `<code class="chip">${esc(p)}</code>`).join("");
  const repos = d.repoHeld ?? [];
  const rows = repos.length
    ? repos.map((r) => `<div class="held-repo"><b>${esc(r.repo)}</b> <div class="held">${chips(r.held)}</div></div>`).join("")
    : `<p class="quiet">No repo names held paths.</p>`;
  return `<section class="card" aria-label="Held paths">${sectionHead("Held paths")}<p class="quiet">The security paths wait for Chris before the review. A repo's held paths wait for Chris after its review passes. A test is never held.</p>` +
    `<div class="held-repo"><b>Every repo</b> <div class="held">${chips(d.held)}</div></div>${rows}</section>`;
}

/** What a worker step may touch, from the profile sandbox.ts builds. Read-only. */
export function renderSandbox(d) {
  const s = d.sandbox;
  const row = (k, v) => `<dt>${esc(k)}</dt><dd>${v.map((x) => `<code>${esc(x)}</code>`).join(", ") || "none"}</dd>`;
  return `<section class="card" aria-label="Sandbox permissions">${sectionHead("Sandbox permissions")}<p class="quiet">What a worker step may touch. A run that needs more ends with a host chore.</p>` +
    `<dl class="sbx">${row("Read", s.read)}${row("Write", s.write)}${row("Network", [...s.network.domains, ...(s.network.localBinding ? ["local ports"] : [])])}${row("Host", s.denied.map((p) => `no ${p}`))}</dl></section>`;
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
  const chips = ["All", ...Object.keys(BY)].map((k) => `<a class="fchip" href="#/gates${k === "All" ? "" : `?by=${k.toLowerCase()}`}"${k === pick ? ' aria-current="true"' : ""}>${esc(k)}</a>`).join("");
  const entries = d.log.entries.filter((e) => pick === "All" || e.by === pick);
  const rows = entries.map((e) => `<tr><td class="time">${esc(e.count ? `${when(e.first)} – ${when(e.at)}` : when(e.at))}</td><td><span class="badge ${BY[e.by]}">${esc(e.by)}</span></td><td>${itemLink(e.item)}</td><td class="what">${esc(e.what)}${e.count ? ` <span class="quiet">×${e.count}</span>` : ""}</td></tr>`).join("");
  return `<section id="gates-log" aria-label="Log">${sectionHead("Log", { aside: `The last ${d.log.days} days, at most ${d.log.max} entries of each actor.` })}` +
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

/** The rule switches and "Mark all done". `root.onclick`, so a refresh does not add a second handler and the shell clears it on a route change. */
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
    const all = e.target.closest?.('button[data-gates="all-done"]');
    if (!all) return;
    const items = [...root.querySelectorAll('#gates-chores button[data-act="checked"]')];
    if (!all.classList.contains("ask")) {
      all.classList.add("ask");
      all.textContent = `Mark ${items.length} done? Click again`;
      clearTimeout(all._t);
      all._t = setTimeout(() => { all.classList.remove("ask"); all.textContent = all.dataset.label; }, 5000);
      return;
    }
    clearTimeout(all._t);
    all.disabled = true;
    const failed = [];
    for (const b of items) {
      const res = await post(`/api/issues/${encodeURIComponent(b.dataset.repo)}/${encodeURIComponent(b.dataset.id)}/checked`).catch(() => null);
      if (!res?.ok) failed.push(`${b.dataset.repo}-${b.dataset.id}`);
    }
    await redraw(root);
    const again = root.querySelector('button[data-gates="all-done"]');
    if (failed.length && again) say(again, `Not marked: ${failed.join(", ")}`);
  };
}
