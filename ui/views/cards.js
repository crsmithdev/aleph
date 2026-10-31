// The three cards of the UI, Issue, Land and Job, each in two sizes. "full" is the Status page's
// land card: id, title, state badge, key facts. "compact" keeps the look in at most 2 lines
// (two block children: id, badge and title; then one line of facts) for a table or a list.
// Pure string functions, no DOM.
import { actMessages, badge, esc, idLink, costHtml, labelName, repoIdLink, repoOf, shortModel, when } from "../lib.js";

/** A job's id, linking to its page. */
export const itemId = (j) => repoIdLink(j.name, j.href || `#/jobs/${encodeURIComponent(j.name)}`, j.repo ?? "");
export const title = (j) => `<h3>${esc(j.item?.title || j.name)}</h3>`;
export const actMsg = (name) => (actMessages.has(name) ? `<span class="act-msg" role="alert">${esc(actMessages.get(name))}</span>` : "");
export const act = (verb, name, label, primary = false) =>
  `<button class="act${primary ? " primary" : ""}" type="button" data-act="${verb}" data-name="${esc(name)}" data-label="${esc(label)}">${esc(label)}</button>`;
export const fact = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
/** The checks of a run as facts: `Tests 71 s ✓`. */
export const checkFacts = (j) =>
  (j.checks || []).map((c) => fact(c.name.charAt(0).toUpperCase() + c.name.slice(1), `${esc(String(c.seconds))} s ${c.ok ? "✓" : "✗"}`)).join("");
/** "Oct 28 04:28" from a job folder id like 20261028-042822-aleph-aleph-240-agent: the id's own local time, as `when` shows it. */
const idStart = (m, now) => when(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])), new Date(now));
const KINDS = { agent: "agent run", land: "land", triage: "triage", plan: "planner", firefighter: "firefighter" };
/** One trailer as text: Item shows its value alone; a Job folder id is parsed into its run kind and start and links to the job page (raw id in the title). */
const trailer = (t, j, now) => {
  if (t.key === "Item") return esc(t.value);
  const m = t.key === "Job" && /^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)\d\d-.+-([a-z]+)$/.exec(t.value);
  if (!m) return `${esc(t.key)} ${esc(t.value)}`;
  return `<a href="#/jobs/${encodeURIComponent(j.name)}" title="${esc(t.value)}">${esc(KINDS[m[6]] ?? m[6])}, ${esc(idStart(m, now))}</a>`;
};
/** The trailers of a job as one small line; empty when it has none. */
export const trailerLine = (j, now) =>
  j.trailers?.length ? `<p class="trailers-line">${j.trailers.map((t) => trailer(t, j, now)).join(" · ")}</p>` : "";
/** One card shell. */
export const shell = (size, cls, inner, tag = "article") => `<${tag} class="job-card ${size} ${cls}">${inner}</${tag}>`;

const label = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
/** A badge with its own words (a triage outcome); the shared `badge` takes only a state. */
const outcomeBadge = (text, tone) => `<span class="badge ${tone}">${esc(text)}</span>`;
const at = (iso, now) => esc(when(iso, new Date(now)));

/**
 * The compact card: line 1 is badge, id and title; line 2 the facts, `[key, html][]`.
 * `kind` marks the card (job, land, issue, session, note); `b` is { state } for the shared badge, or { text, tone } for a badge with its own words.
 */
export function compactCard({ kind, id = "", repo = "", href = "", title: ttl, badge: b, facts = [] }) {
  const f = facts.filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `<span class="k">${k ? `<span class="fk">${esc(k)}</span> ` : ""}${v}</span>`).join("");
  return `<div class="card compact ${esc(kind)}"><div class="c1">${b.state ? badge(b.state) : outcomeBadge(b.text, b.tone)}${id ? repoIdLink(id, href || (kind === "issue" ? "#/issues" : `#/jobs/${encodeURIComponent(id)}`), repo) : ""}<span class="t" title="${esc(ttl)}">${esc(ttl)}</span></div>` +
    `<div class="c2">${f}</div></div>`;
}

const sha = (j) => (j.commit ? esc(j.commit.slice(0, 7)) : "");
const commitHtml = (j) => (j.commit ? (j.commitUrl ? `<a href="${esc(j.commitUrl)}"><code>${sha(j)}</code></a>` : `<code>${sha(j)}</code>`) : "");
const dur = (a, b) => {
  const ms = Date.parse(b) - Date.parse(a);
  if (!(ms >= 0)) return "";
  const m = Math.floor(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
};

/** The acceptance result without its `acceptance: ` prefix. */
const acceptanceHtml = (j) => esc((j.acceptance || "").replace(/^acceptance: /, ""));

/**
 * A land: a state job `j` ({ name, item, state, commit, commitUrl, started, ended, cost, checks,
 * trailers, check, href? }) at `size` "full" or "compact"; `now` is the server's clock.
 */
export function landCard(j, size = "full", now = new Date().toISOString()) {
  const landed = j.state === "landed";
  if (size === "compact") {
    return compactCard({
      kind: "land", id: j.name, repo: j.repo, href: j.href, title: j.item?.title || j.name, badge: { state: landed ? "landed" : "landing" },
      facts: [["Commit", commitHtml(j)], landed && j.ended ? ["Landed", at(j.ended, now)] : ["Started", at(j.started, now)], ["Cost", j.cost !== undefined ? costHtml(j.cost, j.wk) : ""], ["Acceptance", acceptanceHtml(j)],
        ...(j.checks || []).map((c) => [label(c.name), `${esc(String(c.seconds))} s ${c.ok ? "✓" : "✗"}`])],
    });
  }
  return shell("big", "del", `<div class="ih">${itemId(j)}${title(j)}${badge(landed ? "landed" : "landing")}</div>` +
    `<dl class="facts">${j.commit ? fact("Commit", commitHtml(j)) : ""}${landed && j.ended ? fact("Landed", at(j.ended, now)) : ""}${!landed ? fact("Started", at(j.started, now)) : ""}${j.cost !== undefined ? fact("Cost", costHtml(j.cost, j.wk)) : ""}${j.acceptance ? fact("Acceptance", acceptanceHtml(j)) : ""}</dl>` +
    trailerLine(j, now) +
    (j.check === "open" || actMessages.has(j.name) ? `<div class="actions">${j.check === "open" ? act("checked", j.name, "Checked", true) : ""}${actMsg(j.name)}</div>` : ""));
}

const TRIAGE = { goal: ["To factory", "done"], close: ["Closed", "done"], done: ["Done", "done"], ask: ["Asks you", "need"] };
/** A planner run's job name, `plan-<repo>-<n>`, or its kind when the state gives it. */
const isPlan = (j) => j.run?.kind === "plan" || /^plan-/.test(j.name ?? "");

/**
 * A triage or planner run: a job `j` as the state gives it, kind triage or plan, with `outcome`
 * (goal, close, done, ask) once it has a verdict. Same style as the land card.
 */
export function triageCard(j, size = "full", now = new Date().toISOString()) {
  const running = j.state === "running";
  const plan = isPlan(j);
  const b = running ? { text: plan ? "Planning" : "Triaging", tone: "run" } : TRIAGE[j.outcome] ? { text: TRIAGE[j.outcome][0], tone: TRIAGE[j.outcome][1] } : { text: plan ? "No plan" : "No verdict", tone: "quiet" };
  const took = dur(j.started, j.ended || (running ? now : ""));
  const ttl = j.item?.title || j.name;
  if (size === "compact") {
    return compactCard({ kind: "triage", id: j.name, repo: j.repo, href: j.href, title: ttl, badge: b, facts: [["Started", j.started ? at(j.started, now) : ""], ["Took", esc(took)], ["Cost", j.cost !== undefined ? costHtml(j.cost, j.wk) : ""]] });
  }
  return shell("big", "del triage", `<div class="ih">${itemId(j)}${title(j)}${outcomeBadge(b.text, b.tone)}</div>` +
    `<dl class="facts">${j.started ? fact("Started", at(j.started, now)) : ""}${took ? fact("Took", esc(took)) : ""}${j.cost !== undefined ? fact("Cost", costHtml(j.cost, j.wk)) : ""}</dl>` +
    (!running && !j.outcome && j.reason ? `<p class="quiet q">${esc(j.reason)}</p>` : ""));
}

/** A job: { name, item, state, phase, model, started, ended, cost, trailers, href? }. */
export function jobCard(j, size = "full", now = new Date().toISOString()) {
  const state = j.state || "running";
  const b = { state };
  const took = dur(j.started, j.ended || (state === "running" ? now : ""));
  if (size === "compact") {
    return compactCard({
      kind: "job", id: j.name, repo: j.repo, href: j.href, title: j.item?.title || j.name, badge: b,
      facts: [["Started", j.started ? at(j.started, now) : ""], ["Took", esc(took)], ["Phase", esc(j.phase ?? "")], ["Model", esc(shortModel(j.model))], ["Cost", j.cost !== undefined ? costHtml(j.cost, j.wk) : ""]],
    });
  }
  return shell("big", "del", `<div class="ih">${itemId(j)}${title(j)}${badge(state)}</div>` +
    `<dl class="facts">${j.started ? fact("Started", at(j.started, now)) : ""}${took ? fact("Took", esc(took)) : ""}${j.phase ? fact("Phase", esc(j.phase)) : ""}${j.model ? fact("Model", esc(shortModel(j.model))) : ""}${j.cost !== undefined ? fact("Cost", costHtml(j.cost, j.wk)) : ""}</dl>` + trailerLine(j, now));
}

/** An issue: { id, title, status, href, labels: string[], notes, created, updated }. */
export function issueCard(i, size = "full") {
  const status = i.status || "open";
  const b = { state: status };
  const labels = (i.labels ?? []).map(labelName).join(", ");
  if (size === "compact") {
    return compactCard({
      kind: "issue", id: i.id, repo: repoOf(i.id), href: i.href, title: i.title, badge: b,
      facts: [["Labels", esc(labels)], ["Notes", i.notes ? esc(String(i.notes)) : ""], ["Opened", esc(i.created ?? "")], ["Updated", i.updated && i.updated !== i.created ? esc(i.updated) : ""]],
    });
  }
  return shell("big", "del", `<div class="ih">${repoIdLink(i.id, i.href)}<h3>${esc(i.title)}</h3>${badge(status)}</div>` +
    `<dl class="facts">${labels ? fact("Labels", esc(labels)) : ""}${i.notes ? fact("Notes", esc(String(i.notes))) : ""}${i.created ? fact("Opened", esc(i.created)) : ""}${i.updated && i.updated !== i.created ? fact("Updated", esc(i.updated)) : ""}</dl>`);
}
