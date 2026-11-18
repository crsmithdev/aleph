// The Memory Jobs section of the Automation page, on /api/memory/processes: the memory steps of the tick, the episode
// pages against the issues finished each day, and the lessons that wait for Chris. Every value is read from a file or
// a store the process wrote.
import { count, day, localMs, pct, plural, when } from "./format.js";
import { panelOf } from "./chart.js";
import { actButton, card, dataTable, empty, esc, facts, heads, legendHtml, meter, miss, sectionHead, tag, tone } from "./html.js";

const DAY = 86_400_000;
const time = (ts, why) => (ts ? esc(when(ts)) : miss(why));

/** The result as a badge: a short result shows whole; a long one (a run summary) shows up to its colon, with the summary in the title. */
const result = (s) => {
  const long = s.result.length > 24;
  return tag(long ? s.result.split(":")[0] : s.result, tone(s.result.startsWith("failed") ? "failed" : "done"), (long ? s.result : s.detail) || undefined);
};
const stepRow = (s) => `<tr><td><strong>${esc(s.name)}</strong></td><td>${esc(s.runs)}</td>` +
  `<td class="time">${time(s.last, "Never run")}</td><td class="time">${time(s.next, "Not scheduled")}</td>` +
  `<td>${s.result ? result(s) : miss("No result")}</td><td class="wide" title="${esc(s.does)}">${esc(s.does)}</td></tr>`;

/** The frame of the episode pages written and the issues finished per local day, the last 8 days. */
export const episodesFrame = (e) => ({
  measure: { name: "Pages and Finished Issues per Day", unit: "count", agg: "sum" },
  over: { kind: "time", window: "week" },
  by: { keys: [{ key: "pages", name: "Pages written" }, { key: "finished", name: "Issues finished" }] },
  rows: e.days.slice(-8).map((d) => ({ at: localMs(d.date), pages: d.pages, finished: d.finished })),
  form: "lines",
});

function episodes(e) {
  const [before, last] = e.days.slice(-2), line = (d) => `${count(d.pages)} of ${count(d.finished)} finished`;
  return card("Episodes", facts([["Pages", count(e.pages)], [`Written, ${day(localMs(last.date))}`, line(last)], [`Written, ${day(localMs(before.date))}`, line(before)], ["Pruned after", `${count(e.keep)} days`]]) +
    panelOf("automation/episodes", episodesFrame(e)), { id: "memory-episodes" });
}

/** One open lesson: its rule, its age, and Chris's Approve or Decline. */
const lessonRow = (l) => `<li class="lesson"><span>${esc(l.sentence)}</span><span class="quiet">${l.since ? `${count(Math.floor((Date.now() - Date.parse(l.since)) / DAY))} d` : ""}</span>` +
  `<span class="actions">${actButton("Approve", { act: "approve", path: `/api/proposals/${encodeURIComponent(l.id)}/approve`, label: "Approve" }, { primary: true })}${actButton("Decline", { act: "decline", path: `/api/proposals/${encodeURIComponent(l.id)}/decline`, label: "Decline" })}</span></li>`;
/** The open lessons, one row each. */
export const lessonList = (ls) => `<ul class="lessons">${ls.map(lessonRow).join("")}</ul>`;

function lessons(c) {
  const n = (s) => c.states[s] ?? 0, total = Object.values(c.states).reduce((a, b) => a + b, 0);
  if (!total) return card("Lessons", empty(), { id: "memory-lessons" });
  const seg = [["open", n("open") + n("proposed"), tone("open")], ["approved", n("approved"), tone("done")], ["declined", n("declined"), tone("dropped")]];
  const decided = n("approved") + n("declined"), oldest = c.waiting.map((l) => l.since).filter(Boolean).sort()[0];
  const line = [oldest && `Oldest open lesson ${plural(Math.floor((Date.now() - Date.parse(oldest)) / DAY), "day")}.`, decided && `You decided ${count(decided)}: ${count(n("approved"))} of ${count(decided)} approved (${pct((n("approved") / decided) * 100)}).`].filter(Boolean).join(" ");
  return card("Lessons", meter(seg.map(([, v, t]) => ({ pct: (v / total) * 100, cls: `c-${t}` })), `${total} lessons: ${seg.map(([k, v]) => `${v} ${k}`).join(", ")}`) +
    legendHtml(seg.map(([k, v, t]) => [`${v} ${k}`, `c-${t}`])) + (line ? `<p>${esc(line)}</p>` : "") +
    (c.waiting.length ? lessonList(c.waiting) : ""), { id: "memory-lessons", count: count(total), aside: "Mined daily" });
}

/** The section: `p` is the /api/memory/processes body. */
export const renderMemoryJobs = (p) => `<section id="memory-jobs">${sectionHead("Memory Jobs")}` +
  card("Memory Schedule", p.steps.length ? dataTable(heads(["Process", "Runs", "Last Run", "Next", "Last Result", "Does"]), p.steps.map(stepRow).join("")) : empty(), { aside: "aleph tick" }) +
  `<div class="pair">${episodes(p.episodes)}${lessons(p.corrections)}</div></section>`;

/** Give the chart panel of the section its frame. */
export const mountMemoryJobs = (root, p) => { root.querySelector('aleph-chart[key="automation/episodes"]').frame = episodesFrame(p.episodes); };
