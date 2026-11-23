// The Sessions page, two views. List: the sessions, yours first, the factory's and the scripts' behind a filter. Tools & Skills: the figures,
// the ranked tools and skills, and the ones that fail most. `data` is /api/sessions. The session and turn pages stay in their own views.
import { wireScope, scope } from "./lib/address.js";
import { sessionHref, clip } from "../../lib/naming.ts";
import { cardPct, count, dur, plural, money, when } from "./lib/format.js";
import { cell, chip, chipRow, costHtml, dataTable, empty, error, esc, fold, heads, idLink, notice, barList, barRow, legendHtml, meter, row, card, subHead, tag } from "./lib/html.js";
import { browse, inspector } from "./lib/browse.js";
import { factsLine, figureBand, pageViews } from "./lib/page.js";
import { DAY, SESSIONS, WINDOWS } from "../../lib/windows.ts";

export const view = {
  path: "/sessions",
  title: "Sessions",
  icon: "comments",
  group: "claude",
  order: 0,
  api: (_params, q = new URLSearchParams()) => {
    // The list holds the most rows a page holds, and the page cuts each group to what it draws.
    return scope(q).url(`/api/sessions?${new URLSearchParams({ window: named(q.get("days")), limit: "2000" })}`);
  },
  render: (d, _params, query) => renderSessions(d, options(query), query),
  mount: (root) => wireScope(root),
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

const ROWS = 10, MIN_FOR_RATE = 5, SHOWN = 50;

/** The state from the route's query: ?days=7&project=x. */
export function options(q = new URLSearchParams()) {
  return { days: q.get("days") || "7", project: scope(q).project };
}

const skillHref = (name) => `#/skills/${encodeURIComponent(name)}`;
const toolsOf = (d) => d?.activity?.tools ?? [];
const skillsOf = (d) => d?.skills?.skills ?? [];

/** The eight highest failure rates of the tools and skills with at least five calls. */
export function failing(d) {
  const row = (kind, name, n, errors) => ({ kind, name, n, errors, rate: Math.min(1, errors / n) });
  return [...toolsOf(d).map((t) => row("tool", t.name, t.calls, t.errors)), ...skillsOf(d).map((s) => row("skill", s.name, s.uses, s.errors))]
    .filter((r) => r.n >= MIN_FOR_RATE && r.errors > 0).sort((a, b) => b.rate - a.rate || b.errors - a.errors).slice(0, 8);
}

// plural() prints a bare number; this keeps count()'s thousands separator.
const counted = (n, one) => plural(n, one).replace(/^\d+/, count(n));
const sum = (rows, f) => rows.reduce((n, r) => n + f(r), 0);

/** The prompt as a title: one line of at most 60 characters. */
const titled = (s) => clip(s.firstPrompt, 60) || "No prompt";

/** The inspector of one session: its facts, then its first prompt when the title cut it. */
function inspect(s) {
  const kv = [["Project", s.project ? esc(s.project) : ""], ["Started", esc(when(s.start))], ["Last", esc(when(s.last))], ["Took", esc(dur((Date.parse(s.last) - Date.parse(s.start)) / 1000))],
    ["Turns", esc(count(s.turns))], ["Cost", s.cost ? costHtml(s.cost, s.wk) : ""], ["Kinds", esc(s.taskTypes.join(", "))]];
  const prompt = s.firstPrompt && titled(s) !== s.firstPrompt ? `${subHead("First Prompt")}<p>${esc(s.firstPrompt)}</p>` : "";
  return inspector({ id: s.label ?? s.id.slice(0, 8), title: titled(s), rows: kv, body: prompt, href: sessionHref(s.id) });
}

/** One session as a list row: no aleph and no zero cost. */
const sessionRow = (s) => ({
  key: s.id, lead: idLink(s.label ?? s.id.slice(0, 8), sessionHref(s.id), { title: s.id }),
  main: `<span class="t" title="${esc(s.firstPrompt)}">${esc(s.firstPrompt || "No prompt")}</span>${s.project && s.project !== "aleph" ? chip(s.project) : ""}`,
  cells: [esc(count(s.turns)), s.cost ? costHtml(s.cost, s.wk) : "", esc(when(s.last))],
  text: `${s.id} ${s.label ?? ""} ${s.project ?? ""} ${s.firstPrompt ?? ""}`, data: { who: s.who === "you" ? "yours" : s.who }, inspect: () => inspect(s),
});

// The person's sessions run newest first; the factory's and the scripts' run costliest first.
const WHO = [["you", "Yours", (a, b) => Date.parse(b.last) - Date.parse(a.last)], ["factory", "Factory", (a, b) => b.cost - a.cost], ["headless", "Headless", (a, b) => b.cost - a.cost]];

function listView(d, o) {
  if (d.sessions?.error) return card("Sessions", error("The sessions did not load.", { detail: d.sessions.error }));
  const all = d.sessions?.sessions ?? [];
  const by = (who) => all.filter((s) => s.who === who);
  const cost = (who) => sum(by(who), (s) => s.cost ?? 0);
  const groups = WHO.map(([who, title, order]) => {
    const rows = by(who).sort(order);
    return { title, count: count(rows.length), heads: ["Turns", "Cost", "Last"], rows: rows.map(sessionRow), cap: SHOWN };
  });
  // A cut list (`next`) holds the newest sessions only: `total` covers the window, and who ran a session is read only for the listed ones.
  const cut = d.sessions?.next ? d.sessions.total : null;
  return factsLine([[money(cut ? cut.cost : sum(all, (s) => s.cost ?? 0)), o.days === "7" ? "this week" : `in ${o.days} days`], [money(cost("you")), "yours"], [money(cost("factory")), "factory"], [money(cost("headless")), "headless"]]) +
    (cut ? notice(`Yours, factory and headless cover the newest ${count(all.length)} of ${count(cut.sessions)} sessions.`) : "") +
    browse({ id: "sessions", label: "Sessions", search: "Search the sessions", filters: [{ label: "Who", name: "who", options: ["yours", "factory", "headless"], value: "yours" }], groups });
}

function ranked(rows) {
  const top = Math.max(1, ...rows.map((r) => r.n));
  const bar = (r) => barRow(esc(r.name), 0, `${count(r.n)}${r.errors ? ` ${tag(counted(r.errors, "error"), "error")}` : ""}`,
    { bar: meter([{ pct: ((r.n - r.errors) / top) * 100 }, { pct: (r.errors / top) * 100, cls: "c-err" }]) });
  const rest = rows.slice(ROWS);
  return barList(rows.slice(0, ROWS).map(bar).join("")) + (rest.length ? fold(`${rest.length} more`, barList(rest.map(bar).join("")), { cls: "more" }) : "");
}

function toolsCard(d) {
  const a = d.activity ?? {};
  if (a.langfuse === "off") return card("Tools", empty("Langfuse off"));
  if (a.langfuse === "error") return card("Tools", error("The tools did not load.", { detail: a.error }));
  const t = toolsOf(d);
  return card("Tools", t.length ? ranked(t.map((x) => ({ name: x.name, n: x.calls, errors: x.errors }))) : empty(),
    { aside: legendHtml([[counted(sum(t, (x) => x.calls), "call")], [counted(sum(t, (x) => x.errors), "error"), "c-err"]]) });
}

function skillsCard(d) {
  if (d.skills?.error) return card("Skills", error("The skills did not load.", { detail: d.skills.error }));
  const s = skillsOf(d), unused = d.skills?.unused ?? [];
  return card("Skills", (d.skills?.failed ? notice(`The last reload failed: ${d.skills.failed}.`, true) : "") +
    (s.length ? ranked(s.map((x) => ({ name: x.name, n: x.uses, errors: x.errors }))) : empty()) +
    (unused.length ? fold(`${count(unused.length)} unused`, chipRow(unused.map((n) => chip(n, { el: "a", attrs: ` href="${esc(skillHref(n))}"` })).join(""), "div")) : ""),
    { aside: legendHtml([[counted(sum(s, (x) => x.uses), "use")], [counted(sum(s, (x) => x.errors), "error"), "c-err"]]) });
}

/** The figures of the tools and skills: the tool error rate, the tool with most errors, the skill error rate and the skills never used. */
function figures(d) {
  const t = toolsOf(d), s = skillsOf(d), calls = sum(t, (x) => x.calls), errs = sum(t, (x) => x.errors), uses = sum(s, (x) => x.uses), serrs = sum(s, (x) => x.errors);
  const worst = t.reduce((m, x) => (x.errors > (m?.errors ?? 0) ? x : m), null);
  return [
    ...(calls ? [{ k: "Tool Errors", v: cardPct(errs / calls), cmp: `${count(errs)} of ${count(calls)} calls` }] : []),
    ...(worst ? [{ k: `${worst.name} Errors`, v: cardPct(worst.errors / errs), cmp: `${cardPct(worst.calls / calls)} of calls`, trend: "warn", title: `${count(worst.errors)} of ${count(errs)} tool errors` }] : []),
    ...(uses ? [{ k: "Skill Errors", v: cardPct(serrs / uses), cmp: `${count(serrs)} of ${count(uses)} uses`, trend: "warn" }] : []),
    ...(d.skills?.unused ? [{ k: "Unused Skills", v: count(d.skills.unused.length), cmp: `${count(s.length)} used` }] : []),
  ];
}

function failingCard(d) {
  const rows = failing(d);
  return card("Failing Most", rows.length ? dataTable(heads(["Name", "Kind", "Errors", "Uses", "Rate"], ["Errors", "Uses", "Rate"]),
    rows.map((r) => row([cell(r.name, { wide: true }), cell(r.kind), cell(count(r.errors), { num: true }), cell(count(r.n), { num: true }), cell(cardPct(r.rate), { num: true })])).join("")) : empty(),
  { aside: `${MIN_FOR_RATE} uses or more` });
}

const toolsView = (d) => figureBand(figures(d)) + `<div class="pair">${toolsCard(d)}${skillsCard(d)}</div>` + failingCard(d);

const DAYS = [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }];

export function renderSessions(d, o = options(), query = new URLSearchParams()) {
  // Both views read the one answer, so both carry the project and the day count.
  const bar = { name: "days", options: DAYS, value: o.days, more: d?.sessions?.projects ?? d?.activity?.projects ?? [] };
  return pageViews({ title: "Sessions", path: "/sessions", query, views: [{ id: "list", label: "List", scope: bar, draw: () => partialNotice(d) + listView(d, o) }, { id: "tools", label: "Tools & Skills", scope: bar, draw: () => partialNotice(d) + toolsView(d) }] });
}

/** The fetch reads a bounded number of pages, so a longer window gets the counts of part of it only. */
const partialNotice = (d) => (d?.partial ? notice("Langfuse holds more pages than the fetch reads, so these counts cover only part of the window.") : "");
