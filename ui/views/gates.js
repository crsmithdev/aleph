// The Automation view: metrics, caps, schedules, rules and the log. Each render function takes the /api/automation object and returns an HTML
// string, so tests can call them. The shell's click handler (router.js) runs the Waiting-for-you buttons; `mount` runs the rule switches.
import { moved, redraw } from "./lib/router.js";
import { postJson, goQuery, setQuery, scope } from "./lib/address.js";
import { count, day, localMs, plural, hours, pct, when } from "./lib/format.js";
import { clamp, fold, toc, wireToc, actButton, say, badge, card, cell, row, miss, note, notice, dataTable, pagedTable, empty, error, esc, filterBar, inputBox, selectBox, setting, settings, meter, heads, chip, idLink, pageOf, pageRows, pager, pageHead, seg, statCard, tiles } from "./lib/html.js";
import { contentText, issueHref, linked, parseId, shownId } from "../../lib/naming.ts";
import { findingHtml, findingsList } from "./lib/feed.js";

export const view = {
  path: "/automation",
  title: "Automation",
  // Next to Status in the sidebar: both say what holds the factory now.
  group: "factory",
  order: -2,
  icon: "shield-halved",
  // The caps' use and the live counts come from the factory block of /api/factory.
  api: (_params, q = new URLSearchParams()) => { const s = scope(q); return [s.url(`/api/automation?window=${s.window}`), s.url(`/api/factory?window=${s.window}`)]; },
  combine: ([d, s]) => ({ ...d, factory: { ...s.factory, caps: d.caps, settings: d.settings } }),
  live: true,
  refresh: 60,
  render: (d, _params, q) => renderGates(d, q),
  mount: (root) => mount(root),
};

/** `#/gates` (with or without a query) is now `#/automation`. */
export const redirect = (hash) => moved(hash, ["#/gates"], "#/automation");

/** The label of an automatic mode: what it does. */
const MODES = { resolve: "Take the pick" };
const modeLabel = (m) => MODES[m] ?? m.replace(/^./, (c) => c.toUpperCase());

/** The log's actors, in filter order. */
export const BY = Object.fromEntries(["human", "rule", "director", "firefighter", "gate"].map((a) => [a, a]));

const PAGE = 50;

const CONTENTS = [["gates-schedules", "Schedules"], ["gates-caps", "Controls"], ["monitor", "Monitor"],
  ["rules", "Rules"], ["gates-held", "Held Paths"], ["gates-log", "Log"]];

export function renderGates(d, q = new URLSearchParams()) {
  return `<div class="page gates">${pageHead("Automation", { aside: scope(q).bar() })}` + toc(CONTENTS,
    renderNow(d) + (d.backend ? notice(`Waiting for ${d.backend.via}: ${d.backend.why}`, false, "gates-backend") : "") + `<div class="pair">${renderSchedules(d)}${renderCaps(d)}</div>` + renderMonitor(d) + renderRules(d) +
    renderHeld(d) + renderLog(d, q.get("by"), pageOf(q))) + `</div>`;
}

/** One cap as a setting: a number input with a Save button, `hint` of at most four words, `tip` as the row's title, and a mark in the hint and a warning in the title when its environment variable overrides the `caps` setting. */
function capSetting(f, key, label, value, hint, tip) {
  const c = f.caps[key], id = `cap-${key}`, env = c.set ? ` ${c.env} is set: an edit has no effect while that variable is set.` : "";
  return setting(label, inputBox(key, value, { id, type: "number", attrs: ` min="${c.min}" step="1" inputmode="numeric" required` }),
    { id, save: "Save", hint: env ? `${hint}, env` : hint, attrs: ` data-cap="${key}" title="${esc(`${tip}.${env}`)}"` });
}

/** The metric tiles: the automation rate, the gate catches and the held time, each over the log's window. */
export function renderNow(d) {
  const m = d.metrics;
  const tilesHtml = [
    statCard({ k: "Automation rate", v: m.rate ? pct(m.rate.percent) : "–", ...(m.rate ? { v2: count(m.rate.total) } : {}), ...(m.rate ? { q: ["auto", "asks"] } : {}) }),
    statCard({ k: "Gate catches", v: count(m.catches.fired), v2: count(m.catches.fixed), q: ["sent back", "fixed"] }),
    statCard({ k: "Held time", v: hours(m.held?.hours), v2: count(m.held?.goals), q: ["held", "issues"] }),
  ].join("");
  return `<section id="gates-now">${tiles("Metrics", tilesHtml)}</section>`;
}

/** The settings under the caps: each one's value and a form to edit it. */
const SETTINGS = [
  ["intakeTries", "Intake tries", "runs", "intake runs with no reply before an Ask"],
  ["jobSeconds", "Job time limit", "seconds", "seconds in a worker's time box"],
  ["fixRounds", "Fix rounds", "rounds", "times a failed job goes back to its worker before an Ask"],
  ["landBatch", "Land batch", "jobs", "passed runs one land pushes together"],
  ["loadLimit", "Load limit", "1min load", "the 1-minute load average under which a check, a worker or a land starts"],
];

/** The controls panel: the live cap and the run cap, each with its use against its limit, then the settings, each with a form to edit it. */
export function renderCaps(d) {
  const f = d.factory;
  return card("Controls", settings("Controls", [
    capSetting(f, "live", "Live cap", f.liveCap, `${count(f.liveRuns)} of ${count(f.liveCap)}`, "Live jobs now, of the cap"),
    capSetting(f, "run", "Job cap", f.runCap, `${count(f.runStarts ?? 0)} of ${count(f.runCap)}`, "The most starts any one issue made in the last hour"),
    ...SETTINGS.map(([k, label, hint, tip]) => capSetting(f, k, label, f.settings?.[k] ?? "", hint, tip[0].toUpperCase() + tip.slice(1))),
  ]), { id: "gates-caps" });
}

/** The newest monitor report: a summary that expands to every finding and the reader's reply, or why there is no reading. */
export function renderMonitor(d) {
  const m = d.monitor;
  if (!m) return card("Monitor", empty(), { id: "monitor" });
  const n = m.findings.length, first = n ? ` First: ${findingHtml(m.findings[0])}` : "";
  const summary = `${esc(day(localMs(m.day)))}: ${plural(n, "finding")}.${first}`;
  const body = (n ? findingsList(m.findings) : "") +
    (m.text ? `<pre class="reader">${esc(m.text)}</pre>` : m.error ? error("Could not load the monitor.", { detail: m.error }) : "");
  return card("Monitor", fold(summary, body), { id: "monitor" });
}

/** An interval as systemd writes it ("30s", "1min", "2h") split into a number and its unit, or null for any other form. */
const UNITS = [["s", "seconds"], ["min", "minutes"], ["h", "hours"]];
const splitEvery = (every) => { const m = /^([1-9]\d*)(s|min|h)$/.exec(every ?? ""); return m ? { n: m[1], unit: m[2] } : null; };

/** The interval of a schedule as a setting: a number and a unit, with a Save button that posts them. The hint gives the last run's result and when it ran. */
function everySetting(s, hint) {
  const v = splitEvery(s.every) ?? { n: "", unit: "min" }, id = `every-${s.name}`;
  return setting(`${s.name[0].toUpperCase()}${s.name.slice(1)} every`, inputBox("n", v.n, { id, type: "number", attrs: ` min="1" step="1" inputmode="numeric" required` }) +
    selectBox(`${s.name} unit`, "unit", UNITS.map(([value, label]) => ({ value, label })), v.unit), { id, save: "Save", hint, attrs: ` data-schedule="${esc(s.name)}"` });
}

/** The monitor's hour as a setting: the local hour 0 to 23 from which the tick runs its monitor step. */
function hourSetting(s, hint) {
  return setting("Monitor hour", inputBox("n", s.hour ?? 0, { id: "hour-monitor", type: "number", attrs: ` min="0" max="23" step="1" inputmode="numeric" required aria-label="monitor hour"` }),
    { id: "hour-monitor", save: "Save", hint, attrs: ` data-schedule="monitor"` });
}

/** The tick, the suite and the monitor as one settings list: each row has its interval (the monitor its hour) and Save, and a hint with what came of its last run and when it ran. The monitor runs in the tick, once a day from its hour. */
export function renderSchedules(d) {
  const rows = d.schedules.map((s) => (s.name === "monitor" ? hourSetting : everySetting)(s, [s.result, when(s.last)].filter(Boolean).join(" · ") || "no run"));
  return card("Schedules", rows.length ? settings("Schedules", rows) : empty(), { id: "gates-schedules" });
}

/** The units of an Ask's wait, largest first: a stored number of minutes shows in the largest unit that divides it. */
const WAITS = [["d", 1440, "days"], ["h", 60, "hours"], ["min", 1, "minutes"]];
const splitWait = (m) => { const [unit, k] = WAITS.find(([, k]) => m % k === 0); return { n: m / k, unit }; };
const waitText = (m) => { const { n, unit } = splitWait(m); return `${count(n)} ${unit}`; };

/** Who decides a reason first: a rule's action when the always setting grants one, else the director. */
const decidesText = (r) => (r.places ? (r.places.length ? `Approve for ${r.places.map((k) => k.slice(k.indexOf(":") + 1)).join(", ")}` : "Director") : r.granted ? modeLabel(r.granted.action) : "Director");

/** What happens when an escalated Ask gets no answer: it keeps waiting, or after the timeout the director's pick is taken or the Ask is dropped. */
const noAnswerText = (r) => (r.timeout ? `After ${waitText(r.timeout)}: ${r.noAnswer === "drop" ? "drop" : "take the pick"}` : "Keep waiting");

/** Who decided the reason's Asks in the window, as a bar and its line. */
function decidedCell(d) {
  const all = d.rule + d.director + d.chris;
  if (!all) return miss("none decided");
  const line = `${count(d.rule)} rule · ${count(d.director)} director · ${count(d.chris)} user`;
  return meter([["rule", d.rule], ["dir", d.director], ["user", d.chris]].map(([k, n]) => ({ pct: (100 * n) / all, cls: `c-${k}` })), line) + `<small class="split">${esc(line)}</small>`;
}

/** A reason has an Edit row unless it is a memory proposal, which is granted per place. */
const editable = (r) => !r.places;

/** The settings form of a reason, under the table and hidden until its Edit button opens it. Save posts only what changed. */
function ruleForm(r) {
  const opt = (value, label, on) => ({ label, on, attrs: ` data-value="${esc(value)}"` });
  const g = r.granted?.action ?? "";
  const decide = setting("Decides", seg(`Who decides ${r.name}`, [opt("", "Director", !g), ...(r.mode ? [opt(r.mode, modeLabel(r.mode), g === r.mode)] : []), ...(g && g !== r.mode && g !== "user" ? [opt(g, modeLabel(g), true)] : []), opt("user", "User", g === "user")], ' data-field="decide"'),
    { hint: "Who decides first", attrs: ` title="Director: the director decides and sends the rest to the user. User: the Ask goes to the user with no director run."` });
  const v = r.timeout ? splitWait(r.timeout) : { n: 30, unit: "min" }, off = r.timeout ? "" : " disabled", then = r.timeout ? r.noAnswer ?? "pick" : "wait";
  const wait = setting("If no answer", seg(`If ${r.name} gets no answer`, [opt("wait", "Keep waiting", then === "wait"), opt("pick", "Take the pick", then === "pick"), opt("drop", "Drop", then === "drop")], ' data-field="wait"') +
    ` after ${inputBox("n", v.n, { type: "number", attrs: ` min="1" step="1" inputmode="numeric" required aria-label="${esc(r.name)} wait"${off}` })}` +
    selectBox(`${r.name} wait unit`, "unit", WAITS.map(([value, , label]) => ({ value, label })), v.unit, { attrs: off }),
    { hint: "After the timeout", attrs: ` title="Take the pick: the action the director recommends, if it recommends one. Drop: the reason's drop, close or deny."` });
  const buttons = `<span class="rule-acts">${actButton("Cancel", { cancel: "" })}${actButton("Save", {}, { primary: true, type: "submit" })}</span>`;
  return `<form class="rule-form" data-rule="${esc(r.reason)}" data-was-decide="${esc(g)}" data-was-wait="${r.timeout ?? ""}" data-was-then="${then}" hidden>` +
    settings(`Edit ${r.name}`, r.timeout === undefined ? [decide] : [decide, wait]) + buttons + `</form>`;
}

/** One row per Ask reason: how often it fired, who decided it, who decides it first, and what happens when no one answers. Edit opens the reason's settings under the table. */
export function renderRules(d) {
  const rows = d.rules.map((r) => row([
    cell(r.name, { wide: true, title: [r.reason, r.line].filter(Boolean).join(" ") }), cell(count(r.fired), { num: true }), `<td class="decided">${decidedCell(r.decided)}</td>`,
    cell(decidesText(r)), cell(noAnswerText(r)), `<td class="acts">${editable(r) ? actButton("Edit", { "edit-rule": r.reason }, { kind: "small" }) : ""}</td>`])).join("");
  return card("Rules", !rows ? empty() :
    dataTable(heads(["Ask", "Fired", "Decided By", "Decides", "If No Answer", ""], ["Fired"]), rows, { id: "rules-table" }) + d.rules.filter(editable).map(ruleForm).join(""), { id: "rules" });
}

/** The held paths: the security paths of gate.ts (every repo) and the globs each repo names in the registry. Read-only. */
export function renderHeld(d) {
  const repos = d.repoHeld ?? [];
  const scopeRow = (k, list) => `<dt>${esc(k)}</dt><dd>${list.map((p) => `<div><code>${esc(p)}</code></div>`).join("")}</dd>`;
  return card("Held Paths", `<div title="The reviewer passes the job, then these paths wait for the user. A test is never held.">${note("Awaits user")}</div>` +
    (d.held.length || repos.length ? `<dl class="held-paths">${scopeRow("Every repo", d.held)}${repos.map((r) => scopeRow(r.repo, r.held)).join("")}</dl>` : empty()), { id: "gates-held", label: "Held paths" });
}

/** An ID of the log in its short form, as a link to its issue page: a job ID links to its `target`'s. `repo` is the project of an issue key. Other text stays text. */
function idHtml(id, repo, target) {
  const to = issueHref(id, repo) || issueHref(target, repo);
  return to ? idLink(shownId(id, repo), to, { title: String(id) }) : esc(shownId(id, repo) || "–");
}

/** The detail of an event with each key and issue ID as a link. */
/** A detail longer than this shows behind its Show more button: it is a note, not a phrase. */
const CLAMP_CHARS = 120;
const detailHtml = (e) => linked(e.detail ?? "").map((p) => (typeof p === "string" ? esc(p) : idHtml(p.id, p.id === e.object ? e.project : undefined))).join("");

/** The log, newest first, filtered by `by` (a subject) from the address; page `page` shows. */
export function renderLog(d, by, page = 1) {
  const pick = Object.hasOwn(BY, by ?? "") ? by : "";
  const filter = filterBar([{ name: "by", label: "By", value: pick, options: [{ value: "", label: "All" }, ...Object.keys(BY).map((k) => ({ value: k, label: k }))] }]);
  const entries = d.log.entries.filter((e) => !pick || e.subject === pick);
  const rows = pageRows(entries, page, PAGE).map((e) => {
    const object = !e.object ? miss("no object") : e.action === "changed" && !parseId(e.object) ? `<a href="#rules">${esc(e.object)}</a>` : idHtml(e.object, e.project, e.object_target);
    return `<tr><td class="time lead">${esc(e.times ? `${when(e.first)} – ${when(e.time)}` : when(e.time))}</td><td>${object}</td>` +
      `<td class="wide"${contentText(e) ? ` title="${esc(contentText(e))}"` : ""}>${(e.detail ?? "").length > CLAMP_CHARS ? clamp(detailHtml(e)) : detailHtml(e)}</td>` +
      `<td>${e.action ? esc(e.action) : miss("no action")}</td><td>${chip(e.subject)}</td><td class="num">${count(e.times || 1)}</td></tr>`;
  }).join("");
  return card("Log", filter +
    (rows ? dataTable(heads(["Logged", "Object", "Detail", "Action", "Subject", "Times"], ["Times"]), rows) + pager(page, entries.length, PAGE) : empty()), { id: "gates-log" });
}

/** What each settings form posts, by its `data-` key: the URL, the body and the word for an error line. */
const SAVES = {
  schedule: (f) => ["/api/automation/schedules", { name: f.dataset.schedule, ...(f.elements.unit ? { every: `${f.elements.n.value}${f.elements.unit.value}` } : { hour: Number(f.elements.n.value) }) }, "interval"],
  cap: (f) => ["/api/automation/caps", { [f.dataset.cap]: Number(f.elements[f.dataset.cap].value) }, "cap"],
};

/** The posts a rule form's Save needs: a grant or a revoke when Decides changed, a timeout when the wait or its action changed. */
export function rulePosts(f) {
  const url = (what) => `/api/automation/rules/${encodeURIComponent(f.dataset.rule)}/${what}`;
  const picked = (field) => f.querySelector(`.seg[data-field="${field}"] [aria-pressed="true"]`)?.dataset.value;
  const out = [], decide = picked("decide");
  if (decide !== undefined && decide !== f.dataset.wasDecide) out.push(decide ? [url("grant"), { action: decide }] : [url("revoke"), undefined]);
  const wait = picked("wait");
  if (wait !== undefined) {
    const k = WAITS.find(([u]) => u === f.elements.unit.value)[1], minutes = wait === "wait" ? 0 : Number(f.elements.n.value) * k;
    if (String(minutes) !== f.dataset.wasWait || wait !== f.dataset.wasThen) out.push([url("timeout"), minutes ? { minutes, then: wait } : { minutes }]);
  }
  return out;
}

async function saveRule(f) {
  const btn = f.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    for (const [url, body] of rulePosts(f)) await postJson(url, body);
  } catch (err) { btn.disabled = false; say(btn, `Could not save the rule: ${err.message}`); return; }
  await redraw(true);
}

/** The rule switches. `root.onclick`, so a refresh does not add a second handler and the shell clears it on a route change. */
export function mount(root) {
  scope().wire(root);
  wireToc(root);
  root.onsubmit = async (e) => {
    const rule = e.target.closest?.("form.rule-form");
    if (rule) {
      e.preventDefault();
      return saveRule(rule);
    }
    const form = e.target.closest?.("form[data-schedule], form[data-cap]");
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
    const seg = e.target.closest?.("#gates-log .seg button");
    if (seg) return goQuery({ by: seg.dataset.value, page: "" });
    const turn = e.target.closest?.("#gates-log button[data-page]");
    if (turn) {
      setQuery({ page: turn.dataset.page });
      return redraw();
    }
    const open = e.target.closest?.("button[data-edit-rule]");
    if (open) {
      const form = root.querySelector(`form.rule-form[data-rule="${CSS.escape(open.dataset.editRule)}"]`);
      form.hidden = !form.hidden;
      open.setAttribute("aria-expanded", String(!form.hidden));
      return;
    }
    const pick = e.target.closest?.("form.rule-form .seg button");
    if (pick) {
      for (const b of pick.parentElement.children) b.setAttribute("aria-pressed", String(b === pick));
      if (pick.parentElement.dataset.field === "wait") for (const el of [pick.form.elements.n, pick.form.elements.unit]) el.disabled = pick.dataset.value === "wait";
      return;
    }
    const cancel = e.target.closest?.("form.rule-form button[data-cancel]");
    if (cancel) {
      return redraw(true);
    }
  };
}
