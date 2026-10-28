// The Skills view: how often each skill ran, from Langfuse. `renderSkills` takes
// /api/skills, `renderSkill` takes /api/skills/:name; neither touches the DOM.
// The shell takes one view per module, so the detail route is declared in skill.js.
import { chart, empty, esc, filterBar, idLink, nameLink, numCell, pageHead, sectionHead, sortHead, span, when } from "../lib.js";

export const view = {
  path: "/skills",
  title: "Skills",
  group: "claude",
  order: 20,
  api: (_params, q = new URLSearchParams()) => {
    const out = new URLSearchParams();
    for (const k of ["days", "project"]) if (q.get(k)) out.set(k, q.get(k));
    return out.toString() ? `/api/skills?${out}` : "/api/skills";
  },
  render: (d, _params, query) => renderSkills(d, Object.fromEntries(query ?? [])),
  mount: (root, d, query) => { mountPerDay(root, d); mountSort(root, d, Object.fromEntries(query ?? [])); },
};

const href = (name) => `#/skills/${encodeURIComponent(name)}`;
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

/** The Projects cell: at most three names and "+N", the full list in the title. */
const projectsCell = (ps) => `<td title="${esc(ps.join(", "))}">${esc(ps.slice(0, 3).join(", "))}${ps.length > 3 ? ` +${ps.length - 3}` : ""}</td>`;

// Columns: name, projects, numbers (uses, sessions, errors in red), per-day chart, time last.
const row = (s) =>
  `<tr data-name="${esc(s.name)}"><td>${nameLink(s.name, href(s.name))}</td>${projectsCell(s.projects)}` +
  `<td class="num" title="${s.bySlash} slash, ${s.byTool} tool">${s.uses}</td><td class="num">${s.sessions}</td>` +
  numCell(s.errors) +
  `<td>${bars(s.name)}</td><td class="time">${esc(when(s.lastUsed))}</td></tr>`;

/** The used skills in the order of `sort` ({key, dir}; dir 1 up, -1 down): key is "name", "uses", "sessions" or "last". Ties by name. */
export function sortSkills(skills, sort = { key: "uses", dir: -1 }) {
  if (typeof sort === "string") sort = { key: sort, dir: -1 };
  const val = { name: (s) => s.name, uses: (s) => s.uses, sessions: (s) => s.sessions, last: (s) => s.lastUsed }[sort.key] ?? ((s) => s.uses);
  const cmp = (a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; };
  return (skills || []).slice().sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name));
}

const COLS = [["Skill", "name", false], ["Uses", "uses", true], ["Sessions", "sessions", true], ["Last used", "last", false]];
const heads = (sort) => Object.fromEntries(COLS.map(([label, key, num]) => [key, sortHead(label, key, sort, { num })]));

const hashFor = (params) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  return `#/skills${q.toString() ? `?${q}` : ""}`;
};

/** Wire the filter bar (a change goes to the hash) and the sortable headers: moving the rows of the used tbody, so the charts in them are not redrawn. */
export function mountSort(root, d, f = {}) {
  const go = (name, value) => { location.hash = hashFor({ days: f.days, project: f.project, q: root.querySelector(".fbar input[name=q]")?.value, [name]: value }); };
  root.onchange = (e) => { if (e.target.matches?.(".fbar select")) go(e.target.name, e.target.value); };
  const body = root.querySelector("tbody.used");
  const q = root.querySelector('.fbar input[name="q"]');
  q?.addEventListener("input", () => {
    const needle = q.value.trim().toLowerCase();
    let n = 0;
    for (const r of body?.querySelectorAll("tr[data-name]") ?? []) {
      const hide = !r.dataset.name.toLowerCase().includes(needle);
      r.hidden = hide;
      if (!hide) n++;
    }
    const c = root.querySelector(".ph .count");
    if (c) c.textContent = String(n);
  });
  if (!d) return;
  const rows = new Map([...(body?.querySelectorAll("tr[data-name]") ?? [])].map((r) => [r.dataset.name, r]));
  let sort = { key: "uses", dir: -1 };
  root.onclick = (e) => {
    const seg = e.target.closest?.(".seg button");
    if (seg) return go(seg.parentElement.dataset.name, seg.dataset.value);
    const b = e.target.closest?.("button[data-sort]");
    if (!b || !root.contains(b) || !b.closest("table.skills-tbl")) return;
    const key = b.dataset.sort;
    sort = { key, dir: sort.key === key ? -sort.dir : key === "name" ? 1 : -1 };
    for (const s of sortSkills(d.skills, sort)) body.appendChild(rows.get(s.name));
    const h = heads(sort);
    for (const th of root.querySelectorAll("table.skills-tbl th")) {
      const k = th.querySelector("button[data-sort]")?.dataset.sort;
      if (k) th.outerHTML = h[k];
    }
  };
}

/** When the last reload failed, the page shows the last good rows and says how old they are. */
export const staleNote = (d, now = new Date()) => d.failed
  ? `<p class="quiet stale" role="status">Langfuse failed: ${esc(d.failed)}. Showing the data from ${esc(when(d.asOf, now))} (${esc(span(d.asOf, now.toISOString()) || "0 min")} ago).</p>`
  : "";

export function renderFilters(d, f = {}) {
  const projects = [...new Set(d.projects || [])].sort();
  return filterBar([
    { label: "Project", name: "project", value: projects.includes(f.project) ? f.project : "", options: [{ value: "", label: "All" }, ...projects] },
    { label: "Window", name: "days", value: f.days || "30", options: [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }] },
    { label: "Search", name: "q", search: true, value: f.q ?? "", placeholder: "Skill" },
  ]);
}

export function renderSkills(d, f = {}) {
  const used = sortSkills(d.skills);
  const sort = { key: "uses", dir: -1 }, h = heads(sort);
  const head = `<thead><tr>${h.name}<th>Projects</th>${h.uses}${h.sessions}<th class="num">Errors</th><th>Per day</th>${h.last}</tr></thead>`;
  const unused = d.unused || [];
  const main = used.length ? `<div ${SCROLL}><table class="tbl skills-tbl">${head}<tbody class="used">${used.map(row).join("")}</tbody></table></div>` : "";
  const rest = unused.length
    ? sectionHead("Unused", { count: unused.length, aside: `in the last ${d.days} days` }) +
      `<div ${SCROLL}><table class="tbl fit"><thead><tr><th>Skill</th></tr></thead><tbody>${unused.map((n) => `<tr class="muted"><td>${nameLink(n, href(n))}</td></tr>`).join("")}</tbody></table></div>`
    : "";
  const none = used.length || unused.length ? "" : empty("No skill is installed or used.", "Skills come from the plugin's <code>skills/</code> folder.");
  return `<div class="page skills">${pageHead("Skills", { count: used.length })}${renderFilters(d, f)}${staleNote(d)}` +
    (used.length || !unused.length ? "" : empty(`No skill was used in the last ${d.days} days.`, "A use is a Skill tool call or a slash command.")) + none + main + rest + `</div>`;
}

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
  return `<div class="page skills"><p><a href="#/skills">Skills</a></p>` +
    pageHead(d.name, { count: d.uses, aside: `uses in the last ${d.days} days` }) + staleNote(d) +
    (d.uses ? `<p style="max-width:720px;height:120px">${bars(d.name).replace('class="perday spark"', 'class="perday" style="width:100%;height:120px"')}</p>` : empty("This skill was not used in the window.", "Widen it with <code>?days=90</code> on the API.")) +
    (projects ? `${sectionHead("Projects")}${table("<th>Project</th><th class=\"num\">Uses</th>", projects)}` : "") +
    (sessions ? `${sectionHead("Sessions")}${table("<th>Session</th><th>First prompt line</th><th>Project</th><th>Started by</th><th>Time</th>", sessions)}` : "") +
    (tools ? `${sectionHead("Tools called after it, in the same turn")}${table("<th>Tool</th><th class=\"num\">Calls</th>", tools)}` : "") +
    (errors ? `${sectionHead("Turns with errors", { count: d.errors.length })}${table("<th>Session</th><th>Error</th><th>Project</th><th>Time</th>", errors)}` : "") +
    `</div>`;
}
