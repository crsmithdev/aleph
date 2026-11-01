// The Agents view: Sessions, Tools and Skills on one page. It answers what the agents did and what fails: the highest
// failure rates, ranked tools and skills, and the sessions list, which a selected tool or skill narrows.
// `data` is /api/agents. The session and skill detail routes stay in their own views.
import { chips, costHtml, empty, error, esc, filterBar, idLink, money, pager, sortHead, when } from "../lib.js";

export const view = {
  path: "/agents",
  title: "Agents",
  icon: "robot",
  group: "claude",
  order: 0,
  api: (_params, q = new URLSearchParams()) => {
    const out = new URLSearchParams({ days: q.get("days") || "7" });
    if (q.get("project")) out.set("project", q.get("project"));
    return `/api/agents?${out}`;
  },
  render: (d, _params, query) => renderAgents(d, options(query)),
  mount: (root, d) => mount(root, d),
};

/** The old addresses `#/sessions`, `#/activity` and `#/skills` keep their window and project. The detail routes are left alone. */
export function redirect(hash) {
  const [path, qs = ""] = String(hash ?? "").replace(/^#/, "").split("?");
  if (!["/sessions", "/activity", "/skills"].includes(path.replace(/\/$/, ""))) return null;
  const old = new URLSearchParams(qs), q = new URLSearchParams();
  for (const k of ["days", "project"]) if (old.get(k)) q.set(k, old.get(k));
  return `#/agents${q.toString() ? `?${q}` : ""}`;
}

const STYLE = `<style>
.agents { display: flex; flex-direction: column; gap: 16px; }
.agents .ag-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; margin: 0; }
.agents .ag-head span { font: 400 var(--fs-xl)/1.3 var(--display); color: var(--muted); }
.agents .ag-head h1 { flex: 1 1 320px; margin: 0; font: 400 var(--fs-xl)/1.3 var(--display); color: var(--ink); }
.agents .fbar { margin: 0; }
.agents .fails { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; }
.agents .fail { all: unset; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 16px; background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; color: var(--ink-2); }
.agents .fail:hover, .agents .fail[aria-pressed="true"] { border-color: var(--run); }
.agents .fail .k { color: var(--muted); font: 600 var(--fs-xs) var(--sans); letter-spacing: .08em; text-transform: uppercase; }
.agents .fail b { font: 700 36px/1 var(--metric); color: var(--ink); font-variant-numeric: lining-nums tabular-nums; }
.agents .fail small { font-size: var(--fs-sm); overflow-wrap: anywhere; }
.agents .fail small.nm { color: var(--ink); }
.agents .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; }
.agents .card { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 16px; background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; }
.agents .card h2 { margin: 0; font: 600 var(--fs-lg)/1.3 var(--sans); color: var(--ink); }
.agents .card h2 em { font-style: normal; font-weight: 500; color: var(--muted); }
.agents .card > p { margin: 0; font-size: var(--fs-sm); color: var(--muted); }
.agents .rank { all: unset; box-sizing: border-box; cursor: pointer; width: 100%; display: grid; grid-template-columns: minmax(100px, 170px) minmax(40px, 1fr) 112px; gap: 12px; align-items: center; min-height: 32px; padding: 4px 8px; border-top: 1px solid var(--rule-2); font-size: var(--fs-sm); color: var(--ink-2); }
.agents .rank:hover, .agents .rank[aria-pressed="true"] { background: var(--sunk); }
.agents .rank[aria-pressed="true"] { color: var(--ink); font-weight: 600; }
.agents .fail:focus-visible, .agents .rank:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
.agents .rank em { font-style: normal; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agents .rank .v { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.agents .bars { display: flex; height: 10px; min-width: 2px; }
.agents .bars i { display: block; background: var(--muted); border-radius: 0 3px 3px 0; }
.agents .bars u { display: block; background: var(--stuck); min-width: 2px; }
.agents details.more > summary { cursor: pointer; padding: 6px 8px; font-size: var(--fs-sm); color: var(--muted); }
.agents .unused { display: flex; flex-wrap: wrap; gap: 6px; }
.agents .unused a { font-size: var(--fs-xs); font-weight: 600; color: var(--muted); border: 1px solid var(--rule); border-radius: 4px; padding: 1px 6px; text-decoration: none; }
.agents .unused a:hover { color: var(--ink); border-color: var(--run); }
.agents .sess-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.agents .sess-top input { flex: 0 1 280px; box-sizing: border-box; min-height: 32px; padding: 0 10px; font: var(--fs-sm) var(--sans); color: var(--ink); background: var(--sunk); border: 1px solid var(--rule); border-radius: 6px; }
.agents .sess-top .aside { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: var(--fs-sm); }
.agents .cmd { min-height: 32px; }
@media (max-width: 720px) { .agents .two { grid-template-columns: minmax(0, 1fr); } .agents .rank { grid-template-columns: minmax(0, 1fr) 112px; } .agents .rank .bars { grid-column: 1 / -1; grid-row: 2; } }
</style>`;

const STEP = 50, ROWS = 10, MIN_FOR_RATE = 5;

/** The state from the route's query: ?days=7&project=x&pick=tool:Bash&q=text&sort=cost&dir=desc&limit=100. */
export function options(q = new URLSearchParams()) {
  return { days: q.get("days") || "7", project: q.get("project") ?? "", pick: q.get("pick") ?? "", q: q.get("q") ?? "", sort: { key: q.get("sort") || "cost", dir: q.get("dir") === "asc" ? 1 : -1 }, limit: Math.max(STEP, Number.parseInt(q.get("limit"), 10) || STEP) };
}

const skillHref = (name) => `#/skills/${encodeURIComponent(name)}`;
const toolsOf = (d) => d?.activity?.tools ?? [];
const skillsOf = (d) => d?.skills?.skills ?? [];
const fmt = (n) => Number(n).toLocaleString("en-US");

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
  const keep = o.pick ? sessionIds(d, o.pick) : null, q = o.q.trim().toLowerCase(), f = SORT[o.sort.key] ?? SORT.cost;
  return (d?.sessions?.sessions ?? [])
    .filter((s) => (!o.pick || keep?.has(s.id)) && (!q || `${s.firstPrompt ?? ""} ${s.project ?? ""} ${s.id} ${s.label ?? ""}`.toLowerCase().includes(q)))
    .sort((a, b) => {
      const x = f(a), y = f(b);
      return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * o.sort.dir || SORT.last(b) - SORT.last(a);
    });
}

const rate = (r) => `${Math.round(r.rate * 100)}%`;
const renderFails = (d, o) => `<section class="fails" aria-label="Failing most">${failing(d).map((r) =>
  `<button type="button" class="fail" data-pick="${esc(r.pick)}" aria-pressed="${o.pick === r.pick}"><span class="k">${r.kind}</span><b>${rate(r)}</b><small class="nm">${esc(r.name)}</small><small>${fmt(r.errors)} of ${fmt(r.n)} ${r.kind === "tool" ? "calls" : "uses"}</small></button>`).join("")}</section>`;

function ranked(kind, rows, o) {
  const top = Math.max(1, ...rows.map((r) => r.n));
  const row = (r) => `<button type="button" class="rank" data-pick="${kind}:${esc(r.name)}" aria-pressed="${o.pick === `${kind}:${r.name}`}"><em title="${esc(r.name)}">${esc(r.name)}</em>` +
    `<span class="bars" aria-hidden="true" style="width:${Math.max(1, (r.n / top) * 100).toFixed(2)}%"><i style="flex:${Math.max(0, r.n - r.errors)}"></i>${r.errors ? `<u style="flex:${r.errors}"></u>` : ""}</span><span class="v">${fmt(r.n)} · ${fmt(r.errors)} err</span></button>`;
  const rest = rows.slice(ROWS);
  return `<div>${rows.slice(0, ROWS).map(row).join("")}</div>` + (rest.length ? `<details class="more"${rest.some((r) => o.pick === `${kind}:${r.name}`) ? " open" : ""}><summary>${rest.length} more</summary>${rest.map(row).join("")}</details>` : "");
}

const sum = (rows, f) => rows.reduce((n, r) => n + f(r), 0);

function toolsCard(d, o) {
  const a = d.activity ?? {};
  const head = `<h2>Tools <em>${o.days} days</em></h2>`;
  if (a.langfuse === "off") return `<section class="card">${head}${empty("Langfuse is not configured.", "Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in <code>~/.aleph/.env</code>.")}</section>`;
  if (a.langfuse === "error") return `<section class="card">${head}${error(`Langfuse failed: ${a.error}`, "Check that Langfuse is running, then reload.")}</section>`;
  const t = toolsOf(d);
  return `<section class="card" aria-label="Tools">${head}<p>${fmt(sum(t, (x) => x.calls))} calls, ${fmt(sum(t, (x) => x.errors))} errors. The red part of a bar is errors.</p>` +
    (t.length ? ranked("tool", t.map((x) => ({ name: x.name, n: x.calls, errors: x.errors })), o) : empty("No tool calls in this period.")) + `</section>`;
}

function skillsCard(d, o) {
  const head = `<h2>Skills <em>${o.days} days</em></h2>`;
  if (d.skills?.error) return `<section class="card">${head}${error(`Skills failed: ${d.skills.error}`, "Check that Langfuse is running, then reload.")}</section>`;
  const s = skillsOf(d), unused = d.skills?.unused ?? [];
  return `<section class="card" aria-label="Skills">${head}<p>${fmt(sum(s, (x) => x.uses))} uses, ${fmt(sum(s, (x) => x.errors))} errors.${d.skills?.failed ? ` The last reload failed: ${esc(d.skills.failed)}.` : ""}</p>` +
    (s.length ? ranked("skill", s.map((x) => ({ name: x.name, n: x.uses, errors: x.errors })), o) : empty(`No skill was used in the last ${o.days} days.`, "A use is a Skill tool call or a slash command.")) +
    (unused.length ? `<h2>Unused <em>${unused.length}</em></h2><div class="unused">${unused.map((n) => `<a href="${esc(skillHref(n))}">${esc(n)}</a>`).join("")}</div>` : "") + `</section>`;
}

function hooksCard(d) {
  const a = d.activity ?? {};
  if (a.langfuse !== "ok") return "";
  const denials = a.denials ?? { total: 0, recent: [] };
  const hooks = (a.hooks ?? []).length
    ? `<div class="tscroll"><table class="tbl fit"><thead><tr><th>Hook</th><th class="num">Calls</th><th class="num">Errors</th><th>Last</th></tr></thead><tbody>${a.hooks.map((h) => `<tr><td class="wide">${esc(h.name)}</td><td class="num">${fmt(h.calls)}</td><td class="num${h.errors ? " bad" : ""}">${h.errors}</td><td class="time">${esc(when(h.lastAt))}</td></tr>`).join("")}</tbody></table></div>`
    : empty("No hook calls in this period.");
  const list = denials.recent.length
    ? `<div class="tscroll"><table class="tbl fit"><thead><tr><th>Reason</th><th>When</th></tr></thead><tbody>${denials.recent.map((r) => `<tr><td class="wide" title="${esc(r.reason)}">${esc(r.reason)}</td><td class="time">${esc(when(r.at))}</td></tr>`).join("")}</tbody></table></div>`
    : empty("The gate denied nothing in this period.");
  return `<div class="two"><section class="card" aria-label="Hooks"><h2>Hooks</h2>${hooks}</section><section class="card" aria-label="Verify-gate denials"><h2>Verify-gate denials <em>${fmt(denials.total)}</em></h2>${list}</section></div>`;
}

function renderSessionsTable(d, o) {
  if (d.sessions?.error) return error(`Sessions failed: ${d.sessions.error}`, "Check that Langfuse is running and LANGFUSE_* is set in ~/.aleph/.env, then reload.");
  const all = shownSessions(d, o);
  if (!all.length) return empty(o.pick || o.q ? "No session matches." : `No session in the last ${o.days} days.`, o.pick || o.q ? "Clear the selection or the search." : "Sessions appear when the hooks send traces to Langfuse.");
  const shown = all.slice(0, o.limit);
  const h = (label, key, c) => sortHead(label, key, o.sort, c);
  const rows = shown.map((s) => `<tr><td>${idLink(s.label ?? s.id.slice(0, 8), `#/sessions/${encodeURIComponent(s.id)}`).replace('<a class="idl"', `<a class="idl" title="${esc(s.id)}"`)}</td>` +
    `<td class="wide" title="${esc(s.firstPrompt)}">${esc(s.firstPrompt)}</td><td>${esc(s.project)}</td><td title="${esc(s.taskTypes.join(", "))}">${chips(s.taskTypes.slice(0, 2))}${s.taskTypes.length > 2 ? ` <span class="quiet">+${s.taskTypes.length - 2}</span>` : ""}</td><td class="num">${s.turns}</td><td class="num">${costHtml(s.cost, s.wk)}</td><td class="time">${esc(when(s.start))}</td><td class="time">${esc(when(s.last))}</td></tr>`).join("");
  return `<div class="tscroll"><table class="tbl"><thead><tr><th>Session</th>${h("First prompt", "prompt")}${h("Project", "project")}<th>Kinds</th>${h("Turns", "turns", { num: true })}${h("Cost", "cost", { num: true })}${h("Started", "start")}${h("Last", "last")}</tr></thead><tbody>${rows}</tbody></table></div>${pager(shown.length, all.length, STEP)}`;
}

function sessionsHead(d, o) {
  const name = o.pick.slice(o.pick.indexOf(":") + 1), n = shownSessions(d, o).length;
  const title = o.pick ? `Sessions that used ${name}` : "Sessions";
  const open = o.pick.startsWith("skill:") ? `<a href="${esc(skillHref(name))}">Open the skill</a>` : "";
  return `<h2>${esc(title)} <em>${fmt(n)}</em></h2><span class="aside">${open}${o.pick ? `<button type="button" class="cmd" data-pick="">Show all sessions</button>` : ""}</span>`;
}

const headline = (d, o) => {
  const sessions = d?.sessions?.sessions?.length ?? 0, calls = sum(toolsOf(d), (t) => t.calls);
  return `${fmt(sessions)} ${sessions === 1 ? "session" : "sessions"} made ${fmt(calls)} tool ${calls === 1 ? "call" : "calls"} in ${o.days} days.${failing(d).length ? " These fail most." : ""}`;
};

const DAYS = [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }];

export function renderAgents(d, o = options()) {
  const projects = d?.sessions?.projects ?? d?.activity?.projects ?? [];
  const total = sum(d?.sessions?.sessions ?? [], (s) => s.cost ?? 0);
  return `${STYLE}<div class="page agents"><header class="ag-head"><span>Agents</span><h1>${esc(headline(d, o))}</h1></header>` +
    `<div data-ui="agents-filter">${filterBar([
      { label: "Project", name: "project", value: projects.includes(o.project) ? o.project : "", options: [{ value: "", label: "All" }, ...projects] },
      { label: "Window", name: "days", value: o.days, options: DAYS },
    ])}</div><div id="ag-live">${renderLive(d, o)}</div>` +
    `<p class="hint">${esc(money(total))} recorded across these sessions.</p></div>`;
}

const renderLive = (d, o) => renderFails(d, o) + `<div class="two" style="margin-top:16px">${toolsCard(d, o)}${skillsCard(d, o)}</div>` +
  `<section class="card" aria-label="Sessions" style="margin-top:16px"><div class="sess-top"><div id="ag-sess-head" class="sess-top" style="flex:1 1 auto">${sessionsHead(d, o)}</div><input type="search" name="q" data-ui="ag-search" value="${esc(o.q)}" placeholder="Search the sessions" aria-label="Search the sessions"></div><div id="ag-sessions">${renderSessionsTable(d, o)}</div></section>` +
  `<div style="margin-top:16px">${hooksCard(d)}</div>`;

let live = null;
const here = () => options(new URLSearchParams(location.hash.split("?")[1] ?? ""));

/** Keeps the data for the selection, the sort and the search, which change the page in place. */
function mount(root, d) { live = { root, d }; }

const setQuery = (changes) => {
  const [path, qs = ""] = location.hash.replace(/^#/, "").split("?");
  const q = new URLSearchParams(qs);
  for (const [k, v] of Object.entries(changes)) { if (v) q.set(k, v); else q.delete(k); }
  history.replaceState(null, "", `#${path}${q.toString() ? `?${q}` : ""}`);
};

/** Redraw the sessions; `all` also redraws the tiles and ranks, whose pressed state the selection sets. */
function redraw(all) {
  if (!live?.root.isConnected) return;
  const o = here();
  if (all) live.root.querySelector("#ag-live").innerHTML = renderLive(live.d, o);
  else { live.root.querySelector("#ag-sess-head").innerHTML = sessionsHead(live.d, o); live.root.querySelector("#ag-sessions").innerHTML = renderSessionsTable(live.d, o); }
}

if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const t = e.target.closest ? e.target : null;
    if (!t?.closest(".agents")) return;
    const seg = t.closest('[data-ui="agents-filter"] .seg button');
    if (seg) { const q = new URLSearchParams(location.hash.split("?")[1] ?? ""); q.set(seg.closest(".seg").dataset.name, seg.dataset.value); location.hash = `#/agents?${q}`; return; }
    const pick = t.closest("[data-pick]");
    if (pick) {
      const v = pick.dataset.pick;
      setQuery({ pick: here().pick === v ? "" : v, limit: "" });
      return void redraw(true);
    }
    const sort = t.closest("#ag-sessions button[data-sort]");
    if (sort) {
      const key = sort.dataset.sort, cur = here().sort;
      setQuery({ sort: key, dir: (cur.key === key ? -cur.dir : key === "project" || key === "prompt" ? 1 : -1) > 0 ? "asc" : "desc" });
      return void redraw(false);
    }
    const more = t.closest("#ag-sessions button[data-more]");
    if (more) { setQuery({ limit: String(here().limit + Number(more.dataset.more)) }); redraw(false); }
  });
  document.addEventListener("change", (e) => {
    const f = e.target.closest?.('[data-ui="agents-filter"] select');
    if (!f) return;
    const q = new URLSearchParams(location.hash.split("?")[1] ?? "");
    if (f.value) q.set(f.name, f.value); else q.delete(f.name);
    location.hash = `#/agents${q.toString() ? `?${q}` : ""}`;
  });
  let typing = 0;
  document.addEventListener("input", (e) => {
    if (!e.target.matches?.('[data-ui="ag-search"]')) return;
    clearTimeout(typing);
    typing = setTimeout(() => { setQuery({ q: e.target.value, limit: "" }); redraw(false); }, 120);
  });
}
