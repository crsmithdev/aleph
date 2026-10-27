// The Skills view: how often each skill ran, from Langfuse. `renderSkills` takes
// /api/skills, `renderSkill` takes /api/skills/:name; neither touches the DOM.
// The shell takes one view per module, so the detail route is declared in skill.js.
import { chart, clock, empty, esc } from "../lib.js";

export const view = {
  path: "/skills",
  title: "Skills",
  group: "activity",
  order: 20,
  api: "/api/skills",
  render: (d) => renderSkills(d),
  mount: (root, d) => { mountPerDay(root, d); mountSort(root, d); },
};

const href = (name) => `#/skills/${encodeURIComponent(name)}`;
const sessionHref = (id) => `#/sessions/${encodeURIComponent(id)}`;
const date = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${clock(iso)}`; };

/** The mount point of a per-day chart; `mountPerDay` draws into it. `key` finds its data again. */
export const bars = (key, label = "Uses per day") => `<div class="perday" role="img" aria-label="${esc(label)}" data-skill="${esc(key)}"></div>`;

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

const STYLE = `<style>
.skills .sort-in { position: absolute; opacity: 0; }
.skills label.sort { cursor: pointer; padding: 2px 8px; border-radius: 3px; color: var(--muted); }
#s-uses:checked ~ .sorts label[for="s-uses"], #s-last:checked ~ .sorts label[for="s-last"] { background: var(--sunk); color: var(--ink); font-weight: 600; }
#s-uses:focus-visible ~ .sorts label[for="s-uses"], #s-last:focus-visible ~ .sorts label[for="s-last"] { outline: 2px solid var(--focus); }
.skills .tscroll { overflow-x: auto; max-width: 100%; }
.skills table { width: 100%; border-collapse: collapse; }
.skills th, .skills td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--rule); vertical-align: middle; }
.skills th { font-size: 12px; color: var(--muted); font-weight: 600; }
.skills .perday { width: 150px; height: 28px; }
.skills p > .perday { width: 100%; max-width: 720px; height: 120px; }
.skills .unused td { color: var(--muted); }
</style>`;

const row = (s) =>
  `<tr data-name="${esc(s.name)}"><td><a href="${href(s.name)}">${esc(s.name)}</a></td><td class="num">${s.uses}<small> (${s.bySlash} slash, ${s.byTool} tool)</small></td>` +
  `<td class="num">${s.sessions}</td><td>${esc(s.projects.join(", "))}</td><td class="num">${esc(date(s.lastUsed))}</td>` +
  `<td class="num">${s.errors ? `<span class="badge stuck">${s.errors}</span>` : "0"}</td><td>${bars(s.name)}</td></tr>`;

/** The used skills in the order of the Sort control: `by` is "uses" (most first) or "last" (newest first); ties by name. */
export function sortSkills(skills, by) {
  const cmp = by === "last" ? (a, b) => b.lastUsed.localeCompare(a.lastUsed) : (a, b) => b.uses - a.uses;
  return (skills || []).slice().sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name));
}

/** Wire the Sort control: moving the rows of the used tbody, so the charts in them are not redrawn. */
export function mountSort(root, d) {
  const body = root.querySelector("tbody.used");
  if (!body || !d) return;
  const rows = new Map([...body.querySelectorAll("tr[data-name]")].map((r) => [r.dataset.name, r]));
  for (const input of root.querySelectorAll("input.sort-in")) {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      for (const s of sortSkills(d.skills, input.id === "s-last" ? "last" : "uses")) body.appendChild(rows.get(s.name));
    });
  }
}

export function renderSkills(d) {
  const used = sortSkills(d.skills, "uses");
  const unused = (d.unused || []).map((n) => `<tr class="unused"><td>${esc(n)}</td><td colspan="6">Unused in the last ${d.days} days</td></tr>`).join("");
  const head = `<thead><tr><th>Skill</th><th>Uses</th><th>Sessions</th><th>Projects</th><th>Last used</th><th>Errors</th><th>Per day</th></tr></thead>`;
  const body = used.length || unused
    ? `<input class="sort-in" type="radio" name="sort" id="s-uses" checked aria-label="Sort by uses"><input class="sort-in" type="radio" name="sort" id="s-last" aria-label="Sort by last used">` +
      `<p class="sorts quiet">Sort by <label class="sort" for="s-uses">Uses</label><label class="sort" for="s-last">Last used</label></p>` +
      `<div class="tscroll"><table>${head}<tbody class="used">${used.map(row).join("")}</tbody><tbody>${unused}</tbody></table></div>`
    : empty("No skill is installed or used.", "Skills come from the plugin's <code>skills/</code> folder.");
  return `${STYLE}<div class="page skills"><div class="sh"><h2>Skills</h2><span class="count">${used.length}</span><span class="aside">last ${d.days} days</span></div>` +
    (used.length ? "" : empty(`No skill was used in the last ${d.days} days.`, "A use is a Skill tool call or a slash command.")) + body + `</div>`;
}

export function renderSkill(d) {
  const sessions = d.sessions.map((s) =>
    `<tr><td>${s.id ? `<a href="${sessionHref(s.id)}"><code>${esc(s.id.slice(0, 8))}</code></a>` : ""}</td><td>${esc(s.project)}</td><td class="num">${esc(date(s.time))}</td><td>${s.via === "slash" ? "slash command" : "Skill tool"}</td><td>${esc(s.prompt)}</td></tr>`).join("");
  const errors = d.errors.map((e) =>
    `<tr><td>${e.session ? `<a href="${sessionHref(e.session)}"><code>${esc(e.session.slice(0, 8))}</code></a>` : ""}</td><td>${esc(e.project)}</td><td class="num">${esc(date(e.time))}</td><td>${esc(e.message)}</td></tr>`).join("");
  const tools = d.tools.map((t) => `<tr><td><code>${esc(t.tool)}</code></td><td class="num">${t.count}</td></tr>`).join("");
  const projects = d.projects.map((p) => `<li>${esc(p.project)} <span class="num">${p.uses}</span></li>`).join("");
  return `${STYLE}<div class="page skills"><p><a href="#/skills">Skills</a></p>` +
    `<div class="sh"><h2>${esc(d.name)}</h2><span class="count">${d.uses}</span><span class="aside">uses in the last ${d.days} days</span></div>` +
    (d.uses ? `<p>${bars(d.name)}</p>` : empty("This skill was not used in the window.", "Widen it with <code>?days=90</code> on the API.")) +
    (projects ? `<div class="sh"><h3>Projects</h3></div><ul>${projects}</ul>` : "") +
    (sessions ? `<div class="sh"><h3>Sessions</h3></div><table><thead><tr><th>Session</th><th>Project</th><th>Time</th><th>Started by</th><th>First prompt line</th></tr></thead><tbody>${sessions}</tbody></table>` : "") +
    (tools ? `<div class="sh"><h3>Tools called after it, in the same turn</h3></div><table><thead><tr><th>Tool</th><th>Calls</th></tr></thead><tbody>${tools}</tbody></table>` : "") +
    (errors ? `<div class="sh"><h3>Turns with errors</h3><span class="count">${d.errors.length}</span></div><table><thead><tr><th>Session</th><th>Project</th><th>Time</th><th>Error</th></tr></thead><tbody>${errors}</tbody></table>` : "") +
    `</div>`;
}
