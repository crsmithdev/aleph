// The Memory view: one search over the seven memory types. Tiles count the matches of each type and filter by it;
// the results come grouped by type, each type in its own layout; the inspector shows the selected memory, how it
// reaches the agent, when it was written and read, its links, and the writes it takes. Health is at the bottom.
// `renderNote` serves #/memory/<title> too, from the `noteView` route exported in `views` at the bottom of this file.
import { get } from "../router.js";
import { panelOf } from "../chart.js";
import { actButton, fold, linkButton, codeText, dataTable, heads, priorityBadge, barList, barRow, card, crumb, day, empty, error, esc, filterBar, hashQuery, legendHtml, loadingLine, localMs, md, meter, moreFold, pageHead, pager, pct, postJson, say, searchBox, sectionHead, setQuery, statCard, tiles, when, wireScope, scope } from "../lib.js";

export const view = {
  path: "/memory",
  title: "Memory",
  icon: "brain",
  group: "claude",
  order: 1,
  api: (_params, q = new URLSearchParams()) => scope(q).url("/api/memory"),
  live: true,
  render: (m, _params, query) => renderMemory(m, options(query)),
  mount: (root, m) => mount(root, m),
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
  return { q: qs.get("q") ?? "", type: qs.get("type") ?? "", fresh: qs.get("fresh") ?? "", item: qs.get("item") ?? "" };
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
  statCard({ k: t.name, v: t.id === "parametric" || !loaded ? "–" : String(counts[t.id]), note: t.holds, key: t.id, on: t.id === o.type })).join(""));

const sel = (it, o) => `tabindex="0" data-id="${esc(idOf(it))}" aria-selected="${idOf(it) === o.item}"`;
const titleLink = (it) => (it.href ? `<a href="${esc(it.href)}">${esc(it.title)}</a>` : esc(it.title));

/** A note: its claim, its kind and scope, when it was written and last read, and how it reaches the agent. */
const noteRow = (it, o) => `<li class="mrow" ${sel(it, o)}><div class="mh"><b>${titleLink(it)}</b><span class="quiet">${esc([it.kind, it.scope].filter(Boolean).join(" · "))}</span></div>` +
  `<p>${codeText(it.text)}</p><p class="mm">${it.at ? `written ${esc(shortDay(it.at))}` : ""}${it.source === "note" ? ` · read ${it.read ? esc(shortDay(it.read)) : "never"}` : ""}${it.core ? ` · <span class="core">core line</span>` : ""}</p></li>`;

/** A rule, a skill, a hook or a lesson: what it says and when it is loaded. */
export const ruleRow = (it, o) => `<tr class="mrow" ${sel(it, o)}><td class="mono">${titleLink(it)}</td><td class="wide">${codeText(it.text)}</td><td class="eff">${esc(it.effect)}</td><td class="time">${esc(shortDay(it.at))}</td></tr>`;

/** An event in time: when first, then what. */
const eventRow = (it, o) => `<li class="mrow mev" ${sel(it, o)}><span class="time">${esc(shortDay(it.at) || "–")}</span><div><b>${titleLink(it)}</b>${it.scope ? ` ${q(esc(it.scope))}` : ""}<p>${codeText(it.text)}</p></div></li>`;

/** A handoff, an issue or a miss: what it is and what it does next. */
const cardRow = (it, o) => `<li class="mrow" ${sel(it, o)}><div class="mh"><b>${titleLink(it)}${it.priority ? ` ${priorityBadge(it.priority)}` : ""}</b><span class="quiet">${esc([it.scope, it.at && ago(it.at)].filter(Boolean).join(" · "))}</span></div><p>${codeText(it.text)}</p><p class="mm eff">${esc(it.effect)}</p></li>`;

/** Rows past STEP start hidden; the pager in `.mem-page` shows more. */
const hide = (rows) => rows.map((r, i) => (i < STEP ? r : r.replace(/^<(li|tr) /, "<$1 hidden "))).join("");
const list = (rows, cls = "") => `<div class="mem-page"><ul class="mrows${cls}">${hide(rows)}</ul>${pager(Math.min(STEP, rows.length), rows.length, STEP)}</div>`;

const LAYOUT = {
  semantic: (xs, o) => list(xs.map((it) => noteRow(it, o))),
  procedural: (xs, o) => `<div class="mem-page">${dataTable(heads(["Source", "What it says", "Loaded when", "Changed"]), hide(xs.map((it) => ruleRow(it, o))))}${pager(Math.min(STEP, xs.length), xs.length, STEP)}</div>`,
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
    return xs.length ? `<section class="mgroup" aria-label="${esc(t.name)}">${sectionHead(t.name, { level: 3, count: xs.length, aside: dot(t.id) })}${LAYOUT[t.id](xs, o)}</section>` : "";
  }).join("");
}

/** The frame of a note's recalls per day over 30 days, oldest first, from the recall log. The frame's window only names the x label format: one row per day. */
export const recallFrame = (hist = []) => ({
  measure: { name: "Recalls per Day", unit: "count", agg: "sum" },
  over: { kind: "time", window: "week" },
  by: { keys: [{ key: "recalls", name: "Recalls" }] },
  rows: hist.map((n, i) => ({ at: Date.now() - (hist.length - 1 - i) * DAY, recalls: n })),
  legend: false,
});

/** The chart panel of a note's recalls (`inspect` sets its frame), or the line that there were none. */
const recallHistory = (hist = []) => hist.some(Boolean) ? panelOf("memory/recall", recallFrame(hist)) : `<h4>Recall history, 30 days</h4>${empty("No recall in the last 30 days.")}`;

const why = `<input class="mwhy" name="why" placeholder="Why (optional)" aria-label="Why">`;
// `data-mact`, not `data-act`: router.js runs its own command for every `button.act[data-act]`.
const act = (label, a, o = {}) => actButton(label, { mact: a }, o);

/** The writes a memory takes, by where it lives. A rule, a skill or a hook is a file in the repo, so it changes on a branch, not here. */
function actions(it) {
  const file = ["handoff", "episode", "memory-md"].includes(it.source);
  const rows = {
    note: `${act("Edit", "edit", { primary: true })}${why}${act("Archive", "archive")}${act("Delete", "delete", { cls: "danger" })}`,
    "memory-md": act("Edit", "edit", { primary: true }),
    handoff: `${act("Edit", "edit", { primary: true })}${act("Delete", "file-delete", { cls: "danger" })}`,
    episode: `${act("Edit", "edit", { primary: true })}${act("Delete", "file-delete", { cls: "danger" })}`,
    issue: `${act("Drop", "drop", { cls: "danger" })}`,
    proposal: `${act("Approve", "approve", { primary: true })}${act("Decline", "decline")}`,
    miss: `<label class="mform"><span>Add as an alias of</span><input name="target" list="mem-titles" placeholder="Note title"></label>${act("Add alias", "alias", { primary: true })}`,
  }[it.source];
  const ro = ["rules", "skill", "hook"].includes(it.source) ? `<p class="hint">A file in the repo: change it on a branch.</p>` : "";
  return `<div class="macts" data-file="${file}">${rows ?? ""}${it.href && it.source !== "note" ? linkButton("Open", it.href) : ""}</div>${ro}`;
}

/** The note's links out, each with Unlink, the notes that link to it, and a field to add a link. */
const links = (n) => `<h4>Links to</h4>${n.links?.length ? `<ul>${n.links.map((l) => `<li>${link(l.title)} ${actButton("Unlink", { mact: "unlink", target: l.title }, { cls: "small" })}</li>`).join("")}</ul>` : q("None.")}` +
  `<h4>Linked from</h4>${n.backlinks?.length ? `<ul>${n.backlinks.map((l) => `<li>${link(l.title)}</li>`).join("")}</ul>` : q("None.")}` +
  `<div class="mform"><input name="target" list="mem-titles" placeholder="Note title" aria-label="Link to a note">${act("Link", "link")}</div>`;

/** The core line: the note's one line in the start context of its scope. Blank takes the note out. */
const coreForm = (n) => `<label class="mform col"><span>Core line, in every ${esc(n.frontmatter?.scope ?? "")} session's start context</span>` +
  `<input name="core" value="${esc(n.frontmatter?.core ?? "")}" placeholder="None: the note is reached by recall only" maxlength="160"></label>${act("Save core line", "core")}`;

/** The inspector for `it`; `n` is /api/memory/notes/:title's answer when `it` is a note, `hist` its recalls per day. */
export function renderInspector(it, n = null, status = "", hist = []) {
  if (!it) return `<p class="quiet">Select a memory to see what it says, how it reaches the agent and what you can change.</p>`;
  const fm = n?.frontmatter ?? {};
  const head = `<p class="mtype">${dot(it.type)}${esc(typeName(it.type))} · ${esc(it.source === "memory-md" ? "MEMORY.md" : it.source)}${status ? ` · ${esc(STATUS[status])}` : ""}</p><h3>${esc(it.title)}</h3>`;
  // The claim first; the rest of the note folds, so how it reaches the agent stays in view.
  const [claim, ...rest] = (n?.body ?? "").trim().split(/\n\s*\n/);
  const what = n ? `<article class="note">${md(claim)}</article>${rest.length ? `${fold("The whole note", `<article class="note">${md(rest.join("\n\n"))}</article>`, { cls: "fold" })}` : ""}` : `<p>${codeText(it.text)}</p>`;
  const reach = `<div class="mreach"><h4>How it reaches the agent</h4><p>${esc(it.effect)}</p>${n ? coreForm(n) : ""}</div>`;
  const facts = `<dl class="facts">${[["Written", it.at ? esc(shortDay(it.at)) : "–"], ...(it.source === "note" ? [["Last recalled", it.read ? esc(shortDay(it.read)) : "never"], ["Confidence", esc(fm.confidence ?? "–")]] : [["Scope", esc(it.scope || "all")]])].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
  return `${head}${what}${reach}${facts}${it.source === "note" ? recallHistory(hist) : ""}${n ? links(n) : ""}${actions(it)}` +
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
  return (refuse.length ? sectionHead("Refusals", { count: refuse.length, level: 3 }) + `<ul>${refuse.map(f).join("")}</ul>` : "") +
    (warn.length ? sectionHead("Warnings", { count: warn.length, level: 3 }) + `<ul>${warn.map(f).join("")}</ul>` : "") +
    (!refuse.length && !warn.length ? empty("Lint finds nothing.") : "") +
    (med ? `<p>${esc(`${med.recalls} recalls in ${med.days} days, ${med.empty} empty (${pct(med.empty_share * 100)}), ${med.reformulated} reformulated.`)}</p>` : "");
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
    return barRow(esc(k), 0, `${week} · ${older} · ${never} never`, { bar: meter([{ pct: w(week), cls: "c-use" }, { pct: w(older), cls: "c-stale" }, { pct: w(never), cls: "c-never" }], `${week} in the last 7 days, ${older} earlier, ${never} never`) });
  }).join("");
  return lines ? `${legendHtml([["Last 7 days", "c-use"], ["Earlier", "c-stale"], ["Never", "c-never"]])}${barList(lines)}` : empty("No notes yet.");
}

function renderBroad(m, rows) {
  const lint = m.lint ?? { refuse: [], warn: [] }, rules = lintRules(lint), top = Math.max(1, ...rules.map((r) => r.refused + r.warned));
  const lintCard = card("Lint", (rules.length ? barList(rules.map((r, i) => barRow(esc(r.rule), ((r.refused + r.warned) / top) * 100, [r.refused && `${r.refused} refused`, r.warned && `${r.warned} warned`].filter(Boolean).join(", "), { top: i === 0 && r.refused > 0 })).join("")) : empty("Lint finds nothing.")) +
    fold("Every finding", renderHealth(m), { cls: "fold" }), { count: `${lint.refuse.length} refusals, ${lint.warn.length} warnings` });
  const reads = card("When Recall Last Returned Each Note", readChart(rows), { label: "When recall last returned each note" });
  const start = Object.entries(m.start ?? {});
  const budget = card("Start Context", start.length ? barList(start.map(([scope, x]) => barRow(esc(scope), (x.bytes / x.budget) * 100, `${x.bytes} / ${x.budget} bytes, ${x.core.length} core lines${x.cut ? `, ${x.cut} cut` : ""}`)).join("")) : empty("No start context."), { label: "Start context" });
  const writes = card("Recent Writes", renderWrites({ writes: m.writes ?? [] }), { count: (m.writes ?? []).length, label: "Recent writes" });
  return `<div class="pair">${lintCard}${reads}</div><div class="pair">${budget}${writes}</div>`;
}

const projectBar = (m, project) => filterBar([{ label: "Project", name: "project", data: true, value: project, options: [{ value: "", label: "All" }, ...(m.scopes ?? [])] }]);
const freshBar = (o) => filterBar([{ label: "Freshness", name: "fresh", value: o.fresh, options: FRESH }]);

export function renderMemory(m, o = options(), results = null) {
  const status = new Map(noteRows(m).map((n) => [n.title, n.status]));
  const titles = `<datalist id="mem-titles">${(m.notes ?? []).map((n) => `<option value="${esc(n.title)}">`).join("")}</datalist>`;
  return `<div class="page sp memory">${pageHead("Memory", { aside: projectBar(m, m.project ?? "") })}` +
    `<div class="msearch">${searchBox("mem-search", o.q, "Search every kind of memory")}</div>` +
    `<div id="mem-fresh" data-ui="mem-filter">${freshBar(o)}</div>` +
    `<div id="mem-board">${renderTiles(typeCounts(results ?? [], o, status), o, results !== null)}</div>` +
    `<div class="browse"><div id="mem-results" aria-live="polite">${renderResults(results, o, status)}</div>` +
    `<aside class="card ins" id="mem-inspector" aria-label="Memory inspector">${renderInspector(null)}</aside></div>` +
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
  box.innerHTML = `<label class="mform col"><span>The whole text${it.source === "note" ? ", frontmatter first. vault write checks it" : ""}</span><textarea name="text" rows="16" spellcheck="false">${esc(text ?? "")}</textarea></label>` +
    `<div class="macts">${act("Save", "save", { primary: true })}${act("Cancel", "cancel")}</div>`;
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

async function write(btn) {
  const a = btn.dataset.mact, it = live.results?.find((x) => idOf(x) === here().item);
  if (!it) return;
  if (a === "edit") return edit(btn, it);
  if (a === "cancel") { const box = btn.closest(".medit"); box.hidden = true; box.innerHTML = ""; return; }
  if (ARMED.has(a) && btn.dataset.armed !== "1") { btn.dataset.armed = "1"; btn.textContent = `Confirm ${btn.textContent.toLowerCase()}`; return; }
  const ins = btn.closest(".ins"), field = (name) => ins.querySelector(`[name="${name}"]`)?.value ?? "";
  const f = { text: field("text"), core: field("core"), target: field("target"), why: field("why") };
  const [url, body] = WRITES[a](it, f, btn);
  btn.disabled = true;
  try {
    await postJson(url, body);
    if (a === "delete" || a === "file-delete" || a === "drop" || a === "approve" || a === "decline" || a === "archive") setQuery({ item: "" });
    await refresh();
  } catch (e) { say(btn, e.message); btn.disabled = false; }
}

function mount(root, m) {
  live = { root, m, results: null, note: null, status: new Map(noteRows(m).map((n) => [n.title, n.status])) };
  wireScope(root);
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
    const more = t.closest?.(".mem-page button[data-more]");
    if (more) {
      const box = more.closest(".mem-page"), rows = [...box.querySelectorAll(".mrow")], n = rows.filter((r) => !r.hidden).length + Number(more.dataset.more);
      rows.forEach((r, i) => { r.hidden = i >= n; });
      box.querySelector(".pager").outerHTML = pager(n, rows.length, STEP);
      return;
    }
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
  // Enter or Space on a focused row is a click on it; a key on the title's link is left to the link.
  root.onkeydown = (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".mrow")) { e.preventDefault(); e.target.click(); }
  };
  search();
}

const crumbs = (t) => (t.length ? `<ul>${t.map((n) => `<li>${link(n.title)} <span class="hint">${esc([n.kind, n.scope].filter(Boolean).join(" · "))}</span></li>`).join("")}</ul>` : empty("None."));

/** One note: frontmatter, body (Markdown, [[links]] to notes), outgoing links and backlinks. */
export function renderNote(n) {
  const fm = Object.entries(n.frontmatter).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(Array.isArray(v) ? v.join(", ") : v)}</dd></div>`).join("");
  return `<div class="page">${crumb("#/memory", [["memory", "#/memory"], [n.title]])}${pageHead(n.title)}` +
    (n.archived ? `<p class="quiet">Archived.</p>` : "") +
    `<p class="hint"><code>${esc(n.path)}</code></p>` +
    (fm ? `<dl class="facts">${fm}</dl>` : "") +
    `<article class="note">${md(n.body)}</article>` +
    card("Links to", crumbs(n.links), { id: "links", count: n.links.length }) +
    card("Linked from", crumbs(n.backlinks), { id: "backlinks", count: n.backlinks.length }) + `</div>`;
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
