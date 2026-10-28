// The Memory view: the vault's counts, Home's sections, health and recent
// writes, with a search box. `renderNote` serves #/memory/<title> too, from
// memory-note.js, because the page reads one `view` per file.
import { empty, error, esc, filterBar, md, pageHead, when } from "../lib.js";

export const view = {
  path: "/memory",
  title: "Memory",
  group: "memory",
  order: 0,
  api: "/api/memory",
  refresh: 60,
  render: (m) => renderMemory(m),
};

const link = (title) => `<a href="#/memory/${encodeURIComponent(title)}">${esc(title)}</a>`;
const head = (id, title, n) => `<div class="sh"><h2 id="h-${id}">${esc(title)}</h2>${n === undefined ? "" : `<span class="count">${n}</span>`}</div>`;

/** The search box. Submitting fetches /api/memory/search and fills the results list. */
globalThis.memorySearch = async (form) => {
  const out = document.getElementById("memory-results");
  const q = form.q.value.trim();
  if (!q) { out.innerHTML = ""; return false; }
  const url = `/api/memory/search?q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    out.innerHTML = renderResults(await res.json());
  } catch (e) { out.innerHTML = error(`Search failed: ${e.message}`); }
  return false;
};

export function renderResults(r) {
  if (r.error) return error(r.error, "Run vault recall in a terminal to see why.");
  if (!r.results.length) return empty(`No note matches "${r.q}".`, "Recall looks in titles, aliases and bodies.");
  return `<ol class="results">${r.results.map((n) => `<li>${link(n.title)} <span class="hint">${esc([n.kind, n.scope].filter(Boolean).join(" · "))}</span></li>`).join("")}</ol>`;
}

export function renderSearch() {
  return `<form role="search" onsubmit="return memorySearch(this)">${filterBar([{ label: "Search", name: "q", search: true, placeholder: "Search the vault" }])}</form><div id="memory-results" aria-live="polite"></div>`;
}

const table = (rows) => rows.length
  ? `<table class="tbl"><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k === "" ? "(none)" : k)}</td><td class="num">${v}</td></tr>`).join("")}</tbody></table>` : "";

export function renderCounts(m) {
  if (!m.exists) return head("counts", "Notes") + empty("No vault yet.", "Run <code>vault init</code> to make one.");
  return head("counts", "Notes", m.total) +
    `<div class="two"><div><h3>By kind</h3>${table(Object.entries(m.byKind))}</div>` +
    `<div><h3>By scope</h3>${table(Object.entries(m.byScope)) || empty("No notes.")}</div></div>`;
}

export function renderHome(m) {
  const secs = m.home.map((s) =>
    `<h3>${esc(s.heading)}</h3>` + (s.entries.length
      ? `<ul>${s.entries.map((e) => `<li>${link(e.title)}${e.hook ? ` <span class="quiet">${esc(e.hook)}</span>` : ""}</li>`).join("")}</ul>`
      : `<p class="quiet">Nothing indexed.</p>`)).join("");
  return head("home", "Home") + (secs || empty("Home has no sections.", "Home.md is the vault's map."));
}

export function renderHealth(m) {
  const f = (x) => `<li><code>${esc(x.rule)}</code> ${x.note ? link(x.note) : ""} <span class="quiet">${esc(x.detail)}</span></li>`;
  const { refuse, warn } = m.lint;
  const med = m.misses;
  return head("health", "Health") +
    (refuse.length ? `<h3>Refusals<span class="count">${refuse.length}</span></h3><ul>${refuse.map(f).join("")}</ul>` : "") +
    (warn.length ? `<h3>Warnings<span class="count">${warn.length}</span></h3><ul>${warn.map(f).join("")}</ul>` : "") +
    (!refuse.length && !warn.length ? empty("Lint finds nothing.") : "") +
    (med ? `<h3>Recall misses, ${esc(med.days)} days</h3>` + table([
      ["Recalls", med.recalls], ["Empty", `${med.empty} (${Math.round(med.empty_share * 100)}%)`],
      ["Reformulated", med.reformulated], ["Reads not offered", med.unoffered_reads]]) : "");
}

export function renderWrites(m) {
  return head("writes", "Recent writes", m.writes.length) + (m.writes.length
    ? `<div class="tscroll"><table class="tbl"><thead><tr><th>Write</th><th>When</th></tr></thead><tbody>${m.writes.map((w) => `<tr><td class="wide">${md(w.text).replace(/^<p>|<\/p>$/g, "")}</td><td class="time">${esc(when(`${w.date}T${w.time}`) || `${w.date} ${w.time}`)}</td></tr>`).join("")}</tbody></table></div>`
    : empty("No writes recorded.", "The vault CLI logs each write in the daily note."));
}

export function renderMemory(m) {
  return `<div class="page">${pageHead("Memory", { count: m.exists ? m.total : 0 })}${renderSearch()}` +
    `<section id="counts">${renderCounts(m)}</section>` +
    `<section id="home">${renderHome(m)}</section>` +
    `<section id="health">${renderHealth(m)}</section>` +
    `<section id="writes">${renderWrites(m)}</section></div>`;
}

const crumbs = (t) => (t.length ? `<ul>${t.map((n) => `<li>${link(n.title)} <span class="hint">${esc([n.kind, n.scope].filter(Boolean).join(" · "))}</span></li>`).join("")}</ul>` : `<p class="quiet">None.</p>`);

/** One note: frontmatter, body (Markdown, [[links]] to notes), outgoing links and backlinks. */
export function renderNote(n) {
  const fm = Object.entries(n.frontmatter).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(Array.isArray(v) ? v.join(", ") : v)}</dd></div>`).join("");
  return `<div class="page"><p class="quiet"><a href="#/memory">← Memory</a></p>${pageHead(n.title, { count: n.frontmatter?.kind ?? "" })}` +
    (n.archived ? `<p class="quiet">Archived.</p>` : "") +
    `<p class="hint"><code>${esc(n.path)}</code></p>` +
    (fm ? `<dl class="facts">${fm}</dl>` : "") +
    `<article class="note">${md(n.body)}</article>` +
    `<section id="links">${head("links", "Links to", n.links.length)}${crumbs(n.links)}</section>` +
    `<section id="backlinks">${head("backlinks", "Linked from", n.backlinks.length)}${crumbs(n.backlinks)}</section></div>`;
}
