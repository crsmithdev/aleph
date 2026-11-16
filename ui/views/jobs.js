// The Jobs view (the list) and the Job view (a job's header, KPI strip, timeline, spec, result, and the
// review, checks and diff in Detail panels). Render functions take the /api/jobs objects and return HTML
// strings, with no DOM, so tests can call them.
import { bytes, count, dur, plural, money, span, when } from "./lib/format.js";
import { actButton, runNowButton, fold, pageHead, badCount, blockersHtml, chip, codeText, tag, tone, badge, error, miss, note, shaLink, statusRow, crumb, heads, pagedTable, empty, esc, idLink, linkButton, loadDiff, loadingLine, md, priorityBadge, wkHtml } from "./lib/html.js";
import { barLabel, detailPanel, fromTo, laneRow, panel, renderKpis, renderTimeline, runEvent, spans } from "./lib/timeline.js";
import { shortText, issueHref } from "../../lib/naming.ts";

/** The Job view, routed at `#/jobs/<job ID>`. */
export const view = {
  path: "/jobs/:id",
  title: "Job",
  group: "factory",
  api: "/api/jobs/:id",
  render: (job) => renderJob(job),
  mount: (root) => mountJob(root),
};

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
  }).join("") || empty();
}

/** The event of one run: its state as the tag, then its reason, the commit of a land, its job ID and its log buttons. */
function jobEvent(x, nth, j) {
  const r = x.r, name = barLabel(r, nth);
  const e = runEvent(x, name, r.kind === "land" && r.state === "landed" && j.commit ? `${esc(name)} as ${shaLink(j.commit, j.commitUrl)}.` : null);
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
    title: "Work", aside: j.state === "landed" ? "to the land" : "",
    rows: [laneRow({
      head: `<span class="quiet">${esc([builds ? plural(builds, "implement") : "", lands ? plural(lands, "land") : ""].filter(Boolean).join(", ") || plural(work.length, "job"))}</span>`,
      runs: work, from: work[0].start, result: badge(j.state), cost: true, holds: j.holds ?? [], runEvents: () => events,
      events: [...(j.defaults ?? []).map((d) => ({ tag: "Default", tone: "need", html: codeText(d) })),
        ...(j.followups ?? []).map((f) => ({ tag: "Follow-up", tone: "need", html: codeText(f) }))],
    })],
  });
  return segments;
}

/** The KPI strip of a job: builds, elapsed, cost, change, and what checked it. */
function jobKpis(j, now = Date.now()) {
  const runs = spans(workRuns(j), now), builds = runs.filter((x) => x.r.kind === "worker");
  const bad = builds.filter((x) => ["returned", "failed"].includes(x.r.state)).length, last = builds.at(-1)?.r.state;
  const end = runs.length ? Math.max(...runs.map((x) => x.end)) : NaN, c = change(j.stat);
  return renderKpis([
    { k: "Implements", v: esc(count(builds.length)), sub: bad ? `<span class="bad">${esc(`${bad} stuck${["passed", "landed", "waiting"].includes(last) ? ", then fixed" : ""}`)}</span>` : "" },
    { k: "Elapsed", v: esc(dur(runs.length ? (end - runs[0].start) / 1000 : undefined)), sub: esc(runs.length ? fromTo(runs[0].start, end) : j.started ? `started ${when(j.started)}` : "") },
    { k: "Cost", v: esc(money(j.cost)), sub: j.wk ? wkHtml(j.wk) : "" },
    { k: "Change", v: c ? esc(c.lines) : miss("no change recorded"), sub: [c ? esc(c.files) : "", j.commit ? shaLink(j.commit, j.commitUrl) : ""].filter(Boolean).join(", ") },
    { k: "Checked by", v: j.checkedBy?.length ? esc(j.checkedBy.join(", ")) : miss("no check recorded"), text: !!j.checkedBy?.length, sub: j.look ? esc(`look: ${dur(j.look * 60)}`) : "" },
  ]);
}

/** The actions of an open job on an issue: Land and Recheck while it waits, Park or Unpark, and Cancel, which opens its dialog. */
function lifecycle(j) {
  if (!j.open || !j.item) return "";
  const act = (label, verb, o = {}) => actButton(label, { act: verb, path: `/api/jobs/${encodeURIComponent(j.id)}/${verb}`, label }, o);
  const waiting = j.state === "waiting";
  const outcome = (then, label, effect) => `<label><input type="radio" name="then" value="${then}"${then === "park" ? " checked" : ""}><span>${label}<small>${effect}</small></span></label>`;
  return (waiting && !j.parked ? act("Land", "land", { primary: true }) : "") + (waiting ? act("Recheck", "recheck") : "") +
    (j.parked ? act("Unpark", "unpark", { primary: true }) : act("Park", "park")) +
    `<button class="act danger" type="button" data-dialog="cancel-job">Cancel</button>` +
    `<dialog id="cancel-job" class="cancel-job"><form method="dialog"><h3>Cancel job ${esc(shortText(j.name))}</h3>` +
    outcome("park", "Park the issue", "Waits for Unpark") + outcome("restart", "Restart", "Back to the queue") + outcome("drop", "Drop the issue", "Closes it") +
    `<div class="actions"><button class="act" type="submit">Keep</button>` +
    actButton("Cancel job", { act: "cancel", path: `/api/jobs/${encodeURIComponent(j.id)}/cancel`, body: JSON.stringify({ then: "park" }), label: "Cancel job" }, { kind: "danger" }) + `</div></form></dialog>`;
}

/** The Job page: the header and its pills, the KPI strip, the Timeline, the Spec and the Result, then the Detail panels. */
export function renderJob(j) {
  const id = shortText(j.name), p = j.parent;
  // The issue the job works on: a part's parent, else the job's own item.
  const iss = p ?? (j.item && { id: `${j.repo}-${j.item.id}`, href: issueHref(`${j.repo}-${j.item.id}`) });
  const back = iss ? [[j.repo, `#/issues?project=${encodeURIComponent(j.repo)}`], [`issue ${shortText(iss.id)}`, iss.href], [`job ${id}`]] : [[j.repo], ["jobs", "#/factory/jobs"], [id]];
  const nav = [p?.next ? linkButton(`Next sub-issue: ${shortText(p.next.id)}`, p.next.href) : "", j.trace ? linkButton("Trace", j.trace) : ""].join("");
  const pills = statusRow(badge(j.state), j.item ? priorityBadge(j.item.priority) : "", `${p ? chip("", { html: `sub-issue ${esc(p.n)} of ${esc(p.of)} of ${idLink(shortText(p.id), p.href)}` }) : ""}${idLink(shortText(j.name))}`);
  const blocked = j.blockers?.length ? `<div class="dp-blocked"><span class="quiet">Waits on</span>${blockersHtml(j.blockers, j.repo, j.item.id)}</div>` : "";
  const checkRun = (j.runs ?? []).findLast((r) => r.logs?.some((l) => l.name === "checks.log"));
  const checkLog = checkRun ? `<p><button class="link" type="button" data-log="${esc(checkRun.id)}" data-job="${esc(checkRun.job)}" data-file="checks.log">checks.log</button></p>` : "";
  // A check that ran `bun test` has a record of its tests: the counts, and its failed tests with their failure.
  const counts = (t) => ["ran", "passed", "failed", "skipped"].map((k) => (k === "failed" ? badCount(t?.failed) : `<td class="num">${esc(count(t?.[k]))}</td>`)).join("");
  const failures = (j.checks ?? []).filter((c) => c.tests?.failed).map((c) => {
    const more = c.tests.failed - c.tests.failures.length;
    return c.tests.failures.map((f) => `<p><code>${esc(f.file)}</code> ${esc(f.name)} <span class="quiet">${esc(c.name)}</span></p><pre class="trailers">${esc(f.message)}</pre>`).join("") +
      (more > 0 ? note(`${plural(more, "more failed test")} of ${c.name} not recorded.`) : "");
  }).join("");
  const checks = j.checks?.length
    ? `<div class="dp-logs" data-logs>${pagedTable(heads(["Check", "Result", "Ran", "Passed", "Failed", "Skipped", "Took"], ["Ran", "Passed", "Failed", "Skipped", "Took"]), j.checks.map((c) => `<tr><td>${esc(c.name)}</td><td>${badge(c.ok ? "passed" : "failed")}</td>${counts(c.tests)}<td class="num">${esc(dur(c.seconds))}</td></tr>`))}${checkLog}${failures}<div class="logbody" hidden></div></div>`
    : empty();
  const passed = (j.checks ?? []).filter((c) => c.ok).length, verdict = j.verdict, c = change(j.stat);
  const next = j.next && j.next.step !== "none" ? `<p class="q"><span class="quiet">Next</span> ${esc(j.next.text)}</p>` : "";
  return `<div class="page dp-page">${crumb(iss ? iss.href : "#/factory/jobs", back)}` +
    pageHead(j.item?.title || j.title || id, { aside: nav + lifecycle(j) + (j.open ? "" : runNowButton(j.repo, j.item?.id, j.runNow)) }) + `${pills}${next}${blocked}` +
    (j.reason && !(j.runs ?? []).length ? note(j.reason) : "") +
    jobKpis(j) + renderTimeline(jobSegments(j)) +
    (j.spec ? panel("spec", "Spec", `<div class="md">${md(j.spec)}</div>`) : "") +
    (j.result ? panel("result", "Result", `<div class="md">${md(j.result)}</div>`) : "") +
    `<div class="dp-detail">` +
    (j.review ? detailPanel("Review", verdict ? badge(verdict === "pass" ? "passed" : "returned") : "", `<div class="md">${md(j.review)}</div>`) : "") +
    (j.checks ? detailPanel("Checks", tag(`${passed} / ${j.checks.length}`, tone(passed === j.checks.length ? "passed" : "failed")), checks) : "") +
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
  // Cancel opens its dialog; the chosen outcome becomes the body of the Cancel job button.
  document.addEventListener("click", (e) => { const b = e.target.closest?.("[data-dialog]"); if (b) document.getElementById(b.dataset.dialog)?.showModal(); });
  document.addEventListener("change", (e) => {
    const r = e.target.closest?.("#cancel-job input[name=then]");
    if (r) r.closest("dialog").querySelector("button[data-act=cancel]").dataset.body = JSON.stringify({ then: r.value });
  });
  document.addEventListener("click", async (e) => {
    const b = e.target.closest?.("[data-log]");
    if (!b) return;
    const out = b.closest("[data-logs]").querySelector(".logbody");
    const q = b.dataset.as ? `?as=${b.dataset.as}` : "";
    out.hidden = false;
    out.innerHTML = loadingLine("the log");
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(b.dataset.job)}/logs/${encodeURIComponent(b.dataset.file)}${q}`);
      if (!res.ok) out.innerHTML = error("Could not load the log.", { detail: `status ${res.status}` });
      else if (b.dataset.as) out.innerHTML = renderTranscript(await res.json());
      else out.innerHTML = `<pre class="trailers">${esc(await res.text())}</pre>`;
    } catch (err) { out.innerHTML = error("Could not load the log.", { detail: err.message }); }
  });
}
