// The Agents view: Sessions, Tools and Skills on one page. It answers what the agents did and what fails: the highest
// failure rates, ranked tools and skills, and the sessions list, which a selected tool or skill narrows.
// `data` is /api/sessions. The session and skill detail routes stay in their own views.
import { actButton, badCount, cell, chip, chipRow, codeText, fold, notice, barList, count, barRow, legendHtml, linkButton, meter, miss, plural, row, card, chips, costHtml, tag, dataTable, empty, error, esc, heads, idLink, money, onTile, pageHead, pager, pct, searchBox, setQuery, sortHead, hashQuery, pageOf, pageRows, sortRows, wireTable, statCard, tiles, when, wireScope, scope } from "../lib.js";
import { DAY, SESSIONS, WINDOWS } from "../../lib/windows.ts";

export const view = {
  path: "/sessions",
  title: "Sessions",
  icon: "comments",
  group: "claude",
  order: 0,
  api: (_params, q = new URLSearchParams()) => {
    // The table sorts and filters the whole window, so it asks for the most rows a page holds.
    const out = new URLSearchParams({ window: named(q.get("days")), limit: "2000" });
    if (q.get("project")) out.set("project", q.get("project"));
    return `/api/sessions?${out}`;
  },
  render: (d, _params, query) => renderSessions(d, options(query)),
  mount: (root, d) => mount(root, d),
};

/** The window name of the address's day count: 7, 30 or 90 days, else week. */
const named = (days) => SESSIONS.find((w) => WINDOWS[w] === Number(days) * DAY) ?? "week";

/** The old addresses `#/agents`, `#/activity` and `#/skills` keep their window and project. The detail routes are left alone. */
export function redirect(hash) {
  const [path, qs = ""] = String(hash ?? "").replace(/^#/, "").split("?");
  if (!["/agents", "/activity", "/skills"].includes(path.replace(/\/$/, ""))) return null;
  const old = new URLSearchParams(qs), q = new URLSearchParams();
  for (const k of ["days", "project"]) if (old.get(k)) q.set(k, old.get(k));
  return `#/sessions${q.toString() ? `?${q}` : ""}`;
}

const STEP = 50, ROWS = 10, MIN_FOR_RATE = 5;

/** The state from the route's query: ?days=7&project=x&pick=tool:Bash&q=text&sort=cost&dir=desc&page=2. */
export function options(q = new URLSearchParams()) {
  return { days: q.get("days") || "7", project: q.get("project") ?? "", pick: q.get("pick") ?? "", q: q.get("q") ?? "", sort: { key: q.get("sort") || "cost", dir: q.get("dir") === "asc" ? 1 : -1 }, page: pageOf(q) };
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
// plural() prints a bare number; this keeps count()'s thousands separator.
const counted = (n, one) => plural(n, one).replace(/^\d+/, count(n));
const renderFails = (d, o) => tiles("Failing Most", failing(d).map((r) => statCard({ k: r.name, v: rate(r), note: `${r.kind}: ${count(r.errors)} of ${counted(r.n, r.kind === "tool" ? "call" : "use")}`, key: r.pick, on: o.pick === r.pick })).join(""));

function ranked(kind, rows, o) {
  const top = Math.max(1, ...rows.map((r) => r.n));
  const row = (r) => barRow(esc(r.name), 0, `${count(r.n)}${r.errors ? ` ${tag(counted(r.errors, "error"), "stuck")}` : ""}`, { key: `${kind}:${r.name}`, on: o.pick === `${kind}:${r.name}`,
    bar: meter([{ pct: ((r.n - r.errors) / top) * 100 }, { pct: (r.errors / top) * 100, cls: "c-err" }]) });
  const rest = rows.slice(ROWS);
  return barList(rows.slice(0, ROWS).map(row).join("")) + (rest.length ? fold(`${rest.length} more`, barList(rest.map(row).join("")), { cls: "more", open: rest.some((r) => o.pick === `${kind}:${r.name}`) }) : "");
}

const sum = (rows, f) => rows.reduce((n, r) => n + f(r), 0);

function toolsCard(d, o) {
  const a = d.activity ?? {}, opts = {};
  if (a.langfuse === "off") return card("Tools", empty("Langfuse is not configured.", codeText("Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in `~/.aleph/.env`.")), opts);
  if (a.langfuse === "error") return card("Tools", error("The tools did not load.", `${a.error}. Check that Langfuse is running, then reload.`), opts);
  const t = toolsOf(d);
  return card("Tools", t.length ? ranked("tool", t.map((x) => ({ name: x.name, n: x.calls, errors: x.errors })), o) : empty("No tool calls in this period.", "Widen the window."),
    { aside: legendHtml([[counted(sum(t, (x) => x.calls), "call")], [counted(sum(t, (x) => x.errors), "error"), "c-err"]]) });
}

function skillsCard(d, o) {
  if (d.skills?.error) return card("Skills", error("The skills did not load.", `${d.skills.error}. Check that Langfuse is running, then reload.`));
  const s = skillsOf(d), unused = d.skills?.unused ?? [];
  return card("Skills", (d.skills?.failed ? notice(`The last reload failed: ${d.skills.failed}.`, true) : "") +
    (s.length ? ranked("skill", s.map((x) => ({ name: x.name, n: x.uses, errors: x.errors })), o) : empty(`No skill was used in the last ${plural(Number(o.days), "day")}.`, "A use is a Skill tool call or a slash command.")) +
    (unused.length ? fold(`${count(unused.length)} unused`, chipRow(unused.map((n) => chip(n, { el: "a", attrs: ` href="${esc(skillHref(n))}"` })).join(""), "div")) : ""),
    { aside: legendHtml([[counted(sum(s, (x) => x.uses), "use")], [counted(sum(s, (x) => x.errors), "error"), "c-err"]]) });
}

function hooksCard(d) {
  const a = d.activity ?? {};
  if (a.langfuse !== "ok") return "";
  const denials = a.denials ?? { total: 0, recent: [] };
  const hooks = (a.hooks ?? []).length
    ? dataTable(heads(["Hook", "Calls", "Errors", "Last Call"], ["Calls", "Errors", "Last Call"]), a.hooks.map((h) => row([cell(h.name, { wide: true }), cell(count(h.calls), { num: true }), badCount(h.errors), `<td class="time">${esc(when(h.lastAt))}</td>`])).join(""))
    : empty("No hook calls in this period.", "Widen the window.");
  const list = denials.recent.length
    ? dataTable(heads(["Denied", "Reason"]), denials.recent.map((r) => row([`<td class="time lead">${esc(when(r.at))}</td>`, cell(r.reason, { wide: true })])).join(""))
    : empty("The gate denied nothing in this period.", "Widen the window to see older denials.");
  return `<div class="pair">${card("Hooks", hooks)}${card("Verify-Gate Denials", list, { count: count(denials.total), label: "Verify-gate denials" })}</div>`;
}

function renderSessionsTable(d, o) {
  if (d.sessions?.error) return error("The sessions did not load.", `${d.sessions.error}. Check that Langfuse is running and LANGFUSE_* is set in ~/.aleph/.env, then reload.`);
  const all = shownSessions(d, o);
  if (!all.length) return empty(o.pick || o.q ? "No session matches." : `No session in the last ${plural(Number(o.days), "day")}.`, o.pick || o.q ? "Clear the selection or the search." : "Sessions appear when the hooks send traces to Langfuse.");
  const shown = pageRows(all, o.page, STEP);
  const h = (label, key, c) => sortHead(label, key, o.sort, c);
  const rows = shown.map((s) => row([`<td>${idLink(s.label ?? s.id.slice(0, 8), `#/sessions/${encodeURIComponent(s.id)}`, { title: s.id })}</td>`,
    cell(s.firstPrompt, { wide: true }), s.project ? cell(s.project) : `<td>${miss("No project")}</td>`,
    `<td title="${esc(s.taskTypes.join(", "))}">${chips([...s.taskTypes.slice(0, 2), ...(s.taskTypes.length > 2 ? [`+${s.taskTypes.length - 2}`] : [])])}</td>`,
    cell(count(s.turns), { num: true }), `<td class="num">${costHtml(s.cost, s.wk)}</td>`, `<td class="time">${esc(when(s.start))}</td>`, `<td class="time">${esc(when(s.last))}</td>`])).join("");
  return dataTable(`${heads(["Session"])}${h("First Prompt", "prompt")}${h("Project", "project")}${heads(["Kinds"])}${h("Turns", "turns", { num: true })}${h("Cost", "cost", { num: true })}${h("Started", "start", { num: true })}${h("Last Turn", "last", { num: true })}`, rows) + pager(o.page, all.length, STEP);
}

function sessionsCard(d, o) {
  const name = o.pick.slice(o.pick.indexOf(":") + 1), shown = shownSessions(d, o);
  const title = o.pick ? `Sessions That Used ${name}` : "Sessions";
  const open = o.pick.startsWith("skill:") ? linkButton("Open the skill", skillHref(name)) : "";
  const lede = `${money(sum(shown, (s) => s.cost ?? 0))} recorded across these sessions.`;
  return card(title, renderSessionsTable(d, o), { count: count(shown.length), aside: `${open}${o.pick ? actButton("Show all sessions", { tile: "" }) : ""}`, id: "ag-sess", label: "Sessions", lede });
}

const DAYS = [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }];

export function renderSessions(d, o = options()) {
  const projects = d?.sessions?.projects ?? d?.activity?.projects ?? [];
  const head = scope().bar({ project: projects.includes(o.project) ? o.project : "", value: o.days, more: projects, name: "days", options: DAYS });
  return `<div class="page sp agents">${pageHead("Sessions", { aside: head })}<div id="ag-live" class="sp">${renderLive(d, o)}</div></div>`;
}

// The search box sits over the Sessions card, outside the part that redraws, so it keeps the focus.
const renderLive = (d, o) => partialNotice(d) + renderFails(d, o) + `<div class="pair">${toolsCard(d, o)}${skillsCard(d, o)}</div>` +
  searchBox("ag-search", o.q, "Search the sessions") + `<div id="ag-sessions">${sessionsCard(d, o)}</div>` + hooksCard(d);

/** The fetch reads a bounded number of pages, so a longer window gets the counts of part of it only. */
const partialNotice = (d) => (d?.partial ? notice("Langfuse holds more pages than the fetch reads, so these counts cover only part of the window.") : "");

let live = null;
const here = () => options(hashQuery());

/** Keeps the data for the selection, the sort and the search, which change the page in place. */
function mount(root, d) {
  live = { root, d };
  wireScope(root);
  wireTable(root, { redraw: () => redraw(false), sortOf: (h) => options(new URLSearchParams(h)).sort, downFirst: new Set(["cost", "turns", "start", "last"]), search: "ag-search" });
  // A second press on the selected tile or rank clears it, and "Show all sessions" says "" outright.
  onTile(root.querySelector("#ag-live"), (v) => { setQuery({ pick: here().pick === v ? "" : v, page: "" }); redraw(true); });
}

/** Redraw the sessions; `all` also redraws the tiles and ranks, whose pressed state the selection sets. */
function redraw(all) {
  if (!live?.root.isConnected) return;
  const o = here();
  if (all) live.root.querySelector("#ag-live").innerHTML = renderLive(live.d, o);
  else live.root.querySelector("#ag-sessions").innerHTML = sessionsCard(live.d, o);
}
