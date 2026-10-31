// The Inventory view: the state to browse, not the process: every project and every issue of every repo,
// three tables and a form that files an issue. `data` is /api/contents: { issues, projects, specs }.
// The issue detail (renderIssue) is shared with views/issue.js.
import { badge, chips, crumb, empty, esc, filterBar, idLink, labelName, localId, md, pageHead, pager, sortHead, when } from "../lib.js";

export const X_ICON = `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

const CONFIRM_MS = 5000;
/**
 * The X's two clicks: the first arms the button, the second within 5 s sends `target`
 * ({ url, body }); `done(json)` runs on success, the error shows in the row's `msg` cell.
 */
export async function confirmCancel(btn, msg, target, done) {
  if (!btn.dataset.armed) {
    btn.dataset.armed = "1"; btn.title = "Click again to confirm"; btn.classList.add("arm"); msg.textContent = "";
    setTimeout(() => { if (!btn.isConnected || btn.dataset.sent) return; delete btn.dataset.armed; btn.title = "Stop or drop"; btn.classList.remove("arm"); }, CONFIRM_MS);
    return;
  }
  if (btn.dataset.sent) return;
  btn.dataset.sent = "1"; btn.disabled = true; msg.className = "cmsg"; msg.textContent = "Cancelling…";
  try {
    const res = await fetch(target.url, { method: "POST", headers: { "content-type": "application/json", "x-aleph-ui": "1" }, body: JSON.stringify(target.body) });
    const j = await res.json().catch(() => ({}));
    const err = !res.ok ? (j.error ?? `HTTP ${res.status}`) : j.code ? (j.stderr || j.stdout || `aleph exited ${j.code}`).trim() : "";
    if (err) throw new Error(err);
    done(j);
  } catch (x) {
    delete btn.dataset.sent; delete btn.dataset.armed; btn.disabled = false; btn.title = "Stop or drop"; btn.classList.remove("arm");
    msg.className = "cmsg err"; msg.textContent = x?.message ?? String(x);
  }
}

export const view = {
  path: "/inventory",
  title: "Inventory",
  group: "factory",
  order: 1,
  api: "/api/contents",
  render: (d, _params, query) => renderContents(d, hashOptions(query)),
  mount: (root, d) => mount(root, d),
};

/** The old Issues address: `#/issues`, `#/projects` and `#/contents` become `#/inventory` . The detail routes are left alone. */
export function redirect(hash) {
  const path = String(hash ?? "").replace(/^#/, "").split("?")[0].replace(/\/$/, "");
  return path === "/issues" || path === "/projects" || path === "/contents" ? "#/inventory" : null;
}

// Only what nothing shared covers: the whole-row link and the X button.
const STYLE_CONTENTS = `<style>
.contents .cols { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0 32px; align-items: start; }
.contents .cols > * { min-width: 0; }
.contents .side-col .tbl td, .contents .side-col .tbl th { padding-left: 8px; padding-right: 8px; }
.contents .sub { display: block; font: var(--fs-xs) var(--sans); color: var(--muted); }
@media (min-width: 1200px) {
  .contents .cols { grid-template-columns: minmax(0, 1fr) 360px; }
}
.contents tr.crow { position: relative; }
.contents td.wide a { color: inherit; text-decoration: none; }
.contents td.wide a::after { content: ""; position: absolute; inset: 0; }
.contents tr.crow:hover td.wide a, .contents td.wide a:focus-visible { text-decoration: underline; }
.contents td a.idl, .contents td.drop { position: relative; z-index: 1; }
.contents td.drop { width: 28px; padding: 0; text-align: right; }
.contents .cancel { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px; color: var(--muted); cursor: pointer; }
.contents .cancel svg { width: 14px; height: 14px; pointer-events: none; }
.contents .cancel:hover { color: var(--stuck); background: var(--rule-2); }
.contents .cancel:focus-visible { color: var(--stuck); outline: 2px solid currentColor; outline-offset: 1px; }
.contents .cancel.arm { color: var(--stuck); background: var(--rule-2); }
.contents .cancel[disabled] { opacity: .5; cursor: default; }
.contents .cmsg { position: absolute; right: 30px; top: 50%; transform: translateY(-50%); font: var(--fs-xs) var(--sans); color: var(--muted); background: var(--bg); white-space: nowrap; }
.contents .cmsg.err { color: var(--stuck); }
</style>`;

/** A section heading, the same as the rest of the UI: the h2 and a muted count. */
const section = (title, n) => `<div class="sh"><h2>${esc(title)}</h2><span class="count">${n}</span></div>`;

/** The Issues table shows this many rows, and this many more for each press of the pager's button. */
export const PAGE = 50;

/** The Status filter's default is Open; "any" (the Any option) shows every status. */
export const DEFAULT_STATUS = "open";
const statusOf = (s) => (s === null || s === undefined || s === "" ? DEFAULT_STATUS : s === "any" ? "" : s);

/** The filters and sorts, from the route's query: ?status=open&project=x&label=x&q=text&sort=title&dir=asc (the Issues table), &psort=open&pdir=desc (the Projects table), &ssort=date&sdir=desc (the Specs table), &limit=100 (the Issues rows shown). */
export function hashOptions(q = new URLSearchParams()) {
  return {
    limit: Math.max(PAGE, Number.parseInt(q.get("limit"), 10) || PAGE),
    status: statusOf(q.get("status")), project: q.get("project") ?? "", label: q.get("label") ?? "", q: q.get("q") ?? "",
    sort: { key: q.get("sort") || "updated", dir: q.get("dir") === "asc" ? 1 : -1 },
    psort: { key: q.get("psort") || "updated", dir: q.get("pdir") === "asc" ? 1 : -1 },
    ssort: { key: q.get("ssort") || "date", dir: q.get("sdir") === "asc" ? 1 : -1 },
  };
}

export const ref = (r) => `${r.repo}-${r.id}`;
export const href = (r) => `#/issues/${encodeURIComponent(r.repo)}/${r.id}`;
const projectHref = (p) => `#/projects/${encodeURIComponent(p.key)}`;
const stateBadge = (s) => badge(s);

const ms = (s) => Date.parse(s) || 0;

/** The issue rows from the API data. */
export function issueRows(d) {
  return (d?.issues ?? []).map((r) => ({ status: r.status, id: ref(r), project: r.repo, title: r.title, labels: r.labels ?? [], at: r.updated, href: href(r), repo: r.repo, n: r.id }));
}

/** The project rows from the API data: every registered project, with its open issues (0 when none). */
export function projectRows(d) {
  return (d?.projects ?? []).map((p) => ({ project: p.key, open: p.openItems ?? 0, at: p.activity, href: projectHref(p) }));
}

/** The spec rows from the API data. */
export function specRows(d) {
  return (d?.specs ?? []).map((s) => ({ date: s.date, title: s.title, project: s.project, at: s.date, href: `#/specs/${encodeURIComponent(s.project)}/${encodeURIComponent(s.file)}` }));
}

/** The issue rows that pass the filters. */
export function filterRows(rows, o = {}) {
  const q = (o.q ?? "").trim().toLowerCase();
  return rows.filter((r) =>
    (!o.status || r.status === o.status) && (!o.project || r.project === o.project) && (!o.label || r.labels.includes(o.label)) &&
    (!q || r.title.toLowerCase().includes(q)));
}

/** The project rows that pass the Project filter. */
export const filterProjects = (rows, o = {}) => rows.filter((r) => !o.project || r.project === o.project);

// Column order: id or name, title, state badge, project, labels, numbers, time last. [key, label, { num }]
export const SPEC_COLUMNS = [["title", "Title"], ["date", "Date"]];
const SPEC_SORT = { date: (r) => r.date, title: (r) => r.title, project: (r) => r.project };
export const COLUMNS = [["id", "Id"], ["title", "Title"], ["status", "Status"], ["project", "Project"], ["labels", "Labels"], ["updated", "Updated"], ["act", ""]];
export const PROJECT_COLUMNS = [["title", "Name"], ["open", "Open issues", { num: true }], ["updated", "Last activity"]];
const SORT = {
  project: (r) => r.project, status: (r) => r.status, id: (r) => r.n, title: (r) => r.title, labels: (r) => r.labels.join(","), updated: (r) => ms(r.at),
};
const PROJECT_SORT = { title: (r) => r.project, open: (r) => r.open, updated: (r) => ms(r.at) };

/** The rows ordered by `sort` = { key, dir } (dir 1 up, -1 down). Ties keep newest first. */
export function sortRows(rows, sort = { key: "updated", dir: -1 }, by = SORT) {
  const f = by[sort.key] ?? by.updated ?? by.date;
  return [...rows].sort((a, b) => {
    const x = f(a), y = f(b);
    const c = typeof x === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    return c * sort.dir || when(b.at) - when(a.at);
  });
}

/** "YYYY-MM-DD", from a date or a timestamp; "" when there is none. */
const day = (s) => (Number.isNaN(Date.parse(s)) ? "" : String(s).slice(0, 10));

/** A table's header row: sortable columns are sort buttons. */
const header = (sort, columns, by) =>
  `<thead><tr>${columns.map(([k, label, o]) => (by[k] ? sortHead(label, k, sort, o) : `<th>${esc(label)}</th>`)).join("")}</tr></thead>`;

/** The request an issue row's X sends, or null for a row that is not an open issue. */
export function dropTarget(r) {
  return r.status === "open" ? { url: `/api/issues/${encodeURIComponent(r.repo)}/${r.n}/drop`, body: { reason: "dropped from the Inventory page" } } : null;
}

/** One issue row: id, title, state, project, labels, time, and the X. */
export function renderRow(r) {
  const x = dropTarget(r)
    ? `<button type="button" class="cancel" data-cancel aria-label="Drop ${esc(r.id)}" title="Stop or drop">${X_ICON}</button>` : "";
  return `<tr class="crow" data-repo="${esc(r.repo)}" data-n="${r.n}"><td>${idLink(r.n, r.href)}</td>` +
    `<td class="wide"><a href="${esc(r.href)}">${esc(r.title)}</a></td>` +
    `<td>${badge(r.status)}</td><td>${esc(r.project)}</td><td>${chips(r.labels)}</td>` +
    `<td class="time">${esc(when(r.at))}</td><td class="drop">${x}<span class="cmsg" role="status"></span></td></tr>`;
}

/** One project row; the whole row is the link. */
export function renderProjectRow(r) {
  return `<tr class="crow" data-kind="project"><td class="wide"><a href="#/inventory?project=${encodeURIComponent(r.project)}" data-project="${esc(r.project)}">${esc(r.project)}</a></td>` +
    `<td class="num">${r.open}</td><td class="time">${esc(when(r.at))}</td></tr>`;
}

/** One spec row; the whole row is the link. */
export function renderSpecRow(r) {
  return `<tr class="crow" data-kind="spec"><td class="wide"><a href="${esc(r.href)}">${esc(r.title)}</a><span class="sub">${esc(r.project)}</span></td>` +
    `<td class="time">${esc(day(r.date))}</td></tr>`;
}

export function renderSpecsTable(rows, o = {}) {
  const shown = sortRows(filterProjects(rows, o), o.ssort, SPEC_SORT);
  if (!shown.length) return empty("No spec matches.", "A repo's docs/specs folder lists its specs here.");
  return `<div class="tscroll"><table class="tbl">${header(o.ssort ?? { key: "date", dir: -1 }, SPEC_COLUMNS, SPEC_SORT)}<tbody>${shown.map(renderSpecRow).join("")}</tbody></table></div>`;
}

export function renderFilters(d, o = {}) {
  const issues = issueRows(d);
  const projects = [...new Set([...projectRows(d).map((r) => r.project), ...issues.map((r) => r.project), ...specRows(d).map((r) => r.project)])].sort();
  const labels = [...new Set(issues.flatMap((r) => r.labels))].sort();
  return `<div data-ui="contents-filter">${filterBar([
    { label: "Project", name: "project", value: o.project ?? "", options: [{ value: "", label: "All" }, ...projects] },
    { label: "Status", name: "status", value: o.status || "any", options: [{ value: "any", label: "Any" }, "open", "done", "dropped"] },
    { label: "Label", name: "label", value: o.label ?? "", options: [{ value: "", label: "Any" }, ...labels.map((l) => ({ value: l, label: labelName(l) }))] },
    { label: "Title", name: "q", search: true, value: o.q ?? "", placeholder: "text in the title" },
  ])}</div>`;
}

export function renderProjectsTable(rows, o = {}) {
  const shown = sortRows(filterProjects(rows, o), o.psort, PROJECT_SORT);
  if (!shown.length) return empty("No project matches.", "Register one, or clear the Project filter.");
  return `<div class="tscroll"><table class="tbl">${header(o.psort ?? { key: "updated", dir: -1 }, PROJECT_COLUMNS, PROJECT_SORT)}<tbody>${shown.map(renderProjectRow).join("")}</tbody></table></div>`;
}

export function renderTable(rows, o = {}) {
  const all = sortRows(filterRows(rows, o), o.sort);
  if (!all.length) return empty("Nothing matches.", "File an issue below, or loosen the filters.");
  const shown = all.slice(0, o.limit ?? PAGE);
  return `<div class="tscroll"><table class="tbl">${header(o.sort ?? { key: "updated", dir: -1 }, COLUMNS, SORT)}<tbody>${shown.map(renderRow).join("")}</tbody></table></div>${pager(shown.length, all.length, PAGE)}`;
}

export const BODY_TEMPLATE = "## Outcome\n\n\n\n## Oracle\n\n\n\n## Time box\n\n";

/** The Project select's options, one per registry key, `project` selected. */
export function projectOptions(keys, project) {
  return keys.map((k) => `<option value="${esc(k)}"${k === project ? " selected" : ""}>${esc(k)}</option>`).join("");
}

/** Fills the form's Project select from the registry's keys. */
export async function mount(root, d) {
  const table = root.querySelector?.("#issues-table");
  if (table) table.addEventListener("click", (ev) => {
    const btn = ev.target.closest?.("button[data-cancel]");
    const tr = btn?.closest("tr");
    const r = tr && issueRows(d).find((x) => x.repo === tr.dataset.repo && String(x.n) === tr.dataset.n);
    const target = r && dropTarget(r);
    if (!target) return;
    confirmCancel(btn, tr.querySelector(".cmsg"), target, (j) => {
      r.status = j.status ?? "dropped";
      tr.outerHTML = renderRow(r);
    });
  });
  const select = root.querySelector?.('select[name="repo"]');
  if (!select) return;
  try {
    const res = await fetch("/api/projects/keys");
    if (!res.ok) return;
    const keys = await res.json();
    const cur = select.value;
    select.innerHTML = projectOptions(keys, cur);
  } catch {}
}

export function renderForm(rows, o = {}) {
  const repos = [...new Set(rows.map((r) => r.repo))];
  return `<details class="new"><summary>File an issue</summary>` +
    `<form data-ui="issue-form" class="stack">` +
    `<label>Project <select name="repo" required>${projectOptions(o.keys ?? repos, o.project)}</select></label>` +
    `<label>Title <input name="title" required></label>` +
    `<label>Body <textarea name="body" rows="12">${esc(BODY_TEMPLATE)}</textarea></label>` +
    `<label>Labels <input name="labels" placeholder="comma separated"></label>` +
    `<label><input type="checkbox" name="goal"> Build in the factory (adds the <code>factory</code> label)</label>` +
    `<label>After <input name="after" placeholder="repo-n.k, repo-n.k"></label>` +
    `<label>Due <input name="due" type="date"></label>` +
    `<button type="submit" class="cmd primary">File issue</button> <span class="form-msg" role="status"></span></form></details>`;
}

export function renderContents(d, o = {}) {
  const issues = issueRows(d), projects = projectRows(d), specs = specRows(d);
  const shownSpecs = filterProjects(specs, o).length;
  const shownProjects = filterProjects(projects, o).length, shownIssues = filterRows(issues, o).length;
  return `${STYLE_CONTENTS}<div class="page contents">${pageHead("Inventory")}${renderFilters(d, o)}` +
    `<div class="cols"><div class="main-col">${section("Issues", shownIssues)}<div id="issues-table">${renderTable(issues, o)}</div></div>` +
    `<div class="side-col">${section("Projects", shownProjects)}<div id="projects-table">${renderProjectsTable(projects, o)}</div>` +
    `${section("Specs", shownSpecs)}<div id="specs-table">${renderSpecsTable(specs, o)}</div></div></div>` +
    renderForm(d?.issues ?? [], o) + `</div>`;
}

/** The Job of a goal on the Issue page: a link to each of its jobs with the state, or a quiet line. */
function goalJobs(g, repo) {
  if (!g.jobs.length) return `<span class="quiet">No job yet</span>`;
  return g.jobs.map((j) => `${idLink(localId(j.name, repo), `#/jobs/${encodeURIComponent(j.name)}`)} <span class="time">${esc(when(j.started))}</span>`).join("<br>");
}

/** The body as the page shows it: the `## Request` heading goes, because the section has its own heading. */
export const description = (body) => String(body ?? "").replace(/^\s*## Request[ \t]*\r?\n+/, "");

/** Each `docs/specs/<file>.md` that this project has becomes a link to its Spec page. */
export const linkSpecs = (html, repo, files = []) => html.replace(/docs\/specs\/([\w.-]+\.md)/g, (m, f) => (files.includes(f) ? `<a href="#/specs/${encodeURIComponent(repo)}/${encodeURIComponent(f)}">${m}</a>` : m));

const PRIORITIES = ["high", "medium", "low"], SOURCES = ["chris", "worker", "deps", "memory"];
const choose = (name, all, cur) => `<select name="${name}">${(all.includes(cur) || !cur ? all : [cur, ...all]).map((o) => `<option${o === cur ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;

/** The form that edits what Chris can change on an issue or goal. */
function renderEdit(d, ref) {
  const fm = d.frontmatter ?? {};
  return `<details class="new"><summary>Edit</summary><form data-ui="issue-edit" class="stack" data-repo="${esc(d.repo)}" data-ref="${esc(ref)}">` +
    `<label>Title <input name="title" required value="${esc(d.title)}"></label>` +
    `<label>Priority ${choose("priority", PRIORITIES, d.priority ?? "medium")}</label>` +
    `<label>Source ${choose("source", SOURCES, fm.source ?? "chris")}</label>` +
    `<label>Areas <input name="areas" placeholder="comma separated" value="${esc((d.labels ?? []).join(", "))}"></label>` +
    `<label>${d.kind === "goal" ? "Goal" : "Description"} <textarea name="body" rows="14">${esc(description(d.body))}</textarea></label>` +
    `<button type="submit" class="cmd primary">Save</button> <span class="form-msg" role="status"></span></form></details>`;
}

/** The form that appends a note. */
const renderNoteForm = (d, ref) => `<form data-ui="issue-note" class="stack" data-repo="${esc(d.repo)}" data-ref="${esc(ref)}">` +
  `<label>Add a note <textarea name="text" rows="3" required></textarea></label>` +
  `<button type="submit" class="cmd">Add note</button> <span class="form-msg" role="status"></span></form>`;

/** The Issue page: the `## Request`, then the goals each with its Job, then the notes, the issue's own runs and the commits. Shared with views/issue.js. */
export function renderIssue(d) {
  const fm = d.frontmatter ?? {};
  const HIDE = ["labels", "id", "status", "kind", "goals", "issue", "after", "created", "updated", "repo", "title"];
  const facts = Object.entries(fm).filter(([k]) => !HIDE.includes(k)).map(([k, v]) => `<div><dt>${esc(k[0].toUpperCase() + k.slice(1))}</dt><dd>${esc(Array.isArray(v) ? v.map(labelName).join(", ") : v)}</dd></div>`).join("");
  const notes = d.notes.length ? `<ul class="notes">${d.notes.map((n) => `<li>${esc(n.replace(/^- /, ""))}</li>`).join("")}</ul>` : empty("No notes.");
  const goals = d.goals ?? [];
  const goalTable = goals.length
    ? `<div class="tscroll"><table class="tbl" id="goals"><thead><tr><th>Goal</th><th>Title</th><th>Stage</th><th>State</th><th>Job</th></tr></thead><tbody>${goals.map((g) => `<tr><td>${idLink(localId(g.id, d.repo), g.href)}</td><td class="wide" title="${esc(localId(g.why, d.repo))}">${esc(g.title)}</td><td>${stateBadge(g.stage)}</td><td>${g.jobs.map((j) => stateBadge(j.state)).join("<br>")}</td><td>${goalJobs(g, d.repo)}</td></tr>`).join("")}</tbody></table></div>`
    : empty("No goal is filed for this issue.");
  const jobs = d.jobs.length
    ? `<div class="tscroll"><table class="tbl"><thead><tr><th>Job</th><th>State</th><th>Started</th></tr></thead><tbody>${d.jobs.map((j) => `<tr><td>${idLink(localId(j.name, d.repo), `#/jobs/${encodeURIComponent(j.name)}`)}</td><td>${stateBadge(j.state)}</td><td class="time">${esc(when(j.started))}</td></tr>`).join("")}</tbody></table></div>`
    : empty("No job has worked on this.");
  const commits = d.commits.length
    ? `<div class="tscroll"><table class="tbl"><thead><tr><th>Commit</th><th>Subject</th><th>Date</th></tr></thead><tbody>${d.commits.map((c) => {
      const sha = c.hash.slice(0, 7);
      return `<tr><td>${c.commitUrl ? idLink(sha, c.commitUrl) : `<code>${esc(sha)}</code>`}</td><td class="wide" title="${esc(c.subject)}">${esc(c.subject)}</td><td class="time">${esc(when(c.date))}</td></tr>`;
    }).join("")}</tbody></table></div>`
    : empty("No commit on main names this issue in its trailers.");
  const isIssue = d.kind !== "goal";
  // An issue shows its Request as written; a goal (or an old item with no Request) shows its body.
  const request = isIssue && d.request ? d.request : description(d.body);
  const ref = String(d.ref ?? d.id), inventory = "#/inventory", project = [d.repo, `#/inventory?project=${encodeURIComponent(d.repo)}`];
  const place = isIssue ? [project, ["issues", inventory], [ref]]
    : d.issue ? [project, ["issues", inventory], [localId(d.issue.id, d.repo), d.issue.href], ["goals"], [ref]]
    : [project, ["goals"], [ref]];
  return `<div class="page">${crumb(inventory, place)}` + pageHead(d.title) +
    `<div class="status-row">${d.derived ? stateBadge(d.derived.stage) : badge(d.status)}${chips(fm.labels)}</div>` +
    (facts ? `<dl class="facts">${facts}</dl>` : "") +
    `<div class="sh"><h2 id="h-request">${isIssue ? "Description" : "Goal"}</h2></div><div class="md" id="request">${linkSpecs(md(request), d.repo, d.specs)}</div>${renderEdit(d, ref)}` +
    (isIssue ? `<div class="sh"><h2 id="h-goals">Goals</h2><span class="count">${goals.length}</span></div>${goalTable}` : "") +
    `<div class="sh"><h2>Notes</h2></div>${notes}${renderNoteForm(d, ref)}<div class="sh"><h2>Runs</h2></div>${jobs}<div class="sh"><h2>Commits</h2></div>${commits}</div>`;
}

// Interaction: the shell renders with innerHTML and has no hooks, so the view
// listens on the document. Filters live in the route's query, the form posts.
if (typeof document !== "undefined") {
  const setQuery = (name, value) => {
    const h = location.hash.replace(/^#/, "");
    const [path, qs = ""] = h.split("?");
    const q = new URLSearchParams(qs);
    if (value) q.set(name, value); else q.delete(name);
    location.hash = path + (q.toString() ? `?${q}` : "");
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("#issues-table button[data-sort], #projects-table button[data-sort], #specs-table button[data-sort]");
    if (!b) return;
    const o = hashOptions(new URLSearchParams(location.hash.split("?")[1] ?? ""));
    const p = b.closest("#projects-table") ? "p" : b.closest("#specs-table") ? "s" : "", cur = p === "p" ? o.psort : p === "s" ? o.ssort : o.sort;
    const key = b.dataset.sort, dir = cur.key === key ? -cur.dir : key === "updated" || key === "open" || key === "date" ? -1 : 1;
    setQuery(`${p}sort`, key); setQuery(`${p}dir`, dir > 0 ? "asc" : "desc");
  });
  const FILTERS = '[data-ui="contents-filter"]';
  document.addEventListener("change", (e) => {
    const f = e.target.closest && e.target.closest(`${FILTERS} [name]`);
    if (f) setQuery(f.name, f.value);
  });
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("#projects-table a[data-project]");
    if (a) { e.preventDefault(); return setQuery("project", a.dataset.project); }
    const b = e.target.closest && e.target.closest(`${FILTERS} .seg button`);
    if (b) return setQuery(b.closest(".seg").dataset.name, b.dataset.value);
    const more = e.target.closest && e.target.closest("#issues-table button[data-more]");
    if (more) setQuery("limit", String(hashOptions(new URLSearchParams(location.hash.split("?")[1] ?? "")).limit + Number(more.dataset.more)));
  });
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest && e.target.closest('form[data-ui="issue-edit"], form[data-ui="issue-note"]');
    if (!form) return;
    e.preventDefault();
    const edit = form.dataset.ui === "issue-edit", el = form.elements;
    const body = edit
      ? { title: el.title.value, priority: el.priority.value, source: el.source.value, areas: el.areas.value, description: el.body.value }
      : { text: el.text.value };
    const msg = form.querySelector(".form-msg");
    try {
      const res = await fetch(`/api/issues/${encodeURIComponent(form.dataset.repo)}/${encodeURIComponent(form.dataset.ref)}/${edit ? "edit" : "note"}`, {
        method: "POST", headers: { "content-type": "application/json", "x-aleph-ui": "1" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `answered ${res.status}`);
      location.reload();
    } catch (err) { msg.textContent = `Could not save it: ${err.message}`; }
  });
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest && e.target.closest('form[data-ui="issue-form"]');
    if (!form) return;
    e.preventDefault();
    const v = (n) => form.elements[n].value.trim();
    const labels = v("labels").split(",").map((s) => s.trim()).filter(Boolean);
    if (form.elements.goal.checked && !labels.includes("goal")) labels.push("goal");
    const msg = form.querySelector(".form-msg");
    try {
      const res = await fetch("/api/issues", {
        method: "POST", headers: { "content-type": "application/json", "x-aleph-ui": "1" },
        body: JSON.stringify({ repo: v("repo"), title: v("title"), body: form.elements.body.value, labels, after: v("after"), due: v("due") }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `answered ${res.status}`);
      location.hash = `/issues/${encodeURIComponent(v("repo"))}/${data.added}`;
    } catch (err) { msg.textContent = `Could not file it: ${err.message}`; }
  });
}
