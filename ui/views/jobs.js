// The Jobs view (the list) and the Job view (one job's runs, result, checks,
// logs, and a diff loaded on demand). Render functions take the /api/jobs
// objects and return HTML strings, with no DOM, so tests can call them.
import { blockersHtml, costHtml, STATES, badge, card, cmd, crumb, dataTable, empty, esc, filterBar, goQuery, hashQuery, idLink, keepWindow, localId, md, pageHead, pager, searchBox, setQuery, shortModel, sortHead, span, WINDOW_DAYS, WINDOWS, windowOf, when, wireScope } from "../lib.js";


/** The days of the list: the window, or an old `?days=` address that has no window; else the stored window. */
function daysOf(q) {
  if (!q.get("window") && q.get("days")) return q.get("days");
  return Number(WINDOW_DAYS[windowOf(q)].toFixed(6));
}
/** The window a list shows, or "" for an old `?days=` that is none of the four. */
export function windowShown(f = {}) {
  if (!f.window && f.days) return Object.entries(WINDOW_DAYS).find(([, d]) => Math.abs(d - Number(f.days)) < 1e-4)?.[0] ?? "";
  return windowOf({ get: (k) => f[k] });
}

/** The list's data URL: the filters in the hash go to the API. */
const listUrl = (_params, q = new URLSearchParams()) => {
  const out = new URLSearchParams();
  for (const k of ["repo", "condition"]) if (q.get(k)) out.set(k, q.get(k));
  const days = daysOf(q);
  if (Number(days) !== 7) out.set("days", String(days));
  const s = out.toString();
  return s ? `/api/jobs?${s}` : "/api/jobs";
};

export const view = {
  path: "/jobs",
  title: "All jobs",
  nav: false,
  group: "factory",
  order: 1,
  api: listUrl,
  refresh: 30,
  render: (jobs, _params, query) => renderJobs(jobs, Object.fromEntries(query ?? [])),
  mount: (root, jobs) => mountJobs(root, jobs),
};

/** The Job view, routed at `#/jobs/<name>` through ui/views/job.js. */
export const detail = {
  path: "/jobs/:name",
  title: "Job",
  group: "factory",
  api: "/api/jobs/:name",
  render: (job) => renderJob(job),
};

const fact = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
const href = (path, params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  return `#${path}${q.toString() ? `?${q}` : ""}`;
};

const PAGE = 50;

/** What scopes the page and goes to the API: the project and the window. */
export function renderScope(jobs, f = {}) {
  const repos = [...new Set([...jobs.map((j) => j.repo), f.repo].filter(Boolean))].sort();
  return filterBar([
    { label: "Project", name: "repo", data: true, value: f.repo || "", options: [{ value: "", label: "All" }, ...repos] },
    { label: "Window", name: "window", value: windowShown(f), options: WINDOWS },
  ]);
}

export const renderFilters = (f = {}) => filterBar([{ label: "State", name: "condition", value: f.condition || "", options: [{ value: "", label: "All" }, ...STATES] }]);

const titleOf = (j) => j.item?.title || j.name;
const took = (j) => (j.ended ? Date.parse(j.ended) - Date.parse(j.started) : -1);
const SORT = { name: (j) => j.name, title: titleOf, condition: (j) => j.condition, repo: (j) => j.repo, model: (j) => shortModel(j.model), took, cost: (j) => j.cost ?? -1, started: (j) => Date.parse(j.started) || 0 };
/** The keys that start with the largest first. */
const DOWN_FIRST = new Set(["took", "cost", "started"]);
const sortOf = (f) => (f.sort && SORT[f.sort] ? { key: f.sort, dir: f.dir === "asc" ? 1 : -1 } : { key: "started", dir: -1 });

/** The jobs the search keeps, in the sort's order. */
export function shownJobs(jobs, f = {}) {
  const q = (f.q ?? "").trim().toLowerCase(), sort = sortOf(f), by = SORT[sort.key];
  return jobs.filter((j) => !q || `${j.name} ${titleOf(j)}`.toLowerCase().includes(q)).sort((a, b) => {
    const x = by(a), y = by(b);
    return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir;
  });
}

export function renderJobsTable(jobs, f = {}) {
  const all = shownJobs(jobs, f);
  if (!all.length) return empty("No job matches.", "Widen the window or clear a filter.");
  const shown = all.slice(0, Math.max(PAGE, Number.parseInt(f.limit, 10) || PAGE)), sort = sortOf(f);
  const h = (label, key, c) => sortHead(label, key, sort, c);
  // Columns: id, title, state, project, model, then took, cost, started.
  const rows = shown.map((j) => {
    const url = href(`/jobs/${encodeURIComponent(j.name)}`);
    return `<tr class="rowlink"><td>${idLink(localId(j.name, j.repo), url)}</td><td class="wide" title="${esc(titleOf(j))}"><a href="${esc(url)}">${esc(titleOf(j))}</a></td><td>${badge(j.condition)}</td><td>${esc(j.repo)}</td><td>${esc(shortModel(j.model))}</td>` +
      `<td class="num">${j.ended ? esc(span(j.started, j.ended)) : ""}</td><td class="num">${j.cost !== undefined ? costHtml(j.cost, j.wk) : ""}</td><td class="time">${esc(when(j.started))}</td></tr>`;
  }).join("");
  return dataTable(h("Job", "name") + h("Title", "title") + h("State", "condition") + h("Project", "repo") + h("Model", "model") + h("Took", "took", { num: true }) + h("Cost", "cost", { num: true }) + h("Started", "started"), rows) + pager(shown.length, all.length, PAGE);
}

const WORDS = { hour: "hour", day: "24 hours", week: "7 days", month: "30 days" };

export function renderJobs(jobs, f = {}) {
  return `<div class="page sp">${pageHead("All jobs", { count: `${jobs.length} in the last ${WORDS[windowShown(f)] ?? `${f.days} days`}`, aside: renderScope(jobs, f) })}` +
    card("Jobs", searchBox("jobs-search", f.q, "Search ids and titles") + renderFilters(f) + `<div id="jobs-table">${renderJobsTable(jobs, f)}</div>`) + `</div>`;
}

/** Wire the scope (it fetches again), the state filter, the search, the sort and the pager; the last three redraw the table. */
export function mountJobs(root, jobs) {
  const shown = windowShown(Object.fromEntries(hashQuery()));
  if (shown) keepWindow(shown);
  const redraw = () => { root.querySelector("#jobs-table").innerHTML = renderJobsTable(jobs, Object.fromEntries(hashQuery())); };
  wireScope(root);
  root.onclick = (e) => {
    const seg = e.target.closest?.(".card .seg button");
    if (seg) return goQuery({ [seg.parentElement.dataset.name]: seg.dataset.value });
    const s = e.target.closest?.("button[data-sort]");
    if (s) {
      const key = s.dataset.sort, cur = sortOf(Object.fromEntries(hashQuery()));
      setQuery({ sort: key, dir: (cur.key === key ? -cur.dir : DOWN_FIRST.has(key) ? -1 : 1) > 0 ? "asc" : "desc" });
      return redraw();
    }
    const m = e.target.closest?.("[data-more]");
    if (m) { setQuery({ limit: String(Math.max(PAGE, Number.parseInt(hashQuery().get("limit"), 10) || PAGE) + Number(m.dataset.more)) }); redraw(); }
  };
  root.oninput = (e) => { if (e.target.matches?.('[data-ui="jobs-search"]')) { setQuery({ q: e.target.value, limit: "" }); redraw(); } };
}

export function renderRuns(runs) {
  // Columns: kind (id), reason (title), state, model, then took, cost, started.
  const rows = runs.map((r) =>
    `<tr class="run run-${esc(r.kind)}"><td>${esc(r.kind)}</td><td class="wide" title="${esc(r.reason ?? "")}">${esc(r.reason ?? "")}</td><td>${badge(r.condition)}</td><td>${esc(shortModel(r.model))}</td>` +
    `<td class="num">${r.ended ? esc(span(r.started, r.ended)) : ""}</td><td class="num">${r.cost !== undefined ? costHtml(r.cost, r.wk) : ""}</td>` +
    `<td class="time">${esc(when(r.started))}</td></tr>`).join("");
  return `<div class="sh"><h2>Runs</h2><span class="count">${runs.length}</span></div>` +
    `<div class="tscroll"><table class="tbl"><thead><tr><th>Run</th><th>Reason</th><th>State</th><th>Model</th><th class="num">Took</th><th class="num">Cost</th><th>Started</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

const list = (title, items, open = false) => items.length
  ? `<details${open ? " open" : ""}><summary>${esc(title)}<span class="peek">${items.length}</span></summary><div class="body"><ul>${items.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></div></details>`
  : "";
const log = (title, body) => body ? `<div class="sh"><h2>${esc(title)}</h2></div><pre class="trailers">${esc(body)}</pre>` : "";

export function renderJob(j) {
  const checks = (j.checks ?? []).map((c) => `<li>${c.ok ? "✓" : "✗"} ${esc(c.name)} <span class="quiet">${esc(c.seconds)} s</span></li>`).join("");
  return `<div class="page">${crumb("#/jobs", [[j.repo, `#/jobs?repo=${encodeURIComponent(j.repo)}`], ["jobs", "#/jobs"], [localId(j.name, j.repo)]])}` +
    pageHead(j.item?.title || j.name) + `<div class="status-row">${badge(j.condition)}</div>` +
    `<dl class="facts">${j.blockers?.length ? fact("Blocked by", blockersHtml(j.blockers, j.repo, j.item.id)) : ""}${fact("Project", esc(j.repo))}${fact("Started", esc(when(j.started)))}${j.cost !== undefined ? fact("Cost", costHtml(j.cost, j.wk)) : ""}` +
    `${j.model ? fact("Model", esc(shortModel(j.model))) : ""}${j.commit ? fact("Commit", j.commitUrl ? idLink(j.commit.slice(0, 7), j.commitUrl) : `<code>${esc(j.commit.slice(0, 7))}</code>`) : ""}` +
    `${j.trace ? fact("Trace", `<a href="${esc(j.trace)}">Langfuse</a>`) : ""}${j.checkedBy?.length ? fact("Checked by", esc(j.checkedBy.join(", "))) : ""}${j.look ? fact("Look", `about ${esc(j.look)} min (estimate)`) : ""}</dl>` +
    (j.reason ? `<p class="quiet q">${esc(j.reason)}</p>` : "") +
    renderRuns(j.runs ?? []) +
    (j.result ? `<div class="sh"><h2>Result</h2></div><div class="md">${md(j.result)}</div>` : "") +
    (j.review ? `<div class="sh"><h2>Review</h2></div><div class="md">${md(j.review)}</div>` : "") +
    list("Defaults taken", j.defaults ?? [], true) + list("Follow-ups", j.followups ?? []) +
    (checks ? `<div class="sh"><h2>Checks</h2></div><ul class="checks">${checks}</ul>` : "") +
    log("Diff stat", j.stat) + log("checks.log, last 80 lines", j.checksLog) + log("Worker stderr, last 80 lines", j.stderr) +
    `<div class="sh"><h2>Diff</h2></div><button class="act" type="button" data-diff="${esc(j.name)}">Load the diff</button><pre class="diff" id="diff" hidden></pre>` +
    (j.condition === "awaiting" ? `<div class="actions">${cmd(`aleph land ${j.name}`, { primary: true })}${cmd(`aleph drop ${j.name}`)}</div>` : "") + `</div>`;
}

/** Colour a unified diff's lines. */
export function renderDiff(text) {
  return String(text).split("\n").map((l) => {
    const c = l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : "";
    return c ? `<span class="${c}">${esc(l)}</span>` : esc(l);
  }).join("\n");
}

// Loads the diff when the button is clicked. The button is rebuilt on each render, so listen on the document.
if (typeof document !== "undefined") {
  document.addEventListener("click", async (e) => {
    const b = e.target.closest?.("[data-diff]");
    if (!b) return;
    const out = document.getElementById("diff");
    b.disabled = true;
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(b.dataset.diff)}/diff`);
      out.innerHTML = res.ok ? renderDiff(await res.text()) : esc(res.status === 404 ? "No diff was recorded for this job." : `The diff failed to load (${res.status}).`);
      out.hidden = false;
      b.remove();
    } catch (err) {
      out.textContent = `The diff failed to load: ${err.message}`;
      out.hidden = false;
      b.disabled = false;
    }
  });
}
