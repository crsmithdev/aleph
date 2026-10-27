// The List view: jobs, issues, projects or sessions as one table. The shared
// columns come first; each row's own fields go in one Details cell. The data
// comes from /api/list, which maps the four lists to one row shape.
import { clock, empty, error, esc, money } from "../lib.js";

const SETS = ["jobs", "issues", "projects", "sessions"];
const hashQuery = () => (typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.hash.split("?")[1] ?? ""));

/** The set the hash names; an unknown or missing one is jobs. */
export const pickSet = (q) => (SETS.includes(q?.get?.("set")) ? q.get("set") : "jobs");

export const view = {
  path: "/list",
  title: "List",
  group: "factory",
  order: 4,
  api: () => `/api/list?set=${pickSet(hashQuery())}`,
  refresh: 30,
  render: (d) => renderList(d),
  mount: (root) => {
    const g = root.querySelector?.("wa-radio-group");
    g?.addEventListener("change", () => {
      const q = hashQuery();
      q.set("set", g.value);
      location.hash = `#/list?${q}`;
    });
  },
};

const STYLE = `<style>
.listset { margin: 0 0 16px; }
.list .tbl td.det { color: var(--muted); font-size: 12.5px; }
.list .tbl td.det .k { margin-left: 8px; }
.list .tbl td.det .k:first-child { margin-left: 0; }
</style>`;

const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${clock(iso)}`;
};

export function renderList(d, set = pickSet(hashQuery())) {
  if (!d) return `<div class="page">${error("The list did not load.")}</div>`;
  set = SETS.includes(d.set) ? d.set : set;
  const radios = SETS.map((s) => `<wa-radio appearance="button" value="${s}">${s[0].toUpperCase()}${s.slice(1)}</wa-radio>`).join("");
  const head = `<div class="sh"><h1>List</h1><span class="count">${d.rows?.length ?? 0}</span></div>` +
    `<wa-radio-group class="listset" orientation="horizontal" name="set" label="Data set" value="${esc(set)}">${radios}</wa-radio-group>`;
  if (d.error) return `${STYLE}<div class="page">${head}${error(d.error, "Check the source of this set, then reload.")}</div>`;
  const rows = d.rows.map((r) =>
    `<tr><td class="num">${esc(when(r.when))}</td><td>${esc(r.project)}</td>` +
    `<td><a class="id" href="${esc(r.href)}">${esc(r.id)}</a></td><td><a href="${esc(r.href)}">${esc(r.title)}</a></td>` +
    `<td>${r.state ? `<span class="badge">${esc(r.state)}</span>` : ""}</td><td class="num">${r.cost == null ? "" : esc(money(r.cost))}</td>` +
    `<td class="det">${r.details.map(([k, v]) => `<span class="k">${esc(k)} ${esc(v)}</span>`).join("")}</td></tr>`).join("");
  return `${STYLE}<div class="page">${head}` + (rows
    ? `<div class="list"><div class="tscroll" style="overflow-x:auto;max-width:100%"><table class="tbl"><thead><tr><th>When</th><th>Project</th><th>Id</th><th>Title</th><th>State</th><th>Cost</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table></div></div>`
    : empty(`No ${set} to list.`, "Widen the project filter or try another set.")) + `</div>`;
}
