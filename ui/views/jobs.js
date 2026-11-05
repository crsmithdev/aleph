// The Jobs view (the list) and the Job view (a job's header, KPI strip, timeline, spec, result, and the
// review, checks and diff in Detail panels). Render functions take the /api/jobs objects and return HTML
// strings, with no DOM, so tests can call them.
import { pageHead, sectionHead, blockersHtml, bytes, chip, tag, count, STATES, badge, cmd, crumb, dataTable, heads, pagedTable, dur, empty, esc, filterBar, goQuery, hashQuery, idLink, limitOf, loadDiff, loadingLine, localId, md, money, pager, priorityBadge, projectOf, scopeBar, shortModel, sortHead, sortRows, span, WINDOW_DAYS, wireTable, windowOf, when, wkText } from "../lib.js";
import { barLabel, barsOf, costText, fold, fromTo, gaps, lifespan, panel, renderKpis, renderTimeline, spans, timeText, waitEvent } from "../timeline.js";


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
export const listUrl = (_params, q = new URLSearchParams()) => {
  const out = new URLSearchParams();
  for (const k of ["repo", "condition", "role"]) if (q.get(k)) out.set(k, q.get(k));
  if (projectOf(q)) out.set("project", projectOf(q));
  const days = daysOf(q);
  if (Number(days) !== 7) out.set("days", String(days));
  const s = out.toString();
  return s ? `/api/jobs?${s}` : "/api/jobs";
};

/** The Job view, routed at `#/jobs/<name>` through ui/views/job.js. */
export const detail = {
  path: "/jobs/:name",
  title: "Job",
  group: "factory",
  api: "/api/jobs/:name",
  render: (job) => renderJob(job),
  mount: (root) => mountJob(root),
};

const href = (path, params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  return `#${path}${q.toString() ? `?${q}` : ""}`;
};

const PAGE = 50;

/** What scopes the page and goes to the API: the project and the window. */
export function renderScope(jobs, f = {}) {
  const repos = [...new Set([...jobs.map((j) => j.repo), f.repo].filter(Boolean))].sort();
  return scopeBar(projectOf({ get: (k) => f[k] }), windowShown(f), repos);
}

const ROLES = ["worker", "intake", "triage", "planner", "firefighter", "director", "reviewer"];
export const renderFilters = (f = {}) => filterBar([
  { label: "State", name: "condition", value: f.condition || "", options: [{ value: "", label: "All" }, ...STATES] },
  { label: "Role", name: "role", value: f.role || "", options: [{ value: "", label: "All" }, ...ROLES] },
]);

const titleOf = (j) => j.item?.title || j.name;
const took = (j) => (j.ended ? Date.parse(j.ended) - Date.parse(j.started) : -1);
const SORT = { name: (j) => j.name, title: titleOf, condition: (j) => j.condition, repo: (j) => j.repo, model: (j) => shortModel(j.model), took, cost: (j) => j.cost ?? -1, started: (j) => Date.parse(j.started) || 0 };
/** The keys that start with the largest first. */
const DOWN_FIRST = new Set(["took", "cost", "started"]);
const sortOf = (f) => (f.sort && SORT[f.sort] ? { key: f.sort, dir: f.dir === "asc" ? 1 : -1 } : { key: "started", dir: -1 });

/** The jobs the search keeps, in the sort's order. */
export function shownJobs(jobs, f = {}) {
  const q = (f.q ?? "").trim().toLowerCase(), sort = sortOf(f);
  return sortRows(jobs.filter((j) => !q || `${j.name} ${titleOf(j)}`.toLowerCase().includes(q)), SORT, sort);
}

export function renderJobsTable(jobs, f = {}) {
  const all = shownJobs(jobs, f);
  if (!all.length) return empty("No job matches.", "Widen the window or clear a filter.");
  const shown = all.slice(0, limitOf(f, PAGE)), sort = sortOf(f);
  const h = (label, key, c) => sortHead(label, key, sort, c);
  // Columns: started, id, title, state, project, model, then took and cost: the Issues table's order.
  const rows = shown.map((j) => {
    const url = href(`/jobs/${encodeURIComponent(j.name)}`);
    return `<tr class="rowlink"><td class="time">${esc(when(j.started))}</td><td>${idLink(localId(j.name, j.repo), url)}</td><td class="wide" title="${esc(titleOf(j))}"><a href="${esc(url)}">${esc(titleOf(j))}</a></td><td>${badge(j.condition)}</td><td>${esc(j.repo)}</td><td>${esc(shortModel(j.model))}</td>` +
      `<td class="num">${j.ended ? esc(span(j.started, j.ended)) : ""}</td><td class="num">${j.cost !== undefined ? esc(money(j.cost)) : ""}</td></tr>`;
  }).join("");
  return dataTable(h("Started", "started") + h("Job", "name") + h("Title", "title") + h("State", "condition") + h("Project", "repo") + h("Model", "model") + h("Took", "took", { num: true }) + h("Cost", "cost", { num: true }), rows) + pager(shown.length, all.length, PAGE);
}

/** Wire the state filter (it fetches again), the search, the sort and the pager; the last three redraw the table once `jobsNow()` gives the jobs. */
export function wireJobs(root, jobsNow) {
  const redraw = () => { const jobs = jobsNow(); if (jobs) root.querySelector("#jobs-table").innerHTML = renderJobsTable(jobs, Object.fromEntries(hashQuery())); };
  wireTable(root, { redraw, sortOf, downFirst: DOWN_FIRST, page: PAGE, search: "jobs-search" });
  const table = root.onclick;
  root.onclick = (e) => {
    const seg = e.target.closest?.(".card .seg button");
    if (seg) return goQuery({ [seg.parentElement.dataset.name]: seg.dataset.value });
    if (!e.target.closest?.(".paged")) table(e);
  };
}

const TRANSCRIPT = new Set(["output.log", "review.log"]);
/** A run's log files as buttons, with a place beneath for the one that loads. "" for a run with no logs. */
export function logButtons(job, r) {
  if (!r.logs?.length) return "";
  const buttons = r.logs.map((l) => `<button class="link" type="button" data-log="${esc(r.id)}" data-job="${esc(job)}" data-file="${esc(l.name)}"${TRANSCRIPT.has(l.name) ? ' data-as="transcript"' : ""} title="${esc(`${l.name}, ${bytes(l.size)}`)}">${esc(l.name.replace(/\.log$/, ""))}</button>`).join(" · ");
  return `<div class="dp-logs" data-logs><span class="quiet">logs:</span> ${buttons}<div class="logbody" hidden></div></div>`;
}

const CUT = 600;
/** A transcript's steps: assistant text, each tool call with its input, its result collapsed when long. */
export function renderTranscript(steps) {
  return steps.map((s) => {
    if (s.kind === "text") return `<div class="md">${md(s.text)}</div>`;
    const input = typeof s.input === "string" ? s.input : JSON.stringify(s.input, null, 2);
    const out = s.output === undefined ? "" : s.output.length > CUT || s.output.split("\n").length > 12
      ? `<details><summary>${s.error ? "error, " : ""}result (${esc(bytes(s.output.length))})</summary><pre class="trailers">${esc(s.output)}</pre></details>`
      : `<pre class="trailers">${esc(s.output)}</pre>`;
    return `<div class="step"><b>${esc(s.name)}</b><pre class="trailers">${esc(input ?? "")}</pre>${out}</div>`;
  }).join("") || empty("Nothing to show.");
}

/** Text with its `code` spans set as code, escaped. */
export const inline = (t) => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>");

const RUN_TAG = { stuck: ["Stuck", "stuck"], failed: ["Failed", "stuck"], dropped: ["Dropped", "quiet"], passed: ["Passed", "done"], landed: ["Landed", "done"], done: ["Done", "done"], awaiting: ["Awaiting you", "need"], running: ["Running", "run"] };
const shortSha = (j) => (j.commitUrl ? idLink(j.commit.slice(0, 7), j.commitUrl) : `<code>${esc(j.commit.slice(0, 7))}</code>`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The event of one run: its condition as the tag, then its reason, the commit of a land, and its log buttons. */
function runEvent(job, x, nth, j) {
  const r = x.r, [text, tone] = RUN_TAG[r.condition] ?? [r.condition, "quiet"];
  const name = barLabel(r, nth);
  const what = r.kind === "land" && r.condition === "landed" && j.commit ? `${esc(name[0].toUpperCase() + name.slice(1))} as ${shortSha(j)}.`
    : r.reason ? `${esc(name[0].toUpperCase() + name.slice(1))}: ${inline(r.reason)}` : `${esc(name[0].toUpperCase() + name.slice(1))}.`;
  return { at: x.end, tag: text, tone, html: what + logButtons(job, r) };
}

/** "+23 −2" and "2 files" from a diff stat's last line; null for none. */
export function change(stat) {
  const m = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(String(stat ?? ""));
  return m ? { lines: `+${m[2] ?? 0} −${m[3] ?? 0}`, files: plural(Number(m[1]), "file") } : null;
}

/** The runs that do the work: not the reviews, which run inside a build, and not an old facts run after the land. */
const workRuns = (j) => (j.runs ?? []).filter((r) => r.kind !== "review" && r.kind !== "facts");

/** The Timeline's segments for a job: Work (builds, reviews in them, the land). */
export function jobSegments(j, now = Date.now()) {
  const work = spans(workRuns(j), now);
  const count = {};
  for (const x of work) count[x.r.kind] = (count[x.r.kind] ?? 0) + 1;
  const seen = {};
  const events = work.map((x) => { seen[x.r.kind] = (seen[x.r.kind] ?? 0) + 1; return runEvent(j.name, x, count[x.r.kind] > 1 ? seen[x.r.kind] : 0, j); });
  const waits = work.length ? gaps(work, work[0].start, NaN) : [];
  const builds = count.worker ?? 0, lands = count.land ?? 0;
  const segments = [];
  if (work.length) segments.push({
    title: "Work", aside: j.condition === "landed" ? "to the land" : "",
    rows: [{
      head: `<span class="quiet">${esc([builds ? plural(builds, "build") : "", lands ? plural(lands, "land") : ""].filter(Boolean).join(", ") || plural(work.length, "run"))}</span>`,
      bars: barsOf(work, { cost: true }), waits, marks: [], result: badge(j.condition),
      time: timeText(Math.max(...work.map((x) => x.end)) - work[0].start), cost: costText(work.reduce((n, x) => n + (x.r.cost ?? 0), 0)),
      events: [...waits.map((w) => waitEvent(w, j.holds ?? [])), ...events,
        ...(j.defaults ?? []).map((d) => ({ tag: "Default", tone: "need", html: inline(d) })),
        ...(j.followups ?? []).map((f) => ({ tag: "Follow-up", tone: "need", html: inline(f) }))],
    }],
  });
  return segments;
}

/** The KPI strip of a job: builds, elapsed, cost, change, and what checked it. */
function jobKpis(j, now = Date.now()) {
  const runs = spans(workRuns(j), now), builds = runs.filter((x) => x.r.kind === "worker");
  const bad = builds.filter((x) => ["stuck", "failed"].includes(x.r.condition)).length, last = builds.at(-1)?.r.condition;
  const end = runs.length ? Math.max(...runs.map((x) => x.end)) : NaN, c = change(j.stat);
  return renderKpis([
    { k: "Builds", v: esc(builds.length), sub: bad ? `<span class="bad">${esc(`${bad} stuck${["passed", "landed", "awaiting"].includes(last) ? ", then fixed" : ""}`)}</span>` : "" },
    { k: "Elapsed", v: esc(runs.length ? lifespan(end - runs[0].start) : "–"), sub: esc(runs.length ? fromTo(runs[0].start, end) : j.started ? `started ${when(j.started)}` : "") },
    { k: "Cost", v: j.cost !== undefined ? esc(money(j.cost)) : "–", sub: j.wk ? esc(wkText(j.wk)) : "" },
    { k: "Change", v: esc(c?.lines ?? "–"), sub: [c ? esc(c.files) : "", j.commit ? shortSha(j) : ""].filter(Boolean).join(", ") },
    { k: "Checked by", v: esc(j.checkedBy?.join(", ") || "–"), text: !!j.checkedBy?.length, sub: j.look ? esc(`look: about ${j.look}min`) : "" },
  ]);
}

/** The Job page: the header and its pills, the KPI strip, the Timeline, the Spec and the Result, then the Detail panels. */
export function renderJob(j) {
  const id = localId(j.name, j.repo), p = j.parent;
  // The issue the job works on: a part's parent, else the job's own item.
  const iss = p ?? (j.item && { id: `${j.repo}-${j.item.id}`, href: `#/issues/${encodeURIComponent(j.repo)}/${j.item.id}` });
  const back = iss ? [[j.repo, `#/issues?project=${encodeURIComponent(j.repo)}`], [`issue ${localId(iss.id, j.repo)}`, iss.href], [`job ${id}`]] : [[j.repo], ["jobs", "#/factory/jobs"], [id]];
  const nav = [iss ? `<a class="act" href="${esc(iss.href)}">Issue</a>` : "", p?.next ? `<a class="act" href="${esc(p.next.href)}">Next part: ${esc(localId(p.next.id, j.repo))}</a>` : "", j.trace ? `<a class="act" href="${esc(j.trace)}">Trace</a>` : ""].join("");
  const pills = `<div class="status-row">${badge(j.condition)}${j.item ? priorityBadge(j.item.priority) : ""}${p ? chip("", { html: `part ${esc(p.n)} of ${esc(p.of)} of ${idLink(localId(p.id, j.repo), p.href)}` }) : ""}<span class="idp">${esc(j.name)}</span></div>`;
  const blocked = j.blockers?.length ? `<div class="dp-blocked"><span class="quiet">Waits on</span>${blockersHtml(j.blockers, j.repo, j.item.id)}</div>` : "";
  const checkRun = (j.runs ?? []).findLast((r) => r.logs?.some((l) => l.name === "checks.log"));
  const checkLog = checkRun ? `<button class="link" type="button" data-log="${esc(checkRun.id)}" data-job="${esc(j.name)}" data-file="checks.log">checks.log</button>` : "";
  // A check that ran `bun test` has a record of its tests: the counts, and its failed tests with their failure.
  const counts = (t) => ["ran", "passed", "failed", "skipped"].map((k) => `<td class="num">${t ? esc(count(t[k])) : "–"}</td>`).join("");
  const failures = (j.checks ?? []).filter((c) => c.tests?.failed).map((c) => {
    const more = c.tests.failed - c.tests.failures.length;
    return c.tests.failures.map((f) => `<p><code>${esc(f.file)}</code> ${esc(f.name)} <span class="quiet">${esc(c.name)}</span></p><pre class="trailers">${esc(f.message)}</pre>`).join("") +
      (more > 0 ? `<p class="quiet">${esc(plural(more, "more failed test"))} of ${esc(c.name)} not recorded.</p>` : "");
  }).join("");
  const checks = j.checks?.length
    ? `<div class="dp-logs" data-logs>${pagedTable(heads(["Check", "Result", "Ran", "Passed", "Failed", "Skipped", "Took", "Log"], ["Ran", "Passed", "Failed", "Skipped", "Took"]), j.checks.map((c) => `<tr><td>${esc(c.name)}</td><td>${tag(c.ok ? "pass" : "fail", c.ok ? "done" : "stuck")}</td>${counts(c.tests)}<td class="num">${esc(dur(c.seconds))}</td><td>${checkLog}</td></tr>`))}${failures}<div class="logbody" hidden></div></div>`
    : empty("No check ran.");
  const passed = (j.checks ?? []).filter((c) => c.ok).length, verdict = j.verdict, c = change(j.stat);
  return `<div class="page dp-page">${crumb(iss ? iss.href : "#/factory/jobs", back)}` +
    pageHead(j.item?.title || j.name, { aside: nav }) + `${pills}${blocked}` +
    (j.reason && !(j.runs ?? []).length ? `<p class="quiet q">${esc(j.reason)}</p>` : "") +
    (j.condition === "awaiting" ? `<div class="actions">${cmd(`aleph land ${j.name}`, { primary: true })}${cmd(`aleph drop ${j.name}`)}</div>` : "") +
    jobKpis(j) + renderTimeline(jobSegments(j)) +
    (j.spec ? panel("spec", "Spec", `<div class="md">${md(j.spec)}</div>`) : "") +
    (j.result ? panel("result", "Result", `<div class="md">${md(j.result)}</div>`) : "") +
    `<div class="dp-detail">${sectionHead("Detail")}` +
    (j.review ? fold("Review", verdict ? tag(verdict, verdict === "pass" ? "done" : "stuck") : "", `<div class="md">${md(j.review)}</div>`) : "") +
    (j.checks ? fold("Checks", tag(`${passed} / ${j.checks.length}`, passed === j.checks.length ? "done" : "stuck"), checks) : "") +
    fold("Diff", c ? esc(c.lines) : "", `${j.stat ? `<pre class="trailers">${esc(j.stat)}</pre>` : ""}<div class="diff-panel" id="diff" data-job="${esc(j.name)}">${loadingLine("the diff")}</div>`) +
    `</div></div>`;
}

/** The Job page's mount: load the diff into the Diff panel, once. */
export async function mountJob(root) {
  const out = root.querySelector?.("#diff[data-job]");
  if (!out || out.dataset.loaded) return;
  out.dataset.loaded = "1";
  await loadDiff(out, `/api/jobs/${encodeURIComponent(out.dataset.job)}/diff`);
}

// Loads a log file when its button is clicked: the page itself carries only names and sizes.
if (typeof document !== "undefined") {
  document.addEventListener("click", async (e) => {
    const b = e.target.closest?.("[data-log]");
    if (!b) return;
    const out = b.closest("[data-logs]").querySelector(".logbody");
    const q = b.dataset.as ? `?as=${b.dataset.as}` : "";
    out.hidden = false;
    out.innerHTML = loadingLine("the log");
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(b.dataset.job)}/runs/${encodeURIComponent(b.dataset.log)}/logs/${encodeURIComponent(b.dataset.file)}${q}`);
      if (!res.ok) out.textContent = `The log failed to load (${res.status}).`;
      else if (b.dataset.as) out.innerHTML = renderTranscript(await res.json());
      else out.innerHTML = `<pre class="trailers">${esc(await res.text())}</pre>`;
    } catch (err) { out.textContent = `The log failed to load: ${err.message}`; }
  });
}
