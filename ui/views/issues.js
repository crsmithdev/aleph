// The Issues view: every issue by repo, with filters, a factory lens (goals,
// derived state, readiness, the chain) and a form that files one. Render
// functions take the /api/issues rows and return HTML; no DOM, so tests call them.
import { empty, esc, md } from "../lib.js";

export const view = {
  path: "/issues",
  title: "Issues",
  group: "factory",
  order: 2,
  api: "/api/issues",
  render: (rows) => renderIssues(rows, hashOptions()),
};

/** The filters, from the route's query: ?status=open&label=x&q=text&lens=factory. */
export function hashOptions() {
  if (typeof location === "undefined") return {};
  const h = location.hash.replace(/^#/, "");
  const q = new URLSearchParams(h.includes("?") ? h.slice(h.indexOf("?") + 1) : "");
  return { status: q.get("status") ?? "", label: q.get("label") ?? "", q: q.get("q") ?? "", lens: q.get("lens") === "factory", project: q.get("project") ?? "" };
}

export const ref = (r) => `${r.repo}-${r.id}`;
export const href = (r) => `#/issues/${encodeURIComponent(r.repo)}/${r.id}`;
const badge = (text, cls = "") => `<span class="badge ${cls}">${esc(text)}</span>`;
const stateBadge = (s) => badge(s, s === "done" ? "done" : s === "stuck" || s === "needs-you" ? "stuck" : s === "running" ? "run" : "");

/** The rows that pass the filters. */
export function filterRows(rows, o = {}) {
  const q = (o.q ?? "").trim().toLowerCase();
  return rows.filter((r) =>
    (!o.status || r.status === o.status) && (!o.label || r.labels.includes(o.label)) && (!q || r.title.toLowerCase().includes(q)) &&
    (!o.lens || r.labels.includes("goal")));
}

/** Goals ordered so that what a goal waits on comes before it; ties keep repo and number order. */
export function chainOrder(rows) {
  const byRef = new Map(rows.map((r) => [ref(r), r]));
  const out = [], seen = new Set();
  const visit = (r) => {
    if (seen.has(ref(r))) return;
    seen.add(ref(r));
    const dep = r.waiting_on ? byRef.get(r.waiting_on) : null;
    if (dep) visit(dep);
    out.push(r);
  };
  for (const r of [...rows].sort((a, b) => a.repo.localeCompare(b.repo) || a.id - b.id)) visit(r);
  return out;
}

const readiness = (r) => [r.due ? `due ${r.due}` : "", r.waiting_on ? `waits on ${r.waiting_on}` : ""].filter(Boolean).join(", ");

export function renderFilters(rows, o = {}) {
  const labels = [...new Set(rows.flatMap((r) => r.labels))].sort();
  const opt = (v, cur, text = v) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(text)}</option>`;
  return `<form class="filters" data-ui="issues-filter" onsubmit="return false">` +
    `<label>Status <select data-filter="status">${opt("", o.status, "Any")}${["open", "done", "dropped"].map((s) => opt(s, o.status)).join("")}</select></label>` +
    `<label>Label <select data-filter="label">${opt("", o.label, "Any")}${labels.map((l) => opt(l, o.label)).join("")}</select></label>` +
    `<label>Title <input type="search" data-filter="q" value="${esc(o.q ?? "")}" placeholder="text in the title"></label>` +
    `<label><input type="checkbox" data-filter="lens"${o.lens ? " checked" : ""}> Factory lens</label></form>`;
}

export function renderGroups(rows, o = {}) {
  const shown = filterRows(rows, o);
  if (!shown.length) return empty("No issue matches.", "File one below, or loosen the filters.");
  const by = new Map();
  for (const r of shown) by.set(r.repo, [...(by.get(r.repo) ?? []), r]);
  return [...by].map(([repo, items]) =>
    `<section class="repo" aria-label="${esc(repo)}"><div class="sh"><h2>${esc(repo)}</h2><span class="count">${items.length}</span></div>` +
    `<ul class="issues">${items.map((r) => `<li><a class="id" href="${esc(href(r))}">${esc(ref(r))}</a> <span class="t">${esc(r.title)}</span> ` +
      `${badge(r.status, r.status === "done" ? "done" : "")}${r.labels.map((l) => badge(l)).join("")}` +
      `${readiness(r) ? ` <small class="quiet">${esc(readiness(r))}</small>` : ""}${r.notes ? ` <small class="quiet">${r.notes} ${r.notes === 1 ? "note" : "notes"}</small>` : ""}</li>`).join("")}</ul></section>`).join("");
}

/** The factory lens: goals only, in chain order, each with its derived state and readiness. */
export function renderLens(rows, o = {}) {
  const goals = chainOrder(filterRows(rows, { ...o, lens: true }));
  if (!goals.length) return empty("No goal issue.", "A factory goal is an issue labelled <code>goal</code>.");
  return `<ol class="chain">${goals.map((r) =>
    `<li><a class="id" href="${esc(href(r))}">${esc(ref(r))}</a> <span class="t">${esc(r.title)}</span> ` +
    `${r.state ? stateBadge(r.state) : badge(r.status)}` +
    `${r.why ? ` <small class="quiet">${esc(r.why)}</small>` : ""}` +
    `${r.due ? ` <small class="quiet">due ${esc(r.due)}</small>` : ""}${r.waiting_on ? ` <small class="quiet">waits on ${esc(r.waiting_on)}</small>` : ""}</li>`).join("")}</ol>`;
}

export const BODY_TEMPLATE = "## Goal\n\n\n\n## Oracle\n\n\n\n## Time box\n\n";

export function renderForm(rows, o = {}) {
  const repos = [...new Set(rows.map((r) => r.repo))];
  return `<details class="new"><summary>File an issue</summary>` +
    `<form data-ui="issue-form" class="stack">` +
    `<label>Project <input name="repo" required list="issue-repos" value="${esc(o.project ?? "")}"><datalist id="issue-repos">${repos.map((r) => `<option value="${esc(r)}">`).join("")}</datalist></label>` +
    `<label>Title <input name="title" required></label>` +
    `<label>Body <textarea name="body" rows="12">${esc(BODY_TEMPLATE)}</textarea></label>` +
    `<label>Labels <input name="labels" placeholder="comma separated"></label>` +
    `<label><input type="checkbox" name="goal"> Factory goal (adds the <code>goal</code> label)</label>` +
    `<label>Waits on <input name="waitingOn" placeholder="repo-n"></label>` +
    `<label>Due <input name="due" type="date"></label>` +
    `<button type="submit" class="cmd primary">File issue</button> <span class="form-msg" role="status"></span></form></details>`;
}

export function renderIssues(rows, o = {}) {
  return `<div class="page"><h1>Issues</h1>${renderFilters(rows, o)}` +
    (o.lens ? renderLens(rows, o) : renderGroups(rows, o)) + renderForm(rows, o) + `</div>`;
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
  return `<div class="page"><p><a href="#/issues">Issues</a></p><div class="ih"><span class="id">${esc(ref(d))}</span><h1>${esc(d.title)}</h1>` +
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
  document.addEventListener("change", (e) => {
    const f = e.target.closest && e.target.closest("[data-filter]");
    if (!f) return;
    setQuery(f.dataset.filter, f.type === "checkbox" ? (f.checked ? "factory" : "") : f.value);
  });
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest && e.target.closest('form[data-ui="issue-form"]');
    if (!form) return;
    e.preventDefault();
    const v = (n) => form.elements[n].value.trim();
    const labels = v("labels").split(",").map((s) => s.trim()).filter(Boolean);
    if (form.elements.goal.checked && !labels.includes("goal")) labels.push("goal");
    const msg = form.querySelector(".form-msg");
    const project = new URLSearchParams(location.hash.split("?")[1] ?? "").get("project");
    try {
      const res = await fetch("/api/issues" + (project ? `?project=${encodeURIComponent(project)}` : ""), {
        method: "POST", headers: { "content-type": "application/json", "x-aleph-ui": "1" },
        body: JSON.stringify({ repo: v("repo"), title: v("title"), body: form.elements.body.value, labels, waitingOn: v("waitingOn"), due: v("due") }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `answered ${res.status}`);
      location.hash = `/issues/${encodeURIComponent(v("repo"))}/${data.added}` + (project ? `?project=${encodeURIComponent(project)}` : "");
    } catch (err) { msg.textContent = `Could not file it: ${err.message}`; }
  });
}
