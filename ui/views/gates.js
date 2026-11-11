// The Automation view: metrics, caps, schedules, rules and the log. Each render function takes the /api/automation object and returns an HTML
// string, so tests can call them. The shell's click handler (router.js) runs the Waiting-for-you buttons; `mount` runs the rule switches.
import { redraw } from "../router.js";
import { clamp, fold, toc, wireToc, actButton, postJson, say, count, badge, card, tag, dataTable, pagedTable, empty, error, esc, filterBar, inputBox, setting, settings, goQuery, hashQuery, heads, hours, pct, chip, idLink, limitOf, pager, pageHead, seg, setQuery, statCard, tiles, when, scope } from "../lib.js";
import { contentText, issueHref, parseId, parseJob, shownId } from "../../lib/naming.ts";
import { findingHtml, findingsList } from "./now.js";
import { askCard } from "./cards.js";

export const view = {
  path: "/automation",
  title: "Automation",
  // Next to Status in the sidebar: both say what holds the factory now.
  group: "factory",
  order: -2,
  icon: "shield-halved",
  // The caps' use and the live counts come from the factory block of /api/factory.
  api: (_params, q = new URLSearchParams()) => { const s = scope(q); return [s.url(`/api/automation?window=${s.window}`), s.url(`/api/factory?window=${s.window}`)]; },
  combine: ([d, s]) => ({ ...d, asks: s.asks, factory: { ...s.factory, capEnv: d.capEnv, settings: d.settings } }),
  live: true,
  refresh: 60,
  render: (d, _params, q) => renderGates(d, q),
  mount: (root) => mount(root),
};

/** `#/gates` (with or without a query) is now `#/automation`. */
export const redirect = (hash) => {
  const [path, qs] = String(hash ?? "").split("?");
  return path === "#/gates" ? `#/automation${qs ? `?${qs}` : ""}` : null;
};

/** The label of an automatic mode: what it does. */
export const MODES = { recommended: "Recommended", retry: "Retry", start: "Start", land: "Land", approve: "Approve" };
const modeLabel = (m) => MODES[m] ?? m.replace(/^./, (c) => c.toUpperCase());

/** The log's actors, in filter order, with the badge tone of each. */
export const BY = { human: "need", rule: "done", director: "parked", firefighter: "stuck", gate: "run" };

const PAGE = 50;

const CONTENTS = [["gates-schedules", "Schedules"], ["monitor", "Monitor"], ["gates-waiting", "Waiting for You"], ["gates-repeats", "Rule Candidates"],
  ["rules", "Rules"], ["gates-caps", "Controls"], ["gates-held", "Held Paths"], ["gates-log", "Log"]];

export function renderGates(d, q = new URLSearchParams()) {
  return `<div class="page gates">${pageHead("Automation", { aside: scope(q).bar() })}` + toc(CONTENTS,
    renderNow(d) + (d.backend ? `<p class="quiet" id="gates-backend">Waiting for ${esc(d.backend.via)}: ${esc(d.backend.why)}</p>` : "") + renderSchedules(d) + renderMonitor(d) + renderWaiting(d) + renderRepeats(d) + renderRules(d) +
    `<div class="gates-two">${renderCaps(d)}${renderHeld(d)}</div>` + renderLog(d, q.get("by"), limitOf(q, PAGE))) + `</div>`;
}

/** The environment variable that overrides each key of caps.json, as jobs/lib/infra/settings.ts names it. */
const CAP_ENV = { live: "ALEPH_LIVE_CAP", run: "ALEPH_RUN_CAP", intakeTries: "ALEPH_INTAKE_TRIES", jobSeconds: "ALEPH_JOB_TIMEOUT", fixRounds: "ALEPH_FIX_ROUNDS", landBatch: "ALEPH_LAND_BATCH", loadLimit: "ALEPH_LOAD_LIMIT" };
/** A number input and a Save button for one cap; a note when its environment variable overrides caps.json. */
function capForm(f, key, label, value) {
  const env = CAP_ENV[key], over = !!f.capEnv?.[key];
  return `<form class="capform" data-cap="${key}"><label class="sr-only" for="cap-${key}">${esc(label)}</label>` +
    `<input id="cap-${key}" name="${key}" type="number" min="${key === "fixRounds" ? 0 : 1}" step="1" inputmode="numeric" value="${esc(value)}" required>` +
    actButton("Save", { label: "Save" }, { type: "submit" }) +
    (over ? `<small class="cap-env">${esc(env)} is set: an edit has no effect while that variable is set.</small>` : "") + `</form>`;
}

/** The metric tiles: the automation rate, the gate catches and the held time, each over the log's window. */
export function renderNow(d) {
  const m = d.metrics;
  const tilesHtml = [
    statCard({ k: "Automation rate", v: m.rate ? pct(m.rate.percent) : "–", ...(m.rate ? { v2: count(m.rate.total) } : {}), ...(m.rate ? { q: ["decided without Chris", "asks"] } : { note: "no Ask decided" }) }),
    statCard({ k: "Gate catches", v: count(m.catches.fired), v2: count(m.catches.fixed), q: ["sent back", "fixed later"] }),
    statCard({ k: "Rule candidates", v: count(d.repeats.length), note: "Asks you answered the same way 3+ times" }),
    statCard({ k: "Held time", v: hours(m.held?.hours), v2: count(m.held?.goals), q: ["in a hold", "issues"] }),
  ].join("");
  return `<section id="gates-now">${tiles("Metrics", tilesHtml)}</section>`;
}

/** The settings under the caps: each one's value and a form to edit it. */
const SETTINGS = [
  ["intakeTries", "Intake tries", "intake runs with no reply before an Ask"],
  ["jobSeconds", "Job time limit", "seconds in a worker's time box"],
  ["fixRounds", "Fix rounds", "times a failed job goes back to its worker before an Ask"],
  ["landBatch", "Land batch", "passed runs one land pushes together"],
  ["loadLimit", "Load limit", "the 1-minute load average under which a check, a worker or a land starts"],
];

/** The controls panel: the live cap and the run cap, each with its use against its limit, then the settings, each with a form to edit it. */
export function renderCaps(d) {
  const f = d.factory;
  const row = (key, label, use, limit, note) => `<div class="cap-row"><b>${esc(label)}</b><span>${esc(use)} / ${esc(limit)}</span><small>${esc(note)}</small>${capForm(f, key, label, limit)}</div>`;
  return card("Controls", `<div class="caps">` +
    row("live", "Live cap", f.liveRuns, f.liveCap, "live jobs against the cap") +
    row("run", "Job cap", f.runStarts ?? 0, f.runCap, "the most starts any one issue made in the last hour") +
    SETTINGS.map(([k, label, note]) => `<div class="cap-row"><b>${esc(label)}</b><span>${esc(f.settings?.[k] ?? "–")}</span><small>${esc(note)}</small>${capForm(f, k, label, f.settings?.[k] ?? "")}</div>`).join("") + `</div>`, { id: "gates-caps" });
}

/** The newest monitor report: a summary that expands to every finding and the reader's reply, or why there is no reading. */
export function renderMonitor(d) {
  const m = d.monitor;
  if (!m) return card("Monitor", empty("The monitor has not run.", "It reads once a day, in the tick."), { id: "monitor" });
  const n = m.findings.length, first = n ? ` First: ${findingHtml(m.findings[0])}` : "";
  const summary = `${esc(m.day)}: ${n} ${n === 1 ? "finding" : "findings"}.${first}`;
  const body = (n ? findingsList(m.findings) : "") +
    (m.text ? `<pre class="reader">${esc(m.text)}</pre>` : m.error ? error(`No reading: ${m.error}`, "The monitor reads again at its next run.") : "");
  return card("Monitor", fold(summary, body), { id: "monitor" });
}

/** The tick, the suite and the monitor: how often each runs, what came of its last run and when it ran. The monitor runs in the tick, once a day, so only the other two have an interval to edit. */
export function renderSchedules(d) {
  const rows = d.schedules.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.every)}</td><td>${s.result ? esc(s.result) : ""}</td><td class="time">${s.last ? when(s.last) : "has not run"}</td></tr>`).join("");
  const edit = d.schedules.filter((s) => s.name !== "monitor").map((s) => {
    const id = `every-${s.name}`;
    return setting(`${s.name} every`, inputBox("every", s.every ?? "", { id, attrs: ' pattern="[1-9][0-9]*(s|min|h)" required' }), { id, save: "Save", hint: "A number and s, min or h, such as 30s.", attrs: ` data-schedule="${esc(s.name)}"` });
  });
  return card("Schedules", rows ? dataTable(heads(["Schedule", "Every", "Result", "Last Run"], ["Last Run"]), rows) + settings("Schedule intervals", edit) : empty("No schedule.", "The factory lists its schedules once it runs."), { id: "gates-schedules" });
}

/** The Asks routed to Chris, as the Status page's cards. */
function renderWaiting(d) {
  const rows = d.asks.map((i) => askCard(i, d.now)).join("");
  return card("Waiting for You", rows ? `<div class="list">${rows}</div>` : empty("Nothing waits for you.", "An Ask that needs you shows here."), { id: "gates-waiting", count: d.asks.length });
}

/** Each kind of Ask that Chris answered the same way 3 or more times, with a button that makes the answer the rule when it is the reason's automatic mode. */
export function renderRepeats(d) {
  const rows = d.repeats.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.answer)}</td><td class="num">${r.count}</td></tr>`);
  const make = d.repeats.filter((r) => r.mode).map((r) => setting(r.name, actButton("Make it a rule", { rule: r.reason, mode: r.mode, label: "Make it a rule" })));
  return card("Rule Candidates", rows.length ? pagedTable(heads(["Ask", "Answer", "Times"], ["Times"]), rows) + settings("Make a rule", make) : empty("No answer repeats.", "An Ask you answer the same way 3 times shows here."),
    { id: "gates-repeats", count: d.repeats.length, label: "Rule candidates" });
}

/** The minutes after which the factory lands an escalated Ask of a land reason that the director recommends landing; 0 waits for Chris. */
const timeoutRow = (r) => {
  const id = `timeout-${r.reason}`;
  return setting(`${r.name}: land after`, inputBox("minutes", r.timeout, { id, type: "number", attrs: ' min="0" step="1" inputmode="numeric" required' }) + " min with no answer",
    { id, save: "Save", hint: r.timeout ? "Only when the director recommends the land." : "0: waits for you.", attrs: ` data-timeout="${esc(r.reason)}"` });
};

/** One row per Ask reason: how often it fired and who decided, then a settings list of who decides it. Ask me, or the reason's one automatic mode. */
export function renderRules(d) {
  const rows = d.rules.map((r) => {
    const num = (n) => `<td class="num">${n}</td>`, dec = r.decided, out = r.outcome;
    return `<tr class="rule" data-reason="${esc(r.reason)}"><td class="rule-main"><b>${esc(r.name)}</b> <code>${esc(r.reason)}</code>${r.line ? `<p class="quiet">${esc(r.line)}</p>` : ""}</td>${num(r.fired)}<td>${dec.rule} / ${dec.director} / ${dec.chris}</td><td>${out.fixed} / ${out.none}</td></tr>`;
  }).join("");
  const decide = d.rules.flatMap((r) => {
    const g = r.granted;
    let control, hint = "";
    if (r.places) {
      hint = r.places.length ? `Granted for ${r.places.join(", ")}.` : "";
      control = "Set per target from the proposal.";
    } else {
      const btn = (mode, label, on) => ({ label, on, attrs: ` data-rule="${esc(r.reason)}" data-mode="${esc(mode)}"` });
      control = seg(`Who decides ${r.name}`, [btn("", "Ask me", !g), ...(r.mode ? [btn(r.mode, modeLabel(r.mode), g?.action === r.mode)] : [])]);
      if (!r.mode) hint = "The director decides first and sends the rest to you.";
      if (g && g.action !== r.mode) hint = `always.json grants ${g.action}. Ask me removes it${r.mode ? `; ${modeLabel(r.mode)} replaces it` : ""}.`;
    }
    return [setting(r.name, control, { hint }), ...(r.timeout !== undefined ? [timeoutRow(r)] : [])];
  });
  return card("Rules", !rows ? empty("No rule.", "A rule shows here for each kind of Ask.") : dataTable(heads(["Rule", "Fired", "Decided by (Rule / Director / Manual)", "Outcome (Fixed / No Change)"], ["Fired"]), rows, { id: "rules-table" }) + settings("Who decides", decide), { id: "rules" });
}

/** The held paths: the security paths of gate.ts (every repo) and the globs each repo names in the registry. Read-only. */
export function renderHeld(d) {
  const repos = d.repoHeld ?? [];
  const rows = repos.length
    ? repos.map((r) => `<div class="held-repo"><b>${esc(r.repo)}</b> <div class="held">${r.held.map((p) => chip(p, { el: "code" })).join("")}</div></div>`).join("")
    : empty("No repo names held paths.", "Add held globs to a repo in the registry.");
  return card("Held Paths", `<p class="quiet">The security paths and a repo's held paths wait for Chris after the reviewer passes the job. A test is never held.</p>` +
    `<div class="held-repo"><b>Every repo</b> <div class="held">${d.held.map((p) => chip(p, { el: "code" })).join("")}</div></div>${rows}`, { id: "gates-held", label: "Held paths" });
}

/** An ID of the log in its short form, as a link to its issue page: a job ID links to its subject's. Other text stays text. */
function idHtml(id) {
  const to = issueHref(parseJob(id)?.subject ?? id);
  return to ? idLink(shownId(id), to, { title: String(id) }) : esc(shownId(id) || "–");
}

/** The content of an event, `contentText`, with each ID as a link and the file's base name in mono with its full path as the title. */
function contentHtml(e) {
  const ids = new Map([e.on ?? []].flat().map((x) => [shownId(x), x]));
  const file = e.file && String(e.file).split("/").at(-1);
  return contentText(e).split(" ").map((t) => (ids.has(t) ? idHtml(ids.get(t)) : t === file ? `<code title="${esc(e.file)}">${esc(t)}</code>` : esc(t))).join(" ");
}

/** The log, newest first, filtered by `by` (an actor) from the address; `limit` rows show. A row's note opens with its button. */
export function renderLog(d, by, limit = PAGE) {
  const pick = Object.hasOwn(BY, by ?? "") ? by : "";
  const filter = filterBar([{ name: "by", label: "By", value: pick, options: [{ value: "", label: "All" }, ...Object.keys(BY).map((k) => ({ value: k, label: k }))] }]);
  const entries = d.log.entries.filter((e) => !pick || e.by === pick);
  const rows = entries.slice(0, limit).map((e) => {
    const subject = e.action === "changed" && !parseId(e.subject) ? `<a href="#rules">${esc(e.subject)}</a>` : idHtml(e.subject);
    return `<tr><td class="time lead">${esc(e.times ? `${when(e.first)} – ${when(e.at)}` : when(e.at))}</td><td>${subject}</td><td>${tag(e.by, BY[e.by])}</td><td>${esc(e.action || "–")}</td><td>${esc(e.sub ?? "")}</td>` +
      `<td class="what">${contentHtml(e)}${e.note ? clamp(esc(e.note)) : ""}</td><td class="num">${e.times || 1}</td></tr>`;
  }).join("");
  return card("Log", filter +
    (rows ? dataTable(heads(["Logged", "Subject", "By", "Action", "Sub", "Content", "Times"], ["Times"]), rows) + pager(limit, entries.length, PAGE) : empty("No entry in this window.", "Pick a longer window or clear the By filter.")), { id: "gates-log" });
}

/** The rule switches. `root.onclick`, so a refresh does not add a second handler and the shell clears it on a route change. */
export function mount(root) {
  scope().wire(root);
  wireToc(root);
  root.onsubmit = async (e) => {
    const sched = e.target.closest?.("form[data-schedule]");
    if (sched) {
      e.preventDefault();
      const btn = sched.querySelector("button");
      btn.disabled = true;
      try {
        await postJson("/api/automation/schedules", { name: sched.dataset.schedule, every: sched.elements.every.value.trim() });
      } catch (err) { btn.disabled = false; say(btn, `Could not save the interval: ${err.message}`); return; }
      return redraw(true);
    }
    const timed = e.target.closest?.("form[data-timeout]");
    if (timed) {
      e.preventDefault();
      const btn = timed.querySelector("button");
      btn.disabled = true;
      try {
        await postJson(`/api/automation/rules/${encodeURIComponent(timed.dataset.timeout)}/timeout`, { minutes: Number(timed.elements.minutes.value) });
      } catch (err) { btn.disabled = false; say(btn, `Could not save the timeout: ${err.message}`); return; }
      return redraw(true);
    }
    const form = e.target.closest?.("form.capform");
    if (!form) return;
    e.preventDefault();
    const key = form.dataset.cap, btn = form.querySelector("button");
    btn.disabled = true;
    try {
      await postJson("/api/automation/caps", { [key]: Number(form.elements[key].value) });
    } catch (err) { btn.disabled = false; say(btn, `Could not save the cap: ${err.message}`); return; }
    await redraw(true);
  };
  root.onclick = async (e) => {
    const seg = e.target.closest?.("#gates-log .seg button");
    if (seg) return goQuery({ by: seg.dataset.value, limit: "" });
    const more = e.target.closest?.("#gates-log button[data-more]");
    if (more) {
      setQuery({ limit: String(limitOf(hashQuery(), PAGE) + Number(more.dataset.more)) });
      return redraw();
    }
    const r = e.target.closest?.("button[data-rule]");
    if (r) {
      if (r.getAttribute("aria-pressed") === "true") return;
      const seg = r.parentElement, buttons = [...seg.querySelectorAll("button")];
      buttons.forEach((b) => { b.disabled = true; });
      const { rule, mode } = r.dataset;
      try {
        await (mode ? postJson(`/api/automation/rules/${encodeURIComponent(rule)}/grant`, { action: mode }) : postJson(`/api/automation/rules/${encodeURIComponent(rule)}/revoke`));
      } catch (err) { buttons.forEach((b) => { b.disabled = false; }); say(seg, `Could not change the rule: ${err.message}`); return; }
      await redraw(true);
      return;
    }
  };
}
