// The Memory view: a status board of the seven memory types, broad health below it, then a browser of the
// notes with an inspector. `renderNote` serves #/memory/<title> too, from
// memory-note.js, because the page reads one `view` per file.
import { empty, error, esc, filterBar, localId, md, pageHead, pager, sortHead, when } from "../lib.js";

export const view = {
  path: "/memory",
  title: "Memory",
  icon: "brain",
  group: "memory",
  order: 0,
  api: "/api/memory",
  render: (m, _params, query) => renderMemory(m, options(query)),
  mount: (root, m) => mount(root, m),
};

const link = (title) => `<a href="#/memory/${encodeURIComponent(title)}">${esc(title)}</a>`;
const head = (id, title, n) => `<div class="sh"><h2 id="h-${id}">${esc(title)}</h2>${n === undefined ? "" : `<span class="count">${n}</span>`}</div>`;

const table = (rows) => rows.length
  ? `<table class="tbl"><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k === "" ? "(none)" : k)}</td><td class="num">${v}</td></tr>`).join("")}</tbody></table>` : "";

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
  return (m.writes.length
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
  const kinds = Object.keys(m.byKind ?? {}).filter((k) => k !== "episode" && k !== "none");
  const lists = kinds.map((k) => {
    const xs = s.notes.filter((n) => n.kind === k);
    return `<details><summary>${esc(k)} <span class="count">${xs.length}</span></summary>${xs.length ? fold(xs, (n) => `${link(n.title)} ${q(esc(n.scope))}`) : `<p class="quiet">None.</p>`}</details>`;
  }).join("");
  if (!m.exists) return mem + none("No vault yet.", "Run <code>vault init</code> to make one.");
  return mem + `<h3>Notes by kind <span class="count">${s.notes.length}</span></h3><div class="kinds">${lists}</div>` +
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

const STYLE = `<style>
.memory { display: flex; flex-direction: column; gap: 16px; }
.memory .mem-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; }
.memory .mem-head span { font: 400 var(--fs-xl)/1.3 var(--display); color: var(--muted); }
.memory .mem-head h1 { flex: 1 1 320px; margin: 0; font: 400 var(--fs-xl)/1.3 var(--display); color: var(--ink); }
.memory .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; }
.memory .tile { all: unset; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 16px; background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; color: var(--ink-2); }
.memory .tile:hover, .memory .tile[aria-pressed="true"] { border-color: var(--run); }
.memory .tile:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.memory .tile .k { color: var(--muted); font: 600 var(--fs-xs) var(--sans); letter-spacing: .08em; text-transform: uppercase; }
.memory .tile b { font: 700 36px/1 var(--metric); color: var(--ink); font-variant-numeric: lining-nums tabular-nums; }
.memory .tile small { font-size: var(--fs-sm); }
.memory .st { font-size: var(--fs-sm); font-weight: 600; color: var(--muted); }
.memory .st.good { color: var(--done); } .memory .st.warn { color: var(--need); }
.memory .dates { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; margin: 0; font-size: var(--fs-xs); }
.memory .dates dt { color: var(--muted); } .memory .dates dd { margin: 0; color: var(--ink); }
.memory .card { display: flex; flex-direction: column; gap: 10px; min-width: 0; padding: 16px; background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; }
.memory .card h2 { margin: 0; font: 600 var(--fs-lg)/1.3 var(--sans); color: var(--ink); }
.memory .card h2 em { font-style: normal; font-weight: 500; color: var(--muted); }
.memory .broad { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.memory .barrow { display: grid; grid-template-columns: 100px minmax(40px, 1fr) 150px; gap: 12px; align-items: center; padding: 6px 0; border-top: 1px solid var(--rule-2); font-size: var(--fs-sm); }
.memory .barrow > span:first-child { color: var(--ink); }
.memory .barrow > span:last-child { text-align: right; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.memory .barrow i { display: block; height: 10px; background: var(--muted); border-radius: 0 3px 3px 0; }
.memory .barrow.top i { background: var(--stuck); }
.memory .stack { display: flex; height: 10px; overflow: hidden; border-radius: 3px; background: var(--sunk); }
.memory .c-use { background: var(--run); } .memory .c-stale { background: var(--muted); } .memory .c-never { background: var(--rule); }
.memory .key { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: var(--fs-xs); color: var(--muted); }
.memory .key span { display: inline-flex; align-items: center; gap: 6px; } .memory .key i { width: 10px; height: 10px; border-radius: 2px; }
.memory .nb-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
.memory .nb-tools input[type="search"] { flex: 1 1 240px; box-sizing: border-box; min-height: 36px; padding: 0 12px; font: var(--fs-md) var(--sans); color: var(--ink); background: var(--sunk); border: 1px solid var(--rule); border-radius: 6px; }
.memory .nb-tools .fbar { margin: 0; }
.memory #mem-filters .seg { height: auto; flex-wrap: wrap; } .memory #mem-filters .seg button { min-height: 28px; white-space: nowrap; }
.memory .browse { display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 16px; align-items: start; }
.memory .ins { position: sticky; top: 8px; max-height: calc(100vh - 16px); overflow: auto; }
.memory .ins h3 { margin: 0; font: 400 18px/1.35 var(--display); color: var(--ink); overflow-wrap: anywhere; }
.memory .ins h4 { margin: 4px 0 0; color: var(--muted); font: 600 var(--fs-xs) var(--sans); letter-spacing: .08em; text-transform: uppercase; }
.memory .ins ul { margin: 0; padding: 0; list-style: none; font-size: var(--fs-sm); }
.memory .ins li { padding: 4px 0; border-top: 1px solid var(--rule-2); overflow-wrap: anywhere; }
.memory .ins .note { font-size: var(--fs-sm); overflow-wrap: anywhere; }
.memory .ins .warnbox { padding: 8px 10px; font-size: var(--fs-sm); color: var(--ink); border: 1px solid var(--stuck); border-radius: 6px; }
.memory .ins .pill { align-self: flex-start; }
.memory .pill { font-size: var(--fs-xs); font-weight: 600; white-space: nowrap; padding: 1px 6px; border: 1px solid var(--rule); border-radius: 4px; color: var(--muted); }
.memory .pill.use { color: var(--done); border-color: var(--done); } .memory .pill.stale { color: var(--need); border-color: var(--need); } .memory .pill.lint { color: var(--stuck); border-color: var(--stuck); }
.memory tr.nrow { cursor: pointer; } .memory tr.nrow[aria-selected="true"] { background: var(--sunk); box-shadow: inset 3px 0 0 var(--run); }
.memory td.wide a { color: inherit; text-decoration: none; } .memory tr.nrow:hover td.wide a { text-decoration: underline; }
@media (min-width: 1200px) { .memory .tiles { grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 12px; } .memory .tile { padding: 12px; } }
@media (max-width: 1100px) { .memory .browse { grid-template-columns: minmax(0, 1fr); } .memory .ins { position: static; max-height: none; } }
@media (max-width: 720px) { .memory .broad { grid-template-columns: minmax(0, 1fr); } .memory .barrow { grid-template-columns: 1fr 150px; } .memory .barrow > div { grid-column: 1 / -1; grid-row: 2; } }
</style>`;

const DAY = 86_400_000, STEP = 50;
const KNOWLEDGE = ["decision", "gotcha", "project", "entity", "concept"];
const STATUS = { use: "In use", stale: "Stale", never: "Never read", lint: "Lint problem" };
const fmt = (n) => Number(n).toLocaleString("en-US");
const shortDay = (s) => { const t = Date.parse(`${String(s).slice(0, 10)}T00:00`); return t ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""; };

/** A note's status: a refusal first; else in use when recall returned it in the last 7 days, stale when earlier, never when it never did. */
export function noteStatus(n, now = Date.now()) {
  if (n.problems?.length) return "lint";
  if (!n.read) return "never";
  return now - Date.parse(`${n.read}T00:00`) <= 7 * DAY ? "use" : "stale";
}

/** The note rows with their status. */
export const noteRows = (m, now = Date.now()) => (m.notes ?? []).map((n) => ({ ...n, status: noteStatus(n, now) }));

const isKnown = (n) => KNOWLEDGE.includes(n.kind);

/** How many of `rows` have each status. A lint problem counts as itself, so the four add up to the rows. */
export function statusCounts(rows) {
  const c = { use: 0, stale: 0, never: 0, lint: 0 };
  for (const n of rows) c[n.status]++;
  return c;
}

/** The newest date of `xs`, or "". */
const newest = (xs) => xs.filter(Boolean).sort().at(-1) ?? "";

/** The seven tiles. `use` is shown only where it is measured: the recall log covers the notes and the episodes. */
export function typeTiles(m, rows) {
  const t = { ...EMPTY_TYPES, ...(m.types ?? {}) };
  const known = rows.filter(isKnown), eps = rows.filter((n) => n.kind === "episode");
  const kept = known.length ? Math.round((known.filter((n) => n.read).length / known.length) * 100) : 0;
  const stats = t.retrieval.stats;
  const hooks = t.procedural.hooks.length;
  return [
    { id: "working", name: "Working", n: t.working.total, unit: "handoffs", status: t.working.current ? "One current" : "None current", tone: "", write: t.working.last },
    { id: "semantic", name: "Semantic", n: m.exists ? known.length : 0, unit: "notes", status: `${kept}% returned, ${100 - kept}% never`, tone: kept < 50 ? "warn" : "good", write: t.semantic.last, use: newest(known.map((n) => n.read)) },
    { id: "episodic", name: "Episodic", n: m.byKind?.episode ?? eps.length, unit: `episodes, ${t.episodic.daily.total} daily pages`, status: `${eps.filter((n) => n.read).length} returned by recall`, tone: "", write: t.episodic.last, use: newest(eps.map((n) => n.read)) },
    { id: "procedural", name: "Procedural", n: t.procedural.skills.length, unit: `skills, ${hooks} hooks`, status: t.procedural.claudeMd ? `${t.procedural.claudeMd.lines} lines of rules` : "No rules file", tone: "", write: t.procedural.last },
    { id: "retrieval", name: "Retrieval", n: stats ? stats.recalls : "–", unit: "recalls, 7 days", status: stats ? `${Math.round(stats.empty_share * 100)}% empty` : "No data", tone: stats && stats.empty_share > 0.2 ? "warn" : "", write: t.retrieval.last },
    { id: "prospective", name: "Prospective", n: t.prospective.issues.length, unit: "dated or waiting", status: t.prospective.issues.length ? "Waiting" : "Empty", tone: "", write: t.prospective.last },
    { id: "parametric", name: "Parametric", n: "–", unit: "not stored", status: "By design", tone: "", write: "" },
  ];
}

const dateOr = (s) => (s ? esc(shortDay(s) || s) : "–");
const renderTiles = (m, rows, type) => `<section class="tiles" aria-label="Memory types">${typeTiles(m, rows).map((t) =>
  `<button type="button" class="tile" data-type="${t.id}" aria-pressed="${t.id === type}"><span class="k">${t.name}</span><b>${typeof t.n === "number" ? fmt(t.n) : esc(t.n)}</b><small>${esc(t.unit)}</small><span class="st ${t.tone}">${esc(t.status)}</span>` +
  `<dl class="dates"><dt>Write</dt><dd>${dateOr(t.write)}</dd><dt>Use</dt><dd>${dateOr(t.use)}</dd></dl></button>`).join("")}</section>`;

/** Each knowledge kind's notes by when recall last returned them. */
function readChart(rows) {
  const lines = KNOWLEDGE.map((k) => {
    const of = rows.filter((n) => n.kind === k);
    if (!of.length) return "";
    const week = of.filter((n) => n.read && noteStatusRead(n) === "use").length, older = of.filter((n) => n.read).length - week, never = of.length - week - older;
    const w = (x) => ((x / of.length) * 100).toFixed(2);
    return `<div class="barrow"><span>${esc(k)}</span><div class="stack" role="img" aria-label="${week} in the last 7 days, ${older} earlier, ${never} never"><div class="c-use" style="width:${w(week)}%"></div><div class="c-stale" style="width:${w(older)}%"></div><div class="c-never" style="width:${w(never)}%"></div></div><span>${week} · ${older} · ${never} never</span></div>`;
  }).join("");
  return `<h3>When recall last returned each note</h3><div class="key"><span><i class="c-use"></i>Last 7 days</span><span><i class="c-stale"></i>Earlier</span><span><i class="c-never"></i>Never</span></div><div>${lines}</div><p class="hint">The recall log keeps the last return date of each note. Its oldest date is ${esc(shortDay(oldest(rows)) || "none")}, so "never" means never since then.</p>`;
}
const oldest = (rows) => rows.map((n) => n.read).filter(Boolean).sort()[0] ?? "";
/** The recency alone, for a note with a refusal too. */
const noteStatusRead = (n) => noteStatus({ read: n.read });

function renderDetail(m, rows, type) {
  const t = { ...EMPTY_TYPES, ...(m.types ?? {}) };
  const bodies = {
    working: () => renderWorking(t.working),
    semantic: () => readChart(rows) + renderSemantic(m, t.semantic),
    episodic: () => renderEpisodic(t.episodic),
    procedural: () => renderProcedural(t.procedural),
    retrieval: () => renderRetrieval(t.retrieval),
    prospective: () => renderProspective(t.prospective),
    parametric: () => renderParametric(),
  };
  const name = typeTiles(m, rows).find((x) => x.id === type)?.name ?? "";
  return `<section class="card" id="mem-detail" aria-label="${esc(name)}"><h2>${esc(name)}</h2>${(bodies[type] ?? bodies.semantic)()}</section>`;
}

/** Lint by rule, largest first. */
export function lintRules(lint) {
  const add = (m, f, key) => { const r = m.get(f.rule) ?? { rule: f.rule, refused: 0, warned: 0 }; r[key]++; m.set(f.rule, r); };
  const m = new Map();
  for (const f of lint?.refuse ?? []) add(m, f, "refused");
  for (const f of lint?.warn ?? []) add(m, f, "warned");
  return [...m.values()].sort((a, b) => b.refused + b.warned - a.refused - a.warned);
}

function renderBroad(m) {
  const lint = m.lint ?? { refuse: [], warn: [] }, rules = lintRules(lint), top = Math.max(1, ...rules.map((r) => r.refused + r.warned));
  const lintCard = `<section class="card" aria-label="Lint"><h2>Lint <em>${lint.refuse.length} refusals, ${lint.warn.length} warnings</em></h2>` +
    (rules.length ? `<div>${rules.map((r, i) => `<div class="barrow${i === 0 && r.refused ? " top" : ""}"><span>${esc(r.rule)}</span><div><i style="width:${(((r.refused + r.warned) / top) * 100).toFixed(1)}%"></i></div><span>${[r.refused && `${r.refused} refused`, r.warned && `${r.warned} warned`].filter(Boolean).join(", ")}</span></div>`).join("")}</div>` : empty("Lint finds nothing.")) +
    `<details class="fold"><summary>Every finding</summary>${renderHealth(m)}</details></section>`;
  const t = { ...EMPTY_TYPES, ...(m.types ?? {}) }, week = m.factsWeek ?? { days: 7, kept: 0, rejected: 0 }, all = week.kept + week.rejected;
  const gates = `<section class="card" aria-label="Factory memory gates"><h2>Factory memory gates <em>${week.days} days</em></h2>` +
    `<div class="stack" role="img" aria-label="${week.kept} kept, ${week.rejected} rejected"><div class="c-use" style="width:${all ? ((week.kept / all) * 100).toFixed(1) : 0}%"></div></div>` +
    `<div class="key"><span><i class="c-use"></i>${week.kept} kept</span><span><i class="c-never"></i>${week.rejected} rejected</span><span>${t.gates.corrections.length} corrections</span><span>${t.gates.proposals.length} proposals</span></div>` +
    `<details class="fold" id="gates"><summary>Facts runs, corrections and proposals</summary>${renderGates(t.gates, m.facts, m.factsWeek)}</details></section>`;
  const writes = `<section class="card" aria-label="Recent writes"><h2>Recent writes <em>${(m.writes ?? []).length}</em></h2>${renderWrites({ writes: (m.writes ?? []).slice(0, 5) })}` +
    ((m.writes ?? []).length > 5 ? `<details class="fold"><summary>${m.writes.length - 5} more</summary>${renderWrites({ writes: m.writes.slice(5) })}</details>` : "") + `</section>`;
  return `<div class="broad">${lintCard}${gates}</div>${writes}`;
}

/** The browser's state from the route's query: ?type=semantic&status=never&kind=gotcha&scope=aleph&q=text&sort=read&dir=desc&note=Title&limit=100. */
export function options(q = new URLSearchParams()) {
  return { type: q.get("type") || "semantic", status: q.get("status") ?? "", kind: q.get("kind") ?? "", scope: q.get("scope") ?? "", q: q.get("q") ?? "", note: q.get("note") ?? "",
    sort: q.get("sort") ? { key: q.get("sort"), dir: q.get("dir") === "asc" ? 1 : -1 } : null, limit: Math.max(STEP, Number.parseInt(q.get("limit"), 10) || STEP) };
}

/** The kind filter: empty is the knowledge notes; episodes are there on request. */
const ofKind = (rows, kind) => (kind ? rows.filter((n) => n.kind === kind) : rows.filter(isKnown));

const SORT = { title: (n) => n.title, kind: (n) => n.kind, scope: (n) => n.scope, read: (n) => n.read ?? "", updated: (n) => n.updated, status: (n) => n.status };
/** The rows the filters keep. `hits` is the ranked titles of a search; a title that holds the text also passes, for the episodes recall does not search. */
export function browseRows(rows, o, hits = []) {
  const q = o.q.trim().toLowerCase(), rank = new Map(hits.map((t, i) => [t, i]));
  const out = ofKind(rows, o.kind).filter((n) => (!o.status || n.status === o.status) && (!o.scope || n.scope === o.scope) && (!q || rank.has(n.title) || n.title.toLowerCase().includes(q)));
  if (o.sort) {
    const f = SORT[o.sort.key] ?? SORT.updated;
    return out.sort((a, b) => String(f(a)).localeCompare(String(f(b))) * o.sort.dir || a.title.localeCompare(b.title));
  }
  if (q) return out.sort((a, b) => (rank.get(a.title) ?? Infinity) - (rank.get(b.title) ?? Infinity) || a.title.localeCompare(b.title));
  return out.sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title));
}

const pill = (s) => `<span class="pill ${s}">${esc(STATUS[s])}</span>`;

function renderNoteTable(rows, o, hits) {
  const all = browseRows(rows, o, hits);
  if (!all.length) return empty("No note matches.", "Loosen the filters.");
  const shown = all.slice(0, o.limit), sort = o.sort ?? (o.q.trim() ? null : { key: "updated", dir: -1 });
  const h = (label, key) => sortHead(label, key, sort);
  return `<div class="tscroll"><table class="tbl"><thead><tr>${h("Title", "title")}${h("Kind", "kind")}${h("Scope", "scope")}${h("Read", "read")}${h("Written", "updated")}${h("Status", "status")}</tr></thead><tbody>` +
    shown.map((n) => `<tr class="nrow" data-note="${esc(n.title)}" aria-selected="${n.title === o.note}"><td class="wide" title="${esc(n.title)}"><a href="#/memory/${encodeURIComponent(n.title)}">${esc(n.title)}</a></td><td>${esc(n.kind)}</td><td>${esc(n.scope)}</td><td class="time">${n.read ? esc(shortDay(n.read)) : "never"}</td><td class="time">${esc(shortDay(n.updated))}</td><td>${pill(n.status)}</td></tr>`).join("") +
    `</tbody></table></div>${pager(shown.length, all.length, STEP)}`;
}

function renderNoteTools(rows, o) {
  const inKind = ofKind(rows, o.kind), c = statusCounts(inKind), scopes = [...new Set(rows.map((n) => n.scope).filter(Boolean))].sort(), kinds = [...new Set(rows.map((n) => n.kind))].filter((k) => !KNOWLEDGE.includes(k)).sort();
  return filterBar([
    { label: "", name: "status", value: o.status, options: [{ value: "", label: `All ${inKind.length}` }, ...Object.entries(STATUS).map(([k, v]) => ({ value: k, label: `${k === "lint" ? "Lint" : v} ${c[k]}` }))] },
    { label: "Kind", name: "kind", value: o.kind, options: [{ value: "", label: "Knowledge" }, ...KNOWLEDGE, ...kinds] },
    { label: "Scope", name: "scope", value: o.scope, options: [{ value: "", label: "All" }, ...scopes] },
  ]);
}

/** The inspector for one note from /api/memory/note; `row` gives its status and read date. */
export function renderInspector(n, row) {
  if (!n) return `<p class="quiet">Select a note to see its claim, sources and links.</p>`;
  const fm = n.frontmatter ?? {}, sources = [].concat(fm.sources ?? []);
  const list = (title, xs, item) => (xs.length ? `<h4>${title}</h4><ul>${xs.map((x) => `<li>${item(x)}</li>`).join("")}</ul>` : "");
  const fact = (k, v) => (v ? `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>` : "");
  return (row ? pill(row.status) : "") + `<h3>${esc(n.title)}</h3>` +
    (row?.problems?.length ? `<div class="warnbox">${row.problems.map((p) => esc(`${p.rule}: ${p.detail}`)).join("<br>")}</div>` : "") +
    `<dl class="facts">${fact("Kind", [fm.kind, fm.scope].filter(Boolean).join(", "))}${fact("Confidence", fm.confidence)}${fact("Written", fm.updated && shortDay(fm.updated))}${fact("Last read", row ? (row.read ? shortDay(row.read) : "never") : "")}</dl>` +
    `<article class="note">${md(n.body)}</article>` +
    list("Sources", sources, (s) => `<code>${esc(s)}</code>`) + list("Links to", n.links ?? [], (l) => link(l.title)) + list("Linked from", n.backlinks ?? [], (l) => link(l.title)) +
    `<p class="hint"><code>${esc(n.path)}</code> · ${`<a href="#/memory/${encodeURIComponent(n.title)}">Open the page</a>`}</p>`;
}

export function renderMemory(m, o = options()) {
  const rows = noteRows(m), known = rows.filter(isKnown), never = known.filter((n) => !n.read).length, refused = new Set((m.lint?.refuse ?? []).map((f) => f.note)).size;
  const line = !m.exists ? "No vault yet." : `Recall has never returned ${fmt(never)} of the ${fmt(known.length)} knowledge notes. Lint refuses ${fmt(refused)} ${refused === 1 ? "note" : "notes"}.`;
  return `${STYLE}<div class="page memory"><header class="mem-head"><span>${fmt(m.exists ? m.total : 0)} notes</span><h1>${esc(line)}</h1></header>` +
    `<div id="mem-board">${renderTiles(m, rows, o.type)}</div><div id="mem-detail-box">${renderDetail(m, rows, o.type)}</div>` + renderBroad(m) +
    (m.exists ? `<section aria-label="Notes" class="memory" id="mem-notes"><div class="sh"><h2>Notes</h2></div><div class="nb-tools"><input type="search" name="q" data-ui="mem-search" value="${esc(o.q)}" placeholder="Search titles, aliases and bodies" aria-label="Search the vault"></div><div id="mem-filters" data-ui="mem-filter">${renderNoteTools(rows, o)}</div>` +
      `<div class="browse"><div id="mem-table">${renderNoteTable(rows, o, [])}</div><aside class="card ins" id="mem-inspector" aria-label="Note inspector" aria-live="polite">${renderInspector(null)}</aside></div></section>` : "") + `</div>`;
}

let live = null;
const here = () => options(new URLSearchParams(location.hash.split("?")[1] ?? ""));
const setQuery = (changes) => {
  const [path, qs = ""] = location.hash.replace(/^#/, "").split("?");
  const q = new URLSearchParams(qs);
  for (const [k, v] of Object.entries(changes)) { if (v) q.set(k, v); else q.delete(k); }
  history.replaceState(null, "", `#${path}${q.toString() ? `?${q}` : ""}`);
};

function redrawNotes() {
  if (!live?.root.isConnected) return;
  const o = here();
  live.root.querySelector("#mem-filters").innerHTML = renderNoteTools(live.rows, o);
  live.root.querySelector("#mem-table").innerHTML = renderNoteTable(live.rows, o, live.hits);
}

/** Fetch one note into the inspector. A later selection wins over a slower answer. */
async function inspect(title) {
  const box = live?.root.querySelector("#mem-inspector");
  if (!box || !title) return;
  const row = live.rows.find((n) => n.title === title);
  box.innerHTML = `<p class="quiet" role="status">Loading the note…</p>`;
  try {
    const res = await fetch(`/api/memory/note?title=${encodeURIComponent(title)}`, { cache: "no-store" });
    const n = await res.json();
    if (here().note !== title) return;
    box.innerHTML = res.ok ? renderInspector(n, row) : error(n.error ?? `answered ${res.status}`, "The note may have left the vault.");
  } catch (e) { box.innerHTML = error(`Could not load the note: ${e.message}`); }
}

/** `/api/memory/search`, which ranks over titles, aliases and bodies and logs no read. */
async function search(q) {
  if (!q.trim()) { live.hits = []; return redrawNotes(); }
  try {
    const r = await (await fetch(`/api/memory/search?q=${encodeURIComponent(q)}`, { cache: "no-store" })).json();
    if (here().q !== q) return;
    live.hits = (r.results ?? []).map((x) => x.title);
  } catch { live.hits = []; }
  redrawNotes();
}

function mount(root, m) {
  live = { root, m, rows: noteRows(m), hits: [] };
  const o = here();
  if (o.q) search(o.q);
  if (o.note) inspect(o.note);
}

if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const t = e.target.closest ? e.target : null;
    if (!t?.closest(".page.memory") || !live) return;
    const tile = t.closest("button[data-type]");
    if (tile) {
      setQuery({ type: tile.dataset.type });
      const o = here();
      live.root.querySelector("#mem-board").innerHTML = renderTiles(live.m, live.rows, o.type);
      live.root.querySelector("#mem-detail-box").innerHTML = renderDetail(live.m, live.rows, o.type);
      return;
    }
    const seg = t.closest("#mem-filters .seg button");
    if (seg) { setQuery({ [seg.closest(".seg").dataset.name]: seg.dataset.value, limit: "" }); return redrawNotes(); }
    const sort = t.closest("#mem-table button[data-sort]");
    if (sort) {
      const key = sort.dataset.sort, cur = here().sort;
      setQuery({ sort: key, dir: (cur?.key === key ? -cur.dir : key === "read" || key === "updated" ? -1 : 1) > 0 ? "asc" : "desc" });
      return redrawNotes();
    }
    const more = t.closest("#mem-table button[data-more]");
    if (more) { setQuery({ limit: String(here().limit + Number(more.dataset.more)) }); return redrawNotes(); }
    const row = t.closest("tr.nrow");
    // A click selects; with a modifier key, the title's link opens the note's page.
    if (row && !(e.metaKey || e.ctrlKey || e.shiftKey)) {
      e.preventDefault();
      setQuery({ note: row.dataset.note });
      for (const r of live.root.querySelectorAll("tr.nrow")) r.setAttribute("aria-selected", String(r === row));
      inspect(row.dataset.note);
      // Stacked, the inspector is below the table.
      if (innerWidth <= 1100) live.root.querySelector("#mem-inspector").scrollIntoView({ block: "start" });
    }
  });
  document.addEventListener("change", (e) => {
    const f = e.target.closest?.("#mem-filters select");
    if (f) { setQuery({ [f.name]: f.value, limit: "" }); redrawNotes(); }
  });
  let typing = 0;
  document.addEventListener("input", (e) => {
    if (!e.target.matches?.('[data-ui="mem-search"]')) return;
    clearTimeout(typing);
    typing = setTimeout(() => { setQuery({ q: e.target.value, limit: "" }); search(e.target.value); }, 200);
  });
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
