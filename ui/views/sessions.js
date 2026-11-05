// The Agents view: Sessions, Tools and Skills on one page. It answers what the agents did and what fails: the highest
// failure rates, ranked tools and skills, and the sessions list, which a selected tool or skill narrows.
// `data` is /api/agents. The session and skill detail routes stay in their own views.
import { barList, count, barRow, meter, card, chips, costHtml, dataTable, empty, error, esc, filterBar, heads, idLink, money, onTile, pageHead, pager, pct, searchBox, sectionHead, setQuery, sortHead, hashQuery, limitOf, sortRows, wireTable, statCard, tiles, when, wireScope } from "../lib.js";

export const view = {
  path: "/sessions",
  title: "Sessions",
  icon: "comments",
  group: "claude",
  order: 0,
  api: (_params, q = new URLSearchParams()) => {
    const out = new URLSearchParams({ days: q.get("days") || "7" });
    if (q.get("project")) out.set("project", q.get("project"));
    return `/api/agents?${out}`;
  },
  render: (d, _params, query) => renderSessions(d, options(query)),
  mount: (root, d) => mount(root, d),
};

/** The old addresses `#/agents`, `#/activity` and `#/skills` keep their window and project. The detail routes are left alone. */
export function redirect(hash) {
  const [path, qs = ""] = String(hash ?? "").replace(/^#/, "").split("?");
  if (!["/agents", "/activity", "/skills"].includes(path.replace(/\/$/, ""))) return null;
  const old = new URLSearchParams(qs), q = new URLSearchParams();
  for (const k of ["days", "project"]) if (old.get(k)) q.set(k, old.get(k));
  return `#/sessions${q.toString() ? `?${q}` : ""}`;
}

const STEP = 50, ROWS = 10, MIN_FOR_RATE = 5;

/** The state from the route's query: ?days=7&project=x&pick=tool:Bash&q=text&sort=cost&dir=desc&limit=100. */
export function options(q = new URLSearchParams()) {
  return { days: q.get("days") || "7", project: q.get("project") ?? "", pick: q.get("pick") ?? "", q: q.get("q") ?? "", sort: { key: q.get("sort") || "cost", dir: q.get("dir") === "asc" ? 1 : -1 }, limit: limitOf(q, STEP) };
}

const skillHref = (name) => `#/skills/${encodeURIComponent(name)}`;
const toolsOf = (d) => d?.activity?.tools ?? [];
const skillsOf = (d) => d?.skills?.skills ?? [];

/** The five highest failure rates of the tools and skills with at least five calls. */
export function failing(d) {
  const row = (kind, name, n, errors) => ({ kind, name, n, errors, rate: Math.min(1, errors / n), pick: `${kind}:${name}` });
  return [...toolsOf(d).map((t) => row("tool", t.name, t.calls, t.errors)), ...skillsOf(d).map((s) => row("skill", s.name, s.uses, s.errors))]
    .filter((r) => r.n >= MIN_FOR_RATE && r.errors > 0).sort((a, b) => b.rate - a.rate || b.errors - a.errors).slice(0, 5);
}

/** The sessions a selection keeps, or null when the selection has no list to read. */
export function sessionIds(d, pick) {
  const at = pick.indexOf(":"), kind = pick.slice(0, at), name = pick.slice(at + 1);
  const ids = kind === "tool" ? d?.toolSessions?.[name] : kind === "skill" ? skillsOf(d).find((s) => s.name === name)?.sessionIds : null;
  return ids ? new Set(ids) : null;
}

const SORT = { cost: (s) => s.cost ?? 0, turns: (s) => s.turns ?? 0, start: (s) => Date.parse(s.start) || 0, last: (s) => Date.parse(s.last) || 0, project: (s) => s.project ?? "", prompt: (s) => s.firstPrompt ?? "" };

/** The sessions the selection and search keep, in the sort's order; ties newest first. */
export function shownSessions(d, o) {
  const keep = o.pick ? sessionIds(d, o.pick) : null, q = o.q.trim().toLowerCase();
  return sortRows((d?.sessions?.sessions ?? [])
    .filter((s) => (!o.pick || keep?.has(s.id)) && (!q || `${s.firstPrompt ?? ""} ${s.project ?? ""} ${s.id} ${s.label ?? ""}`.toLowerCase().includes(q))),
    SORT, { key: SORT[o.sort.key] ? o.sort.key : "cost", dir: o.sort.dir }, (a, b) => SORT.last(b) - SORT.last(a));
}

const rate = (r) => pct(r.rate * 100);
const renderFails = (d, o) => tiles("Failing most", failing(d).map((r) => statCard({ k: r.name, v: rate(r), note: `${r.kind}: ${count(r.errors)} of ${count(r.n)} ${r.kind === "tool" ? "calls" : "uses"}`, key: r.pick, on: o.pick === r.pick })).join(""));

function ranked(kind, rows, o) {
  const top = Math.max(1, ...rows.map((r) => r.n));
  const row = (r) => barRow(esc(r.name), 0, `${count(r.n)} · ${count(r.errors)} err`, { key: `${kind}:${r.name}`, on: o.pick === `${kind}:${r.name}`,
    bar: meter([{ pct: ((r.n - r.errors) / top) * 100 }, { pct: (r.errors / top) * 100, cls: "c-err" }]) });
  const rest = rows.slice(ROWS);
  return barList(rows.slice(0, ROWS).map(row).join("")) + (rest.length ? `<details class="more"${rest.some((r) => o.pick === `${kind}:${r.name}`) ? " open" : ""}><summary>${rest.length} more</summary>${barList(rest.map(row).join(""))}</details>` : "");
}

const sum = (rows, f) => rows.reduce((n, r) => n + f(r), 0);

function toolsCard(d, o) {
  const a = d.activity ?? {}, opts = {};
  if (a.langfuse === "off") return card("Tools", empty("Langfuse is not configured.", "Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in <code>~/.aleph/.env</code>."), opts);
  if (a.langfuse === "error") return card("Tools", error(`Langfuse failed: ${a.error}`, "Check that Langfuse is running, then reload."), opts);
  const t = toolsOf(d);
  return card("Tools", `<p>${count(sum(t, (x) => x.calls))} calls, ${count(sum(t, (x) => x.errors))} errors. The red part of a bar is errors.</p>` +
    (t.length ? ranked("tool", t.map((x) => ({ name: x.name, n: x.calls, errors: x.errors })), o) : empty("No tool calls in this period.")), opts);
}

function skillsCard(d, o) {
  const opts = {};
  if (d.skills?.error) return card("Skills", error(`Skills failed: ${d.skills.error}`, "Check that Langfuse is running, then reload."), opts);
  const s = skillsOf(d), unused = d.skills?.unused ?? [];
  return card("Skills", `<p>${count(sum(s, (x) => x.uses))} uses, ${count(sum(s, (x) => x.errors))} errors.${d.skills?.failed ? ` The last reload failed: ${esc(d.skills.failed)}.` : ""}</p>` +
    (s.length ? ranked("skill", s.map((x) => ({ name: x.name, n: x.uses, errors: x.errors })), o) : empty(`No skill was used in the last ${o.days} days.`, "A use is a Skill tool call or a slash command.")) +
    (unused.length ? sectionHead("Unused", { count: unused.length, level: 3 }) + `<div class="unused">${unused.map((n) => `<a href="${esc(skillHref(n))}">${esc(n)}</a>`).join("")}</div>` : ""), opts);
}

function hooksCard(d) {
  const a = d.activity ?? {};
  if (a.langfuse !== "ok") return "";
  const denials = a.denials ?? { total: 0, recent: [] };
  const hooks = (a.hooks ?? []).length
    ? dataTable(heads(["Last Call", "Hook", "Calls", "Errors"], ["Calls", "Errors"]), a.hooks.map((h) => `<tr><td class="time">${esc(when(h.lastAt))}</td><td class="wide">${esc(h.name)}</td><td class="num">${count(h.calls)}</td><td class="num${h.errors ? " bad" : ""}">${h.errors}</td></tr>`).join(""))
    : empty("No hook calls in this period.");
  const list = denials.recent.length
    ? dataTable(heads(["Denied", "Reason"]), denials.recent.map((r) => `<tr><td class="time">${esc(when(r.at))}</td><td class="wide" title="${esc(r.reason)}">${esc(r.reason)}</td></tr>`).join(""))
    : empty("The gate denied nothing in this period.");
  return `<div class="pair">${card("Hooks", hooks)}${card("Verify-Gate Denials", list, { count: count(denials.total), label: "Verify-gate denials" })}</div>`;
}

function renderSessionsTable(d, o) {
  if (d.sessions?.error) return error(`Sessions failed: ${d.sessions.error}`, "Check that Langfuse is running and LANGFUSE_* is set in ~/.aleph/.env, then reload.");
  const all = shownSessions(d, o);
  if (!all.length) return empty(o.pick || o.q ? "No session matches." : `No session in the last ${o.days} days.`, o.pick || o.q ? "Clear the selection or the search." : "Sessions appear when the hooks send traces to Langfuse.");
  const shown = all.slice(0, o.limit);
  const h = (label, key, c) => sortHead(label, key, o.sort, c);
  const rows = shown.map((s) => `<tr><td class="time">${esc(when(s.start))}</td><td class="time">${esc(when(s.last))}</td><td>${idLink(s.label ?? s.id.slice(0, 8), `#/sessions/${encodeURIComponent(s.id)}`).replace('<a class="idl"', `<a class="idl" title="${esc(s.id)}"`)}</td>` +
    `<td class="wide" title="${esc(s.firstPrompt)}">${esc(s.firstPrompt)}</td><td>${esc(s.project)}</td><td title="${esc(s.taskTypes.join(", "))}">${chips(s.taskTypes.slice(0, 2))}${s.taskTypes.length > 2 ? ` <span class="quiet">+${s.taskTypes.length - 2}</span>` : ""}</td><td class="num">${s.turns}</td><td class="num">${costHtml(s.cost, s.wk)}</td></tr>`).join("");
  return dataTable(`${h("Started", "start")}${h("Last Turn", "last")}${heads(["Session"])}${h("First Prompt", "prompt")}${h("Project", "project")}${heads(["Kinds"])}${h("Turns", "turns", { num: true })}${h("Cost", "cost", { num: true })}`, rows) + pager(shown.length, all.length, STEP);
}

function sessionsHead(d, o) {
  const name = o.pick.slice(o.pick.indexOf(":") + 1), n = shownSessions(d, o).length;
  const title = o.pick ? `Sessions That Used ${name}` : "Sessions";
  const open = o.pick.startsWith("skill:") ? `<a href="${esc(skillHref(name))}">Open the skill</a>` : "";
  return { count: count(n), aside: `${open}${o.pick ? `<button type="button" class="act" data-tile="">Show all sessions</button>` : ""}`, id: "ag-sess", title };
}

const DAYS = [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }];

export function renderSessions(d, o = options()) {
  const projects = d?.sessions?.projects ?? d?.activity?.projects ?? [];
  const total = sum(d?.sessions?.sessions ?? [], (s) => s.cost ?? 0);
  const scope = filterBar([
    { label: "Project", name: "project", data: true, value: projects.includes(o.project) ? o.project : "", options: [{ value: "", label: "All" }, ...projects] },
    { label: "Window", name: "days", value: o.days, options: DAYS },
  ]);
  return `<div class="page sp agents">${pageHead("Sessions", { count: `last ${o.days} days`, aside: scope })}<div id="ag-live" class="sp">${renderLive(d, o)}</div>` +
    `<p class="hint">${esc(money(total))} recorded across these sessions.</p></div>`;
}

const renderLive = (d, o) => {
  const h = sessionsHead(d, o);
  return renderFails(d, o) + `<div class="pair">${toolsCard(d, o)}${skillsCard(d, o)}</div>` +
    card(h.title, `${searchBox("ag-search", o.q, "Search the sessions")}<div id="ag-sessions">${renderSessionsTable(d, o)}</div>`, { ...h, label: "Sessions" }) + hooksCard(d);
};

let live = null;
const here = () => options(hashQuery());

/** Keeps the data for the selection, the sort and the search, which change the page in place. */
function mount(root, d) {
  live = { root, d };
  wireScope(root);
  wireTable(root, { redraw: () => redraw(false), sortOf: (h) => options(new URLSearchParams(h)).sort, downFirst: new Set(["cost", "turns", "start", "last"]), page: STEP, search: "ag-search" });
  // A second press on the selected tile or rank clears it, and "Show all sessions" says "" outright.
  onTile(root.querySelector("#ag-live"), (v) => { setQuery({ pick: here().pick === v ? "" : v, limit: "" }); redraw(true); });
}

/** Redraw the sessions; `all` also redraws the tiles and ranks, whose pressed state the selection sets. */
function redraw(all) {
  if (!live?.root.isConnected) return;
  const o = here();
  if (all) live.root.querySelector("#ag-live").innerHTML = renderLive(live.d, o);
  else { const h = sessionsHead(live.d, o); live.root.querySelector("#ag-sess > .sh").outerHTML = sectionHead(h.title, h); live.root.querySelector("#ag-sessions").innerHTML = renderSessionsTable(live.d, o); }
}
