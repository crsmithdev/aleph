// One skill: how often it ran, from Langfuse. `renderSkill` takes /api/skills/:name and does not touch the DOM.
// The list of skills is in sessions.js.
import { redraw } from "../router.js";
import { chips, codeText, count, crumb, dataTable, esc, heads, idLink, notice, pageHead, pageOf, pageRows, pager, setQuery, statusRow, when } from "../lib.js";
import { panelOf } from "../chart.js";
import { detailPanel, renderKpis } from "../timeline.js";

const sessionHref = (id) => `#/sessions/${encodeURIComponent(id)}`;

/** The key of the uses panel: its frame, its kept form and its kept hidden series are the skill's own. */
export const chartKey = (name) => `skills/${name}`;

/** The uses of the skill per day, from `since`. The frame's window only names the x label format: one row per day. */
export const usesFrame = (d) => {
  const t0 = Date.parse(d.since);
  return {
    measure: { name: "Uses by Day", unit: "count", agg: "sum" },
    over: { kind: "time", window: "week" },
    by: { keys: [{ key: "uses", name: "Uses" }] },
    rows: (d.perDay ?? []).map((n, i) => ({ at: t0 + i * 864e5, uses: n })),
  };
};

/** When the last reload failed, the page shows the last good rows and says how old they are. */
const staleNote = (d, now = new Date()) => d.failed
  ? notice(`Langfuse failed: ${d.failed}. Showing the data from ${when(d.asOf, now)}.`, true)
  : "";

const sessionCell = (id) => (id ? idLink(id.slice(0, 8), sessionHref(id)) : "");
const PAGE = 50;
/** A panel of `rows` (row strings) that shows page `page` of them with a pager; no rows, no panel. A `fit` table is as wide as its cells. */
const table = (name, title, head, rows, page, fit = false) => rows.length
  ? detailPanel(title, count(rows.length), `<div data-t="${name}">${dataTable(head, pageRows(rows, page, PAGE).join(""), { fit })}${pager(page, rows.length, PAGE)}</div>`) : "";

export function renderSkill(d, pages = {}) {
  const at = (name) => pageOf({ page: pages[name] });
  // Sessions: a list, time last. Errors: an event log, time first.
  const sessions = d.sessions.map((s) =>
    `<tr><td>${sessionCell(s.id)}</td><td class="wide" title="${esc(s.prompt)}">${esc(s.prompt)}</td><td>${esc(s.project)}</td>` +
    `<td>${s.via === "slash" ? "slash command" : "Skill tool"}</td><td class="time">${esc(when(s.time))}</td></tr>`);
  const errors = d.errors.map((e) =>
    `<tr><td class="time lead">${esc(when(e.time))}</td><td>${sessionCell(e.session)}</td><td class="wide" title="${esc(e.message)}">${esc(e.message)}</td><td>${esc(e.project)}</td></tr>`);
  const tools = d.tools.map((t) => `<tr><td>${codeText(`\`${t.tool}\``)}</td><td class="num">${count(t.count)}</td></tr>`);
  const projects = d.projects.map((p) => `<tr><td>${esc(p.project)}</td><td class="num">${count(p.uses)}</td></tr>`);
  return `<div class="page dp-page skills">${crumb("#/sessions", [["sessions", "#/sessions"], ["skills"], [d.name]])}` +
    pageHead(d.name, { count: count(d.uses), aside: `Last ${d.days} days` }) + staleNote(d) +
    statusRow("", "", chips(d.projects.map((p) => p.project))) +
    renderKpis([{ k: "Uses", v: esc(count(d.uses)) }, { k: "Sessions", v: esc(count(d.sessions.length)) }, { k: "Errors", v: esc(count(d.errors.length)) }]) +
    (d.uses ? panelOf(chartKey(d.name), usesFrame(d)) : "") +
    table("projects", "Projects", heads(["Project", "Uses"], ["Uses"]), projects, at("projects"), true) +
    table("sessions", "Sessions", heads(["Session", "First Prompt", "Project", "Started by", "Started"], ["Started"]), sessions, at("sessions")) +
    table("tools", "Tools Called After It, in the Same Turn", heads(["Tool", "Calls"], ["Calls"]), tools, at("tools"), true) +
    table("errors", "Turns with Errors", heads(["Started", "Session", "Error", "Project"]), errors, at("errors")) +
    `</div>`;
}

export const view = {
  path: "/skills/:name",
  title: "Skill",
  group: "claude",
  api: "/api/skills/:name",
  // A table's page is in the address under the table's name (`?sessions=2`).
  render: (d, _params, q) => renderSkill(d, Object.fromEntries(q ?? [])),
  mount: (root, d) => {
    const el = root.querySelector(`aleph-chart[key="${chartKey(d.name)}"]`);
    if (el) el.frame = usesFrame(d);
    root.onclick = (e) => {
      const turn = e.target.closest?.("[data-t] button[data-page]");
      if (!turn) return;
      setQuery({ [turn.closest("[data-t]").dataset.t]: turn.dataset.page });
      redraw();
    };
  },
};
