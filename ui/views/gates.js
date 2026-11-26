// The Automation view: Rules, Limits and Log (design/rules.md, page-grammar). Each render function takes the /api/automation object and returns an HTML
// string, so tests can call them. The shell's click handler (router.js) runs the browse list; `mount` runs the settings forms.
import { moved, redraw } from "./lib/router.js";
import { postJson, scope } from "./lib/address.js";
import { count, day, dur, localMs, pct, when, clock } from "./lib/format.js";
import { say, card, empty, error, esc, inputBox, selectBox, setting, settings, chip, idLink, linkButton } from "./lib/html.js";
import { contentText, issueHref, linked, shownId } from "../../lib/naming.ts";
import { findingsList } from "./lib/feed.js";
import { factsLine, pageViews } from "./lib/page.js";
import { browse, inspector } from "./lib/browse.js";
import { rowBar } from "./lib/bars.js";

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

export function renderGates(d, q = new URLSearchParams()) {
  return pageViews({ title: "Automation", path: "/automation", query: q, views: [
    { id: "rules", label: "Rules", scope: true, draw: () => (q.get("monitor") ? renderMonitor(d) : "") + renderRules(d) },
    { id: "limits", label: "Limits", draw: () => `<div class="pair">${renderCaps(d)}${renderSchedules(d)}</div>${renderHeld(d)}` },
    { id: "log", label: "Log", scope: true, draw: () => renderLog(d) },
  ] });
}

/** One cap as a setting: a number input with a Save button, `hint` of at most four words, `tip` as the row's title, and a mark in the hint and a warning in the title when its environment variable overrides the `caps` setting. */
function capSetting(f, key, label, value, hint, tip) {
  const c = f.caps[key], id = `cap-${key}`, env = c.set ? ` ${c.env} is set: an edit has no effect while that variable is set.` : "";
  return setting(label, inputBox(key, value, { id, type: "number", attrs: ` min="${c.min}" step="1" inputmode="numeric" required` }),
    { id, save: "Save", hint: env ? `${hint}, env` : hint, attrs: ` data-cap="${key}" title="${esc(`${tip}.${env}`)}"` });
}

/** The settings under the caps: each one's value and a form to edit it. */
const SETTINGS = [
  ["intakeTries", "Intake tries", "runs", "intake runs with no reply before an Ask"],
  ["jobSeconds", "Job time limit", "seconds", "seconds in a worker's time box"],
  ["fixRounds", "Fix rounds", "rounds", "times a failed job goes back to its worker before an Ask"],
  ["landBatch", "Land batch", "jobs", "passed runs one land pushes together"],
  ["loadLimit", "Load limit", "1min load", "the 1-minute load average under which a check, a worker or a land starts"],
];

/** The caps panel: the live cap and the run cap, each with its use against its limit, then the settings, each with a form to edit it. */
export function renderCaps(d) {
  const f = d.factory;
  return card("Caps", settings("Caps", [
    capSetting(f, "live", "Live cap", f.liveCap, `${count(f.liveRuns)} of ${count(f.liveCap)}`, "Live jobs now, of the cap"),
    capSetting(f, "run", "Job cap", f.runCap, `${count(f.runStarts ?? 0)} of ${count(f.runCap)}`, "The most starts any one issue made in the last hour"),
    ...SETTINGS.map(([k, label, hint, tip]) => capSetting(f, k, label, f.settings?.[k] ?? "", hint, tip[0].toUpperCase() + tip.slice(1))),
  ]), { id: "gates-caps" });
}

/** The newest monitor report, open in place from its attention row: every finding and the reader's reply, or why there is no reading. */
export function renderMonitor(d) {
  const m = d.monitor;
  if (!m) return card("Monitor", empty(), { id: "monitor" });
  const body = (m.findings.length ? findingsList(m.findings) : "") +
    (m.text ? `<pre class="reader">${esc(m.text)}</pre>` : m.error ? error("Could not load the monitor.", { detail: m.error }) : "");
  return card(`Monitor, ${day(localMs(m.day))}`, body || empty(), { id: "monitor", count: count(m.findings.length), aside: linkButton("Close", "#/automation") });
}

const UNITS = [["s", "seconds"], ["min", "minutes"], ["h", "hours"]];

/** The interval of a schedule as a setting: a number and a unit, with a Save button that posts them. The hint gives the last run's result and when it ran. */
function everySetting(s, hint) {
  const v = { n: s.n ?? "", unit: s.unit ?? "min" }, id = `every-${s.name}`;
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

/** Who decided a rule's Asks, each with its count and no zeros. */
const who = (x) => [[x.rule, "rule"], [x.director, "director"], [x.user, "user"]].filter(([n]) => n).map(([n, k]) => `${count(n)} ${k}`);

/** Who decided a rule's Asks, as one bar: rule, director, user; "" when none did. */
function decided(x) {
  const all = x.rule + x.director + x.user;
  return all ? rowBar([["rule", x.rule], ["dir", x.director], ["user", x.user]].map(([k, n]) => ({ pct: (100 * n) / all, cls: `c-${k}` })), who(x).join(" · ")) : "";
}

/** The two settings of a rule: who decides first and, for a timed Ask, what happens when no one answers. Each has a Save of its own that shows after a change. */
function ruleSettings(r) {
  const g = r.granted?.action ?? "", opt = (value, label) => ({ value, label });
  const id = (f) => `${f}-${r.reason}`, at = (f) => ` data-rule="${esc(r.reason)}" data-field="${f}"`;
  const decide = setting("Decides", selectBox(`Who decides ${r.name}`, "decide", [opt("", "Director"), ...(r.mode ? [opt(r.mode, modeLabel(r.mode))] : []), ...(g && g !== r.mode && g !== "user" ? [opt(g, modeLabel(g))] : []), opt("user", "User")], g, { id: id("decide") }),
    { id: id("decide"), save: "Save", attrs: `${at("decide")} title="Director: the director decides and sends the rest to the user. User: the Ask goes to the user with no director run."` });
  if (r.timeout === undefined) return settings(`Edit ${r.name}`, [decide]);
  const v = r.timeout ? splitWait(r.timeout) : { n: 30, unit: "min" }, then = r.timeout ? r.noAnswer ?? "pick" : "wait", off = r.timeout ? "" : " disabled";
  const wait = setting("No answer", selectBox(`If ${r.name} gets no answer`, "wait", [opt("wait", "Keep waiting"), opt("pick", "Take the pick"), opt("drop", "Drop")], then, { id: id("wait") }) +
    ` after ${inputBox("n", v.n, { type: "number", attrs: ` min="1" step="1" inputmode="numeric" required aria-label="${esc(r.name)} wait"${off}` })}` +
    selectBox(`${r.name} wait unit`, "unit", WAITS.map(([value, , label]) => ({ value, label })), v.unit, { attrs: off }),
    { id: id("wait"), save: "Save", attrs: `${at("wait")} title="Take the pick: the action the director recommends, if it recommends one. Drop: the reason's drop, close or deny."` });
  return settings(`Edit ${r.name}`, [decide, wait]);
}

/** The inspector of one rule: its counts, then its settings. */
function ruleInspect(r, now) {
  const kv = [
    ["Fired", count(r.fired)], ["Decided", esc(who(r.decided).join(", "))], ["Fixed", r.fired ? `${count(r.outcome.fixed)} of ${count(r.fired)}` : ""],
    ["Mode", esc(r.mode && modeLabel(r.mode))], ["Granted", r.granted ? esc(day(r.granted.at, now)) : ""], ["Projects", esc(r.projects.map((p) => p.project).join(", "))],
  ];
  return inspector({ id: r.reason, title: r.name, rows: kv, body: `<p class="quiet">${esc(r.line)}</p>${ruleSettings(r)}`, href: "#/automation" });
}

/** One row per Ask reason: the ask, how often it fired, who decided it and who decides first. A rule with no grant leaves its Decides blank. No answer shows only in the inspector. */
export function renderRules(d) {
  const f = d.metrics, now = new Date(d.now);
  const rows = d.rules.map((r) => ({
    key: r.reason, lead: esc(r.name), main: `<span class="t" title="${esc(r.line)}">${esc(r.line)}</span>`, text: `${r.name} ${r.line} ${r.reason}`, inspect: ruleInspect(r, now),
    cells: [r.fired ? count(r.fired) : "", decided(r.decided), r.granted ? esc(modeLabel(r.granted.action)) : `<span class="quiet">director</span>`],
  }));
  return factsLine([[f.rate ? pct(f.rate.percent) : "–", "automatic"], [count(f.catches.fired), "sent back"], [count(f.catches.fixed), "fixed"], [dur(f.held?.hours * 3600), "held"]]) +
    (rows.length ? browse({ id: "rules", label: "Rules", search: "Search rules", groups: [{ title: "Asks", count: count(rows.length), heads: ["Fired", "Decided", "Decides"], rows }] }) : card("Rules", empty()));
}

/** The held paths as setting rows: the security paths of gate.ts (every repo) and the globs each repo names in the registry. Read-only. */
export function renderHeld(d) {
  const paths = (list) => `<span class="held-paths">${list.map((p) => `<code>${esc(p)}</code>`).join("")}</span>`;
  const rows = [...(d.held.length ? [["Every repo", d.held]] : []), ...(d.repoHeld ?? []).map((r) => [r.repo, r.held])];
  return card("Held Paths", rows.length ? settings("Held paths", rows.map(([k, list]) => setting(k, paths(list)))) : empty(), { id: "gates-held", label: "Held paths", aside: `<span title="The reviewer passes the job, then these paths wait for the user. A test is never held.">awaits user</span>` });
}

/** An ID of the log in its short form, as a link to its issue page: a job ID links to its `target`'s. `repo` is the project of an issue key. Other text stays text. */
function idHtml(id, repo, target) {
  const to = issueHref(id, repo) || issueHref(target, repo);
  return to ? idLink(shownId(id, repo), to, { title: String(id) }) : esc(shownId(id, repo) || "–");
}

/** The detail of an event with each key and issue ID as a link. */
const detailHtml = (e) => linked(e.detail ?? "").map((p) => (typeof p === "string" ? esc(p) : idHtml(p.id, p.id === e.object ? e.project : undefined))).join("");

/** One log entry as a row: the clock, the object and its detail, the action and who logged it. The inspector holds the entry's other facts. */
function logRow(e, i, now) {
  const object = e.object ? idHtml(e.object, e.project, e.object_target) : "", detail = e.detail ? `<span class="t" title="${esc(contentText(e))}">${detailHtml(e)}</span>` : "";
  const kv = [["Logged", esc(e.times ? `${when(e.first, now)} – ${when(e.time, now)}` : when(e.time, now))], ["By", chip(e.subject)], ["Action", esc(e.action)], ["Object", object], ["Times", e.times ? count(e.times) : ""]];
  return {
    key: `${e.time}/${i}`, lead: esc(clock(e.time)), main: object + detail, cells: [esc(e.action ?? ""), chip(e.subject)], text: `${e.subject} ${e.action ?? ""} ${e.object ?? ""} ${e.detail ?? ""}`, data: { by: e.subject },
    inspect: inspector({ id: e.object ?? "", title: `${e.subject} ${e.action ?? ""}`, rows: kv, body: e.detail ? `<p class="quiet">${detailHtml(e)}</p>` : "", href: issueHref(e.object, e.project) || issueHref(e.object_target, e.project) || "#/automation?view=log" }),
  };
}

/** The log, newest first, in a group for each day. */
export function renderLog(d) {
  const { entries, total } = d.log, now = new Date(d.now);
  if (!entries.length) return card("Log", empty());
  const days = Map.groupBy(entries.map((e, i) => [day(e.time, now), logRow(e, i, now)]), ([t]) => t);
  const groups = [...days].map(([title, rows]) => ({ title, count: count(rows.length), heads: ["Action", "By"], rows: rows.map(([, r]) => r) }));
  if (total > entries.length) groups.at(-1).more = `${count(entries.length)} of ${count(total)}`;
  return browse({ id: "log", label: "Log", search: "Search the log", filters: [{ label: "By", name: "by", options: Object.keys(BY) }], groups });
}

/** What each settings form posts, by its `data-` key: the URL, the body and the word for an error line. A rule form posts its one field: Decides grants an action or revokes it, No answer sets the timeout. */
export function ruleSave(f) {
  const url = (what) => `/api/automation/rules/${encodeURIComponent(f.dataset.rule)}/${what}`, v = f.elements[f.dataset.field].value;
  if (f.dataset.field === "decide") return v ? [url("grant"), { action: v }, "rule"] : [url("revoke"), undefined, "rule"];
  const minutes = v === "wait" ? 0 : Number(f.elements.n.value) * WAITS.find(([u]) => u === f.elements.unit.value)[1];
  return [url("timeout"), minutes ? { minutes, then: v } : { minutes }, "rule"];
}

const SAVES = {
  schedule: (f) => ["/api/automation/schedules", { name: f.dataset.schedule, ...(f.elements.unit ? { every: `${f.elements.n.value}${f.elements.unit.value}` } : { hour: Number(f.elements.n.value) }) }, "interval"],
  cap: (f) => ["/api/automation/caps", { [f.dataset.cap]: Number(f.elements[f.dataset.cap].value) }, "cap"],
  rule: ruleSave,
};

/** The settings forms: a rule's No answer select turns its wait time on or off. `onsubmit`, so a refresh does not add a second handler. */
export function mount(root) {
  scope().wire(root);
  root.onsubmit = async (e) => {
    const form = e.target.closest?.("form[data-schedule], form[data-cap], form[data-rule]");
    if (!form) return;
    e.preventDefault();
    const [url, body, what] = SAVES[Object.keys(SAVES).find((k) => k in form.dataset)](form), btn = form.querySelector("button");
    btn.disabled = true;
    try {
      await postJson(url, body);
    } catch (err) { btn.disabled = false; say(btn, `Could not save the ${what}: ${err.message}`); return; }
    await redraw(true);
  };
  root.onchange = (e) => {
    const pick = e.target.closest?.('form[data-field="wait"] select[name="wait"]');
    if (pick) for (const el of [pick.form.elements.n, pick.form.elements.unit]) el.disabled = pick.value === "wait";
  };
}
