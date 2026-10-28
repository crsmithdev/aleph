// The Contents view: the state to browse, not the process: every project and every issue of every repo, in rows styled like Activity's (its CSS, header and X are imported from timeline.js),
// two tables and a form that files an issue. `data` is /api/contents: { issues, projects }.
// The issue detail (renderIssue) is shared with views/issue.js.
import { empty, esc, labelName, md } from "../lib.js";
import { STYLE, X_ICON, confirmCancel, head as header } from "./timeline.js";

export const view = {
  path: "/contents",
  title: "Contents",
  group: "factory",
  order: 2,
  api: "/api/contents",
  render: (d, _params, query) => renderContents(d, hashOptions(query)),
  mount: (root, d) => mount(root, d),
};

/** The old Issues address: `#/issues` and `#/projects` become `#/contents` . The detail routes are left alone. */
export function redirect(hash) {
  const path = String(hash ?? "").replace(/^#/, "").split("?")[0].replace(/\/$/, "");
  return path === "/issues" ? "#/contents" : path === "/projects" ? "#/contents" : null;
}

const STYLE_CONTENTS = `<style>
.tl .filters { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; margin: 0 0 12px; font: 13px var(--sans); }
.tl .filters label { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); }
.tl .filters select, .tl .filters input { font: 13px var(--sans); padding: 4px 8px; color: var(--ink); background: var(--bg); border: 1px solid var(--rule); border-radius: 4px; min-width: 0; }
.tl .filters select:hover, .tl .filters input:hover { border-color: var(--ink-2); }
.tl .filters select:focus-visible, .tl .filters input:focus-visible { outline: 2px solid var(--ink-2); outline-offset: 1px; }
.tl .tbl tr.crow { position: relative; }
.tl .tbl tr.crow:hover { background: var(--rule-2); }
.tl .tbl .c-title a { color: inherit; text-decoration: none; }
.tl .tbl .c-title a::after { content: ""; position: absolute; inset: 0; }
.tl .tbl tr.crow:hover .c-title a, .tl .tbl .c-title a:focus-visible { text-decoration: underline; }
.tl .tbl td.c-id a, .tl .tbl .c-act { position: relative; z-index: 1; }
@media (max-width: 480px) { .tl .filters label { flex: 1 1 100%; } .tl .filters select, .tl .filters input { flex: 1; } }
</style>`;

/** The Status filter's default is Open; "any" (the Any option) shows every status. */
export const DEFAULT_STATUS = "open";
const statusOf = (s) => (s === null || s === undefined || s === "" ? DEFAULT_STATUS : s === "any" ? "" : s);

/** The filters and sorts, from the route's query: ?status=open&project=x&label=x&q=text&sort=title&dir=asc (the Issues table), &psort=open&pdir=desc (the Projects table). */
export function hashOptions(q = new URLSearchParams()) {
  return {
    status: statusOf(q.get("status")), project: q.get("project") ?? "", label: q.get("label") ?? "", q: q.get("q") ?? "",
    sort: { key: q.get("sort") || "updated", dir: q.get("dir") === "asc" ? 1 : -1 },
    psort: { key: q.get("psort") || "updated", dir: q.get("pdir") === "asc" ? 1 : -1 },
  };
}

export const ref = (r) => `${r.repo}-${r.id}`;
export const href = (r) => `#/issues/${encodeURIComponent(r.repo)}/${r.id}`;
const projectHref = (p) => `#/projects/${encodeURIComponent(p.key)}`;
const badge = (text, cls = "") => `<span class="badge ${cls}">${esc(text)}</span>`;
const stateBadge = (s) => badge(s, s === "done" ? "done" : s === "stuck" || s === "needs-you" ? "stuck" : s === "running" ? "run" : "");

const STATUS_TONE = { open: "run", done: "done", dropped: "quiet" };
const when = (s) => Date.parse(s) || 0;

/** The issue rows from the API data. */
export function issueRows(d) {
  return (d?.issues ?? []).map((r) => ({ status: r.status, id: ref(r), project: r.repo, title: r.title, labels: r.labels ?? [], at: r.updated, href: href(r), repo: r.repo, n: r.id }));
}

/** The project rows from the API data: every registered project, with its open issues (0 when none). */
export function projectRows(d) {
  return (d?.projects ?? []).map((p) => ({ project: p.key, open: p.openItems ?? 0, at: p.activity, href: projectHref(p) }));
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

export const COLUMNS = [["project", "Project"], ["status", "Status"], ["id", "Id"], ["title", "Title"], ["labels", "Labels"], ["updated", "Updated"], ["act", ""]];
export const PROJECT_COLUMNS = [["title", "Name"], ["open", "Open issues"], ["updated", "Last activity"]];
const SORT = {
  project: (r) => r.project, status: (r) => r.status, id: (r) => r.id, title: (r) => r.title, labels: (r) => r.labels.join(","), updated: (r) => when(r.at),
};
const PROJECT_SORT = { title: (r) => r.project, open: (r) => r.open, updated: (r) => when(r.at) };

/** The rows ordered by `sort` = { key, dir } (dir 1 up, -1 down). Ties keep newest first. */
export function sortRows(rows, sort = { key: "updated", dir: -1 }, by = SORT) {
  const f = by[sort.key] ?? by.updated;
  return [...rows].sort((a, b) => {
    const x = f(a), y = f(b);
    const c = typeof x === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    return c * sort.dir || when(b.at) - when(a.at);
  });
}

/** "YYYY-MM-DD", from a date or a timestamp; "" when there is none. */
const day = (s) => (Number.isNaN(Date.parse(s)) ? "" : String(s).slice(0, 10));

/** The request an issue row's X sends, or null for a row that is not an open issue. */
export function dropTarget(r) {
  return r.status === "open" ? { url: `/api/issues/${encodeURIComponent(r.repo)}/${r.n}/drop`, body: { reason: "dropped from the Contents page" } } : null;
}

/** One issue row, aligned in the columns of the Activity table. */
export function renderRow(r) {
  const x = dropTarget(r)
    ? `<button type="button" class="cancel" data-cancel aria-label="Drop ${esc(r.id)}" title="Stop or drop">${X_ICON}</button>` : "";
  return `<tr class="evr crow" data-repo="${esc(r.repo)}" data-n="${r.n}"><td class="c-project">${esc(r.project)}</td>` +
    `<td class="c-status">${badge(r.status, STATUS_TONE[r.status] ?? "")}</td><td class="c-id"><a class="id" href="${esc(r.href)}">${esc(r.id)}</a></td>` +
    `<td class="c-title"><a href="${esc(r.href)}">${esc(r.title)}</a></td>` +
    `<td class="c-labels">${r.labels.map((l) => badge(labelName(l))).join(" ")}</td>` +
    `<td class="c-time">${esc(day(r.at))}</td><td class="c-act">${x}<span class="cmsg" role="status"></span></td></tr>`;
}

/** One project row; the whole row is the link. */
export function renderProjectRow(r) {
  return `<tr class="evr crow" data-kind="project"><td class="c-title"><a href="${esc(r.href)}">${esc(r.project)}</a></td>` +
    `<td class="c-open">${r.open}</td><td class="c-time">${esc(day(r.at))}</td></tr>`;
}

export function renderFilters(d, o = {}) {
  const issues = issueRows(d);
  const projects = [...new Set([...projectRows(d).map((r) => r.project), ...issues.map((r) => r.project)])].sort();
  const labels = [...new Set(issues.flatMap((r) => r.labels))].sort();
  const opt = (v, cur, text = v) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(text)}</option>`;
  return `<form class="filters" data-ui="contents-filter" onsubmit="return false">` +
    `<label>Project <select data-filter="project">${opt("", o.project, "All")}${projects.map((k) => opt(k, o.project)).join("")}</select></label>` +
    `<label>Status <select data-filter="status">${opt("any", o.status || "any", "Any")}${["open", "done", "dropped"].map((s) => opt(s, o.status)).join("")}</select></label>` +
    `<label>Label <select data-filter="label">${opt("", o.label, "Any")}${labels.map((l) => opt(l, o.label, labelName(l))).join("")}</select></label>` +
    `<label>Title <input type="search" data-filter="q" value="${esc(o.q ?? "")}" placeholder="text in the title"></label></form>`;
}

export function renderProjectsTable(rows, o = {}) {
  const shown = sortRows(filterProjects(rows, o), o.psort, PROJECT_SORT);
  if (!shown.length) return empty("No project matches.", "Register one, or clear the Project filter.");
  return `<div class="list"><table class="tbl">${header(o.psort ?? { key: "updated", dir: -1 }, PROJECT_COLUMNS, PROJECT_SORT)}<tbody>${shown.map(renderProjectRow).join("")}</tbody></table></div>`;
}

export function renderTable(rows, o = {}) {
  const shown = sortRows(filterRows(rows, o), o.sort);
  if (!shown.length) return empty("Nothing matches.", "File an issue below, or loosen the filters.");
  return `<div class="list"><table class="tbl">${header(o.sort ?? { key: "updated", dir: -1 }, COLUMNS, SORT)}<tbody>${shown.map(renderRow).join("")}</tbody></table></div>`;
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
    `<label>Waits on <input name="waitingOn" placeholder="repo-n"></label>` +
    `<label>Due <input name="due" type="date"></label>` +
    `<button type="submit" class="cmd primary">File issue</button> <span class="form-msg" role="status"></span></form></details>`;
}

export function renderContents(d, o = {}) {
  const issues = issueRows(d), projects = projectRows(d);
  const shownProjects = filterProjects(projects, o).length, shownIssues = filterRows(issues, o).length;
  return `${STYLE}${STYLE_CONTENTS}<div class="page tl"><h1>Contents</h1>${renderFilters(d, o)}` +
    `<h2>Projects <small class="quiet">${shownProjects}</small></h2><div id="projects-table">${renderProjectsTable(projects, o)}</div>` +
    `<h2>Issues <small class="quiet">${shownIssues}</small></h2><div id="issues-table">${renderTable(issues, o)}</div>` +
    renderForm(d?.issues ?? [], o) + `</div>`;
}

/** The detail view's pieces, shared with views/issue.js. */
export function renderIssue(d) {
  const facts = Object.entries(d.frontmatter ?? {}).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(Array.isArray(v) ? v.map(labelName).join(", ") : v)}</dd></div>`).join("");
  const notes = d.notes.length ? `<ul class="notes">${d.notes.map((n) => `<li>${esc(n.replace(/^- /, ""))}</li>`).join("")}</ul>` : empty("No notes.");
  const jobs = d.jobs.length
    ? `<ul class="jobs">${d.jobs.map((j) => `<li><a href="#/jobs/${encodeURIComponent(j.name)}">${esc(j.name)}</a> ${badge(j.state)} <small class="quiet">${esc(j.started)}</small></li>`).join("")}</ul>`
    : empty("No job has worked on this.");
  const commits = d.commits.length
    ? `<ul class="commits">${d.commits.map((c) => {
      const sha = `<code>${esc(c.hash.slice(0, 7))}</code>`;
      return `<li>${c.commitUrl ? `<a href="${esc(c.commitUrl)}">${sha}</a>` : sha} ${esc(c.subject)} <small class="quiet">${esc(c.date)}</small></li>`;
    }).join("")}</ul>`
    : empty("No commit on main names this issue in its trailers.");
  return `<div class="page"><p><a href="#/contents">Contents</a></p><div class="ih"><span class="id">${esc(ref(d))}</span><h1>${esc(d.title)}</h1>` +
    `${d.derived ? stateBadge(d.derived.state) : badge(d.status)}</div>` +
    (d.derived ? `<p class="quiet">${esc(d.derived.why)}</p>` : "") +
    `<dl class="facts">${facts}</dl><section class="body">${md(d.body)}</section>` +
    `<div class="sh"><h2>Notes</h2></div>${notes}<div class="sh"><h2>Jobs</h2></div>${jobs}<div class="sh"><h2>Commits</h2></div>${commits}</div>`;
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
    const b = e.target.closest && e.target.closest("#issues-table button[data-sort], #projects-table button[data-sort]");
    if (!b) return;
    const o = hashOptions(new URLSearchParams(location.hash.split("?")[1] ?? ""));
    const p = b.closest("#projects-table") ? "p" : "", cur = p ? o.psort : o.sort;
    const key = b.dataset.sort, dir = cur.key === key ? -cur.dir : key === "updated" || key === "open" ? -1 : 1;
    setQuery(`${p}sort`, key); setQuery(`${p}dir`, dir > 0 ? "asc" : "desc");
  });
  document.addEventListener("change", (e) => {
    const f = e.target.closest && e.target.closest("[data-filter]");
    if (!f) return;
    setQuery(f.dataset.filter, f.value);
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
        body: JSON.stringify({ repo: v("repo"), title: v("title"), body: form.elements.body.value, labels, waitingOn: v("waitingOn"), due: v("due") }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `answered ${res.status}`);
      location.hash = `/issues/${encodeURIComponent(v("repo"))}/${data.added}`;
    } catch (err) { msg.textContent = `Could not file it: ${err.message}`; }
  });
}
