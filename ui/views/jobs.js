// The Jobs view (the list) and the Job view (one job's runs, result, checks,
// logs, and a diff loaded on demand). Render functions take the /api/jobs
// objects and return HTML strings, with no DOM, so tests can call them.
import { clock, cmd, empty, esc, md, money, span } from "../lib.js";

const STATES = ["running", "passed", "needs-you", "failed", "stuck", "done", "landed", "dropped"];
const BADGE = { landed: "done", done: "done", running: "run", passed: "run", failed: "stuck", stuck: "stuck", "needs-you": "stuck" };

const hashQuery = () => (typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.hash.split("?")[1] ?? ""));

/** The list's data URL: the filters in the hash go to the API. */
const listUrl = () => {
  const q = hashQuery();
  const out = new URLSearchParams();
  for (const k of ["repo", "state", "days"]) if (q.get(k)) out.set(k, q.get(k));
  const s = out.toString();
  return s ? `/api/jobs?${s}` : "/api/jobs";
};

export const view = {
  path: "/jobs",
  title: "Jobs",
  group: "factory",
  order: 1,
  api: listUrl,
  refresh: 30,
  render: (jobs) => renderJobs(jobs, Object.fromEntries(hashQuery())),
};

/** The Job view, routed at `#/jobs/<name>` through ui/views/job.js. */
export const detail = {
  path: "/jobs/:name",
  title: "Job",
  group: "factory",
  api: "/api/jobs/:name",
  render: (job) => renderJob(job),
};

const badge = (state) => `<span class="badge ${BADGE[state] ?? ""}">${esc(state)}</span>`;
const fact = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
const href = (path, params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  return `#${path}${q.toString() ? `?${q}` : ""}`;
};

const STYLE = `<style>
.filters { display: flex; flex-wrap: wrap; gap: 10px 24px; margin: 0 0 20px; font: 13px var(--sans); }
.filters .group { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.filters .k { color: var(--muted); font-weight: 500; margin-right: 4px; }
.filters .pill { padding: 2px 10px; border: 1px solid var(--rule); border-radius: 999px; color: var(--ink); text-decoration: none; white-space: nowrap; }
.filters .pill:hover { border-color: var(--muted); }
.filters .pill[aria-current] { background: var(--ink); border-color: var(--ink); color: var(--bg, #fff); }
@media (max-width: 480px) { .filters { gap: 12px; } .filters .group { flex: 1 1 100%; } }
</style>`;

export function renderFilters(jobs, f = {}) {
  const repos = [...new Set([...jobs.map((j) => j.repo), f.repo].filter(Boolean))].sort();
  const pill = (label, params, on) => `<a class="pill${on ? " on" : ""}" href="${esc(href("/jobs", params))}"${on ? ' aria-current="true"' : ""}>${esc(label)}</a>`;
  const keep = { repo: f.repo, state: f.state, days: f.days };
  const group = (label, chips) => `<div class="group" role="group" aria-label="${label}"><span class="k">${label}</span>${chips.join("")}</div>`;
  return `<nav class="filters" aria-label="Filter jobs">` +
    group("Repo", [pill("All", { ...keep, repo: "" }, !f.repo), ...repos.map((r) => pill(r, { ...keep, repo: r }, f.repo === r))]) +
    group("State", [pill("All", { ...keep, state: "" }, !f.state), ...STATES.map((s) => pill(s, { ...keep, state: s }, f.state === s))]) +
    group("Window", [["7 days", ""], ["30 days", "30"], ["90 days", "90"]].map(([l, d]) => pill(l, { ...keep, days: d }, (f.days || "") === d))) +
    `</nav>`;
}

export function renderJobs(jobs, f = {}) {
  const rows = jobs.map((j) =>
    `<article class="del"><div class="ih"><a class="id" href="${esc(href(`/jobs/${encodeURIComponent(j.name)}`))}">${esc(j.name)}</a>` +
    `<h3>${esc(j.item?.title || j.name)}</h3>${badge(j.state)}</div>` +
    `<dl class="facts">${fact("Repo", esc(j.repo))}${fact("Started", esc(clock(j.started)))}` +
    `${j.ended ? fact("Took", esc(span(j.started, j.ended))) : ""}${j.cost !== undefined ? fact("Cost", esc(money(j.cost))) : ""}${j.model ? fact("Model", esc(j.model)) : ""}</dl></article>`).join("");
  return `${STYLE}<div class="page"><div class="sh"><h1 id="h-jobs">Jobs</h1><span class="count">${jobs.length}</span></div>` +
    renderFilters(jobs, f) + (rows ? `<div class="list">${rows}</div>` : empty("No job in this window.", "Widen the window or clear a filter.")) + `</div>`;
}

export function renderRuns(runs) {
  const rows = runs.map((r) =>
    `<li class="run run-${esc(r.kind)}"><span class="id">${esc(r.kind)}</span>${badge(r.state)}` +
    `<span class="num">${esc(clock(r.started))}${r.ended ? `, ${esc(span(r.started, r.ended))}` : ""}</span>` +
    `${r.cost !== undefined ? `<span class="num">${esc(money(r.cost))}</span>` : ""}${r.model ? `<span class="quiet">${esc(r.model)}</span>` : ""}` +
    `${r.reason ? `<span class="quiet">${esc(r.reason)}</span>` : ""}</li>`).join("");
  return `<div class="sh"><h2>Runs</h2><span class="count">${runs.length}</span></div><ol class="runs">${rows}</ol>`;
}

const list = (title, items, open = false) => items.length
  ? `<details${open ? " open" : ""}><summary>${esc(title)}<span class="peek">${items.length}</span></summary><div class="body"><ul>${items.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></div></details>`
  : "";
const log = (title, body) => body ? `<div class="sh"><h2>${esc(title)}</h2></div><pre class="trailers">${esc(body)}</pre>` : "";

export function renderJob(j) {
  const checks = (j.checks ?? []).map((c) => `<li>${c.ok ? "✓" : "✗"} ${esc(c.name)} <span class="quiet">${esc(c.seconds)} s</span></li>`).join("");
  return `<div class="page"><p><a href="#/jobs">← Jobs</a></p>` +
    `<div class="ih"><span class="id">${esc(j.name)}</span><h1>${esc(j.item?.title || j.name)}</h1>${badge(j.state)}</div>` +
    `<dl class="facts">${fact("Repo", esc(j.repo))}${fact("Started", esc(clock(j.started)))}${j.cost !== undefined ? fact("Cost", esc(money(j.cost))) : ""}` +
    `${j.model ? fact("Model", esc(j.model)) : ""}${j.commit ? fact("Commit", j.commitUrl ? `<a href="${esc(j.commitUrl)}"><code>${esc(j.commit.slice(0, 7))}</code></a>` : `<code>${esc(j.commit.slice(0, 7))}</code>`) : ""}` +
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
    const project = hashQuery().get("project");
    b.disabled = true;
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(b.dataset.diff)}/diff${project ? `?project=${encodeURIComponent(project)}` : ""}`);
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
