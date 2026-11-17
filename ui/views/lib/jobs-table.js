// The jobs table of the Jobs page: its data URL, scope bar, filters, rows and wiring. The Job view and the Jobs page share it.
import { goQuery, hashQuery, scope } from "./address.js";
import { money, shortModel, span, when } from "./format.js";
import { badge, dataTable, empty, esc, filterBar, idLink, miss, pageOf, pageRows, pager, sortHead, sortOf, sortRows, wireTable } from "./html.js";
import { ACTORS, shortText, jobHref, STATES } from "../../../lib/naming.ts";

/** The most rows the list asks for: one page of the API holds the whole window. */
const ALL = 2000;
/** The list's data URL: the project, the window and the state and the unusable filter in the hash go to the API; the role filters on the page. */
export const listUrl = (_params, q = new URLSearchParams()) => {
  const s = scope(q), out = new URLSearchParams();
  if (s.project) out.set("project", s.project);
  if (s.window !== "week") out.set("window", s.window);
  if (q.get("state")) out.set("state", q.get("state"));
  if (q.get("unusable")) out.set("unusable", "1");
  out.set("limit", String(ALL));
  return `/api/jobs?${out}`;
};

const PAGE = 50;

/** What scopes the page and goes to the API: the project and the window. */
export function renderScope(jobs, f = {}) {
  const repos = [...new Set(jobs.map((j) => j.repo).filter(Boolean))].sort();
  return scope({ get: (k) => f[k] }).bar({ more: repos });
}

const ROLES = ACTORS.filter((a) => !["human", "rule", "gate", "check", "firefighter", "claude"].includes(a));
export const renderFilters = (f = {}) => filterBar([
  { label: "State", name: "state", value: f.state || "", options: [{ value: "", label: "All" }, ...STATES] },
  { label: "Runs", name: "unusable", value: f.unusable ? "1" : "", options: [{ value: "", label: "All" }, { value: "1", label: "Failed" }] },
  { label: "Role", name: "role", value: f.role || "", options: [{ value: "", label: "All" }, ...ROLES] },
]);

const titleOf = (j) => j.title;
const SORT = { id: (j) => j.id, title: titleOf, state: (j) => j.state, repo: (j) => j.repo, model: (j) => shortModel(j.model), took: (j) => j.seconds ?? -1, cost: (j) => j.cost ?? -1, started: (j) => Date.parse(j.started) || 0 };
/** The keys that start with the largest first. */
const DOWN_FIRST = new Set(["took", "cost", "started"]);
const sorted = (f) => sortOf(f, SORT, { key: "started", dir: -1 });

/** The jobs the role and the search keep, in the sort's order. */
function shownJobs(jobs, f = {}) {
  const q = (f.q ?? "").trim().toLowerCase(), sort = sorted(f);
  return sortRows(jobs.filter((j) => (!f.role || j.actor === f.role) && (!q || `${j.id} ${titleOf(j)}`.toLowerCase().includes(q))), SORT, sort);
}

export function renderJobsTable(jobs, f = {}) {
  const all = shownJobs(jobs, f);
  if (!all.length) return empty();
  const shown = pageRows(all, pageOf(f), PAGE), sort = sorted(f);
  const h = (label, key, c) => sortHead(label, key, sort, c);
  // Columns: id, title, state, project, model, took, cost, then started: the Issues table's order.
  const rows = shown.map((j) => {
    const url = jobHref(j.id);
    return `<tr class="rowlink" data-annotate="${esc(j.id)}"><td>${idLink(shortText(j.id), url)}</td><td class="wide" title="${esc(titleOf(j))}"><a href="${esc(url)}">${esc(titleOf(j))}</a></td><td>${badge(j.state)}</td><td>${j.repo ? esc(j.repo) : miss("no project")}</td><td>${esc(shortModel(j.model))}</td>` +
      `<td class="num">${esc(span(j.started, j.ended))}</td><td class="num">${esc(money(j.cost))}</td><td class="time">${esc(when(j.started))}</td></tr>`;
  }).join("");
  return dataTable(h("Id", "id") + h("Title", "title") + h("State", "state") + h("Project", "repo") + h("Model", "model") + h("Took", "took", { num: true }) + h("Cost", "cost", { num: true }) + h("Started", "started", { num: true }), rows) + pager(pageOf(f), all.length, PAGE);
}

/** Wire the state filter (it fetches again), the search, the sort and the pager; the last three redraw the table once `jobsNow()` gives the jobs. */
export function wireJobs(root, jobsNow) {
  const redraw = () => { const jobs = jobsNow(); if (jobs) root.querySelector("#jobs-table").innerHTML = renderJobsTable(jobs, Object.fromEntries(hashQuery())); };
  wireTable(root, { redraw, sortOf: sorted, downFirst: DOWN_FIRST, search: "jobs-search" });
  const table = root.onclick;
  root.onclick = (e) => {
    const seg = e.target.closest?.(".card .seg button");
    if (seg) return goQuery({ [seg.parentElement.dataset.name]: seg.dataset.value });
    if (!e.target.closest?.(".paged")) table(e);
  };
}
