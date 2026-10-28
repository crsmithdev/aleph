// The three cards of the UI, Issue, Land and Job, each in two sizes. "full" is the Status page's
// land card: id, title, state badge, key facts. "compact" keeps the look in at most 2 lines
// (two block children: id, badge and title; then one line of facts) for a table or a list.
// Pure string functions, no DOM.
import { actMessages, clock, esc, money } from "../lib.js";

export const itemId = (j) => `<span class="id">${esc(j.name)}</span>`;
export const title = (j) => `<h3>${esc(j.item?.title || j.name)}</h3>`;
export const actMsg = (name) => (actMessages.has(name) ? `<span class="act-msg" role="alert">${esc(actMessages.get(name))}</span>` : "");
export const act = (verb, name, label, primary = false) =>
  `<button class="act${primary ? " primary" : ""}" type="button" data-act="${verb}" data-name="${esc(name)}" data-label="${esc(label)}">${esc(label)}</button>`;
export const fact = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
/** The checks of a run as facts: `Tests 71 s ✓`. */
export const checkFacts = (j) =>
  (j.checks || []).map((c) => fact(c.name.charAt(0).toUpperCase() + c.name.slice(1), `${esc(String(c.seconds))} s ${c.ok ? "✓" : "✗"}`)).join("");
/** The trailers of a job as one small line; empty when it has none. */
export const trailerLine = (j) =>
  j.trailers?.length ? `<p class="trailers-line">${j.trailers.map((t) => `${esc(t.key)} ${esc(t.value)}`).join(" · ")}</p>` : "";
/** One card shell. */
export const shell = (size, cls, inner, tag = "article") => `<${tag} class="job-card ${size} ${cls}">${inner}</${tag}>`;

/** "14:05" for a land today, "26 Oct 14:05" for an older one. */
export const landedAt = (iso, now) =>
  new Date(iso).toDateString() === new Date(now).toDateString() ? clock(iso)
    : `${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${clock(iso)}`;

const label = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
const TONE = { running: "run", landing: "run", open: "run", landed: "done", passed: "done", done: "done", closed: "done", "needs-you": "need", failed: "stuck", stuck: "stuck" };
const badge = (text, tone) => `<span class="badge ${tone}">${esc(text)}</span>`;
const idLink = (id, href) => (href ? `<a class="id" href="${esc(href)}">${esc(id)}</a>` : `<span class="id">${esc(id)}</span>`);

/**
 * The compact card: line 1 is badge, id and title; line 2 the facts, `[key, html][]`.
 * `kind` marks the card (job, land, issue, session, note); `b` is { text, tone } for the badge.
 */
export function compactCard({ kind, id = "", href = "", title: ttl, badge: b, facts = [] }) {
  const f = facts.filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `<span class="k">${k ? `<span class="fk">${esc(k)}</span> ` : ""}${v}</span>`).join("");
  return `<div class="card compact ${esc(kind)}"><div class="c1">${badge(b.text, b.tone)}${id ? idLink(id, href) : ""}<span class="t" title="${esc(ttl)}">${esc(ttl)}</span></div>` +
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

/**
 * A land: a state job `j` ({ name, item, state, commit, commitUrl, started, ended, cost, checks,
 * trailers, check, href? }) at `size` "full" or "compact"; `now` is the server's clock.
 */
export function landCard(j, size = "full", now = new Date().toISOString()) {
  const landed = j.state === "landed";
  if (size === "compact") {
    return compactCard({
      kind: "land", id: j.name, href: j.href, title: j.item?.title || j.name, badge: { text: landed ? "Landed" : "Landing", tone: landed ? "done" : "run" },
      facts: [["Commit", commitHtml(j)], landed && j.ended ? ["Landed", esc(landedAt(j.ended, now))] : ["Started", j.started ? esc(clock(j.started)) : ""], ["Cost", j.cost !== undefined ? esc(money(j.cost)) : ""],
        ...(j.checks || []).map((c) => [label(c.name), `${esc(String(c.seconds))} s ${c.ok ? "✓" : "✗"}`])],
    });
  }
  return shell("big", "del", `<div class="ih">${itemId(j)}${title(j)}<span class="badge ${landed ? "done" : "run"}">${landed ? "Landed" : "Landing"}</span></div>` +
    `<dl class="facts">${j.commit ? fact("Commit", commitHtml(j)) : ""}${landed && j.ended ? fact("Landed", esc(landedAt(j.ended, now))) : ""}${!landed ? fact("Started", esc(clock(j.started))) : ""}${j.cost !== undefined ? fact("Cost", esc(money(j.cost))) : ""}${checkFacts(j)}</dl>` +
    trailerLine(j) +
    (j.check === "open" || actMessages.has(j.name) ? `<div class="actions">${j.check === "open" ? act("checked", j.name, "Checked", true) : ""}${actMsg(j.name)}</div>` : ""));
}

/** A job: { name, item, state, phase, model, started, ended, cost, trailers, href? }. */
export function jobCard(j, size = "full", now = new Date().toISOString()) {
  const state = j.state || "running";
  const b = { text: label(state === "needs-you" ? "needs you" : state), tone: TONE[state] ?? "quiet" };
  const took = dur(j.started, j.ended || (state === "running" ? now : ""));
  if (size === "compact") {
    return compactCard({
      kind: "job", id: j.name, href: j.href, title: j.item?.title || j.name, badge: b,
      facts: [["Started", j.started ? esc(clock(j.started)) : ""], ["Took", esc(took)], ["Phase", esc(j.phase ?? "")], ["Model", esc(j.model ?? "")], ["Cost", j.cost !== undefined ? esc(money(j.cost)) : ""]],
    });
  }
  return shell("big", "del", `<div class="ih">${idLink(j.name, j.href)}${title(j)}${badge(b.text, b.tone)}</div>` +
    `<dl class="facts">${j.started ? fact("Started", esc(clock(j.started))) : ""}${took ? fact("Took", esc(took)) : ""}${j.phase ? fact("Phase", esc(j.phase)) : ""}${j.model ? fact("Model", esc(j.model)) : ""}${j.cost !== undefined ? fact("Cost", esc(money(j.cost))) : ""}</dl>` + trailerLine(j));
}

/** An issue: { id, title, status, href, labels: string[], notes, created, updated }. */
export function issueCard(i, size = "full") {
  const status = i.status || "open";
  const b = { text: label(status), tone: TONE[status] ?? "quiet" };
  const labels = (i.labels ?? []).join(", ");
  if (size === "compact") {
    return compactCard({
      kind: "issue", id: i.id, href: i.href, title: i.title, badge: b,
      facts: [["Labels", esc(labels)], ["Notes", i.notes ? esc(String(i.notes)) : ""], ["Opened", esc(i.created ?? "")], ["Updated", i.updated && i.updated !== i.created ? esc(i.updated) : ""]],
    });
  }
  return shell("big", "del", `<div class="ih">${idLink(i.id, i.href)}<h3>${esc(i.title)}</h3>${badge(b.text, b.tone)}</div>` +
    `<dl class="facts">${labels ? fact("Labels", esc(labels)) : ""}${i.notes ? fact("Notes", esc(String(i.notes))) : ""}${i.created ? fact("Opened", esc(i.created)) : ""}${i.updated && i.updated !== i.created ? fact("Updated", esc(i.updated)) : ""}</dl>`);
}
