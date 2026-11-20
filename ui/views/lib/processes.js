// The Memory Jobs section of the Automation page, on /api/memory/processes: the memory steps of the tick. Every value is
// read from a file or a store the process wrote.
import { when } from "./format.js";
import { card, dataTable, empty, esc, heads, miss, sectionHead, tag, tone } from "./html.js";

const time = (ts, why) => (ts ? esc(when(ts)) : miss(why));

/** The result as a badge: a short result shows whole; a long one (a run summary) shows up to its colon, with the summary in the title. */
const result = (s) => {
  const long = s.result.length > 24;
  return tag(long ? s.result.split(":")[0] : s.result, tone(s.result.startsWith("failed") ? "failed" : "done"), (long ? s.result : s.detail) || undefined);
};
const stepRow = (s) => `<tr><td><strong>${esc(s.name)}</strong></td><td>${esc(s.runs)}</td>` +
  `<td class="time">${time(s.last, "Never run")}</td><td class="time">${time(s.next, "Not scheduled")}</td>` +
  `<td>${s.result ? result(s) : miss("No result")}</td><td class="wide" title="${esc(s.does)}">${esc(s.does)}</td></tr>`;

/** The section: `p` is the /api/memory/processes body. */
export const renderMemoryJobs = (p) => `<section id="memory-jobs">${sectionHead("Memory Jobs")}` +
  card("Memory Schedule", p.steps.length ? dataTable(heads(["Process", "Runs", "Last Run", "Next", "Last Result", "Does"]), p.steps.map(stepRow).join("")) : empty(), { aside: "aleph tick" }) + `</section>`;

