// The Projects view: a card per registry repo, recent activity first. Each
// render function takes the /api/projects array and returns an HTML string.
// views/project.js shows one project with renderDetail from here.
import { empty, esc } from "../lib.js";

export const view = {
  path: "/projects",
  title: "Projects",
  group: "work",
  order: 1,
  api: "/api/projects",
  refresh: 30,
  render: (projects) => renderProjects(projects),
};

const day = (iso) => (Number.isNaN(Date.parse(iso)) ? "" : new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }));
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
    fact("Open issues", String(p.openItems)) + fact("Open goals", String(p.openGoals)) +
    fact("Last landed", p.lastLanded ? `<code>${esc(p.lastLanded.name)}</code> ${esc(day(p.lastLanded.at))}` : "none yet") +
    fact("Behind origin", p.behind === null ? "unknown" : p.behind === 0 ? "up to date" : plural(p.behind, "commit")) +
    renderBaseline(p) + fact("Vault notes", String(p.notes)) + `</dl>`;
}

export function renderCard(p) {
  return `<article class="del project"><div class="ih"><span class="id">${esc(p.key)}</span>` +
    `<h3><a href="#/projects/${encodeURIComponent(p.key)}">${esc(p.key)}</a></h3>` +
    `<span class="badge ${p.factory ? "run" : "done"}">${p.factory ? "Factory" : "Plain repo"}</span></div>` +
    `<p class="quiet q"><code>${esc(p.path)}</code></p>${renderFacts(p)}</article>`;
}

export function renderProjects(projects) {
  const cards = projects.map(renderCard).join("");
  return `<div class="page"><div class="sh"><h2>Projects</h2><span class="count">${projects.length}</span><span class="aside">numbers as of the last fetch</span></div>` +
    (cards || empty("No project in the registry.", "Add a repo to <code>~/.aleph/repos.json</code>.")) + `</div>`;
}

export function renderDetail(p) {
  const sec = (title, n, body) => `<div class="sh"><h2>${esc(title)}</h2><span class="count">${n}</span></div>${body}`;
  const commits = p.commits.map((c) => {
    const sha = esc(c.hash.slice(0, 7));
    return `<li><span class="tm">${esc(day(c.date))}</span> ${c.commitUrl ? `<a href="${esc(c.commitUrl)}"><code>${sha}</code></a>` : `<code>${sha}</code>`} ${esc(c.subject)}${c.item ? ` <span class="id">${esc(c.item)}</span>` : ""}</li>`;
  }).join("");
  const items = p.items.map((i) => `<li><span class="id">${esc(p.key)}-${i.id}</span> ${esc(i.title)}${i.labels.map((l) => ` <span class="badge run">${esc(l)}</span>`).join("")}</li>`).join("");
  const jobs = p.jobs.map((j) => `<li><span class="id">${esc(j.name)}</span> <span class="badge ${j.state === "landed" ? "done" : "run"}">${esc(j.state)}</span> <span class="tm">${esc(day(j.started))}</span></li>`).join("");
  const notes = p.vault.map((n) => `<li>${esc(n.title)} <span class="badge run">${esc(n.kind)}</span> <span class="tm">${esc(n.updated)}</span></li>`).join("");
  return `<div class="page"><p><a href="#/projects">All projects</a></p>${renderCard(p)}` +
    sec("Recent commits", p.commits.length, commits ? `<ul class="ticks">${commits}</ul>` : empty("No commits on origin.", "The checkout has not fetched origin yet.")) +
    sec("Open issues", p.items.length, items ? `<ul class="ticks">${items}</ul>` : empty("No open issue.")) +
    sec("Jobs", p.jobs.length, jobs ? `<ul class="ticks">${jobs}</ul>` : empty("No job has run here.")) +
    sec("Vault notes", p.vault.length, notes ? `<ul class="ticks">${notes}</ul>` : empty("No vault note has this scope.")) + `</div>`;
}
