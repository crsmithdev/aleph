// The Memory view: the vault's counts, Home's sections, health and recent
// writes, with a search box. `renderNote` serves #/memory/<title> too, from
// memory-note.js, because the page reads one `view` per file.
import { empty, error, esc, filterBar, localId, md, pageHead, when } from "../lib.js";

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

const ROWS = 10;
const li = (html) => `<li>${html}</li>`;
const ago = (ts) => (ts ? esc(when(ts) || String(ts).slice(0, 10)) : "never");
const sub = (title, n, body) => `<div class="sub"><h3>${esc(title)}${n === undefined ? "" : `<span class="count">${n}</span>`}</h3>${body}</div>`;
/** The first ROWS rows of a list; the rest sit under a fold. */
const fold = (items, row, n = ROWS) => {
  const ul = (xs) => `<ul class="tight">${xs.map((x) => li(row(x))).join("")}</ul>`;
  return ul(items.slice(0, n)) + (items.length > n ? `<details><summary>${items.length - n} more</summary>${ul(items.slice(n))}</details>` : "");
};
const q = (s) => `<span class="quiet">${s}</span>`;
const none = (line, hint) => empty(line, hint);

function renderWorking(w) {
  if (!w.total) return none("No handoff yet.", "<code>/handoff</code> writes one to <code>~/.aleph/handoffs</code>.");
  const cur = w.current
    ? `<p><strong>Current</strong> ${q(ago(w.current.at))} ${esc(w.current.intent || "(no intent line)")}</p>`
    : `<p class="quiet">No current handoff.</p>`;
  return cur + (w.archived.length ? sub("Archived", w.archived.length, `<ul class="tight">${w.archived.map((h) => li(`<span class="time">${esc(h.date)}</span> ${esc(h.intent || h.name)}`)).join("")}</ul>`) : "");
}

function renderSemantic(m, s) {
  const mem = s.memory
    ? `<p><code>MEMORY.md</code> ${q(`${s.memory.lines} lines, written ${ago(s.memory.at)}`)}${s.memory.first ? `<br>${q(esc(s.memory.first))}` : ""}</p>`
    : none("No MEMORY.md.", "The agent writes standing context there.");
  const kinds = Object.keys(m.byKind ?? {}).filter((k) => k !== "episode");
  const lists = kinds.map((k) => {
    const xs = s.notes.filter((n) => n.kind === k);
    return `<details><summary>${esc(k)} <span class="count">${xs.length}</span></summary>${xs.length ? fold(xs, (n) => `${link(n.title)} ${q(esc(n.scope))}`) : `<p class="quiet">None.</p>`}</details>`;
  }).join("");
  if (!m.exists) return mem + none("No vault yet.", "Run <code>vault init</code> to make one.");
  return mem + `<h3>Notes by kind<span class="count">${m.total}</span></h3><div class="kinds">${lists}</div>` +
    `<details><summary>Counts by kind and scope</summary><div class="two"><div>${table(Object.entries(m.byKind))}</div><div>${table(Object.entries(m.byScope)) || empty("No notes.")}</div></div></details>` +
    `<details><summary>Home</summary>${renderHome(m)}</details>`;
}

function renderEpisodic(e) {
  const eps = e.episodes.length ? fold(e.episodes, (n) => `${link(n.title)} ${q(esc(`${n.scope} · ${n.updated}`))}`) : none("No episode page yet.", "The factory's tick writes one per done goal.");
  const daily = e.daily.total ? fold(e.daily.latest.map((d) => ({ d })), (x) => link(x.d)) : none("No daily page yet.", "The vault CLI starts one at the first write of a day.");
  const sess = e.sessions === null ? none("Sessions are not available.", "Langfuse keys fill this.")
    : e.sessions.length ? fold(e.sessions, (x) => `<a href="#/sessions/${encodeURIComponent(x.id)}">${esc(x.firstPrompt || x.id)}</a> ${q(esc(`${x.project} · ${x.turns} turns · ${ago(x.last)}`))}`)
    : none("No session in 7 days.", "Claude Code sessions traced to Langfuse fill this.");
  return `<div class="kinds">${sub("Episode pages", e.episodes.length, eps)}${sub("Daily pages", e.daily.total, daily)}${sub("Latest sessions", e.sessions?.length, sess)}</div><p class="hint"><a href="#/sessions">All sessions</a></p>`;
}

function renderProcedural(p) {
  const skills = p.skills.length ? `<p class="chips">${p.skills.map((n) => `<a class="chip" href="#/skills/${encodeURIComponent(n)}">${esc(n)}</a>`).join("")}</p>` : none("No skills.", "Folders under <code>skills/</code> fill this.");
  const claude = p.claudeMd ? `<p><code>${esc(p.claudeMd.path)}</code> ${q(`${p.claudeMd.lines} lines, written ${ago(p.claudeMd.at)}`)}</p>` : none("No identity/CLAUDE.md.");
  const hooks = p.hooks.length
    ? `<table class="tbl"><tbody>${p.hooks.map((h) => `<tr><td>${esc(h.event)}${h.matcher ? ` ${q(esc(h.matcher))}` : ""}</td><td class="wide"><code>${esc(h.command)}</code></td><td class="num">${h.calls === null ? "–" : h.calls}</td></tr>`).join("")}</tbody></table>`
    : none("No hooks in ~/.claude/settings.json.", "The hooks entry of that file fills this, with calls from Langfuse.");
  return `<div class="kinds">${sub("Skills", p.skills.length, skills + `<p class="hint"><a href="#/skills">Skill use</a></p>`)}${sub("Rules", undefined, claude)}${sub("Hooks, calls in 7 days", p.hooks.length, hooks)}</div>`;
}

function renderRetrieval(r) {
  if (!r.stats) return none("No recall data.", "<code>vault misses</code> reads Langfuse; set its keys to fill this.");
  const s = r.stats;
  const rows = r.missed.length ? fold(r.missed, (x) => `<code>${esc(x.query)}</code> ${q(ago(x.at))}`) : `<p class="quiet">No query missed.</p>`;
  return `<div class="kinds">${sub(`Recalls, ${s.days} days`, s.recalls, table([["Empty", `${s.empty} (${Math.round(s.empty_share * 100)}%)`], ["Reformulated", s.reformulated], ["Reads not offered", s.unoffered_reads]]))}${sub("Latest misses", r.missed.length, rows)}</div>`;
}

function renderProspective(p) {
  const issues = p.issues.length
    ? fold(p.issues, (i) => `<a href="#/issues/${encodeURIComponent(i.repo)}/${i.id}">${i.id}</a> ${esc(i.title)} ${q(esc([i.repo, i.due && `due ${i.due}`, i.after?.length && `after ${localId(i.after.join(", "), i.repo)}`].filter(Boolean).join(" · ")))}`)
    : none("No open issue has a due date or an after.", "<code>aleph todo add --due</code> or <code>--after</code> fills this.");
  const trig = p.triggers.length ? fold(p.triggers, (t) => esc(JSON.stringify(t))) : none("No scheduled trigger.", "The aleph-tick sweep reads them once they exist.");
  return `<div class="kinds">${sub("Open issues with a date or a wait", p.issues.length, issues)}${sub("Scheduled triggers", p.triggers.length, trig)}</div>`;
}

const renderParametric = () =>
  `<p>The model weights. Aleph does not store them. <a href="#/memory/${encodeURIComponent("Seven Agent Memory Types Mapped Onto Aleph")}">The rule</a>: keep what the model already knows out of the vault.</p>`;

function renderGates(g, runs = [], week = { days: 7, kept: 0, rejected: 0 }) {
  const none2 = (what, fills) => none(`No ${what} yet.`, fills);
  const lessons = (xs, what, fills) => (xs.length ? fold(xs, (l) => `${esc(l.sentence)} ${q(`seen ${l.count}×${l.kind ? ` · ${esc(l.kind)}` : ""}`)}`) : none2(what, fills));
  const run = (r) => `<div class="sub"><h4>${esc(r.job)} ${q(`${esc(r.run)} · ${ago(r.at)}`)}</h4>` +
    (r.kept.length ? fold(r.kept, (k) => `${link(k.title)} ${q(esc(k.source))}`) : `<p class="quiet">Nothing kept.</p>`) +
    (r.rejected.length ? fold(r.rejected, (x) => `${esc(x.fact)} ${q(esc(x.reason))}`) : `<p class="quiet">Nothing rejected.</p>`) + `</div>`;
  const facts = runs.length
    ? `<p>${q(`Last ${week.days} days:`)} <strong>${week.kept}</strong> kept, <strong>${week.rejected}</strong> rejected</p>${runs.map(run).join("")}`
    : none2("facts run", "The factory's facts gate (aleph-352) fills this.");
  return `<div class="kinds">${sub("Facts runs", runs.length, facts)}` +
    `${sub("Corrections", g.corrections.length, lessons(g.corrections, "correction", "The correction miner (aleph-353) fills this."))}${sub("Proposals", g.proposals.length, lessons(g.proposals, "proposal", "A correction seen 3 times (aleph-353) becomes one."))}</div>`;
}

const EMPTY_TYPES = {
  working: { total: 0, archived: [], current: null, last: "" },
  semantic: { memory: null, notes: [], last: "" },
  episodic: { episodes: [], daily: { total: 0, latest: [] }, sessions: null, last: "" },
  procedural: { skills: [], claudeMd: null, hooks: [], last: "" },
  retrieval: { stats: null, missed: [], last: "" },
  prospective: { issues: [], triggers: [], last: "" },
  gates: { corrections: [], proposals: [] },
};

export function renderMemory(m) {
  const t = { ...EMPTY_TYPES, ...(m.types ?? {}) };
  const types = [
    ["working", "Working", t.working.total, "handoffs", t.working.last, renderWorking(t.working)],
    ["semantic", "Semantic", m.exists ? m.total : 0, "notes", t.semantic.last, renderSemantic(m, t.semantic)],
    ["episodic", "Episodic", t.episodic.episodes.length, "episodes", t.episodic.last, renderEpisodic(t.episodic)],
    ["procedural", "Procedural", t.procedural.skills.length, "skills", t.procedural.last, renderProcedural(t.procedural)],
    ["retrieval", "Retrieval", t.retrieval.stats ? t.retrieval.stats.recalls : "–", "recalls, 7 days", t.retrieval.last, renderRetrieval(t.retrieval)],
    ["prospective", "Prospective", t.prospective.issues.length, "dated or waiting", t.prospective.last, renderProspective(t.prospective)],
    ["parametric", "Parametric", "–", "not stored", "", renderParametric()],
  ];
  const cards = `<nav class="cards types" aria-label="Memory types">${types.map(([id, name, n, unit, last]) =>
    `<a class="job-card small" href="#h-${id}"><strong>${name}</strong><span class="num">${esc(n)} <span class="quiet">${esc(unit)}</span></span><span class="hint">last write ${ago(last)}</span></a>`).join("")}</nav>`;
  return `<div class="page">${pageHead("Memory", { count: m.exists ? m.total : 0 })}${renderSearch()}${cards}` +
    `<details class="fold"><summary>Health and recent writes</summary><section id="health">${renderHealth(m)}</section><section id="writes">${renderWrites(m)}</section></details>` +
    types.map(([id, name, n, , , body]) => `<details class="fold" id="${id}"><summary>${head(id, name, n)}</summary>${body}</details>`).join("") +
    `<details class="fold" id="gates"><summary>${head("gates", "Factory memory gates")}</summary>${renderGates(t.gates, m.facts, m.factsWeek)}</details></div>`;
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
