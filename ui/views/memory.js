// The Memory view, in three views (page.js). Notes: one list surface of the memory types, one type at a time, with the
// inspector of the selected memory. Health: lib/memory-health.js. Log: the writes, recalls and misses of 30 days.
// The attention rows come from /api/attention, by the route.
// `renderNote` serves #/memory/<title> too, from the `noteView` route exported in `views` at the bottom of this file.
import { MEMORY_TYPES, noteHref } from "../../lib/naming.ts";
import { dayOf, flowFrame, isEpisode, link, offered, renderHealth, shortDay } from "./lib/memory-health.js";
import { browse, inspector } from "./lib/browse.js";
import { factsLine, pageViews, viewOf } from "./lib/page.js";
import { postJson, scope } from "./lib/address.js";
import { get, redraw } from "./lib/router.js";
import { detailPanel, panel } from "./lib/timeline.js";
import { count, dur, when } from "./lib/format.js";
import { actButton, arm, badge, chip, crumb, error, esc, facts, field, form, inputBox, md, meta, note, pageHead, say, setting, statusRow, subHead } from "./lib/html.js";

const VIEWS = ["notes", "health", "log"];
// Each view loads what it draws, besides /api/memory.
const LOADS = { notes: ["/api/memory/processes", "/api/memory/search?q="], health: ["/api/memory/processes", "/api/memory/log"], log: ["/api/memory/log"] };

export const view = {
  path: "/memory",
  title: "Memory",
  icon: "brain",
  group: "claude",
  order: 1,
  api: (_params, q = new URLSearchParams()) => [scope(q).url("/api/memory"), ...LOADS[viewOf(q, VIEWS)].map((u) => (u.includes("processes") ? u : scope(q).url(u)))],
  combine: (answers) => Object.assign({}, ...answers),
  live: true,
  render: (m, _params, q = new URLSearchParams()) => pageViews({ title: "Memory", path: "/memory", query: q, views: [
    { id: "notes", label: "Notes", scope: { more: m.scopes, window: false }, draw: () => notesView(m, q) },
    { id: "health", label: "Health", scope: { window: false }, draw: () => renderHealth(m) },
    { id: "log", label: "Log", scope: { window: false }, draw: () => logView(m) },
  ] }),
  mount: (root, m, q = new URLSearchParams()) => {
    scope().wire(root);
    watch?.disconnect();
    if (viewOf(q, VIEWS) === "health") root.querySelector('aleph-chart[key="memory/flow"]').frame = flowFrame(m.rows ?? []);
    if (viewOf(q, VIEWS) === "notes") wire(root, m);
  },
};

const PAGE = 25; // rows of a type that draw before "Show all"
const LOG_ROWS = 100; // rows of the log that draw: a regeneration writes thousands of episode pages in a day
const quiet = (s) => `<span class="quiet">${s}</span>`;
/** A scope chip, and none for the default scope `aleph`. */
const scopeChip = (s) => (s && s !== "aleph" ? chip(s) : "");

const LISTED = MEMORY_TYPES.filter((t) => t.id !== "prospective"); // an issue lives on the Issues page
const offers = (n) => (n?.history ?? []).reduce((a, b) => a + b, 0);
/** The words of a note's state: offered in 7 days, earlier, or never. */
const stateOf = (n, now) => (!n.read ? "never offered" : offered(n, now) ? "in use" : "stale");

const idOf = (it) => `${it.source}:${it.key}`;
const noteUrl = (title, act = "") => `/api/memory/notes/${encodeURIComponent(title)}${act ? `/${act}` : ""}`;
const fileUrl = (it, act = "") => `/api/memory/files/${encodeURIComponent(it.source)}/${encodeURIComponent(it.key)}${act ? `/${act}` : ""}`;

// `data-mact`, not `data-act`: router.js runs its own command for every `button.act[data-act]`.
const act = (label, a, o = {}) => actButton(label, { mact: a }, o);

/** The writes a memory takes, by where it lives. A rule, a skill or a hook is a file in the repo, so it changes on a branch, not here. */
function actions(it) {
  const rows = {
    note: `${act("Edit", "edit", { primary: true })}${field("Why (optional)", inputBox("why"))}${act("Archive", "archive")}${act("Delete", "delete", { kind: "danger" })}`,
    "memory-md": act("Edit", "edit", { primary: true }),
    handoff: `${act("Edit", "edit", { primary: true })}${act("Delete", "file-delete", { kind: "danger" })}`,
  }[it.source];
  if (["rules", "skill", "hook"].includes(it.source)) return note("A file in the repo: change it on a branch.");
  return rows ? `<div data-item="${esc(idOf(it))}"><div class="actions">${rows}</div><div class="medit" hidden></div></div>` : "";
}

/** The note's core line: its one line in the start context of its scope. Blank takes the note out. */
const coreForm = (n) => setting("Core line", inputBox("core", n.frontmatter?.core, { id: "mem-core", attrs: ' maxlength="160"' }),
  { id: "mem-core", save: "Save", stack: true, attrs: ` data-mact="core" title="${esc(`In every ${n.frontmatter?.scope ?? ""} session's start context. Blank takes the note out.`)}"` });

/** The note's links out, each with Unlink, the notes that link to it (each block only when it holds rows), and a field to add a link. */
const links = (n) => (n.links?.length ? `${subHead("Links to")}<ul>${n.links.map((l) => `<li>${link(l.title)} ${actButton("Unlink", { mact: "unlink", target: l.title }, { kind: "small" })}</li>`).join("")}</ul>` : "") +
  (n.backlinks?.length ? `${subHead("Linked from")}<ul>${n.backlinks.map((l) => `<li>${link(l.title)}</li>`).join("")}</ul>` : "") +
  setting("Link to a note", inputBox("target", "", { id: "mem-link", attrs: ' list="mem-titles" placeholder="Note title"' }), { id: "mem-link", save: "Link", attrs: ' data-mact="link"', stack: true });

/** The inspector of one memory: its type and source, its facts, its text, how it reaches the agent, and the writes its source takes. `n` is its /api/memory row when it is a note. */
function inspectItem(it, n, now) {
  const isNote = it.source === "note", type = LISTED.find((t) => t.id === it.type).name;
  const kv = [["Kind", esc(it.kind ?? "")], ["Scope", esc(it.scope)], ["Written", esc(shortDay(it.at))], ["Last offered", isNote ? esc(it.read ? shortDay(it.read) : "never") : ""], ["Offers", offers(n) ? `${count(offers(n))} in 30 days` : ""]];
  return inspector({ id: `${type} · ${it.source}`, title: it.title, status: isNote ? statusRow(badge(stateOf(it, now)), "", "") : "", rows: kv, href: it.href ?? "#/memory",
    body: `<p class="mtext">${esc(it.text)}</p><div class="mreach">${subHead("Reaches the Agent")}<p>${esc(it.effect)}</p></div>` +
      // The core line and the links come from the note's own answer: `fillNote` loads them when the inspector shows it.
      `${isNote ? `<div class="mnote" data-item="${esc(idOf(it))}" data-title="${esc(it.key)}"></div>` : ""}${actions(it)}` });
}

/** The cells each type's row has, after its title and scope chip. */
// prettier-ignore
const LAYOUT = {
  semantic:   { heads: ["Offers", "Offered", "Written"], cells: (it, n) => [offers(n) ? count(offers(n)) : "", it.read ? esc(shortDay(it.read)) : quiet("never"), esc(shortDay(it.at))] },
  procedural: { heads: ["Updated"], cells: (it) => [esc(shortDay(it.at))] },
  episodic:   { heads: [], cells: () => [], tail: (it) => quiet(esc(it.text)) },
  working:    { heads: ["Age"], cells: (it, _n, now) => [esc(dur((now - Date.parse(it.at)) / 1000))] },
};

/** The Notes view: the facts line, then the list surface with a Type filter that opens on semantic. `?all=<type>` shows every row of a type, not its first page. */
function notesView(m, q) {
  const now = Date.now(), byTitle = new Map(m.notes.map((n) => [n.title, n])), results = m.results ?? [];
  const row = (it) => {
    const n = it.source === "note" ? byTitle.get(it.key) : null, L = LAYOUT[it.type];
    return { key: idOf(it), lead: "", main: `<span class="t" title="${esc(it.title)}">${esc(it.title)}</span>${scopeChip(it.scope)}${L.tail?.(it) ?? ""}`,
      cells: L.cells(it, n, now), text: `${it.title} ${it.text} ${it.scope} ${it.kind ?? ""}`, data: { type: it.type }, inspect: () => inspectItem(it, n, now) };
  };
  const groups = LISTED.map((t) => {
    const xs = results.filter((it) => it.type === t.id), all = q.get("all") === t.id;
    const href = new URLSearchParams(q);
    href.set("all", t.id);
    return { title: t.name, count: count(xs.length), heads: LAYOUT[t.id].heads, rows: xs.map(row), cap: all ? undefined : PAGE, more: `<a href="#/memory?${esc(href)}">Show all</a>` };
  });
  const used = m.notes.filter((n) => offered(n, now)).length;
  return factsLine([[count(m.total), "notes"], [count(used), "offered in 7 days"], [count(m.notes.filter((n) => !n.read).length), "never offered"], [count((m.decay?.stale ?? []).length), "past re-check"]]) +
    browse({ id: "memory", label: "Notes", search: "Search memory", filters: [{ label: "Type", name: "type", options: LISTED.map((t) => t.id), value: "semantic" }], groups }) +
    `<datalist id="mem-titles">${m.notes.map((n) => `<option value="${esc(n.title)}">`).join("")}</datalist>`;
}

let watch; // The observer that loads the note of an inspector a row's selection draws.

/** Load the core line and the links of the note that the inspector shows, once. */
async function fillNote(root) {
  const slot = root.querySelector(".ins .mnote:not([data-done])");
  if (!slot) return;
  slot.dataset.done = "";
  try {
    const res = await get(noteUrl(slot.dataset.title), "mem-note");
    if (!res) return;
    const n = await res.json();
    if (!res.ok) throw new Error(n.error ?? `answered ${res.status}`);
    if (slot.isConnected) slot.innerHTML = coreForm(n) + links(n);
  } catch (e) { slot.innerHTML = error("Could not load the note.", { detail: e.message }); }
}

/** The editor for the selected memory's whole text. */
async function edit(btn, it) {
  const box = btn.closest(".ins").querySelector(".medit");
  try {
    const res = await get(it.source === "note" ? noteUrl(it.key) : fileUrl(it), "mem-file");
    if (!res) return;
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `answered ${res.status}`);
    if (typeof body.text !== "string") throw new Error("The text did not load.");
    box.innerHTML = form("mem-edit", [field("The whole text", `<textarea name="text" rows="16" spellcheck="false">${esc(body.text)}</textarea>`, { hint: it.source === "note" ? "Frontmatter first. vault write checks it." : "" })], "Save text", ' data-mact="save"') + act("Cancel", "cancel");
    box.hidden = false;
    box.querySelector("textarea").focus();
  } catch (e) { box.innerHTML = error("Could not load the text.", { detail: e.message }); box.hidden = false; }
}

const WRITES = {
  save: (it, f) => (it.source === "note" ? [noteUrl(it.key, "edit"), { text: f.text }] : [fileUrl(it, "edit"), { text: f.text }]),
  core: (it, f) => [noteUrl(it.key, "core"), { core: f.core }],
  link: (it, f) => [noteUrl(it.key, "link"), { target: f.target }],
  unlink: (it, _f, b) => [noteUrl(it.key, "link"), { target: b.dataset.target, unlink: true }],
  archive: (it, f) => [noteUrl(it.key, "archive"), { why: f.why }],
  delete: (it, f) => [noteUrl(it.key, "delete"), { why: f.why }],
  "file-delete": (it) => [fileUrl(it, "delete"), {}],
};
/** A write that removes something asks for a second click. */
const ARMED = new Set(["delete", "file-delete"]);

/** Run the write `a` of button `btn` on the memory its inspector shows, then draw the page again from the server. */
async function write(btn, m, a = btn.dataset.mact) {
  const it = m.results?.find((x) => idOf(x) === btn.closest("[data-item]")?.dataset.item);
  if (!it) return;
  if (a === "edit") return edit(btn, it);
  if (a === "cancel") { const box = btn.closest(".medit"); box.hidden = true; box.innerHTML = ""; return; }
  if (ARMED.has(a) && arm(btn, `${btn.textContent} ${it.title}? Click again`)) return;
  const ins = btn.closest(".ins"), val = (name) => ins.querySelector(`[name="${name}"]`)?.value ?? "";
  const [url, body] = WRITES[a](it, { text: val("text"), core: val("core"), target: val("target"), why: val("why") }, btn);
  btn.disabled = true;
  try {
    await postJson(url, body);
    await redraw(true);
  } catch (e) { say(btn, `${a} failed: ${e.message}`); btn.disabled = false; }
}

/** The inspector's buttons and forms run their writes; `root` is the page container, and each mount replaces the last one's handlers. */
function wire(root, m) {
  root.onclick = (e) => { const b = e.target.closest?.(".ins button[data-mact]"); if (b) write(b, m); };
  root.onsubmit = (e) => {
    const f = e.target.closest?.(".ins form[data-mact]");
    if (f) { e.preventDefault(); write(e.submitter, m, f.dataset.mact); }
  };
  watch = new MutationObserver(() => fillNote(root));
  watch.observe(root, { childList: true, subtree: true });
  fillNote(root);
}

/** The filter kind of a log row: an episode page's write is its own kind. */
const kindOf = (r) => (isEpisode(r) ? "episode" : r.op);

/** The inspector of one log row: what happened to which note and why, or the query and the notes it returned. */
function inspectLog(r) {
  const recall = r.kind === "recall", at = r.at.length > 10 ? when(r.at) : shortDay(r.at);
  const back = recall && r.titles.length ? `${subHead("Returned")}<ul>${r.titles.map((t) => `<li>${link(t)}</li>`).join("")}</ul>` : "";
  return inspector({ id: kindOf(r), title: r.note || r.why, rows: [["When", esc(at)], ["Returned", recall ? count(r.titles.length) : ""]], href: r.note && !isEpisode(r) ? noteHref(r.note) : "#/memory?view=log",
    body: `${subHead(recall ? "Query" : "Why")}<p class="mtext">${esc(r.why)}</p>${back}` });
}

/** The Log view: the newest rows by day, a Kind filter and the inspector. The recall log keeps a day, a write its time: the lead is the time of a write. */
function logView(m) {
  const all = m.rows ?? [], recalls = all.filter((r) => r.kind === "recall").length;
  const row = (r, i) => ({
    key: `log-${i}`, lead: `<span class="idp">${r.at.length > 10 ? esc(new Date(r.at).toTimeString().slice(0, 5)) : ""}</span>`, data: { kind: kindOf(r) }, inspect: () => inspectLog(r),
    main: `<span class="t" title="${esc(r.why)}">${esc(r.note || r.why)}</span>${r.titles.length > 1 ? quiet(`+${count(r.titles.length - 1)}`) : ""}`,
    cells: [r.op === "recall" ? quiet("recall") : chip(r.op)], text: `${r.note} ${r.why} ${r.op}`,
  });
  const groups = [...Map.groupBy(all.map((r, i) => [r, i]), ([r]) => dayOf(r.at))].map(([d, xs]) => ({ title: shortDay(d), count: count(xs.length), heads: [""], rows: xs.map(([r, j]) => row(r, j)) }));
  return factsLine([[count(recalls), "recalls"], [count(all.length - recalls), "writes"]]) +
    browse({ id: "memory-log", label: "Log", search: "Search the log", filters: [{ label: "Kind", name: "kind", options: [...new Set(all.map(kindOf))] }], groups, cap: LOG_ROWS });
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
