// The Automation page: Rules, Limits and Log (README, Pages and "Automation, Rules"). The 3 tiles are the Rules facts
// line; the monitor report opens in place from its attention row; Memory Jobs moved to Memory.
import { card, chip, esc, idLink, inputBox, linkButton, meter, selectBox } from "../../../../ui/views/lib/html.js";
import { clock, count, day, dur, hours, pct, plural, when } from "../../../../ui/views/lib/format.js";
import { findingsList } from "../../../../ui/views/lib/feed.js";
import { BY } from "../../../../ui/views/gates.js";
import { factsLine, inspector, list, LIVE, now, settingRows, type Data, type Group, type Page, type Row } from "../kit.ts";

const HREF = `${LIVE}#/automation`;
/** The monitor report's own address: `:target` opens it in place, on the Rules pane, from this page or the overview. */
const MONITOR = "automation.html#monitor";
/** The label of a rule's mode, as gates.js names it. */
const MODES: Record<string, string> = { resolve: "Take the pick", approve: "Approve", continue: "Continue" };
const NO_ANSWER: [string, string][] = [["wait", "Keep waiting"], ["pick", "Take the pick"], ["drop", "Drop"]];
const nz = (n: number) => (n ? esc(count(n)) : "");

const STYLE = `<style>
.rt-automation-rules .lead { color: var(--ink); white-space: nowrap; }
.rt-automation-rules .rt-row .main .t { color: var(--muted); }
.rt-automation-dec .meter { width: 120px; }
.rt-automation-mon:not(:target) { display: none; }
.rt-automation-paths { display: flex; flex-wrap: wrap; gap: var(--sp-4) var(--sp-8); }
.rt-automation-log .lead { font: var(--fs-xs) var(--mono); color: var(--muted); }
.rt-automation-detail { margin: 0; overflow-wrap: anywhere; color: var(--ink-2); }
@media (max-width: 720px) { .rt-automation-rules .rt-row .lead { flex: 1 1 100%; } }
</style>`;

/** Who decided a rule's Asks, each with its count, no zeros. */
const who = (x: any) => [[x.rule, "rule"], [x.director, "director"], [x.chris, "Chris"]].filter(([n]) => n).map(([n, k]) => `${count(n)} ${k}`);

/** Who decided a rule's Asks, as one bar: rule, director, Chris. "" when none did. */
function decided(x: any) {
  const all = x.rule + x.director + x.chris;
  if (!all) return "";
  const line = who(x).join(" · ");
  return `<span class="rt-automation-dec">${meter([["rule", x.rule], ["dir", x.director], ["user", x.chris]].map(([k, n]) => ({ pct: (100 * n) / all, cls: `c-${k}` })), line)}</span>`;
}

/** The inspector of one rule: its line, its counts, then its two settings. */
function ruleInspect(r: any, d: Data) {
  const at = new Date(now(d)), x = r.decided, o = r.outcome;
  const kv: [string, string][] = [
    ["Fired", nz(r.fired)],
    ["Decided", esc(who(x).join(", "))],
    ["Fixed", r.fired ? `${esc(count(o.fixed))} of ${esc(count(r.fired))}` : ""],
    ["Mode", esc(MODES[r.mode] ?? r.mode)],
    ["Granted", r.granted ? esc(day(r.granted.at, at)) : ""],
    ["Projects", esc(r.projects.join(", "))],
  ];
  const decide = selectBox(`Who decides ${r.name}`, "decide", [{ value: "", label: "Director" }, { value: r.mode, label: MODES[r.mode] ?? r.mode }, { value: "user", label: "Chris" }], r.granted?.action ?? "", { id: `decide-${r.reason}` });
  const wait = selectBox(`If ${r.name} gets no answer`, "wait", NO_ANSWER.map(([value, label]) => ({ value, label })), r.timeout ? r.noAnswer : "wait", { id: `wait-${r.reason}` });
  const edit = settingRows(`Edit ${r.name}`, [
    { label: "Decides", id: `decide-${r.reason}`, control: decide },
    ...(r.timeout === undefined ? [] : [{ label: "No answer", id: `wait-${r.reason}`, control: wait }]),
  ]);
  return inspector({ id: r.reason, title: r.name, rows: kv, body: `<p class="rt-automation-detail">${esc(r.line)}</p>${edit}`, href: HREF });
}

/** One rule as a row: the ask, its fires, who decided, and who decides first. Defaults are muted or blank; No answer reads "wait" on every rule, so it shows only in the inspector. */
const ruleRow = (r: any, d: Data): Row => ({
  key: r.reason, lead: esc(r.name), main: `<span class="t" title="${esc(r.line)}">${esc(r.line)}</span>`, text: `${r.name} ${r.line} ${r.reason}`, inspect: ruleInspect(r, d),
  cells: [nz(r.fired), decided(r.decided), r.granted ? esc(MODES[r.granted.action] ?? r.granted.action) : `<span class="quiet">director</span>`],
});

/** The monitor report, shown only while the address names it. */
function monitor(d: Data) {
  const m = d.automation.monitor;
  return card(`Monitor, ${day(`${m.day}T12:00`, new Date(now(d)))}`, findingsList(m.findings), { id: "monitor", cls: "rt-automation-mon", count: count(m.findings.length), aside: linkButton("Close", "automation.html#rules") });
}

function rulesView(d: Data) {
  const A = d.automation, m = A.metrics;
  const groups: Group[] = [{ title: "Asks", count: count(A.rules.length), heads: ["Fired", "Decided", "Decides"], rows: A.rules.map((r: any) => ruleRow(r, d)) }];
  return STYLE + monitor(d) +
    factsLine([[pct(m.rate.percent), "automatic"], [count(m.catches.fired), "sent back"], [count(m.catches.fixed), "fixed"], [hours(m.held.hours), "held"]]) +
    `<div class="rt-automation-rules">${list({ label: "Rules", search: "Search rules", groups })}</div>`;
}

const number = (name: string, v: number, id: string) => inputBox(name, v, { id, type: "number", attrs: ` min="0" step="1" inputmode="numeric"` });
/** An interval as systemd writes it ("1min", "1h") as a number and a unit. */
const every = (s: string) => /^(\d+)(s|min|h)$/.exec(s)!.slice(1);

function limitsView(d: Data) {
  const A = d.automation, c = A.caps, at = new Date(now(d));
  const caps = settingRows("Caps", [
    { label: "Live cap", id: "cap-live", control: number("live", c.live, "cap-live"), hint: `${count(c.liveNow)} now` },
    { label: "Job cap", id: "cap-run", control: number("run", c.run, "cap-run"), hint: `${count(c.runNow)} now` },
    { label: "Intake tries", id: "cap-intake", control: number("intakeTries", c.intakeTries, "cap-intake"), hint: "runs" },
    { label: "Job time", id: "cap-job", control: number("jobSeconds", c.jobSeconds, "cap-job"), hint: dur(c.jobSeconds) },
    { label: "Fix rounds", id: "cap-fix", control: number("fixRounds", c.fixRounds, "cap-fix"), hint: "rounds" },
    { label: "Land batch", id: "cap-land", control: number("landBatch", c.landBatch, "cap-land"), hint: "jobs" },
    { label: "Load limit", id: "cap-load", control: number("loadLimit", c.loadLimit, "cap-load"), hint: "1min load" },
  ]);
  const schedules = settingRows("Schedules", A.schedules.map((s: any) => {
    const id = `every-${s.name}`, hint = `${s.result} · ${when(s.last, at)}`;
    if (s.name === "monitor") return { label: "Monitor hour", id, control: number("hour", s.hour, id), hint };
    const [n, unit] = every(s.every);
    return { label: `${s.name[0].toUpperCase()}${s.name.slice(1)} every`, id, control: number("n", Number(n), id) + selectBox(`${s.name} unit`, "unit", [{ value: "s", label: "seconds" }, { value: "min", label: "minutes" }, { value: "h", label: "hours" }], unit), hint };
  }));
  const paths = (ps: string[]) => `<span class="rt-automation-paths">${ps.map((p) => `<code>${esc(p)}</code>`).join("")}</span>`;
  const held = settingRows("Held paths", [{ label: "Every repo", id: "held-all", control: paths(A.held) }, ...A.repoHeld.map((r: any) => ({ label: r.repo, id: `held-${r.repo}`, control: paths(r.held) }))]);
  return `<div class="pair">${card("Caps", caps, { id: "gates-caps" })}${card("Schedules", schedules, { id: "gates-schedules" })}</div>` +
    card("Held Paths", held, { aside: "await Chris" });
}

/** A log object as a link to its live page: `a<n>` is an aleph issue, `j<n>` a job; other text stays text. */
function object(id: string | null) {
  if (!id) return "";
  const issue = /^a(\d+)$/.exec(id)?.[1];
  if (issue) return idLink(id, `${LIVE}#/issues/aleph/${issue}`);
  return /^j\d+$/.test(id) ? idLink(id, `${LIVE}#/jobs/${id}`) : esc(id);
}

/** One log entry as a row: the clock, the object and its detail, the action and who logged it. */
function logRow(e: any, i: number, d: Data): Row {
  const at = new Date(now(d));
  const kv: [string, string][] = [["Logged", esc(when(e.time, at))], ["By", chip(e.subject)], ["Action", esc(e.action)], ["Object", object(e.object)]];
  return {
    key: `${e.time}/${i}`, lead: esc(clock(e.time)), text: `${e.subject} ${e.action} ${e.object ?? ""} ${e.detail ?? ""}`, data: { by: e.subject },
    main: `${object(e.object)}${e.detail ? `<span class="t" title="${esc(e.detail)}">${esc(e.detail)}</span>` : ""}`,
    cells: [esc(e.action), chip(e.subject)],
    inspect: inspector({ id: e.object ?? "", title: `${e.subject} ${e.action}`, rows: kv, body: e.detail ? `<p class="rt-automation-detail">${esc(e.detail)}</p>` : "", href: HREF }),
  };
}

function logView(d: Data) {
  const A = d.automation, at = new Date(now(d)), days = Map.groupBy(A.log.map((e: any, i: number) => logRow(e, i, d)), (_r: Row, i: number) => day(A.log[i].time, at));
  const groups: Group[] = [...days].map(([t, rows]) => ({ title: t, count: count(rows.length), heads: ["Action", "By"], rows }));
  groups.at(-1)!.more = `${count(A.log.length)} of ${count(A.logTotal)}`;
  return `<div class="rt-automation-log">${list({ label: "Log", search: "Search the log", filters: [{ label: "By", name: "by", options: Object.keys(BY) }], groups })}</div>`;
}

export const page: Page = {
  id: "automation", title: "Automation", group: "Factory", order: 1, icon: "shield-halved", route: "automation",
  views: [{ id: "rules", label: "Rules", scope: true, draw: rulesView }, { id: "limits", label: "Limits", draw: limitsView }, { id: "log", label: "Log", scope: true, draw: logView }],
  attention: (d) => {
    const { backend, monitor } = d.automation, link = backend?.why.match(/https?:\/\/\S+/)?.[0];
    return [
      // The why is the backend's own error: its first sentence names the fault, the rest is its advice.
      ...(backend ? [{ tone: "error" as const, text: `${backend.via}: ${backend.why.split(". ")[0]}`, ...(link ? { act: { label: "Add credits", href: link } } : {}) }] : []),
      ...(monitor.findings.length ? [{ tone: "need" as const, text: `Monitor, ${day(`${monitor.day}T12:00`, new Date(now(d)))}: ${plural(monitor.findings.length, "finding")}`, act: { label: "Read", href: MONITOR } }] : []),
    ];
  },
};
