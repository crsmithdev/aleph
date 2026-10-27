// The Skills view: how often each skill ran, from Langfuse. `renderSkills` takes
// /api/skills, `renderSkill` takes /api/skills/:name; neither touches the DOM.
// The shell takes one view per module, so the detail route is declared in skill.js.
import { clock, empty, esc } from "../lib.js";

export const view = {
  path: "/skills",
  title: "Skills",
  group: "activity",
  order: 20,
  api: "/api/skills",
  render: (d) => renderSkills(d),
};

const href = (name) => `#/skills/${encodeURIComponent(name)}`;
const sessionHref = (id) => `#/sessions/${encodeURIComponent(id)}`;
const date = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${clock(iso)}`; };

/** A small bar chart of per-day counts, inline SVG in the prototype's colours. */
export function bars(counts, label = "Uses per day") {
  const w = 4, gap = 1, h = 24, max = Math.max(1, ...counts);
  const rects = counts.map((n, i) => {
    const bh = n ? Math.max(2, Math.round((n / max) * h)) : 1;
    return `<rect x="${i * (w + gap)}" y="${h - bh}" width="${w}" height="${bh}" fill="${n ? "var(--run)" : "var(--rule)"}"></rect>`;
  }).join("");
  const width = Math.max(1, counts.length * (w + gap) - gap);
  return `<svg class="perday" role="img" aria-label="${esc(label)}: ${esc(counts.join(", "))}" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${rects}</svg>`;
}

const STYLE = `<style>
.skills .sort-in { position: absolute; opacity: 0; }
.skills .by-last { display: none; }
#s-last:checked ~ table .by-last { display: table-row-group; }
#s-last:checked ~ table .by-uses { display: none; }
.skills label.sort { cursor: pointer; padding: 2px 8px; border-radius: 3px; color: var(--muted); }
#s-uses:checked ~ .sorts label[for="s-uses"], #s-last:checked ~ .sorts label[for="s-last"] { background: var(--sunk); color: var(--ink); font-weight: 600; }
#s-uses:focus-visible ~ .sorts label[for="s-uses"], #s-last:focus-visible ~ .sorts label[for="s-last"] { outline: 2px solid var(--focus); }
.skills table { width: 100%; border-collapse: collapse; }
.skills th, .skills td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--rule); vertical-align: middle; }
.skills th { font-size: 12px; color: var(--muted); font-weight: 600; }
.skills .unused td { color: var(--muted); }
</style>`;

const row = (s) =>
  `<tr><td><a href="${href(s.name)}">${esc(s.name)}</a></td><td class="num">${s.uses}<small> (${s.bySlash} slash, ${s.byTool} tool)</small></td>` +
  `<td class="num">${s.sessions}</td><td>${esc(s.projects.join(", "))}</td><td class="num">${esc(date(s.lastUsed))}</td>` +
  `<td class="num">${s.errors ? `<span class="badge stuck">${s.errors}</span>` : "0"}</td><td>${bars(s.perDay)}</td></tr>`;

export function renderSkills(d) {
  const used = d.skills || [];
  const byLast = used.slice().sort((a, b) => b.lastUsed.localeCompare(a.lastUsed) || a.name.localeCompare(b.name));
  const unused = (d.unused || []).map((n) => `<tr class="unused"><td>${esc(n)}</td><td colspan="6">Unused in the last ${d.days} days</td></tr>`).join("");
  const head = `<thead><tr><th>Skill</th><th>Uses</th><th>Sessions</th><th>Projects</th><th>Last used</th><th>Errors</th><th>Per day</th></tr></thead>`;
  const body = used.length || unused
    ? `<input class="sort-in" type="radio" name="sort" id="s-uses" checked aria-label="Sort by uses"><input class="sort-in" type="radio" name="sort" id="s-last" aria-label="Sort by last used">` +
      `<p class="sorts quiet">Sort by <label class="sort" for="s-uses">Uses</label><label class="sort" for="s-last">Last used</label></p>` +
      `<table>${head}<tbody class="by-uses">${used.map(row).join("")}</tbody><tbody class="by-last">${byLast.map(row).join("")}</tbody><tbody>${unused}</tbody></table>`
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
    (d.uses ? `<p>${bars(d.perDay)}</p>` : empty("This skill was not used in the window.", "Widen it with <code>?days=90</code> on the API.")) +
    (projects ? `<div class="sh"><h3>Projects</h3></div><ul>${projects}</ul>` : "") +
    (sessions ? `<div class="sh"><h3>Sessions</h3></div><table><thead><tr><th>Session</th><th>Project</th><th>Time</th><th>Started by</th><th>First prompt line</th></tr></thead><tbody>${sessions}</tbody></table>` : "") +
    (tools ? `<div class="sh"><h3>Tools called after it, in the same turn</h3></div><table><thead><tr><th>Tool</th><th>Calls</th></tr></thead><tbody>${tools}</tbody></table>` : "") +
    (errors ? `<div class="sh"><h3>Turns with errors</h3><span class="count">${d.errors.length}</span></div><table><thead><tr><th>Session</th><th>Project</th><th>Time</th><th>Error</th></tr></thead><tbody>${errors}</tbody></table>` : "") +
    `</div>`;
}
