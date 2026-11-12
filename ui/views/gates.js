// The Automation view: metrics, caps, schedules, rules and the log. Each render function takes the /api/automation object and returns an HTML
// string, so tests can call them. The shell's click handler (router.js) runs the Waiting-for-you buttons; `mount` runs the rule switches.
import { redraw } from "../router.js";
import { clamp, fold, toc, wireToc, actButton, postJson, say, count, badge, card, cell, tag, tone, day, localMs, plural, miss, note, notice, facts, dataTable, pagedTable, empty, error, esc, filterBar, inputBox, selectBox, setting, settings, goQuery, heads, hours, pct, chip, idLink, pageOf, pageRows, pager, pageHead, seg, setQuery, statCard, tiles, when, scope } from "../lib.js";
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

/** The log's actors, in filter order, with the badge tone of each from `tone()`. */
export const BY = Object.fromEntries(["human", "rule", "director", "firefighter", "gate"].map((a) => [a, tone(a)]));

const PAGE = 50;

const CONTENTS = [["gates-schedules", "Schedules"], ["monitor", "Monitor"], ["gates-waiting", "Waiting for the User"],
  ["rules", "Rules"], ["gates-caps", "Controls"], ["gates-held", "Held Paths"], ["gates-log", "Log"]];

export function renderGates(d, q = new URLSearchParams()) {
  return `<div class="page gates">${pageHead("Automation", { aside: scope(q).bar() })}` + toc(CONTENTS,
    renderNow(d) + (d.backend ? notice(`Waiting for ${d.backend.via}: ${d.backend.why}`, false, "gates-backend") : "") + renderSchedules(d) + renderMonitor(d) + renderWaiting(d) + renderRules(d) +
    renderCaps(d) + renderHeld(d) + renderLog(d, q.get("by"), pageOf(q))) + `</div>`;
}

/** The environment variable that overrides each key of caps.json, as jobs/lib/infra/settings.ts names it. */
const CAP_ENV = { live: "ALEPH_LIVE_CAP", run: "ALEPH_RUN_CAP", intakeTries: "ALEPH_INTAKE_TRIES", jobSeconds: "ALEPH_JOB_TIMEOUT", fixRounds: "ALEPH_FIX_ROUNDS", landBatch: "ALEPH_LAND_BATCH", loadLimit: "ALEPH_LOAD_LIMIT" };
/** One cap as a setting: a number input with a Save button, `now` in the hint, and a warning when its environment variable overrides caps.json. */
function capSetting(f, key, label, value, note) {
  const id = `cap-${key}`, env = f.capEnv?.[key] ? ` ${CAP_ENV[key]} is set: an edit has no effect while that variable is set.` : "";
  return setting(label, inputBox(key, value, { id, type: "number", attrs: ` min="${key === "fixRounds" ? 0 : 1}" step="1" inputmode="numeric" required` }),
    { id, save: "Save", hint: `${note}.${env}`, attrs: ` data-cap="${key}"` });
}

/** The metric tiles: the automation rate, the gate catches and the held time, each over the log's window. */
export function renderNow(d) {
  const m = d.metrics;
  const tilesHtml = [
    statCard({ k: "Automation rate", v: m.rate ? pct(m.rate.percent) : "–", ...(m.rate ? { v2: count(m.rate.total) } : {}), ...(m.rate ? { q: ["decided without the user", "asks"] } : { note: "no Ask decided" }) }),
    statCard({ k: "Gate catches", v: count(m.catches.fired), v2: count(m.catches.fixed), q: ["sent back", "fixed later"] }),
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
  return card("Controls", settings("Controls", [
    capSetting(f, "live", "Live cap", f.liveCap, `Live jobs against the cap: ${f.liveRuns} of ${f.liveCap} now`),
    capSetting(f, "run", "Job cap", f.runCap, `The most starts any one issue made in the last hour: ${f.runStarts ?? 0} of ${f.runCap}`),
    ...SETTINGS.map(([k, label, note]) => capSetting(f, k, label, f.settings?.[k] ?? "", note[0].toUpperCase() + note.slice(1))),
  ]), { id: "gates-caps" });
}

/** The newest monitor report: a summary that expands to every finding and the reader's reply, or why there is no reading. */
export function renderMonitor(d) {
  const m = d.monitor;
  if (!m) return card("Monitor", empty("The monitor has not run.", "It reads once a day, in the tick."), { id: "monitor" });
  const n = m.findings.length, first = n ? ` First: ${findingHtml(m.findings[0])}` : "";
  const summary = `${esc(day(localMs(m.day)))}: ${plural(n, "finding")}.${first}`;
  const body = (n ? findingsList(m.findings) : "") +
    (m.text ? `<pre class="reader">${esc(m.text)}</pre>` : m.error ? error(`No reading: ${m.error}`, "The monitor reads again at its next run.") : "");
  return card("Monitor", fold(summary, body), { id: "monitor" });
}

/** An interval as systemd writes it ("30s", "1min", "2h") split into a number and its unit, or null for any other form. */
const UNITS = [["s", "seconds"], ["min", "minutes"], ["h", "hours"]];
const splitEvery = (every) => { const m = /^([1-9]\d*)(s|min|h)$/.exec(every ?? ""); return m ? { n: m[1], unit: m[2] } : null; };

/** The Every cell of a schedule with a timer: a number and a unit, locked until Edit opens them, then Save posts them. */
function everyForm(s) {
  const v = splitEvery(s.every) ?? { n: "", unit: "min" }, id = `every-${s.name}`;
  return `<form class="every" data-schedule="${esc(s.name)}">${inputBox("n", v.n, { id, type: "number", attrs: ` min="1" step="1" inputmode="numeric" required disabled aria-label="${esc(s.name)} every"` })}` +
    selectBox(`${s.name} unit`, "unit", UNITS.map(([value, label]) => ({ value, label })), v.unit, { attrs: " disabled" }) +
    `<button type="button" class="act" data-edit>Edit</button></form>`;
}

/** The tick, the suite and the monitor: how often each runs, what came of its last run and when it ran. The monitor runs in the tick, once a day, so only the other two have an interval to edit. */
export function renderSchedules(d) {
  const rows = d.schedules.map((s) => `<tr>${cell(s.name, { wide: true })}<td>${s.name === "monitor" ? esc(s.every) : everyForm(s)}</td><td>${s.result ? esc(s.result) : miss("no result")}</td><td class="time">${esc(when(s.last))}</td></tr>`).join("");
  return card("Schedules", rows ? dataTable(heads(["Schedule", "Every", "Result", "Last Run"], ["Last Run"]), rows) : empty("No schedule.", "The factory lists its schedules once it runs."), { id: "gates-schedules" });
}

/** The Asks routed to Chris, as the Status page's cards. */
function renderWaiting(d) {
  const rows = d.asks.map((i) => askCard(i, d.now)).join("");
  return card("Waiting for the User", rows ? `<div class="list">${rows}</div>` : empty("Nothing waits for the user.", "An Ask that needs the user shows here."), { id: "gates-waiting", count: d.asks.length });
}

/** The minutes after which the factory lands an escalated Ask of a land reason that the director recommends landing; 0 waits for Chris. */
const timeoutRow = (r) => {
  const id = `timeout-${r.reason}`;
  return setting(`${r.name}: land after`, inputBox("minutes", r.timeout, { id, type: "number", attrs: ' min="0" step="1" inputmode="numeric" required' }) + " min with no answer",
    { id, save: "Save", hint: r.timeout ? "Only when the director recommends the land." : "0: waits for the user.", attrs: ` data-timeout="${esc(r.reason)}"` });
};

/** One row per Ask reason: how often it fired and who decided, then a settings list of who decides it. Ask me, or the reason's one automatic mode. */
export function renderRules(d) {
  const rows = d.rules.map((r) => {
    const dec = r.decided, out = r.outcome;
    return `<tr class="rule" data-reason="${esc(r.reason)}"><td class="wide"><b>${esc(r.name)}</b> <code>${esc(r.reason)}</code>${r.line ? note(r.line) : ""}</td>` +
      [r.fired, dec.rule, dec.director, dec.chris, out.fixed, out.none].map((n) => cell(count(n), { num: true })).join("") + `</tr>`;
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
      if (!r.mode) hint = "The director decides first and sends the rest to the user.";
      if (g && g.action !== r.mode) hint = `always.json grants ${g.action}. Ask me removes it${r.mode ? `; ${modeLabel(r.mode)} replaces it` : ""}.`;
    }
    return [setting(r.name, control, { hint }), ...(r.timeout !== undefined ? [timeoutRow(r)] : [])];
  });
  return card("Rules", !rows ? empty("No rule.", "A rule shows here for each kind of Ask.") : dataTable(heads(["Ask", "Fired", "Rule", "Director", "User", "Fixed", "No Change"], ["Fired", "Rule", "Director", "User", "Fixed", "No Change"]), rows, { id: "rules-table" }) + settings("Who decides", decide), { id: "rules" });
}

/** The held paths: the security paths of gate.ts (every repo) and the globs each repo names in the registry. Read-only. */
export function renderHeld(d) {
  const repos = d.repoHeld ?? [];
  const paths = (list) => `<div class="held">${list.map((p) => chip(p, { el: "code" })).join("")}</div>`;
  return card("Held Paths", note("The security paths and a repo's held paths wait for the user after the reviewer passes the job. A test is never held.") +
    facts([["Every repo", paths(d.held)], ...repos.map((r) => [r.repo, paths(r.held)])]) +
    (repos.length ? "" : empty("No repo names held paths.", "Add held globs to a repo in the registry.")), { id: "gates-held", label: "Held paths" });
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

/** The log, newest first, filtered by `by` (an actor) from the address; page `page` shows. A row's note opens with its button. */
export function renderLog(d, by, page = 1) {
  const pick = Object.hasOwn(BY, by ?? "") ? by : "";
  const filter = filterBar([{ name: "by", label: "By", value: pick, options: [{ value: "", label: "All" }, ...Object.keys(BY).map((k) => ({ value: k, label: k }))] }]);
  const entries = d.log.entries.filter((e) => !pick || e.by === pick);
  const rows = pageRows(entries, page, PAGE).map((e) => {
    const subject = e.action === "changed" && !parseId(e.subject) ? `<a href="#rules">${esc(e.subject)}</a>` : idHtml(e.subject);
    return `<tr><td class="time lead">${esc(e.times ? `${when(e.first)} – ${when(e.at)}` : when(e.at))}</td><td>${subject}</td><td>${tag(e.by, tone(e.by))}</td><td>${e.action ? esc(e.action) : miss("no action")}</td><td>${e.sub ? esc(e.sub) : miss("no sub")}</td>` +
      `<td class="wide">${contentHtml(e)}${e.note ? clamp(esc(e.note)) : ""}</td><td class="num">${e.times || 1}</td></tr>`;
  }).join("");
  return card("Log", filter +
    (rows ? dataTable(heads(["Logged", "Subject", "By", "Action", "Sub", "Content", "Times"], ["Times"]), rows) + pager(page, entries.length, PAGE) : empty("No entry in this window.", "Pick a longer window or clear the By filter.")), { id: "gates-log" });
}

/** What each settings form posts, by its `data-` key: the URL, the body and the word for an error line. */
const SAVES = {
  schedule: (f) => ["/api/automation/schedules", { name: f.dataset.schedule, every: `${f.elements.n.value}${f.elements.unit.value}` }, "interval"],
  timeout: (f) => [`/api/automation/rules/${encodeURIComponent(f.dataset.timeout)}/timeout`, { minutes: Number(f.elements.minutes.value) }, "timeout"],
  cap: (f) => ["/api/automation/caps", { [f.dataset.cap]: Number(f.elements[f.dataset.cap].value) }, "cap"],
};

/** The rule switches. `root.onclick`, so a refresh does not add a second handler and the shell clears it on a route change. */
export function mount(root) {
  scope().wire(root);
  wireToc(root);
  root.onsubmit = async (e) => {
    const form = e.target.closest?.("form[data-schedule], form[data-timeout], form[data-cap]");
    if (!form) return;
    e.preventDefault();
    const [url, body, what] = SAVES[Object.keys(SAVES).find((k) => k in form.dataset)](form), btn = form.querySelector("button");
    btn.disabled = true;
    try {
      await postJson(url, body);
    } catch (err) { btn.disabled = false; say(btn, `Could not save the ${what}: ${err.message}`); return; }
    await redraw(true);
  };
  root.onclick = async (e) => {
    // The first click unlocks the row's interval and turns Edit into Save; the next submits it.
    const edit = e.target.closest?.("form.every button");
    if (edit) {
      const f = edit.form;
      if (f.elements.n.disabled) {
        for (const el of f.elements) el.disabled = false;
        edit.textContent = "Save";
        return f.elements.n.focus();
      }
      return f.requestSubmit();
    }
    const seg = e.target.closest?.("#gates-log .seg button");
    if (seg) return goQuery({ by: seg.dataset.value, page: "" });
    const turn = e.target.closest?.("#gates-log button[data-page]");
    if (turn) {
      setQuery({ page: turn.dataset.page });
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
