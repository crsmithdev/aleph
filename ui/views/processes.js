// The Processes tab of the Memory page, on /api/memory/processes: the scheduled memory steps of the tick, then a card each
// for episodes, corrections, the contradiction screen and decay. Every value is read from a file the process wrote.
import { card, count, dataTable, empty, esc, heads, tag, when } from "../lib.js";

const link = (title) => `<a href="#/memory/${encodeURIComponent(title)}">${esc(title)}</a>`;
const flow = (...boxes) => `<p class="quiet" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">${boxes.map((b, i) => `${i ? "to " : ""}${tag(b)}`).join(" ")}</p>`;
const time = (ts) => (ts ? esc(when(ts)) : '<span class="quiet">none</span>');

const stepRow = (s) => `<tr><td><strong>${esc(s.name)}</strong></td><td>${esc(s.runs)}</td><td class="time">${time(s.last)}</td><td class="time">${time(s.next)}</td>` +
  `<td>${s.result ? tag(s.result, s.result === "ok" ? "done" : "stuck") : ""}</td><td class="wide">${esc(s.does)}</td></tr>`;

function episodes(e) {
  const top = Math.max(1, ...e.days.map((d) => d.pages));
  const bars = e.days.map((d, i) => `<div title="${esc(d.date)}: ${d.pages} pages" style="flex:1;height:${(d.pages / top * 100).toFixed(1)}%;background:${i === e.days.length - 1 ? "var(--stuck)" : "var(--run)"};border-radius:3px 3px 0 0"></div>`).join("");
  const prunes = e.prunes.length ? `<ul>${e.prunes.map((p) => `<li>${esc(when(p.at))} · ${esc(p.text.replace(/^prune episodes/, "prune"))}</li>`).join("")}</ul>` : `<p class="quiet">No prune is logged yet.</p>`;
  return card("Episodes · every 30 min", flow("transcripts", `episode pages · ${count(e.pages)}`, `pruned after ${e.keep} days`) +
    `<div style="display:flex;align-items:flex-end;gap:4px;height:90px;border-bottom:1px solid var(--rule)" role="img" aria-label="Episode pages last written per day, last ${e.keep} days">${bars}</div>` +
    `<p class="quiet" style="display:flex;justify-content:space-between"><span>${e.keep} days ago</span><span>pages last written per day</span><span>today</span></p>${prunes}`);
}

function corrections(c) {
  const n = (s) => c.states[s] ?? 0, total = Object.values(c.states).reduce((a, b) => a + b, 0);
  const seg = [["open", n("open") + n("proposed"), "var(--need)"], ["approved", n("approved"), "var(--done)"], ["declined", n("declined"), "var(--rule)"]];
  const bar = seg.map(([k, v, col]) => `<i style="width:${total ? v / total * 100 : 0}%;background:${col}" title="${v} ${k}"></i>`).join("");
  const rows = c.waiting.slice(0, 5).map((l) => `<li>${esc(l.sentence)} ${tag(l.state, l.state === "proposed" ? "need" : "quiet")}</li>`).join("");
  return card("Corrections · daily after 03:00", flow("transcripts", `lessons · ${total}`, "you decide", "vault note") +
    `<div style="display:flex;height:18px;border-radius:6px;overflow:hidden;background:var(--sunk)" role="img" aria-label="${total} lessons: ${seg.map(([k, v]) => `${v} ${k}`).join(", ")}">${bar}</div>` +
    `<p class="quiet" style="display:flex;gap:16px">${seg.map(([k, v]) => `<span>${v} ${k}</span>`).join("")}</p>` +
    (rows ? `<ul>${rows}</ul>${c.waiting.length > 5 ? `<p class="quiet">${c.waiting.length - 5} more waiting.</p>` : ""}` : `<p class="quiet">No lesson waits.</p>`));
}

const screen = () => card("Contradiction screen · on each write", flow("new note", "Jev screen", "refused if p ≥ 0.7") +
  empty("No record today.", "A refusal goes to stderr only. To show refusals here, the screen must write an event first."));

function decay(d) {
  const rows = d.stale.slice(0, 10).map((s) => `<tr><td>${link(s.note)}</td><td class="wide">${esc(s.detail)}</td></tr>`).join("");
  return card("Decay · lint, run by hand", flow("note age", "over its kind's window × confidence", "stale") +
    (rows ? dataTable("", rows) + (d.stale.length > 10 ? `<p class="quiet">${d.stale.length - 10} more in lint.</p>` : "") : `<p class="quiet">No note is stale.</p>`), { count: d.stale.length });
}

/** The body of the tab: `m` is the /api/memory/processes body. */
export const renderProcesses = (m) =>
  card("Schedule · aleph tick runs every minute", dataTable(heads(["Process", "Runs", "Last run", "Next", "Last result", "Does"]), m.steps.map(stepRow).join("")), { aside: "From tick.json, corrections.json and factory events" }) +
  `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(420px,100%),1fr));gap:var(--gap-in)">${episodes(m.episodes)}${corrections(m.corrections)}${screen()}${decay(m.decay)}</div>` +
  card("Not automatic today", `<p>Consolidation, dedupe and reflection have no job. Compile, archive and delete run by hand, and the Log tab shows each run. A new job gets a row in Schedule when it exists.</p>`);
