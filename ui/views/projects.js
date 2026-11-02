// The project card and detail renderers, shared by views/project.js. The list of
// projects is part of views/issues.js.
import { badge, priorityBadge, card, chips, crumb, dataTable, empty, esc, heads, idLink, localId, pageHead, pager, when } from "../lib.js";

const fact = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function renderBaseline(p) {
  if (!p.factory) return "";
  if (!p.baseline) return fact("Baseline", "not checked yet");
  const b = p.baseline;
  return fact("Baseline", `<span class="badge ${b.ok ? "done" : "stuck"}">${b.ok ? "Green" : "Red"}</span> <code>${esc(b.commit.slice(0, 7))}</code>${b.ok ? "" : ` ${esc(b.failed ?? "")}`}`);
}

export function renderFacts(p) {
  return `<dl class="facts">` +
    fact("Open issues", String(p.openItems)) +
    fact("Last landed", p.lastLanded ? `<code>${esc(p.lastLanded.name)}</code> ${esc(when(p.lastLanded.at))}` : "none yet") +
    fact("Behind origin", p.behind === null ? "unknown" : p.behind === 0 ? "up to date" : plural(p.behind, "commit")) +
    renderBaseline(p) + fact("Vault notes", String(p.notes)) + `</dl>`;
}

export const NOTES = 50;

export function renderDetail(p, limit = NOTES) {
  const sec = (title, n, body) => card(title, body, { count: n });
  const table = (labels, rows) => dataTable(heads(labels), rows.join(""));
  const commits = p.commits.map((c) => {
    const sha = c.hash.slice(0, 7);
    return `<tr><td>${c.commitUrl ? idLink(sha, c.commitUrl) : `<code>${esc(sha)}</code>`}</td><td class="wide" title="${esc(c.subject)}">${esc(c.subject)}</td>` +
      `<td>${c.item ? esc(localId(c.item, p.key)) : ""}</td><td class="time">${esc(when(c.date))}</td></tr>`;
  });
  const items = p.items.map((i) => `<tr><td>${idLink(i.id, `#/issues/${encodeURIComponent(p.key)}/${i.id}`)} ${priorityBadge(i.priority)}</td><td class="wide" title="${esc(i.title)}">${esc(i.title)}</td><td>${chips(i.labels)}</td></tr>`);
  const jobs = p.jobs.map((j) => `<tr><td>${idLink(localId(j.name, p.key), `#/jobs/${encodeURIComponent(j.name)}`)}</td><td>${badge(j.condition)}</td><td class="time">${esc(when(j.started))}</td></tr>`);
  const notes = p.vault.slice(0, limit).map((n) => `<tr><td class="wide">${esc(n.title)}</td><td>${chips([n.kind])}</td><td class="time">${esc(when(n.updated))}</td></tr>`);
  return `<div class="page sp">${crumb("#/issues", [["issues", "#/issues"], [p.key]])}` +
    pageHead(p.key, { aside: `<span class="badge ${p.factory ? "run" : "done"}">${p.factory ? "Factory" : "Plain repo"}</span> <code>${esc(p.path)}</code>` }) + renderFacts(p) +
    sec("Recent commits", p.commits.length, commits.length ? table(["Commit", "Subject", "Issue", "Date"], commits) : empty("No commits on origin.", "The checkout has not fetched origin yet.")) +
    sec("Open issues", p.items.length, items.length ? table(["Issue", "Title", "Labels"], items) : empty("No open issue.")) +
    sec("Jobs", p.jobs.length, jobs.length ? table(["Job", "State", "Started"], jobs) : empty("No job has run here.")) +
    sec("Vault notes", p.vault.length, notes.length ? table(["Title", "Kind", "Updated"], notes) + pager(notes.length, p.vault.length, NOTES) : empty("No vault note has this scope.")) + `</div>`;
}
