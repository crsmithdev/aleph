// The Jobs view (the list) and the Job view (one job's runs, result, checks,
// logs, and a diff loaded on demand). Render functions take the /api/jobs
// objects and return HTML strings, with no DOM, so tests can call them.
import { STATES, badge, cmd, empty, esc, filterBar, idLink, md, money, pageHead, pager, span, when } from "../lib.js";


/** The list's data URL: the filters in the hash go to the API. */
const listUrl = (_params, q = new URLSearchParams()) => {
  const out = new URLSearchParams();
  for (const k of ["repo", "state", "days"]) if (q.get(k)) out.set(k, q.get(k));
  const s = out.toString();
  return s ? `/api/jobs?${s}` : "/api/jobs";
};

export const view = {
  path: "/jobs",
  title: "Jobs",
  nav: false,
  group: "factory",
  order: 1,
  api: listUrl,
  refresh: 30,
  render: (jobs, _params, query) => renderJobs(jobs, Object.fromEntries(query ?? [])),
  mount: (root, jobs, query) => mountJobs(root, jobs, Object.fromEntries(query ?? [])),
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

export function renderFilters(jobs, f = {}) {
  const repos = [...new Set([...jobs.map((j) => j.repo), f.repo].filter(Boolean))].sort();
  return filterBar([
    { label: "Project", name: "repo", value: f.repo || "", options: [{ value: "", label: "All" }, ...repos] },
    { label: "State", name: "state", value: f.state || "", options: [{ value: "", label: "All" }, ...STATES] },
    { label: "Window", name: "days", value: f.days || "", options: [{ value: "", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }] },
  ]);
}

export function renderJobs(jobs, f = {}) {
  // Columns: id, title, state, project, then started, took, cost, model. Rows past the first page are hidden until the pager shows them.
  const rows = jobs.map((j, i) =>
    `<tr${i >= PAGE ? " hidden" : ""}><td>${idLink(j.name, href(`/jobs/${encodeURIComponent(j.name)}`))}</td>` +
    `<td class="wide" title="${esc(j.item?.title || j.name)}">${esc(j.item?.title || j.name)}</td><td>${badge(j.state)}</td><td>${esc(j.repo)}</td>` +
    `<td class="time">${esc(when(j.started))}</td><td class="num">${j.ended ? esc(span(j.started, j.ended)) : ""}</td>` +
    `<td class="num">${j.cost !== undefined ? esc(money(j.cost)) : ""}</td><td>${esc(j.model ?? "")}</td></tr>`).join("");
  return `<div class="page">${pageHead("Jobs", { count: jobs.length })}${renderFilters(jobs, f)}` + (rows
    ? `<div class="tscroll" style="overflow-x:auto;max-width:100%"><table class="tbl"><thead><tr><th>Job</th><th>Title</th><th>State</th><th>Project</th><th>Started</th><th class="num">Took</th><th class="num">Cost</th><th>Model</th></tr></thead><tbody>${rows}</tbody></table></div>` +
      (jobs.length > PAGE ? pager(PAGE, jobs.length, PAGE) : "")
    : empty("No job in this window.", "Widen the window or clear a filter.")) + `</div>`;
}

/** Wire the filter bar (a change goes to the hash, keeping the other filters) and the pager's "Show more". */
export function mountJobs(root, _jobs, f = {}) {
  const go = (name, value) => { location.hash = href("/jobs", { repo: f.repo, state: f.state, days: f.days, [name]: value }); };
  root.onclick = (e) => {
    const b = e.target.closest?.(".seg button");
    if (b) return go(b.parentElement.dataset.name, b.dataset.value);
    const m = e.target.closest?.("[data-more]");
    if (!m) return;
    const hidden = [...root.querySelectorAll("tbody tr[hidden]")];
    const total = root.querySelectorAll("tbody tr").length;
    hidden.slice(0, Number(m.dataset.more)).forEach((tr) => { tr.hidden = false; });
    const shown = total - hidden.length + Math.min(hidden.length, Number(m.dataset.more));
    m.closest(".pager").outerHTML = pager(shown, total, PAGE);
  };
  root.onchange = (e) => { if (e.target.matches?.(".fbar select")) go(e.target.name, e.target.value); };
}

export function renderRuns(runs) {
  // Columns: kind (id), reason (title), state, model, then took, cost, started.
  const rows = runs.map((r) =>
    `<tr class="run run-${esc(r.kind)}"><td>${esc(r.kind)}</td><td class="wide" title="${esc(r.reason ?? "")}">${esc(r.reason ?? "")}</td><td>${badge(r.state)}</td><td>${esc(r.model ?? "")}</td>` +
    `<td class="num">${r.ended ? esc(span(r.started, r.ended)) : ""}</td><td class="num">${r.cost !== undefined ? esc(money(r.cost)) : ""}</td>` +
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
  return `<div class="page"><p class="quiet"><a href="#/jobs">← Jobs</a></p>` +
    pageHead(j.item?.title || j.name, { count: j.name, aside: badge(j.state) }) +
    `<dl class="facts">${fact("Repo", esc(j.repo))}${fact("Started", esc(when(j.started)))}${j.cost !== undefined ? fact("Cost", esc(money(j.cost))) : ""}` +
    `${j.model ? fact("Model", esc(j.model)) : ""}${j.commit ? fact("Commit", j.commitUrl ? idLink(j.commit.slice(0, 7), j.commitUrl) : `<code>${esc(j.commit.slice(0, 7))}</code>`) : ""}` +
    `${j.trace ? fact("Trace", `<a href="${esc(j.trace)}">Langfuse</a>`) : ""}</dl>` +
    (j.reason ? `<p class="quiet q">${esc(j.reason)}</p>` : "") +
    renderRuns(j.runs ?? []) +
    (j.result ? `<div class="sh"><h2>Result</h2></div><div class="md">${md(j.result)}</div>` : "") +
    (j.review ? `<div class="sh"><h2>Review</h2></div><div class="md">${md(j.review)}</div>` : "") +
    list("Defaults taken", j.defaults ?? [], true) + list("Follow-ups", j.followups ?? []) +
    (checks ? `<div class="sh"><h2>Checks</h2></div><ul class="checks">${checks}</ul>` : "") +
    log("Diff stat", j.stat) + log("checks.log, last 80 lines", j.checksLog) + log("Worker stderr, last 80 lines", j.stderr) +
    `<div class="sh"><h2>Diff</h2></div><button class="cmd" type="button" data-diff="${esc(j.name)}"><span>Load the diff</span></button><pre class="diff" id="diff" hidden></pre>` +
    (j.state === "needs-you" ? `<div class="actions">${cmd(`aleph land ${j.name}`, { primary: true })}${cmd(`aleph drop ${j.name}`)}</div>` : "") + `</div>`;
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
      out.innerHTML = res.ok ? renderDiff(await res.text()) : esc(res.status === 404 ? "The branch is gone, so there is no diff to show." : `The diff failed to load (${res.status}).`);
      out.hidden = false;
      b.remove();
    } catch (err) {
      out.textContent = `The diff failed to load: ${err.message}`;
      out.hidden = false;
      b.disabled = false;
    }
  });
}
