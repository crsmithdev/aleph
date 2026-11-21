// The Memory view, in three tabs. Notes: one search over the memory types, a kind filter with the matches of each, the
// results grouped by type, each type in its own layout, and an inspector for the selected memory: how it reaches the
// agent, when it was written and offered, its links, and the writes it takes. Health and Log: memory-health.js and
// renderLog(). The Needs-you strip heads every tab.
// `renderNote` serves #/memory/<title> too, from the `noteView` route exported in `views` at the bottom of this file.
import { MEMORY_TYPES as TYPES } from "../../lib/naming.ts";
import { get, redraw } from "./lib/router.js";
import { daysBack, dayOf, isEpisode, link, needs, offered, renderHealth, shortDay, writeWeeks } from "./lib/memory-health.js";
import { panelOf } from "./lib/chart.js";
import { detailPanel, panel } from "./lib/timeline.js";
import { goQuery, hashQuery, postJson, setQuery, scope } from "./lib/address.js";
import { count, localMs, when } from "./lib/format.js";
import { actButton, badge, chip, fold, list as stack, linkButton, codeText, facts, field, inputBox, note, setting, form, meta, heads, pagedTable, priorityBadge, card, crumb, empty, error, esc, filterBar, arm, loadingLine, md, miss, pageHead, pager, say, searchBox, subHead } from "./lib/html.js";

export const view = {
  path: "/memory",
  title: "Memory",
  icon: "brain",
  group: "claude",
  order: 1,
  // Every tab draws the Needs-you strip from the overview and the processes; Health and Log read the log too.
  api: (_params, q = new URLSearchParams()) => [scope(q).url("/api/memory"), "/api/memory/processes", ...(TABS.includes(q.get("tab")) ? [scope(q).url("/api/memory/log")] : [])],
  combine: ([m, processes, log]) => ({ ...m, processes, rows: log?.rows }),
  live: true,
  more: (m, query) => (TABS.includes(query.get("tab")) ? m : found(m, query)),
  render: (m, _params, query) => (query?.get("tab") === "health" ? renderHealthTab(m) : query?.get("tab") === "log" ? renderLog(m, options(query)) : renderMemory(m, options(query), m.results ?? null)),
  mount: (root, m, query) => (query?.get("tab") === "health" ? scope().wire(root) : query?.get("tab") === "log" ? mountLog(root, m) : mount(root, m)),
};
const TABS = ["health", "log"];

const q = (s) => `<span class="quiet">${s}</span>`;
const DAY = 86_400_000, STEP = 50;
const ago = (ts) => (ts ? esc(when(ts) || String(ts).slice(0, 10)) : "never");

const typeName = (id) => TYPES.find((t) => t.id === id)?.name ?? id;
const dot = (type) => `<i class="mdot t-${esc(type)}" aria-hidden="true"></i>`;

const STATUS = { use: "in use", stale: "stale", never: "never offered", lint: "lint problem" };
/** A note's status: a refusal first; else in use when recall offered it in the last 7 days, stale when earlier, never when it never did. */
export function noteStatus(n, now = Date.now()) {
  if (n.problems?.length) return "lint";
  if (!n.read) return "never";
  return offered(n, now) ? "use" : "stale";
}
/** The note rows of the overview with their status. */
export const noteRows = (m, now = Date.now()) => (m.notes ?? []).map((n) => ({ ...n, status: noteStatus(n, now) }));

const FRESH = [{ value: "", label: "All" }, { value: "use", label: "Offered in 7 days" }, { value: "never", label: "Never offered" }, { value: "old", label: "Not written in 60 days" }, { value: "lint", label: "Lint" }];

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

/** Matches per type, before the type filter, so an option shows what choosing it would show. */
export function typeCounts(results, o, status) {
  const rows = keepRows(results, { ...o, type: "" }, status);
  return Object.fromEntries(TYPES.map((t) => [t.id, rows.filter((it) => it.type === t.id).length]));
}

/** The Kind filter, each option with its matches once the search is in. */
function kindBar(results, o, status) {
  const n = results ? typeCounts(results, o, status) : null, all = n && Object.values(n).reduce((a, b) => a + b, 0);
  const label = (name, k) => (n ? `${name} ${count(k)}` : name);
  return filterBar([{ label: "Kind", name: "type", value: o.type, options: [{ value: "", label: label("All", all) }, ...TYPES.map((t) => ({ value: t.id, label: label(t.name, n?.[t.id]) }))] }]);
}

const sel = (it, o) => `tabindex="0" data-id="${esc(idOf(it))}" aria-selected="${idOf(it) === o.item}"`;
const titleLink = (it) => (it.href ? `<a href="${esc(it.href)}">${esc(it.title)}</a>` : esc(it.title));

/** A note: its claim, its kind and scope, when it was written and last read, and how it reaches the agent. */
const noteRow = (it, o) => `<li class="mrow" ${sel(it, o)}><div class="mh"><b>${titleLink(it)}</b><span class="quiet">${esc([it.kind, it.scope].filter(Boolean).join(" · "))}</span></div>` +
  `<p>${codeText(it.text)}</p><p class="mm">${it.at ? `written ${esc(shortDay(it.at))}` : ""}${it.source === "note" ? ` · offered ${it.read ? esc(shortDay(it.read)) : "never"}` : ""}${it.core ? ` · <span class="core">core line</span>` : ""}</p></li>`;

/** A rule, a skill, a hook or a lesson: what it says and when it is loaded. */
export const ruleRow = (it, o) => `<tr class="mrow" ${sel(it, o)}><td class="mono">${titleLink(it)}</td><td class="wide" title="${esc(it.text.replaceAll("`", ""))}">${codeText(it.text)}</td><td title="${esc(it.effect)}">${esc(it.effect)}</td><td class="time">${esc(shortDay(it.at))}</td></tr>`;

/** An event in time: when first, then what. */
const eventRow = (it, o) => `<li class="mrow mev" ${sel(it, o)}><span class="time">${shortDay(it.at) ? esc(shortDay(it.at)) : miss("No date")}</span><div><b>${titleLink(it)}</b>${it.scope ? ` ${q(esc(it.scope))}` : ""}<p>${codeText(it.text)}</p></div></li>`;

/** A handoff or an issue: what it is and what it does next. `shared` leaves the effect out: the inspector gives it. */
const cardRow = (it, o, shared = false) => `<li class="mrow" ${sel(it, o)}><div class="mh"><b>${titleLink(it)}${it.priority ? ` ${priorityBadge(it.priority)}` : ""}</b><span class="quiet">${esc([it.scope, it.at && ago(it.at)].filter(Boolean).join(" · "))}</span></div><p>${codeText(it.text)}</p>${shared ? "" : `<p class="mm eff">${esc(it.effect)}</p>`}</li>`;

/** Rows past STEP start hidden; the pager turns the page in place, as under `pagedTable()`. */
const hide = (rows) => rows.map((r, i) => (i < STEP ? r : r.replace(/^<li /, "<li hidden "))).join("");
const list = (rows, cls = "") => `<div class="paged" data-step="${STEP}"><ul class="mrows${cls}">${hide(rows)}</ul>${rows.length > STEP ? pager(1, rows.length, STEP) : ""}</div>`;

const LAYOUT = {
  semantic: (xs, o) => list(xs.map((it) => noteRow(it, o))),
  procedural: (xs, o) => pagedTable(heads(["Source", "What It Says", "Loaded When", "Updated"], ["Updated"]), xs.map((it) => ruleRow(it, o)), STEP),
  episodic: (xs, o) => list([...xs].sort((a, b) => String(b.at).localeCompare(String(a.at))).map((it) => eventRow(it, o)), " tl"),
  working: (xs, o) => list(xs.map((it) => cardRow(it, o, xs.length > 1 && xs.every((x) => x.effect === xs[0].effect)))),
  prospective: (xs, o) => list(xs.map((it) => cardRow(it, o))),
};

export function renderResults(results, o, status) {
  if (results === null) return loadingLine("memory");
  const rows = keepRows(results, o, status);
  if (!rows.length) return empty();
  return stack(TYPES.filter((t) => LAYOUT[t.id]).map((t) => {
    const xs = rows.filter((it) => it.type === t.id);
    return xs.length ? card(t.name, LAYOUT[t.id](xs, o), { level: 3, count: count(xs.length) }) : "";
  }).join(""));
}

/** The frame of a note's offers per day over 30 days, oldest first, from the recall log. The frame's window only names the x label format: one row per day. */
export const recallFrame = (hist = []) => ({
  measure: { name: "Offers per Day", unit: "count", agg: "sum" },
  over: { kind: "time", window: "week" },
  by: { keys: [{ key: "recalls", name: "offers" }] },
  rows: hist.map((n, i) => ({ at: Date.now() - (hist.length - 1 - i) * DAY, recalls: n })),
  legend: false,
});

/** The chart panel of a note's offers (`mount` sets its frame), or nothing when there were none. */
const recallHistory = (hist = []) => hist.some(Boolean) ? panelOf("memory/recall", recallFrame(hist)) : "";

const why = field("Why (optional)", inputBox("why"));
// `data-mact`, not `data-act`: router.js runs its own command for every `button.act[data-act]`.
const act = (label, a, o = {}) => actButton(label, { mact: a }, o);

/** The writes a memory takes, by where it lives. A rule, a skill or a hook is a file in the repo, so it changes on a branch, not here. */
function actions(it) {
  const rows = {
    note: `${act("Edit", "edit", { primary: true })}${why}${act("Archive", "archive")}${act("Delete", "delete", { kind: "danger" })}`,
    "memory-md": act("Edit", "edit", { primary: true }),
    handoff: `${act("Edit", "edit", { primary: true })}${act("Delete", "file-delete", { kind: "danger" })}`,
    issue: `${act("Drop", "drop", { cls: "warn" })}`,
  }[it.source];
  const ro = ["rules", "skill", "hook"].includes(it.source) ? note("A file in the repo: change it on a branch.") : "";
  return `<div class="actions">${rows ?? ""}${it.href && it.source !== "note" ? linkButton("Open", it.href) : ""}</div>${ro}`;
}

/** The note's links out, each with Unlink, the notes that link to it (each block only when it holds rows), and a field to add a link. */
const links = (n) => (n.links?.length ? `${subHead("Links to")}<ul>${n.links.map((l) => `<li>${link(l.title)} ${actButton("Unlink", { mact: "unlink", target: l.title }, { kind: "small" })}</li>`).join("")}</ul>` : "") +
  (n.backlinks?.length ? `${subHead("Linked from")}<ul>${n.backlinks.map((l) => `<li>${link(l.title)}</li>`).join("")}</ul>` : "") +
  setting("Link to a note", inputBox("target", "", { id: "mem-link", attrs: ' list="mem-titles" placeholder="Note title"' }), { id: "mem-link", save: "Link", attrs: ' data-mact="link"', stack: true });

/** The core line: the note's one line in the start context of its scope. Blank takes the note out. */
const coreForm = (n) => setting("Core line", inputBox("core", n.frontmatter?.core, { id: "mem-core", attrs: ' maxlength="160"' }),
  { id: "mem-core", save: "Save", stack: true, attrs: ` data-mact="core" title="${esc(`In every ${n.frontmatter?.scope ?? ""} session's start context. Blank takes the note out.`)}"` });

/** The inspector for `it`; `n` is /api/memory/notes/:title's answer when `it` is a note, `hist` its recalls per day. */
export function renderInspector(it, n = null, status = "", hist = []) {
  if (!it) return empty("Select a memory");
  const fm = n?.frontmatter ?? {};
  const head = `<p class="mtype">${dot(it.type)}${esc(typeName(it.type))} · ${esc(it.source === "memory-md" ? "MEMORY.md" : it.source)}${status ? ` · ${badge(STATUS[status])}` : ""}</p><h3>${esc(it.title)}</h3>`;
  // The claim first; the rest of the note folds, so how it reaches the agent stays in view.
  const [claim, ...rest] = (n?.body ?? "").trim().split(/\n\s*\n/);
  const what = n ? `<article class="note">${md(claim)}</article>${rest.length ? `${fold("The whole note", `<article class="note">${md(rest.join("\n\n"))}</article>`, { cls: "fold" })}` : ""}` : `<p>${codeText(it.text)}</p>`;
  const reach = `<div class="mreach">${subHead("How it reaches the agent")}<p>${esc(it.effect)}</p>${n ? coreForm(n) : ""}</div>`;
  const rows = facts([["Written", it.at && esc(shortDay(it.at))], ...(it.source === "note" ? [["Last offered", it.read ? esc(shortDay(it.read)) : "never"], ["Confidence", esc(fm.confidence ?? "")]] : [["Scope", esc(it.scope || "all")]])]);
  return `${head}${what}${reach}${rows}${it.source === "note" ? recallHistory(hist) : ""}${n ? links(n) : ""}${actions(it)}` +
    (n ? `<p class="hint"><code>${esc(n.path)}</code></p>` : "") + `<div class="medit" hidden></div>`;
}

/** The Freshness filter, each option but All with the notes it keeps among the results. */
function freshBar(results, o, status) {
  const n = (value) => (results ? ` ${count(keepRows(results, { ...o, fresh: value }, status).length)}` : "");
  return filterBar([{ label: "Freshness", name: "fresh", value: o.fresh, options: FRESH.map((f) => ({ ...f, label: f.value ? f.label + n(f.value) : f.label })) }]);
}

/** The views of the page: Notes, Health and Log are routes (`?tab=`). */
export function renderTabs(on, project = "") {
  const href = (tab) => { const p = new URLSearchParams(); if (tab) p.set("tab", tab); if (project) p.set("project", project); return `#/memory${p.size ? `?${p}` : ""}`; };
  const t = ([id, label]) => `<a href="${href(id)}"${id === on ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<nav class="vtabs" aria-label="Memory views">${[["", "Notes"], ["health", "Health"], ["log", "Log"]].map(t).join("")}</nav>`;
}

/** The head of every tab: the title, the scope, the tabs and the Needs-you strip. */
const head = (m, on, more) => `${pageHead("Memory", { aside: scope().bar({ project: m.project ?? "", more }) })}${renderTabs(on, m.project ?? "")}${needs(m)}`;

const KINDS = [{ value: "", label: "All" }, { value: "write", label: "Writes" }, { value: "episode", label: "Episode pages" }, { value: "recall", label: "Recalls" }];
/** A log row's filter kind: an episode page's write is its own kind. */
const kindOf = (r) => (isEpisode(r) ? "episode" : r.kind);
/** The `when` of a log row: a time for a write or a miss, the day for a recall (the recall log keeps no time). */
const logTime = (at) => (at.length > 10 ? when(at) : shortDay(at));

/** One event of the log. A recall's query opens to the notes it returned, in rank order. An episode page is no note, so it gets no link. */
export function logRow(r) {
  const name = isEpisode(r) ? esc(r.note) : link(r.note);
  const why = r.kind === "recall"
    ? `<details><summary title="${esc(r.why)}">${esc(r.why)}</summary><ol>${r.titles.map((t) => `<li>${link(t)}</li>`).join("")}</ol></details>`
    : esc(r.why);
  return `<tr><td class="time lead">${esc(logTime(r.at))}</td><td>${chip(r.op)}</td>` +
    `<td>${r.note ? name : miss("No note")}${r.titles.length > 1 ? ` ${q(`+${r.titles.length - 1}`)}` : ""}</td><td class="wide" title="${esc(r.why)}">${why}</td></tr>`;
}

/** The frame of the log rows that `keep` keeps, per local day over the last `n` days, oldest first. */
export function dayFrame(rows, keep, n, name, now = Date.now()) {
  const days = Array.from({ length: n }, (_, i) => daysBack(n - 1 - i, now)), per = Map.groupBy(rows.filter(keep), (r) => dayOf(r.at));
  return { measure: { name, unit: "count", agg: "sum" }, over: { kind: "time", window: "month" }, by: { keys: [{ key: "n", name: "rows" }] }, rows: days.map((d) => ({ at: localMs(d), n: per.get(d)?.length ?? 0 })), legend: false };
}
/** The Log tab's charts: key, frame. Episode pages have their own chart: a regeneration writes thousands in a day. */
const logCharts = (rows) => [
  ["memory/writes", dayFrame(rows, (r) => r.kind === "write" && !isEpisode(r), 30, "Note Writes per Day")],
  ["memory/episode-writes", dayFrame(rows, isEpisode, 30, "Episode Page Writes per Day")],
  ["memory/recalls", dayFrame(rows, (r) => r.kind === "recall", 8, "Recall Runs per Day")],
];

/** The Log tab: the charts, then every write, recall and miss of the last 30 days, newest first, 50 to a page. */
export function renderLog(m, o = options()) {
  const all = m.rows ?? [], rows = all.filter((r) => !o.kind || kindOf(r) === o.kind), w = writeWeeks(all);
  const charts = logCharts(all).map(([key, f]) => panelOf(key, f)).join("");
  return `<div class="page sp memory">${head(m, "log")}` +
    stack(`${charts}${note(`${count(w.week)} note writes in the last 7 days; the median week of the 3 before had ${count(w.median)} (${count(w.lo)} to ${count(w.hi)}).`)}`) +
    `<div id="log-kind" data-ui="log-filter">${filterBar([{ label: "Kind", name: "kind", value: o.kind, options: KINDS }])}</div>` +
    `<div id="log-rows">${logRows(rows)}</div></div>`;
}
const logRows = (rows) => rows.length
  ? pagedTable(heads(["Time", "Kind", "Note", "Why or Query"]), rows.map(logRow), STEP)
  : empty();

function mountLog(root, m) {
  scope().wire(root);
  for (const [key, f] of logCharts(m.rows ?? [])) root.querySelector(`aleph-chart[key="${key}"]`).frame = f;
  root.onclick = (e) => {
    const b = e.target.closest?.("#log-kind .seg button");
    if (b) goQuery({ kind: b.dataset.value });
  };
}

/** The Health tab: the head around the body of `renderHealth`. */
export const renderHealthTab = (m) => `<div class="page sp memory">${head(m, "health")}${renderHealth(m)}</div>`;

export function renderMemory(m, o = options(), results = null) {
  const status = new Map(noteRows(m).map((n) => [n.title, n.status]));
  const it = results?.find((x) => idOf(x) === o.item), n = m.note?.error ? null : m.note;
  const inspector = m.note?.error ? error("Could not load the note.", { detail: m.note.error }) : renderInspector(it ?? null, n, n && status.get(it.key), m.notes?.find((x) => x.title === it?.key)?.history);
  const titles = `<datalist id="mem-titles">${(m.notes ?? []).map((n) => `<option value="${esc(n.title)}">`).join("")}</datalist>`;
  const found = results && !m.failed ? results : null;
  return `<div class="page sp memory">${head(m, "", m.scopes)}` +
    `<div id="mem-kind" data-ui="mem-filter">${kindBar(found, o, status)}</div>` +
    `<div class="msearch">${searchBox("mem-search", o.q, "Search every kind of memory")}</div>` +
    `<div id="mem-fresh" data-ui="mem-filter">${freshBar(found, o, status)}</div>` +
    `<div class="browse"><div id="mem-results" aria-live="polite">${m.failed ? error("Could not load the search.", { detail: m.failed }) : renderResults(results, o, status)}</div>` +
    card("Inspector", `<div id="mem-inspector">${inspector}</div>`, { cls: "ins", label: "Memory inspector" }) + `</div>${titles}</div>`;
}

const here = () => options(hashQuery());
/** The URL of one note, and of a handoff or MEMORY.md text. */
const noteUrl = (title, act = "") => `/api/memory/notes/${encodeURIComponent(title)}${act ? `/${act}` : ""}`;
const fileUrl = (it, act = "") => `/api/memory/files/${encodeURIComponent(it.source)}/${encodeURIComponent(it.key)}${act ? `/${act}` : ""}`;

/** True while the Memory page is drawn: `root` is the shell's container, and its handlers outlive the page. Loads need
 * no such check (the router drops an answer that comes after the route changed); a click and a typing pause do. */
const onPage = (root) => !!root.querySelector(".page.memory");

/** A note's `/api/memory/notes/:title` answer, or `{ error }`; null when a later load made it old. */
async function noteOf(title) {
  try {
    const res = await get(noteUrl(title), "mem-note");
    if (!res) return null;
    const n = await res.json();
    return res.ok ? n : { error: n.error ?? `answered ${res.status}` };
  } catch (e) { return { error: e.message }; }
}

/** `m` with `/api/memory/search` for the query as `results`, and the selected note as `note`; a failed search gives `failed`. The router drops an answer that a later query or another page made old. */
async function found(m, query) {
  const o = options(query);
  try {
    const res = await get(scope(query).url(`/api/memory/search?q=${encodeURIComponent(o.q)}`), "mem-search");
    if (!res) return m;
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `answered ${res.status}`);
    const results = body.results ?? [], it = results.find((x) => idOf(x) === o.item);
    return { ...m, results, note: it?.source === "note" ? await noteOf(it.key) : null };
  } catch (e) { return { ...m, results: [], failed: e.message }; }
}

/** The editor for the selected memory's whole text. */
async function edit(btn, it, note) {
  const box = btn.closest(".ins").querySelector(".medit");
  let text = note?.text;
  try {
    if (it.source !== "note") {
      const res = await get(fileUrl(it), "mem-file");
      if (!res) return;
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `answered ${res.status}`);
      text = body.text;
    }
    if (typeof text !== "string") throw new Error("The text did not load.");
  } catch (e) { box.innerHTML = error("Could not load the text.", { detail: e.message }); box.hidden = false; return; }
  box.innerHTML = form("mem-edit", [field("The whole text", `<textarea name="text" rows="16" spellcheck="false">${esc(text)}</textarea>`, { hint: it.source === "note" ? "Frontmatter first. vault write checks it." : "" })], "Save text", ' data-mact="save"') + act("Cancel", "cancel");
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
};
/** A write that removes something asks for a second click. */
const ARMED = new Set(["delete", "file-delete", "drop"]);

async function write(btn, m, a = btn.dataset.mact) {
  const it = m.results?.find((x) => idOf(x) === here().item);
  if (!it) return;
  if (a === "edit") return edit(btn, it, m.note);
  if (a === "cancel") { const box = btn.closest(".medit"); box.hidden = true; box.innerHTML = ""; return; }
  if (ARMED.has(a) && arm(btn, `${btn.textContent} ${it.title}? Click again`)) return;
  const ins = btn.closest(".ins"), field = (name) => ins.querySelector(`[name="${name}"]`)?.value ?? "";
  const f = { text: field("text"), core: field("core"), target: field("target"), why: field("why") };
  const [url, body] = WRITES[a](it, f, btn);
  btn.disabled = true;
  try {
    await postJson(url, body);
    if (a === "delete" || a === "file-delete" || a === "drop" || a === "archive") setQuery({ item: "" });
    await redraw(true);
  } catch (e) { say(btn, `${a} failed: ${e.message}`); btn.disabled = false; }
}

function mount(root, m) {
  scope().wire(root);
  const chart = root.querySelector("#mem-inspector aleph-chart");
  if (chart) chart.frame = recallFrame(m.notes?.find((x) => x.title === m.results?.find((r) => idOf(r) === here().item)?.key)?.history);
  let timer;
  // Properties, not listeners: `root` is the page container, and each mount replaces the last one's handlers.
  root.oninput = (e) => {
    if (!e.target.matches?.('[data-ui="mem-search"]')) return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (!onPage(root)) return; setQuery({ q: e.target.value }); redraw(true); }, 200);
  };
  root.onclick = (e) => {
    const t = e.target;
    const seg = t.closest?.("#mem-kind .seg button, #mem-fresh .seg button");
    if (seg) { setQuery({ [seg.closest(".seg").dataset.name]: seg.dataset.value }); return redraw(); }
    const btn = t.closest?.("#mem-inspector button[data-mact]");
    if (btn) return write(btn, m);
    const row = t.closest?.(".mrow");
    // A click selects; with a modifier key, the title's link opens its page.
    if (row && !(e.metaKey || e.ctrlKey || e.shiftKey)) {
      e.preventDefault();
      setQuery({ item: row.dataset.id });
      redraw(true).then(() => { if (onPage(root) && innerWidth <= 1100) root.querySelector("#mem-inspector").scrollIntoView({ block: "start" }); });
    }
  };
  // The forms of the inspector (a core line, a link, an alias, the editor) submit here; Enter in a field submits too.
  root.onsubmit = (e) => {
    const f = e.target.closest?.("#mem-inspector form[data-mact]");
    if (f) { e.preventDefault(); write(e.submitter, m, f.dataset.mact); }
  };
  // Enter or Space on a focused row is a click on it; a key on the title's link is left to the link.
  root.onkeydown = (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".mrow")) { e.preventDefault(); e.target.click(); }
  };
}

// A frontmatter key in sentence case: written_by is "Written by", last_verified is "Last verified" (docs/design.md, Words).
const titleKey = (k) => { const s = k.split(/[_-]/).join(" "); return s[0].toUpperCase() + s.slice(1); };
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
