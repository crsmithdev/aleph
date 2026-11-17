// The Processes tab of the Memory page, on /api/memory/processes: the scheduled memory steps of the tick, then a card each
// for episodes, corrections, the contradiction screen and decay. Every value is read from a file the process wrote.
import { when } from "./format.js";
import { panelOf } from "./chart.js";
import { badge, card, chip, dataTable, empty, esc, fold, heads, legendHtml, list, meter, miss, moreFold, tag, tone } from "./html.js";

const link = (title) => `<a href="#/memory/${encodeURIComponent(title)}">${esc(title)}</a>`;
const flow = (...boxes) => `<p class="quiet" style="display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-8)">${boxes.map((b, i) => `${i ? "to " : ""}${chip(b)}`).join(" ")}</p>`;
const time = (ts, why) => (ts ? esc(when(ts)) : miss(why));

/** The result as a badge: a short result shows whole; a long one (a run summary) shows up to its colon, with the summary in the title. */
const result = (s) => {
  const long = s.result.length > 24;
  return tag(long ? s.result.split(":")[0] : s.result, tone(s.result.startsWith("failed") ? "failed" : "done"), (long ? s.result : s.detail) || undefined);
};
const stepRow = (s) => `<tr><td><strong>${esc(s.name)}</strong></td><td class="wide" title="${esc(s.does)}">${esc(s.does)}</td><td>${esc(s.runs)}</td>` +
  `<td>${s.result ? result(s) : miss("No result")}</td>` +
  `<td class="time">${time(s.last, "Never run")}</td><td class="time">${time(s.next, "Not scheduled")}</td></tr>`;

/** The frame of the episode pages last written per day. */
export const episodesFrame = (e) => ({
  measure: { name: "Episodes", unit: "count", agg: "sum" },
  over: { kind: "time", window: "month" },
  by: { keys: [{ key: "pages", name: "pages" }] },
  rows: e.days.map((d) => ({ at: `${d.date}T12:00:00`, pages: d.pages })),
  legend: false,
});

function corrections(c) {
  const n = (s) => c.states[s] ?? 0, total = Object.values(c.states).reduce((a, b) => a + b, 0);
  const seg = [["open", n("open") + n("proposed"), tone("open")], ["approved", n("approved"), tone("done")], ["declined", n("declined"), tone("dropped")]];
  if (!total) return card("Corrections", empty());
  return card("Corrections", flow("transcripts", `lessons · ${total}`, "you decide", "vault note") +
    meter(seg.map(([, v, t]) => ({ pct: v / total * 100, cls: `c-${t}` })), `${total} lessons: ${seg.map(([k, v]) => `${v} ${k}`).join(", ")}`) +
    legendHtml(seg.map(([k, v, t]) => [`${v} ${k}`, `c-${t}`])) +
    (c.waiting.length ? moreFold(c.waiting, (l) => `${esc(l.sentence)} ${badge(l.state)}`) : empty()));
}

const screen = () => card("Contradiction Screen", flow("new note", "Jev screen", "refused if p ≥ 0.7") +
  empty());

function decay(d) {
  const table = (xs) => dataTable(heads(["Note", "Why"]), xs.map((s) => `<tr><td>${link(s.note)}</td><td class="wide" title="${esc(s.detail)}">${esc(s.detail)}</td></tr>`).join(""));
  return card("Decay", flow("note age", "over its kind's window × confidence", "stale") +
    (d.stale.length ? table(d.stale.slice(0, 10)) + (d.stale.length > 10 ? fold(`${d.stale.length - 10} more`, table(d.stale.slice(10))) : "") : empty()), { count: d.stale.length });
}

/** The body of the tab: `m` is the /api/memory/processes body. */
export const renderProcesses = (m) => list(
  card("Schedule", m.steps.length ? dataTable(heads(["Process", "Does", "Runs", "Last Result", "Last Run", "Next"]), m.steps.map(stepRow).join("")) : empty()) +
  `<div class="pair">${panelOf("memory/episodes", episodesFrame(m.episodes))}${corrections(m.corrections)}</div><div class="pair">${screen()}${decay(m.decay)}</div>` +
  card("Not Automatic Today", moreFold(["Consolidation", "Dedupe", "Reflection"], (name) => name)));

/** Give the chart panel of the tab its frame. */
export const mountProcesses = (root, m) => { root.querySelector('aleph-chart[key="memory/episodes"]').frame = episodesFrame(m.episodes); };
