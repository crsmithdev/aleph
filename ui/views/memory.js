// The Memory view: one search over the seven memory types. Tiles count the matches of each type and filter by it;
// the results come grouped by type, each type in its own layout; the inspector shows the selected memory, how it
// reaches the agent, when it was written and read, its links, and the writes it takes. Health is at the bottom.
// `renderNote` serves #/memory/<title> too, from the `noteView` route exported in `views` at the bottom of this file.
import { get } from "../router.js";
import { panelOf } from "../chart.js";
import { detailPanel, panel } from "../timeline.js";
import { actButton, badge, bytes, count, fold, linkButton, codeText, facts, field, inputBox, note, setting, form, meta, heads, pagedTable, priorityBadge, barList, barRow, card, crumb, day, empty, error, esc, filterBar, goQuery, hashQuery, legendHtml, arm, loadingLine, localMs, md, meter, miss, moreFold, pageHead, pager, pct, postJson, say, searchBox, sectionHead, setQuery, statCard, tag, tiles, when, scope } from "../lib.js";

export const view = {
  path: "/memory",
  title: "Memory",
  icon: "brain",
  group: "claude",
  order: 1,
  api: (_params, q = new URLSearchParams()) => scope(q).url(q.get("tab") === "log" ? "/api/memory/log" : "/api/memory"),
  live: true,
  render: (m, _params, query) => (query?.get("tab") === "log" ? renderLog(m, options(query)) : renderMemory(m, options(query))),
  mount: (root, m, query) => (query?.get("tab") === "log" ? mountLog(root) : mount(root, m)),
};

const link = (title) => `<a href="#/memory/${encodeURIComponent(title)}">${esc(title)}</a>`;
const q = (s) => `<span class="quiet">${s}</span>`;
const DAY = 86_400_000, STEP = 50;
const shortDay = (s) => (s ? day(localMs(String(s).slice(0, 10))) : "");
const ago = (ts) => (ts ? esc(when(ts) || String(ts).slice(0, 10)) : "never");

/** The seven types in the page's order: what each holds. Parametric has no rows: aleph does not store the weights. */
export const TYPES = [
  { id: "semantic", name: "Semantic", holds: "notes, MEMORY.md" },
  { id: "procedural", name: "Procedural", holds: "rules, skills, hooks, lessons" },
  { id: "episodic", name: "Episodic", holds: "episodes, daily log, sessions" },
  { id: "working", name: "Working", holds: "handoffs" },
  { id: "prospective", name: "Prospective", holds: "issues with an after" },
  { id: "retrieval", name: "Retrieval", holds: "recall misses" },
  { id: "parametric", name: "Parametric", holds: "model weights, not stored" },
];
const typeName = (id) => TYPES.find((t) => t.id === id)?.name ?? id;
const dot = (type) => `<i class="mdot t-${esc(type)}" aria-hidden="true"></i>`;

const STATUS = { use: "in use", stale: "stale", never: "never read", lint: "lint problem" };
/** A note's status: a refusal first; else in use when recall returned it in the last 7 days, stale when earlier, never when it never did. */
export function noteStatus(n, now = Date.now()) {
  if (n.problems?.length) return "lint";
  if (!n.read) return "never";
  return now - localMs(n.read) <= 7 * DAY ? "use" : "stale";
}
/** The note rows of the overview with their status. */
export const noteRows = (m, now = Date.now()) => (m.notes ?? []).map((n) => ({ ...n, status: noteStatus(n, now) }));

const FRESH = [{ value: "", label: "Any" }, { value: "use", label: "Read in 7 days" }, { value: "never", label: "Never read" }, { value: "old", label: "Not written in 60 days" }, { value: "lint", label: "Lint problem" }];

/** The page's state from the route's query: ?q=text&type=semantic&fresh=never&item=note:Title. */
export function options(qs = new URLSearchParams()) {
  return { q: qs.get("q") ?? "", type: qs.get("type") ?? "", fresh: qs.get("fresh") ?? "", item: qs.get("item") ?? "", kind: qs.get("kind") ?? "" };
}

export const idOf = (it) => `${it.source}:${it.key}`;

/**
 * The results the filters keep. `status` maps a note's title to its status. A read filter keeps notes only, since
 * recall reads nothing else; "old" keeps any memory last written over 60 days ago.
 */
export function keepRows(results, o, status = new Map(), now = Date.now()) {
  const old = (it) => it.at && now - localMs(String(it.at).slice(0, 10)) > 60 * DAY;
  const fresh = {
    "": () => true, old,
    use: (it) => it.source === "note" && status.get(it.key) === "use",
    never: (it) => it.source === "note" && status.get(it.key) === "never",
    lint: (it) => it.source === "note" && status.get(it.key) === "lint",
  }[o.fresh] ?? (() => true);
  return results.filter((it) => (!o.type || it.type === o.type) && fresh(it));
}

/** Matches per type, before the type filter, so a tile shows what choosing it would show. */
export function typeCounts(results, o, status) {
  const rows = keepRows(results, { ...o, type: "" }, status);
  return Object.fromEntries(TYPES.map((t) => [t.id, rows.filter((it) => it.type === t.id).length]));
}

const renderTiles = (counts, o, loaded) => tiles("Memory types", TYPES.map((t) =>
  statCard({ k: t.name, v: t.id === "parametric" || !loaded ? "–" : count(counts[t.id]), note: t.holds, key: t.id, on: t.id === o.type })).join(""));

const sel = (it, o) => `tabindex="0" data-id="${esc(idOf(it))}" aria-selected="${idOf(it) === o.item}"`;
const titleLink = (it) => (it.href ? `<a href="${esc(it.href)}">${esc(it.title)}</a>` : esc(it.title));

/** A note: its claim, its kind and scope, when it was written and last read, and how it reaches the agent. */
const noteRow = (it, o) => `<li class="mrow" ${sel(it, o)}><div class="mh"><b>${titleLink(it)}</b><span class="quiet">${esc([it.kind, it.scope].filter(Boolean).join(" · "))}</span></div>` +
  `<p>${codeText(it.text)}</p><p class="mm">${it.at ? `written ${esc(shortDay(it.at))}` : ""}${it.source === "note" ? ` · read ${it.read ? esc(shortDay(it.read)) : "never"}` : ""}${it.core ? ` · <span class="core">core line</span>` : ""}</p></li>`;

/** A rule, a skill, a hook or a lesson: what it says and when it is loaded. */
export const ruleRow = (it, o) => `<tr class="mrow" ${sel(it, o)}><td class="mono">${titleLink(it)}</td><td class="wide" title="${esc(it.text)}">${codeText(it.text)}</td><td class="eff">${esc(it.effect)}</td><td class="time">${esc(shortDay(it.at))}</td></tr>`;

/** An event in time: when first, then what. */
const eventRow = (it, o) => `<li class="mrow mev" ${sel(it, o)}><span class="time">${shortDay(it.at) ? esc(shortDay(it.at)) : miss("No date")}</span><div><b>${titleLink(it)}</b>${it.scope ? ` ${q(esc(it.scope))}` : ""}<p>${codeText(it.text)}</p></div></li>`;

/** A handoff, an issue or a miss: what it is and what it does next. */
const cardRow = (it, o) => `<li class="mrow" ${sel(it, o)}><div class="mh"><b>${titleLink(it)}${it.priority ? ` ${priorityBadge(it.priority)}` : ""}</b><span class="quiet">${esc([it.scope, it.at && ago(it.at)].filter(Boolean).join(" · "))}</span></div><p>${codeText(it.text)}</p><p class="mm eff">${esc(it.effect)}</p></li>`;

/** Rows past STEP start hidden; the pager turns the page in place, as under `pagedTable()`. */
const hide = (rows) => rows.map((r, i) => (i < STEP ? r : r.replace(/^<li /, "<li hidden "))).join("");
const list = (rows, cls = "") => `<div class="paged" data-step="${STEP}"><ul class="mrows${cls}">${hide(rows)}</ul>${pager(1, rows.length, STEP)}</div>`;

const LAYOUT = {
  semantic: (xs, o) => list(xs.map((it) => noteRow(it, o))),
  procedural: (xs, o) => pagedTable(heads(["Source", "What It Says", "Loaded When", "Updated"], ["Updated"]), xs.map((it) => ruleRow(it, o)), STEP),
  episodic: (xs, o) => list([...xs].sort((a, b) => String(b.at).localeCompare(String(a.at))).map((it) => eventRow(it, o)), " tl"),
  working: (xs, o) => list(xs.map((it) => cardRow(it, o))),
  prospective: (xs, o) => list(xs.map((it) => cardRow(it, o))),
  retrieval: (xs, o) => list(xs.map((it) => cardRow(it, o))),
};

export function renderResults(results, o, status) {
  if (results === null) return loadingLine("memory");
  const rows = keepRows(results, o, status);
  if (!rows.length) return empty(o.q ? `No memory matches “${o.q}”.` : "No memory matches.", "Loosen the filters, or search another word.");
  return TYPES.filter((t) => LAYOUT[t.id]).map((t) => {
    const xs = rows.filter((it) => it.type === t.id);
    return xs.length ? card(t.name, LAYOUT[t.id](xs, o), { level: 3, count: count(xs.length), aside: dot(t.id), cls: "mgroup" }) : "";
  }).join("");
}

/** The frame of a note's recalls per day over 30 days, oldest first, from the recall log. The frame's window only names the x label format: one row per day. */
export const recallFrame = (hist = []) => ({
  measure: { name: "Recalls per Day", unit: "count", agg: "sum" },
  over: { kind: "time", window: "week" },
  by: { keys: [{ key: "recalls", name: "recalls" }] },
  rows: hist.map((n, i) => ({ at: Date.now() - (hist.length - 1 - i) * DAY, recalls: n })),
  legend: false,
});

/** The chart panel of a note's recalls (`inspect` sets its frame), or the line that there were none. */
const recallHistory = (hist = []) => hist.some(Boolean) ? panelOf("memory/recall", recallFrame(hist)) : `<h4>Recall history, 30 days</h4>${empty("No recall in the last 30 days.", "A note shows here once recall returns it.")}`;

const why = field("Why (optional)", inputBox("why"));
// `data-mact`, not `data-act`: router.js runs its own command for every `button.act[data-act]`.
const act = (label, a, o = {}) => actButton(label, { mact: a }, o);

/** The writes a memory takes, by where it lives. A rule, a skill or a hook is a file in the repo, so it changes on a branch, not here. */
function actions(it) {
  const file = ["handoff", "episode", "memory-md"].includes(it.source);
  const rows = {
    note: `${act("Edit", "edit", { primary: true })}${why}${act("Archive", "archive")}${act("Delete", "delete")}`,
    "memory-md": act("Edit", "edit", { primary: true }),
    handoff: `${act("Edit", "edit", { primary: true })}${act("Delete", "file-delete")}`,
    episode: `${act("Edit", "edit", { primary: true })}${act("Delete", "file-delete")}`,
    issue: `${act("Drop", "drop")}`,
    proposal: `${act("Approve", "approve", { primary: true })}${act("Decline", "decline")}`,
    miss: setting("Add as an alias of", inputBox("target", "", { id: "mem-alias", attrs: ' list="mem-titles" placeholder="Note title"' }), { id: "mem-alias", save: "Add alias", attrs: ' data-mact="alias"' }),
  }[it.source];
  const ro = ["rules", "skill", "hook"].includes(it.source) ? note("A file in the repo: change it on a branch.") : "";
  return `<div class="macts" data-file="${file}">${rows ?? ""}${it.href && it.source !== "note" ? linkButton("Open", it.href) : ""}</div>${ro}`;
}

/** The note's links out, each with Unlink, the notes that link to it, and a field to add a link. */
const links = (n) => `<h4>Links to</h4>${n.links?.length ? `<ul>${n.links.map((l) => `<li>${link(l.title)} ${actButton("Unlink", { mact: "unlink", target: l.title })}</li>`).join("")}</ul>` : empty("No links out.", "Add one with the field below.")}` +
  `<h4>Linked from</h4>${n.backlinks?.length ? `<ul>${n.backlinks.map((l) => `<li>${link(l.title)}</li>`).join("")}</ul>` : empty("No note links here.", "A note links here when it names this one in double brackets.")}` +
  setting("Link to a note", inputBox("target", "", { id: "mem-link", attrs: ' list="mem-titles" placeholder="Note title"' }), { id: "mem-link", save: "Link", attrs: ' data-mact="link"' });

/** The core line: the note's one line in the start context of its scope. Blank takes the note out. */
const coreForm = (n) => setting("Core line", inputBox("core", n.frontmatter?.core, { id: "mem-core", attrs: ' placeholder="None: the note is reached by recall only" maxlength="160"' }),
  { id: "mem-core", hint: `In every ${n.frontmatter?.scope ?? ""} session's start context.`, save: "Save core line", attrs: ' data-mact="core"' });

/** The inspector for `it`; `n` is /api/memory/notes/:title's answer when `it` is a note, `hist` its recalls per day. */
export function renderInspector(it, n = null, status = "", hist = []) {
  if (!it) return empty("No memory selected.", "Select a memory to see what it says, how it reaches the agent and what can change.");
  const fm = n?.frontmatter ?? {};
  const head = `<p class="mtype">${dot(it.type)}${esc(typeName(it.type))} · ${esc(it.source === "memory-md" ? "MEMORY.md" : it.source)}${status ? ` · ${badge(STATUS[status])}` : ""}</p><h3>${esc(it.title)}</h3>`;
  // The claim first; the rest of the note folds, so how it reaches the agent stays in view.
  const [claim, ...rest] = (n?.body ?? "").trim().split(/\n\s*\n/);
  const what = n ? `<article class="note">${md(claim)}</article>${rest.length ? `${fold("The whole note", `<article class="note">${md(rest.join("\n\n"))}</article>`, { cls: "fold" })}` : ""}` : `<p>${codeText(it.text)}</p>`;
  const reach = `<div class="mreach"><h4>How it reaches the agent</h4><p>${esc(it.effect)}</p>${n ? coreForm(n) : ""}</div>`;
  const rows = facts([["Written", it.at && esc(shortDay(it.at))], ...(it.source === "note" ? [["Last recalled", it.read ? esc(shortDay(it.read)) : "never"], ["Confidence", esc(fm.confidence ?? "")]] : [["Scope", esc(it.scope || "all")]])]);
  return `${head}${what}${reach}${rows}${it.source === "note" ? recallHistory(hist) : ""}${n ? links(n) : ""}${actions(it)}` +
    (n ? `<p class="hint"><code>${esc(n.path)}</code></p>` : "") + `<div class="medit" hidden></div>`;
}

export function renderWrites(m) {
  return (m.writes.length
    ? moreFold(m.writes, (w) => `${q(esc(when(w.at) || w.at))} ${md(w.text).replace(/^<p>|<\/p>$/g, "")}`)
    : empty("No writes recorded.", "The vault CLI logs each write in the daily note."));
}

function renderHealth(m) {
  const f = (x) => `<li><code>${esc(x.rule)}</code> ${x.note ? link(x.note) : ""} <span class="quiet">${esc(x.detail)}</span></li>`;
  const { refuse, warn } = m.lint;
  const med = m.misses;
  return (refuse.length ? sectionHead("Refusals", { count: count(refuse.length), level: 3 }) + `<ul>${refuse.map(f).join("")}</ul>` : "") +
    (warn.length ? sectionHead("Warnings", { count: count(warn.length), level: 3 }) + `<ul>${warn.map(f).join("")}</ul>` : "") +
    (!refuse.length && !warn.length ? empty("Lint finds nothing.", "Every note passes the vault checks.") : "") +
    (med ? `<p>${esc(`${count(med.recalls)} recalls in ${count(med.days)} days, ${count(med.empty)} empty (${pct(med.empty_share * 100)}), ${count(med.reformulated)} reformulated.`)}</p>` : "");
}

/** Lint by rule, largest first. */
export function lintRules(lint) {
  const add = (m, f, key) => { const r = m.get(f.rule) ?? { rule: f.rule, refused: 0, warned: 0 }; r[key]++; m.set(f.rule, r); };
  const m = new Map();
  for (const f of lint?.refuse ?? []) add(m, f, "refused");
  for (const f of lint?.warn ?? []) add(m, f, "warned");
  return [...m.values()].sort((a, b) => b.refused + b.warned - a.refused - a.warned);
}

const KNOWLEDGE = ["decision", "gotcha", "project", "entity", "concept"];
/** Each knowledge kind's notes by when recall last returned them. */
function readChart(rows) {
  const lines = KNOWLEDGE.map((k) => {
    const of = rows.filter((n) => n.kind === k);
    if (!of.length) return "";
    const week = of.filter((n) => n.read && noteStatus({ read: n.read }) === "use").length, older = of.filter((n) => n.read).length - week, never = of.length - week - older;
    const w = (x) => ((x / of.length) * 100).toFixed(2);
    return barRow(esc(k), 0, `${count(week)} · ${count(older)} · ${count(never)} never`, { bar: meter([{ pct: w(week), cls: "c-use" }, { pct: w(older), cls: "c-stale" }, { pct: w(never), cls: "c-never" }], `${count(week)} in the last 7 days, ${count(older)} earlier, ${count(never)} never`) });
  }).join("");
  return lines ? `${legendHtml([["Last 7 days", "c-use"], ["Earlier", "c-stale"], ["Never", "c-never"]])}${barList(lines)}` : empty("No notes yet.", "Notes show here once the vault holds some.");
}

function renderBroad(m, rows) {
  const lint = m.lint ?? { refuse: [], warn: [] }, rules = lintRules(lint), top = Math.max(1, ...rules.map((r) => r.refused + r.warned));
  const lintCard = card("Lint", (rules.length ? barList(rules.map((r, i) => barRow(esc(r.rule), ((r.refused + r.warned) / top) * 100, [r.refused && `${count(r.refused)} refused`, r.warned && `${count(r.warned)} warned`].filter(Boolean).join(", "), { top: i === 0 && r.refused > 0 })).join("")) : empty("Lint finds nothing.", "Every note passes the vault checks.")) +
    fold("Every finding", renderHealth(m), { cls: "fold" }), { count: count(lint.refuse.length + lint.warn.length) });
  const reads = card("When Recall Last Returned Each Note", readChart(rows), { label: "When recall last returned each note" });
  const start = Object.entries(m.start ?? {});
  const budget = card("Start Context", start.length ? barList(start.map(([scope, x]) => barRow(esc(scope), (x.bytes / x.budget) * 100, `${bytes(x.bytes)} / ${bytes(x.budget)}, ${count(x.core.length)} core lines${x.cut ? `, ${count(x.cut)} cut` : ""}`)).join("")) : empty("No start context.", "A scope with core lines shows its budget here."), { label: "Start context" });
  const writes = card("Recent Writes", renderWrites({ writes: m.writes ?? [] }), { count: count((m.writes ?? []).length), label: "Recent writes" });
  return `<div class="pair">${lintCard}${reads}</div><div class="pair">${budget}${writes}</div>`;
}

const freshBar = (o) => filterBar([{ label: "Freshness", name: "fresh", value: o.fresh, options: FRESH }]);

/** The views of the page: Search and Log are routes (`?tab=`); Context and Processes are not built, so they are not links. */
export function renderTabs(on, project = "") {
  const href = (tab) => { const p = new URLSearchParams(); if (tab) p.set("tab", tab); if (project) p.set("project", project); return `#/memory${p.size ? `?${p}` : ""}`; };
  const t = ([id, label]) => (id === "context" || id === "processes"
    ? `<span class="soon" aria-disabled="true" title="Not built">${label}</span>`
    : `<a href="${href(id)}"${id === on ? ' aria-current="page"' : ""}>${label}</a>`);
  return `<nav class="vtabs" aria-label="Memory views">${[["", "Search"], ["context", "Context"], ["log", "Log"], ["processes", "Processes"]].map(t).join("")}</nav>`;
}

const TONE = { write: "done", recall: "run", miss: "need" };
const KINDS = [{ value: "", label: "All" }, { value: "write", label: "Writes" }, { value: "recall", label: "Recalls" }, { value: "miss", label: "Misses" }];
/** The `when` of a log row: a time for a write or a miss, the day for a recall (the recall log keeps no time). */
const logTime = (at) => (at.length > 10 ? when(at) : shortDay(at));

/** One event of the log. A recall's query opens to the notes it returned, in rank order. */
export function logRow(r) {
  const why = r.kind === "recall"
    ? `<details><summary>${esc(r.why)}</summary><ol>${r.titles.map((t) => `<li>${link(t)}</li>`).join("")}</ol></details>`
    : esc(r.why);
  return `<tr><td class="time">${esc(logTime(r.at))}</td><td>${tag(r.op, TONE[r.kind])}</td>` +
    `<td>${r.note ? link(r.note) : q("none")}${r.titles.length > 1 ? ` ${q(`+${r.titles.length - 1}`)}` : ""}</td><td class="wide">${why}</td></tr>`;
}

/** The Log tab: every write, recall and miss of the last 30 days, newest first, 50 to a page. */
export function renderLog(m, o = options()) {
  const rows = m.rows.filter((r) => !o.kind || r.kind === o.kind);
  return `<div class="page sp memory">${pageHead("Memory", { aside: scope().bar({ project: m.project ?? "" }) })}${renderTabs("log", m.project ?? "")}` +
    `<div id="log-kind" data-ui="log-filter">${filterBar([{ label: "Kind", name: "kind", value: o.kind, options: KINDS }])}</div>` +
    `<div id="log-rows">${logRows(rows)}</div></div>`;
}
const logRows = (rows) => rows.length
  ? pagedTable(heads(["Time", "Kind", "Note", "Why or Query"]), rows.map(logRow), STEP)
  : empty("No events.", "Writes, recalls and misses of the last 30 days show here.");

function mountLog(root) {
  scope().wire(root);
  root.onclick = (e) => {
    const b = e.target.closest?.("#log-kind .seg button");
    if (b) goQuery({ kind: b.dataset.value });
  };
}

export function renderMemory(m, o = options(), results = null) {
  const status = new Map(noteRows(m).map((n) => [n.title, n.status]));
  const titles = `<datalist id="mem-titles">${(m.notes ?? []).map((n) => `<option value="${esc(n.title)}">`).join("")}</datalist>`;
  return `<div class="page sp memory">${pageHead("Memory", { aside: scope().bar({ project: m.project ?? "", more: m.scopes }) })}${renderTabs("", m.project ?? "")}` +
    `<div id="mem-board">${renderTiles(typeCounts(results ?? [], o, status), o, results !== null)}</div>` +
    `<div class="msearch">${searchBox("mem-search", o.q, "Search every kind of memory")}</div>` +
    `<div id="mem-fresh" data-ui="mem-filter">${freshBar(o)}</div>` +
    `<div class="browse"><div id="mem-results" aria-live="polite">${renderResults(results, o, status)}</div>` +
    card("Inspector", `<div id="mem-inspector">${renderInspector(null)}</div>`, { cls: "ins", label: "Memory inspector" }) + `</div>` +
    `<section aria-label="Health" id="mem-health">${sectionHead("Health")}${renderBroad(m, noteRows(m))}</section>${titles}</div>`;
}

let live = null;
const here = () => options(hashQuery());
/** The URL of one note, and of a handoff's, an episode's or MEMORY.md's text. */
const noteUrl = (title, act = "") => `/api/memory/notes/${encodeURIComponent(title)}${act ? `/${act}` : ""}`;
const fileUrl = (it, act = "") => `/api/memory/files/${encodeURIComponent(it.source)}/${encodeURIComponent(it.key)}${act ? `/${act}` : ""}`;

/** True while the Memory page is drawn: `root` is the shell's container, and its handlers outlive the page. Loads need
 * no such check (the router drops an answer that comes after the route changed); a click and a typing pause do. */
const onPage = () => !!live?.root.querySelector(".page.memory");

function redraw() {
  if (!onPage()) return;
  const o = here();
  live.root.querySelector("#mem-fresh").innerHTML = freshBar(o);
  live.root.querySelector("#mem-board").innerHTML = renderTiles(typeCounts(live.results ?? [], o, live.status), o, live.results !== null);
  live.root.querySelector("#mem-results").innerHTML = renderResults(live.results, o, live.status);
}

/** `/api/memory/search` for the query; the router drops an answer that a later query or another page made old. */
async function search() {
  try {
    const res = await get(scope().url(`/api/memory/search?q=${encodeURIComponent(here().q)}`), "mem-search");
    if (!res) return;
    live.results = (await res.json()).results ?? [];
  } catch (e) { live.results = []; live.root.querySelector("#mem-results").innerHTML = error(`Could not search: ${e.message}`); return; }
  redraw();
  if (here().item) inspect(here().item);
}

/** Show `id` in the inspector; a note also loads its body and links. */
async function inspect(id) {
  const box = live?.root.querySelector("#mem-inspector"), it = live?.results?.find((x) => idOf(x) === id);
  if (!box) return;
  if (!it) { box.innerHTML = renderInspector(null); return; }
  if (it.source !== "note") { box.innerHTML = renderInspector(it); return; }
  box.innerHTML = loadingLine("the note");
  try {
    const res = await get(noteUrl(it.key), "mem-note");
    if (!res) return;
    const n = await res.json();
    live.note = res.ok ? n : null;
    const row = live.m.notes?.find((x) => x.title === it.key);
    box.innerHTML = res.ok ? renderInspector(it, n, live.status.get(it.key), row?.history) : error(n.error ?? `answered ${res.status}`, "The note may have left the vault.");
    const chart = box.querySelector("aleph-chart");
    if (chart) chart.frame = recallFrame(row?.history);
  } catch (e) { box.innerHTML = error(`Could not load the note: ${e.message}`); }
}

/** After a write: search again, so every count and row shows the vault as it is now. */
const refresh = () => { live.results = null; redraw(); return search(); };

/** The editor for the selected memory's whole text. */
async function edit(btn, it) {
  const box = btn.closest(".ins").querySelector(".medit");
  const res = it.source === "note" ? null : await get(fileUrl(it), "mem-file");
  if (it.source !== "note" && !res) return;
  const text = it.source === "note" ? live.note?.text : (await res.json()).text;
  box.innerHTML = form("mem-edit", [field("The whole text", `<textarea name="text" rows="16" spellcheck="false">${esc(text ?? "")}</textarea>`, { hint: it.source === "note" ? "Frontmatter first. vault write checks it." : "" })], "Save text", ' data-mact="save"') + act("Cancel", "cancel");
  box.hidden = false;
  box.querySelector("textarea").focus();
}

const WRITES = {
  save: (it, f) => (it.source === "note" ? [noteUrl(it.key, "edit"), { text: f.text }] : [fileUrl(it, "edit"), { text: f.text }]),
  core: (it, f) => [noteUrl(it.key, "core"), { core: f.core }],
  link: (it, f) => [noteUrl(it.key, "link"), { target: f.target }],
  unlink: (it, _f, b) => [noteUrl(it.key, "link"), { target: b.dataset.target, unlink: true }],
  archive: (it, f) => [noteUrl(it.key, "archive"), { why: f.why }],
  delete: (it, f) => [noteUrl(it.key, "delete"), { why: f.why }],
  "file-delete": (it) => [fileUrl(it, "delete"), {}],
  alias: (it, f) => [noteUrl(f.target, "alias"), { alias: it.title }],
  drop: (it) => [`/api/issues/${encodeURIComponent(it.title)}/drop`, {}],
  approve: (it) => [`/api/proposals/${encodeURIComponent(it.key)}/approve`, {}],
  decline: (it) => [`/api/proposals/${encodeURIComponent(it.key)}/decline`, {}],
};
/** A write that removes something asks for a second click. */
const ARMED = new Set(["delete", "file-delete", "drop"]);

async function write(btn, a = btn.dataset.mact) {
  const it = live.results?.find((x) => idOf(x) === here().item);
  if (!it) return;
  if (a === "edit") return edit(btn, it);
  if (a === "cancel") { const box = btn.closest(".medit"); box.hidden = true; box.innerHTML = ""; return; }
  if (ARMED.has(a) && arm(btn, `${btn.textContent} ${it.title}? Click again`)) return;
  const ins = btn.closest(".ins"), field = (name) => ins.querySelector(`[name="${name}"]`)?.value ?? "";
  const f = { text: field("text"), core: field("core"), target: field("target"), why: field("why") };
  const [url, body] = WRITES[a](it, f, btn);
  btn.disabled = true;
  try {
    await postJson(url, body);
    if (a === "delete" || a === "file-delete" || a === "drop" || a === "approve" || a === "decline" || a === "archive") setQuery({ item: "" });
    await refresh();
  } catch (e) { say(btn, `${a} failed: ${e.message}`); btn.disabled = false; }
}

function mount(root, m) {
  live = { root, m, results: null, note: null, status: new Map(noteRows(m).map((n) => [n.title, n.status])) };
  scope().wire(root);
  let timer;
  // Properties, not listeners: `root` is the page container, and each mount replaces the last one's handlers.
  root.oninput = (e) => {
    if (!e.target.matches?.('[data-ui="mem-search"]')) return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (!onPage()) return; setQuery({ q: e.target.value }); live.results = null; redraw(); search(); }, 200);
  };
  root.onclick = (e) => {
    const t = e.target;
    const tile = t.closest?.("#mem-board button[data-tile]");
    if (tile) { setQuery({ type: tile.dataset.tile === here().type ? "" : tile.dataset.tile }); return redraw(); }
    const seg = t.closest?.("#mem-fresh .seg button");
    if (seg) { setQuery({ fresh: seg.dataset.value }); return redraw(); }
    const btn = t.closest?.("#mem-inspector button[data-mact]");
    if (btn) return write(btn);
    const row = t.closest?.(".mrow");
    // A click selects; with a modifier key, the title's link opens its page.
    if (row && !(e.metaKey || e.ctrlKey || e.shiftKey)) {
      e.preventDefault();
      setQuery({ item: row.dataset.id });
      for (const r of root.querySelectorAll(".mrow")) r.setAttribute("aria-selected", String(r === row));
      inspect(row.dataset.id);
      if (innerWidth <= 1100) root.querySelector("#mem-inspector").scrollIntoView({ block: "start" });
    }
  };
  // The forms of the inspector (a core line, a link, an alias, the editor) submit here; Enter in a field submits too.
  root.onsubmit = (e) => {
    const f = e.target.closest?.("#mem-inspector form[data-mact]");
    if (f) { e.preventDefault(); write(e.submitter, f.dataset.mact); }
  };
  // Enter or Space on a focused row is a click on it; a key on the title's link is left to the link.
  root.onkeydown = (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".mrow")) { e.preventDefault(); e.target.click(); }
  };
  search();
}

// A frontmatter key in Title Case: written_by is "Written by", last_verified is "Last Verified" (docs/design.md, Words).
const SMALL = new Set("a an the and but or nor as at by for from in of on per to vs with".split(" "));
const titleKey = (k) => k.split(/[_-]/).map((w, i) => (i && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1))).join(" ");
const crumbs = (t) => `<ul>${t.map((n) => `<li>${link(n.title)}${meta([esc(n.kind), esc(n.scope)])}</li>`).join("")}</ul>`;

/** One note: frontmatter, body (Markdown, [[links]] to notes), outgoing links and backlinks. A panel with no links is left out. */
export function renderNote(n) {
  const fm = Object.entries(n.frontmatter).map(([k, v]) => [titleKey(k), esc(Array.isArray(v) ? v.join(", ") : v)]).filter(([, v]) => v);
  const links = (title, t) => (t.length ? detailPanel(title, esc(count(t.length)), crumbs(t)) : "");
  return `<div class="page dp-page">${crumb("#/memory", [["memory", "#/memory"], [n.title]])}${pageHead(n.title)}` +
    (n.archived ? note("Archived.") : "") +
    note(n.path) +
    (fm.length ? facts(fm) : "") +
    panel("note", "Note", `<div class="md">${md(n.body)}</div>`) +
    links("Links to", n.links) + links("Linked from", n.backlinks) + `</div>`;
}

export const noteView = {
  path: "/memory/:title",
  title: "Note",
  group: "claude",
  api: (params) => noteUrl(params.title),
  live: true,
  render: (n) => renderNote(n),
};
export const views = [view, noteView];
