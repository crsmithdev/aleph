// One skill: how often it ran, from Langfuse. `renderSkill` takes /api/skills/:name and does not touch the DOM.
// The shell takes one view per module, so the route is declared in skill.js. The list of skills is in agents.js.
import { chart, empty, esc, idLink, pageHead, sectionHead, span, when } from "../lib.js";

const sessionHref = (id) => `#/sessions/${encodeURIComponent(id)}`;

/** The mount point of a per-day chart; `mountPerDay` draws into it. `key` finds its data again. */
export const bars = (key, label = "Uses per day") => `<div class="perday spark" role="img" aria-label="${esc(label)}" data-skill="${esc(key)}"></div>`;

/** The ECharts option for per-day counts: one bar per day, the days counted on from `since` (YYYY-MM-DD). */
export function perDayOption(counts, since) {
  const t0 = Date.parse(since);
  const days = counts.map((_, i) => (Number.isNaN(t0) ? String(i + 1) : new Date(t0 + i * 864e5).toISOString().slice(0, 10)));
  return {
    grid: { left: 2, right: 2, top: 2, bottom: 2 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, confine: true, formatter: (p) => { const q = [].concat(p)[0]; return `${esc(q.name)}<br>${q.value} ${q.value === 1 ? "use" : "uses"}`; } },
    xAxis: { type: "category", data: days, show: false },
    yAxis: { type: "value", show: false, min: 0 },
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
  for (const el of root.querySelectorAll(".perday[data-skill]")) {
    const counts = by.get(el.dataset.skill);
    if (counts) drawn.push(chart(el, perDayOption(counts, d.since)));
  }
}

const SCROLL = `class="tscroll"`;

/** When the last reload failed, the page shows the last good rows and says how old they are. */
export const staleNote = (d, now = new Date()) => d.failed
  ? `<p class="quiet stale" role="status">Langfuse failed: ${esc(d.failed)}. Showing the data from ${esc(when(d.asOf, now))} (${esc(span(d.asOf, now.toISOString()) || "0 min")} ago).</p>`
  : "";

const sessionCell = (id) => (id ? idLink(id.slice(0, 8), sessionHref(id)) : "");
const table = (head, rows) => `<div ${SCROLL}><table class="tbl fit"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;

export function renderSkill(d) {
  // Columns: session, title (prompt or message), project, numbers, time last.
  const sessions = d.sessions.map((s) =>
    `<tr><td>${sessionCell(s.id)}</td><td class="wide" title="${esc(s.prompt)}">${esc(s.prompt)}</td><td>${esc(s.project)}</td>` +
    `<td>${s.via === "slash" ? "slash command" : "Skill tool"}</td><td class="time">${esc(when(s.time))}</td></tr>`).join("");
  const errors = d.errors.map((e) =>
    `<tr><td>${sessionCell(e.session)}</td><td class="wide" title="${esc(e.message)}">${esc(e.message)}</td><td>${esc(e.project)}</td><td class="time">${esc(when(e.time))}</td></tr>`).join("");
  const tools = d.tools.map((t) => `<tr><td><code>${esc(t.tool)}</code></td><td class="num">${t.count}</td></tr>`).join("");
  const projects = d.projects.map((p) => `<tr><td>${esc(p.project)}</td><td class="num">${p.uses}</td></tr>`).join("");
  return `<div class="page skills"><p><a href="#/sessions">Sessions</a></p>` +
    pageHead(d.name, { count: d.uses, aside: `uses in the last ${d.days} days` }) + staleNote(d) +
    (d.uses ? `<p style="max-width:720px;height:120px">${bars(d.name).replace('class="perday spark"', 'class="perday" style="width:100%;height:120px"')}</p>` : empty("This skill was not used in the window.", "Widen it with <code>?days=90</code> on the API.")) +
    (projects ? `${sectionHead("Projects")}${table("<th>Project</th><th class=\"num\">Uses</th>", projects)}` : "") +
    (sessions ? `${sectionHead("Sessions")}${table("<th>Session</th><th>First prompt line</th><th>Project</th><th>Started by</th><th>Time</th>", sessions)}` : "") +
    (tools ? `${sectionHead("Tools called after it, in the same turn")}${table("<th>Tool</th><th class=\"num\">Calls</th>", tools)}` : "") +
    (errors ? `${sectionHead("Turns with errors", { count: d.errors.length })}${table("<th>Session</th><th>Error</th><th>Project</th><th>Time</th>", errors)}` : "") +
    `</div>`;
}
