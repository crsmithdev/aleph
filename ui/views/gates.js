// The Automation view: metrics, caps, schedules, rules and the log. Each render function takes the /api/gates object and returns an HTML
// string, so tests can call them. The shell's click handler (index.html) runs the Waiting-for-you buttons; `mount` runs the rule switches.
import { clamp, contentText, parseId, parseJob, setCodes, shownId, actButton, postJson, say, count, badge, card, tag, dataTable, pagedTable, empty, error, esc, filterBar, goQuery, hashQuery, heads, hours, pct, chip, idLink, keepProject, keepWindow, limitOf, pager, pageHead, projectNow, recordState, restoreState, scopeBar, seg, sectionHead, setQuery, statCard, tiles, when, windowOf, withProject, wireScope } from "../lib.js";
import { askRow, findingHtml } from "./now.js";

export const view = {
  path: "/automation",
  title: "Automation",
  // Next to Status in the sidebar: both say what holds the factory now.
  group: "factory",
  order: -2,
  icon: "shield-halved",
  api: (_params, q = new URLSearchParams()) => withProject(`/api/gates?window=${windowOf(q)}`, q),
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
  "held-path": ["Lands on held paths", "A job that changes a held path, after its checks and review pass."],
  review: ["Reviewer holds", "The reviewer held the job and no fix rounds are left."],
  question: ["Questions", "A job or an intake stopped on a choice that the spec leaves open."],
  "no-commit": ["Jobs with no commit", "The last 3 jobs of an issue ended with nothing committed."],
  "part-dropped": ["Dropped sub-issues", "A sub-issue of an issue was dropped and no other sub-issue is open."],
  "intake-failed": ["Failed intake", "Intake of an issue failed twice."],
  rescue: ["Rescue of a stuck job", "A stuck job with more than one way out."],
  "run-cap": ["Job cap", "An issue started 3 times in one hour."],
  "proposal-check": ["Proposed checks", "The correction memory proposes a check for a repo."],
  "proposal-claude-md": ["Proposed CLAUDE.md lines", "The correction memory proposes a line in a CLAUDE.md."],
  "proposal-skill": ["Proposed skill changes", "The correction memory proposes a change to a skill."],
};

/** The label of an automatic mode: what it does. */
export const MODES = { recommended: "Recommended", retry: "Retry", start: "Start", land: "Land", approve: "Approve" };
const modeLabel = (m) => MODES[m] ?? m.replace(/^./, (c) => c.toUpperCase());

/** The log's actors, in filter order, with the badge tone of each. */
export const BY = { human: "need", rule: "done", director: "parked", firefighter: "stuck", gate: "run" };

const PAGE = 50;

export function renderGates(d, q = new URLSearchParams()) {
  return `<div class="page gates">${pageHead("Automation", { count: `last ${d.metrics.days} days`, aside: scopeBar(projectNow(), windowOf(q)) })}` +
    renderNow(d) + renderSchedules(d) + renderMonitor(d) + renderWaiting(d) + renderRepeats(d) + renderRules(d) +
    `<div class="gates-two">${renderCaps(d)}${renderHeld(d)}</div>` + renderLog(d, q.get("by"), limitOf(q, PAGE)) + `</div>`;
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
  const m = d.monitor, head = sectionHead("Monitor");
  if (!m) return `<section id="monitor" aria-label="Monitor">${head}<p>The monitor has not run.</p></section>`;
  const n = m.findings.length, first = n ? ` First: ${findingHtml(m.findings[0])}` : "";
  const summary = `${esc(m.day)}: ${n} ${n === 1 ? "finding" : "findings"}.${first}`;
  const body = (n ? `<ol class="findings">${m.findings.map((f) => `<li>${findingHtml(f)}</li>`).join("")}</ol>` : "") +
    (m.text ? `<pre class="reader">${esc(m.text)}</pre>` : m.error ? error(`No reading: ${m.error}`, "The monitor reads again at its next run.") : "");
  return `<section id="monitor" aria-label="Monitor">${head}<details><summary>${summary}</summary>${body}</details></section>`;
}

/** The interval of a schedule on a timer of its own, with a form to change it; the monitor runs in the tick, once a day. */
function intervalCell(s) {
  if (s.name === "monitor") return `<td>${esc(s.every)}</td>`;
  return `<td><form class="capform schedform" data-schedule="${esc(s.name)}"><label class="sr-only" for="every-${esc(s.name)}">${esc(s.name)} interval</label>` +
    `<input id="every-${esc(s.name)}" name="every" type="text" pattern="[1-9][0-9]*(s|min|h)" value="${esc(s.every ?? "")}" required>` +
    actButton("Save", { label: "Save" }, { type: "submit" }) + `</form></td>`;
}

/** The tick, the suite and the monitor: whether each is on (every one is, and none can be turned off yet), how often it runs, when it last ran and what came of it. */
export function renderSchedules(d) {
  const rows = d.schedules.map((s) => `<tr><td><label class="sched-on"><input type="checkbox" checked disabled aria-label="${esc(s.name)} on"> ${esc(s.name)}</label></td>` +
    `${intervalCell(s)}<td>${s.last ? when(s.last) : "has not run"}</td><td>${s.result ? esc(s.result) : ""}</td></tr>`).join("");
  return `<section id="gates-schedules" aria-label="Schedules">${sectionHead("Schedules")}${rows ? dataTable(heads(["Schedule", "Every", "Last Run", "Result"]), rows) : empty("No schedule.")}</section>`;
}

/** The Asks routed to Chris, as the Status page's cards. */
function renderWaiting(d) {
  const rows = d.asks.map((i) => askRow(i, d.now)).join("");
  return `<section id="gates-waiting" aria-label="Waiting for you">${sectionHead("Waiting for You", { count: d.asks.length })}` +
    (rows ? `<div class="list">${rows}</div>` : empty("Nothing waits for you.")) + `</section>`;
}

/** Each kind of Ask that Chris answered the same way 3 or more times, with a button that makes the answer the rule when it is the reason's automatic mode. */
export function renderRepeats(d) {
  const rows = d.repeats.map((r) => `<tr><td>${esc(REASONS[r.reason]?.[0] ?? r.reason)}</td><td>${esc(r.answer)}</td><td class="num">${r.count}</td><td>` +
    (r.mode ? actButton("Make it a rule", { rule: r.reason, mode: r.mode, label: "Make it a rule" }) : "") + `</td></tr>`);
  return `<section id="gates-repeats" aria-label="Rule candidates">${sectionHead("Rule Candidates", { count: d.repeats.length })}` +
    (rows.length ? pagedTable(heads(["Ask", "Answer", "Times", ""], ["Times"]), rows) : empty("No answer repeats.")) + `</section>`;
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
      const btn = (mode, label, on) => ({ label, on, attrs: ` data-rule="${esc(r.reason)}" data-mode="${esc(mode)}"` });
      control = seg(`Who decides ${name}`, [btn("", "Ask me", !g), ...(r.mode ? [btn(r.mode, modeLabel(r.mode), g?.action === r.mode)] : [])]);
      if (!r.mode) hint = "The director decides first and sends the rest to you.";
      if (g && g.action !== r.mode) hint = `always.json grants ${g.action}. Ask me removes it${r.mode ? `; ${modeLabel(r.mode)} replaces it` : ""}.`;
    }
    const num = (n) => `<td class="num">${n}</td>`;
    const dec = r.decided, out = r.outcome;
    return `<tr class="rule" data-reason="${esc(r.reason)}"><td class="rule-main"><b>${esc(name)}</b> <code>${esc(r.reason)}</code>${desc ? `<p class="quiet">${esc(desc)}</p>` : ""}</td><td>${control}${hint ? `<p class="hint">${esc(hint)}</p>` : ""}</td>${num(r.fired)}<td>${dec.rule} / ${dec.director} / ${dec.chris}</td><td>${out.fixed} / ${out.none}</td></tr>`;
  }).join("");
  return `<section id="rules" aria-label="Rules">${sectionHead("Rules")}${!rows ? empty("No rule.") : dataTable(heads(["Rule", "Who Decides", "Fired", "Decided by (Rule / Director / Manual)", "Outcome (Fixed / No Change)"]), rows, { id: "rules-table" })}</section>`;
}

/** The held paths: the security paths of gate.ts (every repo) and the globs each repo names in the registry. Read-only. */
export function renderHeld(d) {
  const repos = d.repoHeld ?? [];
  const rows = repos.length
    ? repos.map((r) => `<div class="held-repo"><b>${esc(r.repo)}</b> <div class="held">${r.held.map((p) => chip(p, { el: "code" })).join("")}</div></div>`).join("")
    : empty("No repo names held paths.");
  return card("Held Paths", `<p class="quiet">The security paths and a repo's held paths wait for Chris after the reviewer passes the job. A test is never held.</p>` +
    `<div class="held-repo"><b>Every repo</b> <div class="held">${d.held.map((p) => chip(p, { el: "code" })).join("")}</div></div>${rows}`, { label: "Held paths" });
}

/** An ID of the log in its short form, as a link to its issue page: a job ID links to its subject's. Other text stays text. */
function idHtml(id) {
  const p = parseId(parseJob(id)?.subject ?? id);
  return p ? idLink(shownId(id), `#/issues/${encodeURIComponent(p.repo)}/${p.n}${p.sub === undefined ? "" : `.${p.sub}`}`, { title: String(id) }) : esc(shownId(id) || "–");
}

/** The content of an event, `contentText`, with each ID as a link and the file's base name in mono with its full path as the title. */
function contentHtml(e) {
  const ids = new Map([e.on ?? []].flat().map((x) => [shownId(x), x]));
  const file = e.file && String(e.file).split("/").at(-1);
  return contentText(e).split(" ").map((t) => (ids.has(t) ? idHtml(ids.get(t)) : t === file ? `<code title="${esc(e.file)}">${esc(t)}</code>` : esc(t))).join(" ");
}

/** The log, newest first, filtered by `by` (an actor) from the address; `limit` rows show. A row's note opens with its button. */
export function renderLog(d, by, limit = PAGE) {
  if (d.codes) setCodes(d.codes);
  const pick = Object.hasOwn(BY, by ?? "") ? by : "";
  const filter = filterBar([{ name: "by", label: "By", value: pick, options: [{ value: "", label: "all" }, ...Object.keys(BY).map((k) => ({ value: k, label: k }))] }]);
  const entries = d.log.entries.filter((e) => !pick || e.by === pick);
  const rows = entries.slice(0, limit).map((e) => {
    const subject = e.action === "changed" && !parseId(e.subject) ? `<a href="#rules">${esc(e.subject)}</a>` : idHtml(e.subject);
    return `<tr><td class="time">${esc(e.times ? `${when(e.first)} – ${when(e.at)}` : when(e.at))}</td><td>${tag(e.by, BY[e.by])}</td><td>${subject}</td><td>${esc(e.action || "–")}</td><td>${esc(e.sub ?? "")}</td>` +
      `<td class="what">${contentHtml(e)}${e.note ? clamp(esc(e.note)) : ""}</td><td class="num">${e.times || 1}</td></tr>`;
  }).join("");
  return `<section id="gates-log" aria-label="Log">${sectionHead("Log")}${filter}` +
    (rows ? dataTable(heads(["Logged", "By", "Subject", "Action", "Sub", "Content", "Times"], ["Times"]), rows) + pager(limit, entries.length, PAGE) : empty("No entry in this window.")) + `</section>`;
}

/** Load /api/gates again and draw the page with it. */
async function redraw(root) {
  const res = await fetch(view.api(null, hashQuery()), { cache: "no-store" });
  if (!res.ok) return;
  const saved = recordState(root);
  root.innerHTML = renderGates(await res.json(), hashQuery());
  restoreState(root, saved);
  wireScope(root);
}

/** The rule switches. `root.onclick`, so a refresh does not add a second handler and the shell clears it on a route change. */
export function mount(root) {
  keepWindow(windowOf(hashQuery()));
  keepProject(projectNow());
  wireScope(root);
  root.onsubmit = async (e) => {
    const sched = e.target.closest?.("form.schedform");
    if (sched) {
      e.preventDefault();
      const btn = sched.querySelector("button");
      btn.disabled = true;
      try {
        await postJson("/api/gates/schedules", { name: sched.dataset.schedule, every: sched.elements.every.value.trim() });
      } catch (err) { btn.disabled = false; say(btn, `Could not save the interval: ${err.message}`); return; }
      return redraw(root);
    }
    const form = e.target.closest?.("form.capform");
    if (!form) return;
    e.preventDefault();
    const key = form.dataset.cap, btn = form.querySelector("button");
    btn.disabled = true;
    try {
      await postJson("/api/gates/caps", { [key]: Number(form.elements[key].value) });
    } catch (err) { btn.disabled = false; say(btn, `Could not save the cap: ${err.message}`); return; }
    await redraw(root);
  };
  root.onclick = async (e) => {
    const seg = e.target.closest?.("#gates-log .seg button");
    if (seg) return goQuery({ by: seg.dataset.value, limit: "" });
    const more = e.target.closest?.("#gates-log button[data-more]");
    if (more) {
      setQuery({ limit: String(limitOf(hashQuery(), PAGE) + Number(more.dataset.more)) });
      return redraw(root);
    }
    const r = e.target.closest?.("button[data-rule]");
    if (r) {
      if (r.getAttribute("aria-pressed") === "true") return;
      const seg = r.parentElement, buttons = [...seg.querySelectorAll("button")];
      buttons.forEach((b) => { b.disabled = true; });
      const { rule, mode } = r.dataset;
      try {
        await (mode ? postJson(`/api/standing/${encodeURIComponent(rule)}`, { action: mode }) : postJson(`/api/gates/revoke/${encodeURIComponent(rule)}`));
      } catch (err) { buttons.forEach((b) => { b.disabled = false; }); say(seg, `Could not change the rule: ${err.message}`); return; }
      await redraw(root);
      return;
    }
  };
}
