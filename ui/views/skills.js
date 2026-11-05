// One skill: how often it ran, from Langfuse. `renderSkill` takes /api/skills/:name and does not touch the DOM.
// The shell takes one view per module, so the route is declared in skill.js. The list of skills is in sessions.js.
import { card, chartBox, mountCharts, crumb, dataTable, empty, esc, heads, idLink, day, pageHead, pager, span, when } from "../lib.js";

const sessionHref = (id) => `#/sessions/${encodeURIComponent(id)}`;

/** The box of a per-day chart; `mountPerDay` draws into it. `key` finds its data again. */
export const bars = (key, label = "Uses per day") => chartBox(key, label, "perday");

/** The ECharts option for per-day counts: one bar per day, the days counted on from `since` (YYYY-MM-DD). */
export function perDayOption(counts, since) {
  const t0 = Date.parse(since);
  const days = counts.map((_, i) => (Number.isNaN(t0) ? String(i + 1) : day(t0 + i * 864e5)));
  return {
    grid: { left: 32, right: 8, top: 8, bottom: 20 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, confine: true, formatter: (p) => { const q = [].concat(p)[0]; return `${esc(q.name)}<br>${q.value} ${q.value === 1 ? "use" : "uses"}`; } },
    xAxis: { type: "category", data: days, name: "Days", axisLabel: { hideOverlap: true } },
    yAxis: { type: "value", name: "Uses", min: 0, minInterval: 1 },
    series: [{ type: "bar", name: "Uses", data: counts, barCategoryGap: "20%" }],
  };
}

let drawn = [];
/** Draw every per-day chart under `root`: one per skill in the list, one in the detail. */
export function mountPerDay(root, d) {
  for (const c of drawn) c.dispose();
  drawn = [];
  if (!d) return;
  const by = new Map((d.skills || []).map((s) => [s.name, s.perDay]));
  if (d.perDay) by.set(d.name, d.perDay);
  drawn = [...mountCharts(root, Object.fromEntries([...by].filter(([, counts]) => counts).map(([k, counts]) => [k, perDayOption(counts, d.since)]))).values()];
}

/** When the last reload failed, the page shows the last good rows and says how old they are. */
export const staleNote = (d, now = new Date()) => d.failed
  ? `<p class="quiet stale" role="status">Langfuse failed: ${esc(d.failed)}. Showing the data from ${esc(when(d.asOf, now))} (${esc(span(d.asOf, now.toISOString()) || "0s")} ago).</p>`
  : "";

const sessionCell = (id) => (id ? idLink(id.slice(0, 8), sessionHref(id)) : "");
const PAGE = 50;
/** A table of `rows` (row strings) that shows `limit` of them with a pager, or `none` when it has no rows. */
const table = (name, head, rows, limit, none) => `<div data-t="${name}">${rows.length ? dataTable(head, rows.slice(0, limit).join("")) + pager(limit, rows.length, PAGE) : empty(none)}</div>`;

export function renderSkill(d, limits = {}) {
  const lim = (name) => limits[name] ?? PAGE;
  // Columns: time, session, title (prompt or message), project, numbers.
  const sessions = d.sessions.map((s) =>
    `<tr><td class="time">${esc(when(s.time))}</td><td>${sessionCell(s.id)}</td><td class="wide" title="${esc(s.prompt)}">${esc(s.prompt)}</td><td>${esc(s.project)}</td>` +
    `<td>${s.via === "slash" ? "slash command" : "Skill tool"}</td></tr>`);
  const errors = d.errors.map((e) =>
    `<tr><td class="time">${esc(when(e.time))}</td><td>${sessionCell(e.session)}</td><td class="wide" title="${esc(e.message)}">${esc(e.message)}</td><td>${esc(e.project)}</td></tr>`);
  const tools = d.tools.map((t) => `<tr><td><code>${esc(t.tool)}</code></td><td class="num">${t.count}</td></tr>`);
  const projects = d.projects.map((p) => `<tr><td>${esc(p.project)}</td><td class="num">${p.uses}</td></tr>`);
  return `<div class="page sp skills">${crumb("#/sessions", [["sessions", "#/sessions"], ["skills"], [d.name]])}` +
    pageHead(d.name, { count: d.uses, aside: `uses in the last ${d.days} days` }) + staleNote(d) +
    (d.uses ? card("Uses per Day", bars(d.name), { label: "Uses per day" }) : empty("This skill was not used in the window.", "Widen it with <code>?days=90</code> on the API.")) +
    card("Projects", table("projects", heads(["Project", "Uses"], ["Uses"]), projects, lim("projects"), "No project used this skill.")) +
    card("Sessions", table("sessions", heads(["Time", "Session", "First Prompt Line", "Project", "Started by"]), sessions, lim("sessions"), "No session used this skill.")) +
    card("Tools Called After It, in the Same Turn", table("tools", heads(["Tool", "Calls"], ["Calls"]), tools, lim("tools"), "No tool ran after this skill in the same turn."), { label: "Tools called after it, in the same turn" }) +
    card("Turns With Errors", table("errors", heads(["Time", "Session", "Error", "Project"]), errors, lim("errors"), "No turn with this skill had an error."), { count: d.errors.length, label: "Turns with errors" }) +
    `</div>`;
}
