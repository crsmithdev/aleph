// The Jobs view (the list) and the Job view (a job's header, KPI strip, timeline, spec, result, and the
// review, checks and diff in Detail panels). Render functions take the /api/jobs objects and return HTML
// strings, with no DOM, so tests can call them.
import { fold, pageHead, sectionHead, blockersHtml, bytes, chip, codeText, tag, count, badge, statusRow, cmd, crumb, dataTable, heads, pagedTable, dur, empty, esc, filterBar, goQuery, hashQuery, idLink, limitOf, linkButton, loadDiff, loadingLine, md, money, pager, priorityBadge, shortModel, sortHead, sortRows, span, wireTable, when, wkText, scope } from "../lib.js";
import { barLabel, detailPanel, fromTo, laneRow, panel, renderKpis, renderTimeline, runEvent, spans } from "../timeline.js";
import { ACTORS, shortText, issueHref, jobHref, STATES } from "../../lib/naming.ts";

/** The most rows the list asks for: one page of the API holds the whole window. */
const ALL = 2000;
/** The list's data URL: the project, the window and the state in the hash go to the API; the role filters on the page. */
export const listUrl = (_params, q = new URLSearchParams()) => {
  const s = scope(q), out = new URLSearchParams();
  if (s.project) out.set("project", s.project);
  if (s.window !== "week") out.set("window", s.window);
  if (q.get("state")) out.set("state", q.get("state"));
  out.set("limit", String(ALL));
  return `/api/jobs?${out}`;
};

/** The Job view, routed at `#/jobs/<job ID>`. */
export const view = {
  path: "/jobs/:id",
  title: "Job",
  group: "factory",
  api: "/api/jobs/:id",
  render: (job) => renderJob(job),
  mount: (root) => mountJob(root),
};

const PAGE = 50;

/** What scopes the page and goes to the API: the project and the window. */
export function renderScope(jobs, f = {}) {
  const repos = [...new Set(jobs.map((j) => j.repo).filter(Boolean))].sort();
  return scope({ get: (k) => f[k] }).bar({ more: repos });
}

const ROLES = ACTORS.filter((a) => !["human", "rule", "gate", "check", "firefighter"].includes(a));
export const renderFilters = (f = {}) => filterBar([
  { label: "State", name: "state", value: f.state || "", options: [{ value: "", label: "All" }, ...STATES] },
  { label: "Role", name: "role", value: f.role || "", options: [{ value: "", label: "All" }, ...ROLES] },
]);

const titleOf = (j) => j.title;
const SORT = { id: (j) => j.id, title: titleOf, state: (j) => j.state, repo: (j) => j.repo, model: (j) => shortModel(j.model), took: (j) => j.seconds ?? -1, cost: (j) => j.cost ?? -1, started: (j) => Date.parse(j.started) || 0 };
/** The keys that start with the largest first. */
const DOWN_FIRST = new Set(["took", "cost", "started"]);
const sortOf = (f) => (f.sort && SORT[f.sort] ? { key: f.sort, dir: f.dir === "asc" ? 1 : -1 } : { key: "started", dir: -1 });

/** The jobs the role and the search keep, in the sort's order. */
function shownJobs(jobs, f = {}) {
  const q = (f.q ?? "").trim().toLowerCase(), sort = sortOf(f);
  return sortRows(jobs.filter((j) => (!f.role || j.actor === f.role) && (!q || `${j.id} ${titleOf(j)}`.toLowerCase().includes(q))), SORT, sort);
}

export function renderJobsTable(jobs, f = {}) {
  const all = shownJobs(jobs, f);
  if (!all.length) return empty("No job matches.", "Widen the window or clear a filter.");
  const shown = all.slice(0, limitOf(f, PAGE)), sort = sortOf(f);
  const h = (label, key, c) => sortHead(label, key, sort, c);
  // Columns: id, title, state, project, model, took, cost, then started: the Issues table's order.
  const rows = shown.map((j) => {
    const url = jobHref(j.id);
    return `<tr class="rowlink" data-annotate="${esc(j.id)}"><td>${idLink(shortText(j.id), url)}</td><td class="wide" title="${esc(titleOf(j))}"><a href="${esc(url)}">${esc(titleOf(j))}</a></td><td>${badge(j.state)}</td><td>${esc(j.repo)}</td><td>${esc(shortModel(j.model))}</td>` +
      `<td class="num">${j.ended ? esc(span(j.started, j.ended)) : ""}</td><td class="num">${j.cost !== null ? esc(money(j.cost)) : ""}</td><td class="time">${esc(when(j.started))}</td></tr>`;
  }).join("");
  return dataTable(h("Job", "id") + h("Title", "title") + h("State", "state") + h("Project", "repo") + h("Model", "model") + h("Took", "took", { num: true }) + h("Cost", "cost", { num: true }) + h("Started", "started", { num: true }), rows) + pager(shown.length, all.length, PAGE);
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
function logButtons(r) {
  if (!r.logs?.length) return "";
  const buttons = r.logs.map((l) => `<button class="link" type="button" data-log="${esc(r.id)}" data-job="${esc(r.job)}" data-file="${esc(l.name)}"${TRANSCRIPT.has(l.name) ? ' data-as="transcript"' : ""} title="${esc(`${l.name}, ${bytes(l.size)}`)}">${esc(l.name.replace(/\.log$/, ""))}</button>`).join(" · ");
  return `<div class="dp-logs" data-logs><span class="quiet">logs:</span> ${buttons}<div class="logbody" hidden></div></div>`;
}

const CUT = 600;
/** A transcript's steps: assistant text, each tool call with its input, its result collapsed when long. */
export function renderTranscript(steps) {
  return steps.map((s) => {
    if (s.kind === "text") return `<div class="md">${md(s.text)}</div>`;
    const input = typeof s.input === "string" ? s.input : JSON.stringify(s.input, null, 2);
    const out = s.output === undefined ? "" : s.output.length > CUT || s.output.split("\n").length > 12
      ? fold(`${s.error ? "error, " : ""}result (${esc(bytes(s.output.length))})`, `<pre class="trailers">${esc(s.output)}</pre>`)
      : `<pre class="trailers">${esc(s.output)}</pre>`;
    return `<div class="step"><b>${esc(s.name)}</b><pre class="trailers">${esc(input ?? "")}</pre>${out}</div>`;
  }).join("") || empty("Nothing to show.");
}

const shortSha = (j) => (j.commitUrl ? idLink(j.commit.slice(0, 7), j.commitUrl) : `<code>${esc(j.commit.slice(0, 7))}</code>`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The event of one run: its condition as the tag, then its reason, the commit of a land, its job ID and its log buttons. */
function jobEvent(x, nth, j) {
  const r = x.r, name = barLabel(r, nth);
  const e = runEvent(x, name, r.kind === "land" && r.condition === "landed" && j.commit ? `${esc(name)} as ${shortSha(j)}.` : null);
  return { ...e, html: e.html + (r.job ? ` <span class="quiet">${esc(r.job)}</span>` : "") + logButtons(r) };
}

/** "+23 −2" and "2 files" from a diff stat's last line; null for none. */
export function change(stat) {
  const m = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(String(stat ?? ""));
  return m ? { lines: `+${m[2] ?? 0} −${m[3] ?? 0}`, files: plural(Number(m[1]), "file") } : null;
}

/** The runs that do the work: not the reviews, which run inside a build, and not an old facts run after the land. */
const workRuns = (j) => (j.runs ?? []).filter((r) => r.kind !== "review" && r.kind !== "facts");

/** The Timeline's segments for a job: Work (builds, reviews in them, the land). */
function jobSegments(j, now = Date.now()) {
  const work = spans(workRuns(j), now);
  const count = {};
  for (const x of work) count[x.r.kind] = (count[x.r.kind] ?? 0) + 1;
  const seen = {};
  const events = work.map((x) => { seen[x.r.kind] = (seen[x.r.kind] ?? 0) + 1; return jobEvent(x, count[x.r.kind] > 1 ? seen[x.r.kind] : 0, j); });
  const builds = count.worker ?? 0, lands = count.land ?? 0;
  const segments = [];
  if (work.length) segments.push({
    title: "Work", aside: j.condition === "landed" ? "to the land" : "",
    rows: [laneRow({
      head: `<span class="quiet">${esc([builds ? plural(builds, "build") : "", lands ? plural(lands, "land") : ""].filter(Boolean).join(", ") || plural(work.length, "job"))}</span>`,
      runs: work, from: work[0].start, result: badge(j.condition), cost: true, holds: j.holds ?? [], runEvents: () => events,
      events: [...(j.defaults ?? []).map((d) => ({ tag: "Default", tone: "need", html: codeText(d) })),
        ...(j.followups ?? []).map((f) => ({ tag: "Follow-up", tone: "need", html: codeText(f) }))],
    })],
  });
  return segments;
}

/** The KPI strip of a job: builds, elapsed, cost, change, and what checked it. */
function jobKpis(j, now = Date.now()) {
  const runs = spans(workRuns(j), now), builds = runs.filter((x) => x.r.kind === "worker");
  const bad = builds.filter((x) => ["returned", "failed"].includes(x.r.condition)).length, last = builds.at(-1)?.r.condition;
  const end = runs.length ? Math.max(...runs.map((x) => x.end)) : NaN, c = change(j.stat);
  return renderKpis([
    { k: "Builds", v: esc(builds.length), sub: bad ? `<span class="bad">${esc(`${bad} stuck${["passed", "landed", "waiting"].includes(last) ? ", then fixed" : ""}`)}</span>` : "" },
    { k: "Elapsed", v: esc(runs.length ? dur((end - runs[0].start) / 1000) : "–"), sub: esc(runs.length ? fromTo(runs[0].start, end) : j.started ? `started ${when(j.started)}` : "") },
    { k: "Cost", v: j.cost !== undefined ? esc(money(j.cost)) : "–", sub: j.wk ? esc(wkText(j.wk)) : "" },
    { k: "Change", v: esc(c?.lines ?? "–"), sub: [c ? esc(c.files) : "", j.commit ? shortSha(j) : ""].filter(Boolean).join(", ") },
    { k: "Checked by", v: esc(j.checkedBy?.join(", ") || "–"), text: !!j.checkedBy?.length, sub: j.look ? esc(`look: about ${j.look}min`) : "" },
  ]);
}

/** The Job page: the header and its pills, the KPI strip, the Timeline, the Spec and the Result, then the Detail panels. */
export function renderJob(j) {
  const id = shortText(j.name), p = j.parent;
  // The issue the job works on: a part's parent, else the job's own item.
  const iss = p ?? (j.item && { id: `${j.repo}-${j.item.id}`, href: issueHref(`${j.repo}-${j.item.id}`) });
  const back = iss ? [[j.repo, `#/issues?project=${encodeURIComponent(j.repo)}`], [`issue ${shortText(iss.id)}`, iss.href], [`job ${id}`]] : [[j.repo], ["jobs", "#/factory/jobs"], [id]];
  const nav = [iss ? linkButton("Issue", iss.href) : "", p?.next ? linkButton(`Next sub-issue: ${shortText(p.next.id)}`, p.next.href) : "", j.trace ? linkButton("Trace", j.trace) : ""].join("");
  const pills = statusRow(badge(j.condition), j.item ? priorityBadge(j.item.priority) : "", `${p ? chip("", { html: `sub-issue ${esc(p.n)} of ${esc(p.of)} of ${idLink(shortText(p.id), p.href)}` }) : ""}<span class="idp">${esc(shortText(j.name))}</span>`);
  const blocked = j.blockers?.length ? `<div class="dp-blocked"><span class="quiet">Waits on</span>${blockersHtml(j.blockers, j.repo, j.item.id)}</div>` : "";
  const checkRun = (j.runs ?? []).findLast((r) => r.logs?.some((l) => l.name === "checks.log"));
  const checkLog = checkRun ? `<button class="link" type="button" data-log="${esc(checkRun.id)}" data-job="${esc(checkRun.job)}" data-file="checks.log">checks.log</button>` : "";
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
  const next = j.next && j.next.step !== "none" ? `<p class="q"><span class="quiet">Next</span> ${esc(j.next.text)}</p>` : "";
  return `<div class="page dp-page">${crumb(iss ? iss.href : "#/factory/jobs", back)}` +
    pageHead(j.item?.title || j.title || id, { aside: nav }) + `${pills}${next}${blocked}` +
    (j.reason && !(j.runs ?? []).length ? `<p class="quiet q">${esc(j.reason)}</p>` : "") +
    (j.condition === "waiting" ? `<div class="actions">${cmd(`aleph land ${j.name}`, { primary: true })}${cmd(`aleph drop ${j.name}`)}</div>` : "") +
    jobKpis(j) + renderTimeline(jobSegments(j)) +
    (j.spec ? panel("spec", "Spec", `<div class="md">${md(j.spec)}</div>`) : "") +
    (j.result ? panel("result", "Result", `<div class="md">${md(j.result)}</div>`) : "") +
    `<div class="dp-detail">${sectionHead("Detail")}` +
    (j.review ? detailPanel("Review", verdict ? tag(verdict, verdict === "pass" ? "done" : "stuck") : "", `<div class="md">${md(j.review)}</div>`) : "") +
    (j.checks ? detailPanel("Checks", tag(`${passed} / ${j.checks.length}`, passed === j.checks.length ? "done" : "stuck"), checks) : "") +
    detailPanel("Diff", c ? esc(c.lines) : "", `${j.stat ? `<pre class="trailers">${esc(j.stat)}</pre>` : ""}<div class="diff-panel" id="diff" data-job="${esc(j.id)}">${loadingLine("the diff")}</div>`) +
    `</div></div>`;
}

/** The Job page's mount: load the diff into the Diff panel, once. */
async function mountJob(root) {
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
      const res = await fetch(`/api/jobs/${encodeURIComponent(b.dataset.job)}/logs/${encodeURIComponent(b.dataset.file)}${q}`);
      if (!res.ok) out.textContent = `The log failed to load (${res.status}).`;
      else if (b.dataset.as) out.innerHTML = renderTranscript(await res.json());
      else out.innerHTML = `<pre class="trailers">${esc(await res.text())}</pre>`;
    } catch (err) { out.textContent = `The log failed to load: ${err.message}`; }
  });
}
