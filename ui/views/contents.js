// The Contents view: the state to browse, not the process: every issue of every repo and every
// project, in rows styled like Activity's (its CSS, header and X are imported from timeline.js),
// a Type filter and a form that files an issue. `data` is /api/contents: { issues, projects }.
// The issue detail (renderIssue) is shared with views/issue.js.
import { empty, esc, md } from "../lib.js";
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

/** The old Issues address: `#/issues` and `#/projects` become `#/contents` (a filter by type). The detail routes are left alone. */
export function redirect(hash) {
  const path = String(hash ?? "").replace(/^#/, "").split("?")[0].replace(/\/$/, "");
  return path === "/issues" ? "#/contents" : path === "/projects" ? "#/contents?type=project" : null;
}

export const TYPES = [["", "All"], ["issue", "Issues"], ["project", "Projects"]];

/** The filters and sort, from the route's query: ?type=issue&status=open&label=x&q=text&sort=title&dir=asc. */
export function hashOptions(q = new URLSearchParams()) {
  const type = q.get("type") ?? "";
  return {
    type: TYPES.some(([t]) => t === type) ? type : "", status: q.get("status") ?? "", label: q.get("label") ?? "", q: q.get("q") ?? "",
    sort: { key: q.get("sort") || "updated", dir: q.get("dir") === "asc" ? 1 : -1 },
  };
}

export const ref = (r) => `${r.repo}-${r.id}`;
export const href = (r) => `#/issues/${encodeURIComponent(r.repo)}/${r.id}`;
const projectHref = (p) => `#/projects/${encodeURIComponent(p.key)}`;
const badge = (text, cls = "") => `<span class="badge ${cls}">${esc(text)}</span>`;
const stateBadge = (s) => badge(s, s === "done" ? "done" : s === "stuck" || s === "needs-you" ? "stuck" : s === "running" ? "run" : "");

const STATUS_TONE = { open: "run", done: "done", dropped: "quiet" };
const when = (s) => Date.parse(s) || 0;

/** One list of rows from the API data: an issue row and a project row each. */
export function contentRows(d) {
  return [
    ...(d?.issues ?? []).map((r) => ({ type: "issue", status: r.status, id: ref(r), title: r.title, labels: r.labels ?? [], at: r.updated, href: href(r), repo: r.repo, n: r.id })),
    ...(d?.projects ?? []).map((p) => ({ type: "project", status: "", id: "", title: p.key, labels: [], open: p.openItems, at: p.activity, href: projectHref(p) })),
  ];
}

/** The rows that pass the filters; a status or label filter leaves no project, which has neither. */
export function filterRows(rows, o = {}) {
  const q = (o.q ?? "").trim().toLowerCase();
  return rows.filter((r) =>
    (!o.type || r.type === o.type) && (!o.status || r.status === o.status) && (!o.label || r.labels.includes(o.label)) &&
    (!q || r.title.toLowerCase().includes(q)));
}

export const COLUMNS = [["type", "Type"], ["status", "Status"], ["id", "Id"], ["title", "Title"], ["labels", "Labels"], ["open", "Open issues"], ["updated", "Updated"], ["act", ""]];
const SORT = {
  type: (r) => r.type, status: (r) => r.status, id: (r) => r.id, title: (r) => r.title, labels: (r) => r.labels.join(","),
  open: (r) => r.open ?? -1, updated: (r) => when(r.at),
};

/** The rows ordered by `sort` = { key, dir } (dir 1 up, -1 down). Ties keep newest first. */
export function sortRows(rows, sort = { key: "updated", dir: -1 }) {
  const f = SORT[sort.key] ?? SORT.updated;
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
  return r.type === "issue" && r.status === "open" ? { url: `/api/issues/${encodeURIComponent(r.repo)}/${r.n}/drop`, body: { reason: "dropped from the Contents page" } } : null;
}

/** One row, aligned in the columns of the Activity table. */
export function renderRow(r) {
  const idCell = r.id ? `<a class="id" href="${esc(r.href)}">${esc(r.id)}</a>` : "";
  const x = dropTarget(r)
    ? `<button type="button" class="cancel" data-cancel aria-label="Drop ${esc(r.id)}" title="Stop or drop">${X_ICON}</button>` : "";
  return `<tr class="evr" data-kind="${esc(r.type)}"${r.repo ? ` data-repo="${esc(r.repo)}" data-n="${r.n}"` : ""}><td class="c-type">${esc(r.type)}</td>` +
    `<td class="c-status">${r.status ? badge(r.status, STATUS_TONE[r.status] ?? "") : ""}</td><td class="c-id">${idCell}</td>` +
    `<td class="c-title"><a href="${esc(r.href)}">${esc(r.title)}</a></td>` +
    `<td class="c-labels">${r.labels.map((l) => badge(l)).join(" ")}</td><td class="c-open">${r.open ?? ""}</td>` +
    `<td class="c-time">${esc(day(r.at))}</td><td class="c-act">${x}<span class="cmsg" role="status"></span></td></tr>`;
}

export function renderFilters(rows, o = {}) {
  const labels = [...new Set(rows.flatMap((r) => r.labels))].sort();
  const opt = (v, cur, text = v) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(text)}</option>`;
  return `<form class="filters" data-ui="contents-filter" onsubmit="return false">` +
    `<label>Type <select data-filter="type">${TYPES.map(([t, text]) => opt(t, o.type, text)).join("")}</select></label>` +
    `<label>Status <select data-filter="status">${opt("", o.status, "Any")}${["open", "done", "dropped"].map((s) => opt(s, o.status)).join("")}</select></label>` +
    `<label>Label <select data-filter="label">${opt("", o.label, "Any")}${labels.map((l) => opt(l, o.label)).join("")}</select></label>` +
    `<label>Title <input type="search" data-filter="q" value="${esc(o.q ?? "")}" placeholder="text in the title"></label></form>`;
}

export function renderTable(rows, o = {}) {
  const shown = sortRows(filterRows(rows, o), o.sort);
  if (!shown.length) return empty("Nothing matches.", "File an issue below, or loosen the filters.");
  return `<div class="list"><table class="tbl">${header(o.sort ?? { key: "updated", dir: -1 }, COLUMNS, SORT)}<tbody>${shown.map(renderRow).join("")}</tbody></table></div>`;
}

export const BODY_TEMPLATE = "## Goal\n\n\n\n## Oracle\n\n\n\n## Time box\n\n";

/** The Project select's options, one per registry key, `project` selected. */
export function projectOptions(keys, project) {
  return keys.map((k) => `<option value="${esc(k)}"${k === project ? " selected" : ""}>${esc(k)}</option>`).join("");
}

/** Fills the form's Project select from the registry's keys. */
export async function mount(root, d) {
  const table = root.querySelector?.("#contents-table");
  if (table) table.addEventListener("click", (ev) => {
    const btn = ev.target.closest?.("button[data-cancel]");
    const tr = btn?.closest("tr");
    const r = tr && contentRows(d).find((x) => x.repo === tr.dataset.repo && String(x.n) === tr.dataset.n);
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
    `<label><input type="checkbox" name="goal"> Factory goal (adds the <code>goal</code> label)</label>` +
    `<label>Waits on <input name="waitingOn" placeholder="repo-n"></label>` +
    `<label>Due <input name="due" type="date"></label>` +
    `<button type="submit" class="cmd primary">File issue</button> <span class="form-msg" role="status"></span></form></details>`;
}

export function renderContents(d, o = {}) {
  const rows = contentRows(d);
  return `${STYLE}<div class="page tl"><h1>Contents</h1>${renderFilters(rows, o)}<div id="contents-table">${renderTable(rows, o)}</div>` +
    renderForm(d?.issues ?? [], o) + `</div>`;
}

/** The detail view's pieces, shared with views/issue.js. */
export function renderIssue(d) {
  const facts = Object.entries(d.frontmatter ?? {}).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(Array.isArray(v) ? v.join(", ") : v)}</dd></div>`).join("");
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
    const b = e.target.closest && e.target.closest("#contents-table button[data-sort]");
    if (!b) return;
    const o = hashOptions(new URLSearchParams(location.hash.split("?")[1] ?? ""));
    const key = b.dataset.sort, dir = o.sort.key === key ? -o.sort.dir : key === "updated" ? -1 : 1;
    setQuery("sort", key); setQuery("dir", dir > 0 ? "asc" : "desc");
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
