// The Memory view: a status board of the seven memory types, broad health below it, then a browser of the
// notes with an inspector. `renderNote` serves #/memory/<title> too, from
// memory-note.js, because the page reads one `view` per file.
import { barList, barRow, chip, chipRow, count, pct, priorityBadge, tag, card, crumb, dataTable, day, empty, error, esc, filterBar, loadingLine, localId, md, onTile, pageHead, pager, searchBox, sectionHead, setQuery, sortHead, statCard, tiles, when } from "../lib.js";

export const view = {
  path: "/memory",
  title: "Memory",
  icon: "brain",
  group: "claude",
  order: 1,
  api: "/api/memory",
  render: (m, _params, query) => renderMemory(m, options(query)),
  mount: (root, m) => mount(root, m),
};

const link = (title) => `<a href="#/memory/${encodeURIComponent(title)}">${esc(title)}</a>`;
const head = (id, title, n) => `<div class="sh"><h2 id="h-${id}">${esc(title)}</h2>${n === undefined ? "" : `<span class="count">${n}</span>`}</div>`;

const table = (rows) => rows.length
  ? dataTable("", rows.map(([k, v]) => `<tr><td>${esc(k === "" ? "(none)" : k)}</td><td class="num">${v}</td></tr>`).join("")) : "";

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
    (med ? `<h3>Recall Misses, ${esc(med.days)} Days</h3>` + table([
      ["Recalls", med.recalls], ["Empty", `${med.empty} (${pct(med.empty_share * 100)})`],
      ["Reformulated", med.reformulated], ["Reads not offered", med.unoffered_reads]]) : "");
}

export function renderWrites(m) {
  return (m.writes.length
    ? dataTable("<th>When</th><th>Write</th>", m.writes.map((w) => `<tr><td class="time">${esc(when(`${w.date}T${w.time}`) || `${w.date} ${w.time}`)}</td><td class="wide">${md(w.text).replace(/^<p>|<\/p>$/g, "")}</td></tr>`).join(""))
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
  const kinds = Object.keys(m.byKind ?? {}).filter((k) => k !== "none");
  const lists = kinds.map((k) => {
    const xs = s.notes.filter((n) => n.kind === k);
    return `<details><summary>${esc(k)} <span class="count">${xs.length}</span></summary>${xs.length ? fold(xs, (n) => `${link(n.title)} ${q(esc(n.scope))}`) : `<p class="quiet">None.</p>`}</details>`;
  }).join("");
  const start = Object.entries(s.start ?? {}).map(([scope, x]) =>
    `<details><summary>Core lines, ${esc(scope)} <span class="count">${x.bytes} / ${x.budget} bytes</span></summary>${x.cut ? `<p class="quiet">${x.cut} cut.</p>` : ""}${x.core.length ? fold(x.core, (c) => `${link(c.title)} ${q(esc(c.core))}`) : `<p class="quiet">None.</p>`}</details>`).join("");
  if (!m.exists) return mem + none("No vault yet.", "Run <code>vault init</code> to make one.");
  return mem + start + `<h3>Notes by Kind <span class="count">${s.notes.length}</span></h3><div class="kinds">${lists}</div>` +
    `<details><summary>Counts by kind and scope</summary><div class="pair"><div>${table(Object.entries(m.byKind))}</div><div>${table(Object.entries(m.byScope)) || empty("No notes.")}</div></div></details>` +
    `<details><summary>Home</summary>${renderHome(m)}</details>`;
}

function renderEpisodic(e) {
  const eps = e.episodes.length ? fold(e.episodes, (n) => `${esc(n.title)} ${q(esc(`${n.scope} · ${n.updated}`))}`) : none("No episode page yet.", "The factory's tick writes one per done goal.");
  const daily = e.daily.total ? fold(e.daily.latest.map((d) => ({ d })), (x) => link(x.d)) : none("No daily page yet.", "The vault CLI starts one at the first write of a day.");
  const sess = e.sessions === null ? none("Sessions are not available.", "Langfuse keys fill this.")
    : e.sessions.length ? fold(e.sessions, (x) => `<a href="#/sessions/${encodeURIComponent(x.id)}">${esc(x.firstPrompt || x.id)}</a> ${q(esc(`${x.project} · ${x.turns} turns · ${ago(x.last)}`))}`)
    : none("No session in 7 days.", "Claude Code sessions traced to Langfuse fill this.");
  return `<div class="kinds">${sub("Episode Pages", e.episodes.length, eps)}${sub("Daily Pages", e.daily.total, daily)}${sub("Latest Sessions", e.sessions?.length, sess)}</div><p class="hint"><a href="#/sessions">All sessions</a></p>`;
}

function renderProcedural(p) {
  const skills = p.skills.length ? chipRow(p.skills.map((n) => chip(n, { el: "a", attrs: ` href="#/skills/${encodeURIComponent(n)}"` })).join(""), "p") : none("No skills.", "Folders under <code>skills/</code> fill this.");
  const claude = p.claudeMd ? `<p><code>${esc(p.claudeMd.path)}</code> ${q(`${p.claudeMd.lines} lines, written ${ago(p.claudeMd.at)}`)}</p>` : none("No identity/CLAUDE.md.");
  const hooks = p.hooks.length
    ? dataTable("", p.hooks.map((h) => `<tr><td>${esc(h.event)}${h.matcher ? ` ${q(esc(h.matcher))}` : ""}</td><td class="wide" title="${esc(h.command)}"><code>${esc(h.command)}</code></td><td class="num">${h.calls === null ? "–" : h.calls}</td></tr>`).join(""))
    : none("No hooks in ~/.claude/settings.json.", "The hooks entry of that file fills this, with calls from Langfuse.");
  return `<div class="kinds">${sub("Skills", p.skills.length, skills + `<p class="hint"><a href="#/skills">Skill use</a></p>`)}${sub("Rules", undefined, claude)}${sub("Hooks, Calls in 7 Days", p.hooks.length, hooks)}</div>`;
}

function renderRetrieval(r) {
  if (!r.stats) return none("No recall data.", "<code>vault misses</code> reads Langfuse; set its keys to fill this.");
  const s = r.stats;
  const rows = r.missed.length ? fold(r.missed, (x) => `<code>${esc(x.query)}</code> ${q(ago(x.at))}`) : `<p class="quiet">No query missed.</p>`;
  return `<div class="kinds">${sub(`Recalls, ${s.days} Days`, s.recalls, table([["Empty", `${s.empty} (${pct(s.empty_share * 100)})`], ["Reformulated", s.reformulated], ["Reads not offered", s.unoffered_reads]]))}${sub("Latest Misses", r.missed.length, rows)}</div>`;
}

function renderProspective(p) {
  const issues = p.issues.length
    ? fold(p.issues, (i) => `<a href="#/issues/${encodeURIComponent(i.repo)}/${i.id}">${i.id}</a> ${priorityBadge(i.priority)} ${esc(i.title)} ${q(esc([i.repo, i.after?.length && `after ${localId(i.after.join(", "), i.repo)}`].filter(Boolean).join(" · ")))}`)
    : none("No open issue has an after.", "<code>aleph issue edit</code> with <code>--after</code> fills this.");
  return `<div class="kinds">${sub("Open Issues With a Wait", p.issues.length, issues)}</div>`;
}

const renderParametric = () =>
  `<p>The model weights. Aleph does not store them. <a href="#/memory/${encodeURIComponent("Seven Agent Memory Types Mapped Onto Aleph")}">The rule</a>: keep what the model already knows out of the vault.</p>`;

function renderGates(g) {
  const lessons = (xs, what, fills) => (xs.length ? fold(xs, (l) => `${esc(l.sentence)} ${q(`seen ${l.count}×${l.kind ? ` · ${esc(l.kind)}` : ""}`)}`) : none(`No ${what} yet.`, fills));
  return `<div class="kinds">${sub("Corrections", g.corrections.length, lessons(g.corrections, "correction", "The correction miner (aleph-353) fills this."))}${sub("Proposals", g.proposals.length, lessons(g.proposals, "proposal", "A correction seen 3 times (aleph-353) becomes one."))}</div>`;
}

const EMPTY_TYPES = {
  working: { total: 0, archived: [], current: null, last: "" },
  semantic: { memory: null, notes: [], start: {}, last: "" },
  episodic: { episodes: [], keepDays: 0, daily: { total: 0, latest: [] }, sessions: null, last: "" },
  procedural: { skills: [], claudeMd: null, hooks: [], last: "" },
  retrieval: { stats: null, missed: [], last: "" },
  prospective: { issues: [] },
  gates: { corrections: [], proposals: [] },
};

const DAY = 86_400_000, STEP = 50;
const KNOWLEDGE = ["decision", "gotcha", "project", "entity", "concept"];
const STATUS = { use: "In use", stale: "Stale", never: "Never read", lint: "Lint problem" };
const shortDay = (s) => day(`${String(s).slice(0, 10)}T00:00`);

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


/** The seven cards: the count, and a second value with the qualifier that names both, or a note. */
export function typeTiles(m, rows) {
  const t = { ...EMPTY_TYPES, ...(m.types ?? {}) };
  const known = rows.filter(isKnown);
  const kept = known.length ? (known.filter((n) => n.read).length / known.length) * 100 : 0;
  const stats = t.retrieval.stats;
  return [
    { id: "working", name: "Working", n: t.working.total, note: t.working.current ? "handoffs, one current" : "handoffs, none current" },
    { id: "semantic", name: "Semantic", n: m.exists ? known.length : 0, v2: pct(kept), q: ["notes", "returned"] },
    { id: "episodic", name: "Episodic", n: t.episodic.episodes.length, v2: String(t.episodic.daily.total), q: ["episodes", "daily pages"] },
    { id: "procedural", name: "Procedural", n: t.procedural.skills.length, v2: String(t.procedural.hooks.length), q: ["skills", "hooks"] },
    { id: "retrieval", name: "Retrieval", n: stats ? stats.recalls : "–", ...(stats ? { v2: pct(stats.empty_share * 100), q: ["recalls, 7 days", "empty"] } : { note: "recalls, 7 days" }) },
    { id: "prospective", name: "Prospective", n: t.prospective.issues.length, note: "waiting" },
    { id: "parametric", name: "Parametric", n: "–", note: "not stored, by design" },
  ];
}

const renderTiles = (m, rows, type) => tiles("Memory types", typeTiles(m, rows).map((t) =>
  statCard({ k: t.name, v: typeof t.n === "number" ? count(t.n) : t.n, v2: t.v2, q: t.q, note: t.note, key: t.id, on: t.id === type })).join(""));

/** Each knowledge kind's notes by when recall last returned them. */
function readChart(rows) {
  const lines = KNOWLEDGE.map((k) => {
    const of = rows.filter((n) => n.kind === k);
    if (!of.length) return "";
    const week = of.filter((n) => n.read && noteStatusRead(n) === "use").length, older = of.filter((n) => n.read).length - week, never = of.length - week - older;
    const w = (x) => ((x / of.length) * 100).toFixed(2);
    return barRow(esc(k), 0, `${week} · ${older} · ${never} never`, { bar: `<span class="stack" role="img" aria-label="${week} in the last 7 days, ${older} earlier, ${never} never"><span class="c-use" style="width:${w(week)}%"></span><span class="c-stale" style="width:${w(older)}%"></span><span class="c-never" style="width:${w(never)}%"></span></span>` });
  }).join("");
  return `<h3>When Recall Last Returned Each Note</h3><div class="key"><span><i class="c-use"></i>Last 7 days</span><span><i class="c-stale"></i>Earlier</span><span><i class="c-never"></i>Never</span></div>${barList(lines)}<p class="hint">The recall log keeps the last return date of each note. Its oldest date is ${esc(shortDay(oldest(rows)) || "none")}, so "never" means never since then.</p>`;
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
  return card(name, (bodies[type] ?? bodies.semantic)(), { id: "mem-detail" });
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
  const lintCard = card("Lint", (rules.length ? barList(rules.map((r, i) => barRow(esc(r.rule), ((r.refused + r.warned) / top) * 100, [r.refused && `${r.refused} refused`, r.warned && `${r.warned} warned`].filter(Boolean).join(", "), { top: i === 0 && r.refused > 0 })).join("")) : empty("Lint finds nothing.")) +
    `<details class="fold"><summary>Every finding</summary>${renderHealth(m)}</details>`, { count: `${lint.refuse.length} refusals, ${lint.warn.length} warnings` });
  const t = { ...EMPTY_TYPES, ...(m.types ?? {}) };
  const gates = card("Factory Memory Gates", `<div class="key"><span>${t.gates.corrections.length} corrections</span><span>${t.gates.proposals.length} proposals</span></div>` +
    `<details class="fold" id="gates"><summary>Corrections and proposals</summary>${renderGates(t.gates)}</details>`, { label: "Factory memory gates" });
  const writes = card("Recent Writes", renderWrites({ writes: (m.writes ?? []).slice(0, 5) }) +
    ((m.writes ?? []).length > 5 ? `<details class="fold"><summary>${m.writes.length - 5} more</summary>${renderWrites({ writes: m.writes.slice(5) })}</details>` : ""), { count: (m.writes ?? []).length, label: "Recent writes" });
  return `<div class="pair">${lintCard}${gates}</div>${writes}`;
}

/** The browser's state from the route's query: ?type=semantic&status=never&kind=gotcha&scope=aleph&q=text&sort=read&dir=desc&note=Title&limit=100. */
export function options(q = new URLSearchParams()) {
  return { type: q.get("type") || "semantic", status: q.get("status") ?? "", kind: q.get("kind") ?? "", scope: q.get("scope") ?? "", q: q.get("q") ?? "", note: q.get("note") ?? "",
    sort: q.get("sort") ? { key: q.get("sort"), dir: q.get("dir") === "asc" ? 1 : -1 } : null, limit: Math.max(STEP, Number.parseInt(q.get("limit"), 10) || STEP) };
}

/** The kind filter: empty is the knowledge notes. */
const ofKind = (rows, kind) => (kind ? rows.filter((n) => n.kind === kind) : rows.filter(isKnown));

const SORT = { title: (n) => n.title, kind: (n) => n.kind, scope: (n) => n.scope, read: (n) => n.read ?? "", updated: (n) => n.updated, status: (n) => n.status };
/** The rows the filters keep. `hits` is the ranked titles of a search; a title that holds the text also passes. */
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

const TONE = { use: "done", stale: "need", never: "quiet", lint: "stuck" };
const pill = (s) => tag(STATUS[s], TONE[s]);

function renderNoteTable(rows, o, hits) {
  const all = browseRows(rows, o, hits);
  if (!all.length) return empty("No note matches.", "Loosen the filters.");
  const shown = all.slice(0, o.limit), sort = o.sort ?? (o.q.trim() ? null : { key: "updated", dir: -1 });
  const h = (label, key) => sortHead(label, key, sort);
  return dataTable(`${h("Written", "updated")}${h("Title", "title")}${h("Kind", "kind")}${h("Scope", "scope")}${h("Read", "read")}${h("Status", "status")}`,
    shown.map((n) => `<tr class="nrow" data-note="${esc(n.title)}" aria-selected="${n.title === o.note}"><td class="time">${esc(shortDay(n.updated))}</td><td class="wide" title="${esc(n.title)}"><a href="#/memory/${encodeURIComponent(n.title)}">${esc(n.title)}</a></td><td>${esc(n.kind)}</td><td>${esc(n.scope)}</td><td class="time">${n.read ? esc(shortDay(n.read)) : "never"}</td><td>${pill(n.status)}</td></tr>`).join("")) + pager(shown.length, all.length, STEP);
}

function renderNoteTools(rows, o) {
  const inKind = ofKind(rows, o.kind), c = statusCounts(inKind), scopes = [...new Set(rows.map((n) => n.scope).filter(Boolean))].sort(), kinds = [...new Set(rows.map((n) => n.kind))].filter((k) => !KNOWLEDGE.includes(k)).sort();
  return filterBar([
    { label: "", name: "status", value: o.status, options: [{ value: "", label: `All ${inKind.length}` }, ...Object.entries(STATUS).map(([k, v]) => ({ value: k, label: `${k === "lint" ? "Lint" : v} ${c[k]}` }))] },
    { label: "Kind", name: "kind", data: true, value: o.kind, options: [{ value: "", label: "Knowledge" }, ...KNOWLEDGE, ...kinds] },
    { label: "Scope", name: "scope", data: true, value: o.scope, options: [{ value: "", label: "All" }, ...scopes] },
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
    list("Sources", sources, (s) => `<code>${esc(s)}</code>`) + list("Links to", n.links ?? [], (l) => link(l.title)) + list("Linked From", n.backlinks ?? [], (l) => link(l.title)) +
    `<p class="hint"><code>${esc(n.path)}</code> · ${`<a href="#/memory/${encodeURIComponent(n.title)}">Open the page</a>`}</p>`;
}

export function renderMemory(m, o = options()) {
  const rows = noteRows(m);
  return `<div class="page sp memory">${pageHead("Memory")}` +
    `<div id="mem-board">${renderTiles(m, rows, o.type)}</div><div id="mem-detail-box">${renderDetail(m, rows, o.type)}</div>` + renderBroad(m) +
    (m.exists ? `<section aria-label="Notes" id="mem-notes">${sectionHead("Notes")}${searchBox("mem-search", o.q, "Search titles, aliases and bodies")}<div id="mem-filters" data-ui="mem-filter">${renderNoteTools(rows, o)}</div>` +
      `<div class="browse"><div class="card" id="mem-table">${renderNoteTable(rows, o, [])}</div><aside class="card ins" id="mem-inspector" aria-label="Note inspector" aria-live="polite">${renderInspector(null)}</aside></div></section>` : "") + `</div>`;
}

let live = null;
const here = () => options(new URLSearchParams(location.hash.split("?")[1] ?? ""));

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
  box.innerHTML = loadingLine("the note");
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
  onTile(root.querySelector("#mem-board"), (type) => {
    setQuery({ type });
    root.querySelector("#mem-board .tiles").outerHTML = renderTiles(m, live.rows, type);
    root.querySelector("#mem-detail-box").innerHTML = renderDetail(m, live.rows, type);
    root.querySelector(`button[data-tile="${type}"]`)?.focus();
  });
  const o = here();
  if (o.q) search(o.q);
  if (o.note) inspect(o.note);
}

if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const t = e.target.closest ? e.target : null;
    if (!t?.closest(".page.memory") || !live) return;
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
  return `<div class="page">${crumb("#/memory", [["memory", "#/memory"], [n.title]])}${pageHead(n.title)}` +
    (n.archived ? `<p class="quiet">Archived.</p>` : "") +
    `<p class="hint"><code>${esc(n.path)}</code></p>` +
    (fm ? `<dl class="facts">${fm}</dl>` : "") +
    `<article class="note">${md(n.body)}</article>` +
    `<section id="links">${head("links", "Links to", n.links.length)}${crumbs(n.links)}</section>` +
    `<section id="backlinks">${head("backlinks", "Linked From", n.backlinks.length)}${crumbs(n.backlinks)}</section></div>`;
}
