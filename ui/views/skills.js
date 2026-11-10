// One skill: how often it ran, from Langfuse. `renderSkill` takes /api/skills/:name and does not touch the DOM.
// The list of skills is in sessions.js.
import { card, crumb, dataTable, empty, esc, heads, idLink, pageHead, pager, span, when } from "../lib.js";
import { panelOf } from "../chart.js";

const sessionHref = (id) => `#/sessions/${encodeURIComponent(id)}`;

/** The key of the uses panel: its frame, its kept form and its kept hidden series are the skill's own. */
export const chartKey = (name) => `skills/${name}`;

/** The uses of the skill per day, from `since`. The frame's window only names the x label format: one row per day. */
export const usesFrame = (d) => {
  const t0 = Date.parse(d.since);
  return {
    measure: { name: "Uses per Day", unit: "count", agg: "sum" },
    over: { kind: "time", window: "week" },
    by: { keys: [{ key: "uses", name: "Uses" }] },
    rows: (d.perDay ?? []).map((n, i) => ({ at: t0 + i * 864e5, uses: n })),
  };
};

/** When the last reload failed, the page shows the last good rows and says how old they are. */
const staleNote = (d, now = new Date()) => d.failed
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
    (d.uses ? panelOf(chartKey(d.name), usesFrame(d)) : empty("This skill was not used in the window.", "Widen it with <code>?window=90</code> on the API.")) +
    card("Projects", table("projects", heads(["Project", "Uses"], ["Uses"]), projects, lim("projects"), "No project used this skill.")) +
    card("Sessions", table("sessions", heads(["Started", "Session", "First Prompt Line", "Project", "Started by"]), sessions, lim("sessions"), "No session used this skill.")) +
    card("Tools Called After It, in the Same Turn", table("tools", heads(["Tool", "Calls"], ["Calls"]), tools, lim("tools"), "No tool ran after this skill in the same turn."), { label: "Tools called after it, in the same turn" }) +
    card("Turns With Errors", table("errors", heads(["Started", "Session", "Error", "Project"]), errors, lim("errors"), "No turn with this skill had an error."), { count: d.errors.length, label: "Turns with errors" }) +
    `</div>`;
}

export const view = {
  path: "/skills/:name",
  title: "Skill",
  group: "claude",
  api: "/api/skills/:name",
  render: (d) => renderSkill(d),
  mount: (root, d) => {
    const limits = {};
    const wire = () => {
      const el = root.querySelector(`aleph-chart[key="${chartKey(d.name)}"]`);
      if (el) el.frame = usesFrame(d);
    };
    wire();
    root.onclick = (e) => {
      const more = e.target.closest?.("[data-t] button[data-more]");
      if (!more) return;
      const name = more.closest("[data-t]").dataset.t;
      limits[name] = (limits[name] ?? 50) + Number(more.dataset.more);
      root.innerHTML = renderSkill(d, limits);
      wire();
    };
  },
};
