// The Sessions page: List (the user's own sessions first, the factory's behind a filter) and Tools & Skills (the tiles
// and ranked lists that left the list, as a figure band and two lists). README, Pages and "Sessions, List".
import { barList, barRow, card, cell, chip, chipRow, costHtml, dataTable, esc, fold, heads, idLink, legendHtml, meter, row, subHead, tag } from "../../../../ui/views/lib/html.js";
import { cardPct, count, dur, markLine, money, shortModel, when } from "../../../../ui/views/lib/format.js";
import { band, charts, factsLine, inspector, list, LIVE, now, type Data, type Group, type Page, type Row } from "../kit.ts";

const href = (id: string) => `${LIVE}#/sessions/${encodeURIComponent(id)}`;
const name = (s: any) => s.label ?? s.id.slice(0, 8);
/** A prompt as a title: one line of at most 60 characters, as the live session page cuts it. */
const titled = (t: string) => { const x = t.replace(/\s+/g, " ").trim(); return x.length > 60 ? `${x.slice(0, 59)}…` : x || "No prompt"; };

/** The first turns of a session (the snapshot keeps 6), each linked to its turn page. */
function turns(s: any) {
  if (!s.turnList) return "";
  const body = s.turnList.map((t: any) => row([`<td>${idLink(String(t.n), `${href(s.id)}/turns/${t.n}`)}</td>`, cell(t.prompt, { wide: true, title: t.prompt }), cell(shortModel(t.model)),
    cell(t.tools ? count(t.tools) : "", { num: true }), cell(dur(t.secs), { num: true }), cell(t.cost ? money(t.cost) : "", { num: true })])).join("");
  return `${subHead(s.turnList.length < s.turns ? `Turns, first ${s.turnList.length}` : "Turns")}${dataTable(heads(["Turn", "Prompt", "Model", "Tools", "Took", "Cost"], ["Tools", "Took", "Cost"]), body)}`;
}

/** The inspector of one session: its facts, its first prompt, then its turns. */
function inspect(s: any, T: number) {
  const at = new Date(T);
  const kv: [string, string][] = [["Project", s.project ? esc(s.project) : ""], ["Started", esc(when(s.start, at))], ["Last", esc(when(s.last, at))], ["Took", esc(dur((Date.parse(s.last) - Date.parse(s.start)) / 1000))],
    ["Turns", esc(count(s.turns))], ["Cost", s.cost ? costHtml(s.cost, s.wk ? { pct: s.wk } : null) : ""], ["Holds", s.holds ? esc(count(s.holds)) : ""]];
  const prompt = s.prompt && titled(s.prompt) !== s.prompt ? `${subHead("First Prompt")}<p class="rt-clip">${esc(s.prompt)}</p>` : "";
  return inspector({ id: name(s), title: titled(s.prompt), rows: kv, body: `${prompt}${turns(s)}`, href: href(s.id) });
}

/** One session as a list row: no aleph and no zero cost (README, Decision 6). */
const sessionRow = (s: any, T: number): Row => ({
  key: s.id, lead: idLink(name(s), href(s.id), { title: s.id }),
  main: `<span class="t" title="${esc(s.prompt)}">${esc(s.prompt || "No prompt")}</span>${s.project && s.project !== "aleph" ? chip(s.project) : ""}`,
  cells: [esc(count(s.turns)), s.cost ? esc(money(s.cost)) : "", esc(when(s.last, new Date(T)))],
  text: `${s.id} ${s.label ?? ""} ${s.project} ${s.prompt}`, data: { who: s.who === "you" ? "yours" : s.who }, inspect: inspect(s, T),
});

/**
 * The kit's list with the Who filter on "yours" from the start (README, "Sessions, List"): the other rows and their
 * group head start hidden, as mock.js hides them when a reader presses "yours".
 */
const yoursFirst = (html: string) => html
  .replace('data-name="who"><button type="button" data-value="" aria-pressed="true">', 'data-name="who"><button type="button" data-value="" aria-pressed="false">')
  .replace('data-value="yours" aria-pressed="false"', 'data-value="yours" aria-pressed="true"')
  .replace(/<li class="rt-row mrow"(?=[^>]*data-who="factory")/g, '<li hidden class="rt-row mrow"')
  .replace('<li class="rt-ghead"><span class="gt"><h3 class="sub-head">Factory</h3>', '<li hidden class="rt-ghead"><span class="gt"><h3 class="sub-head">Factory</h3>');

function listView(d: Data) {
  const S = d.sessions, T = now(d), W = S.who;
  // The snapshot lists no headless session, so the filter offers the two kinds it has; the facts line counts all three.
  const groups: Group[] = [
    { title: "Yours", count: count(W.you.n), heads: ["Turns", "Cost", "Last"], rows: S.yours.map((s: any) => sessionRow(s, T)) },
    { title: "Factory", count: count(W.factory.n), heads: ["Turns", "Cost", "Last"], rows: S.factory.map((s: any) => sessionRow(s, T)) },
  ];
  return factsLine([[money(W.you.cost + W.factory.cost + W.headless.cost), "this week"], [money(W.you.cost), "yours"], [money(W.factory.cost), "factory"], [money(W.headless.cost), "headless"]]) +
    yoursFirst(list({ label: "Sessions", search: "Search the sessions", filters: [{ label: "Who", name: "who", options: ["yours", "factory"] }], groups }));
}

const TOP = 10;
const sum = (xs: any[], f: (x: any) => number) => xs.reduce((n, x) => n + f(x), 0);

/** Ranked uses as bars on one scale: the uses that worked, then the errors in `--error`; the rest behind a fold. */
function ranked(rows: { name: string; n: number; errors: number }[]) {
  const most = Math.max(1, ...rows.map((r) => r.n));
  const bar = (r: (typeof rows)[0]) => barRow(esc(r.name), 0, `${esc(count(r.n))}${r.errors ? ` ${tag(count(r.errors), "error", `${count(r.errors)} errors`)}` : ""}`,
    { bar: meter([{ pct: ((r.n - r.errors) / most) * 100 }, { pct: (r.errors / most) * 100, cls: "c-err" }]) });
  const rest = rows.slice(TOP);
  return barList(rows.slice(0, TOP).map(bar).join("")) + (rest.length ? fold(`${count(rest.length)} more`, barList(rest.map(bar).join("")), { cls: "more" }) : "");
}

/** The highest error rates of the tools and skills with 5 uses or more, as the live page's Failing Most picks them. */
function failing(d: Data) {
  const S = d.sessions, rate = (kind: string, nm: string, n: number, errors: number) => ({ kind, name: nm, n, errors, rate: errors / n });
  return [...S.tools.map((t: any) => rate("tool", t.name, t.calls, t.errors)), ...S.skills.map((s: any) => rate("skill", s.name, s.uses, s.errors))]
    .filter((r) => r.n >= 5 && r.errors > 0).sort((a, b) => b.rate - a.rate || b.errors - a.errors).slice(0, 8);
}

function toolsView(d: Data) {
  const S = d.sessions, calls = sum(S.tools, (t) => t.calls), errs = sum(S.tools, (t) => t.errors), uses = sum(S.skills, (s) => s.uses), serrs = sum(S.skills, (s) => s.errors);
  const bash = S.tools.find((t: any) => t.name === "Bash");
  const key = legendHtml([["worked", "k-muted"], ["error", "k-error"]]);
  const fails = failing(d);
  return band([
    { k: "Tool Errors", v: cardPct(errs / calls), cmp: `${count(errs)} of ${count(calls)} calls` },
    { k: "Bash Errors", v: cardPct(bash.errors / errs), cmp: `${cardPct(bash.calls / calls)} of calls`, trend: "warn", title: `${count(bash.errors)} of ${count(errs)} tool errors` },
    { k: "Skill Errors", v: cardPct(serrs / uses), cmp: `${count(serrs)} of ${count(uses)} uses`, trend: "warn" },
    { k: "Unused Skills", v: count(S.unused.length), cmp: `${count(S.skills.length)} used` },
  ]) + charts([
    card("Tools", ranked(S.tools.map((t: any) => ({ name: t.name, n: t.calls, errors: t.errors }))), { count: count(S.tools.length), aside: key }),
    card("Skills", ranked(S.skills.map((s: any) => ({ name: s.name, n: s.uses, errors: s.errors }))) +
      fold(`${count(S.unused.length)} unused`, chipRow(S.unused.map((n: string) => chip(n, { el: "a", attrs: ` href="${esc(`${LIVE}#/skills/${encodeURIComponent(n)}`)}"` })).join(""), "div")),
      { count: count(S.skills.length), aside: key }),
  ]) + card("Failing Most", dataTable(heads(["Name", "Kind", "Errors", "Uses", "Rate"], ["Errors", "Uses", "Rate"]),
    fails.map((r) => row([cell(r.name, { wide: true }), cell(r.kind), cell(count(r.errors), { num: true }), cell(count(r.n), { num: true }), cell(cardPct(r.rate), { num: true })])).join("")), { aside: "5 uses or more" });
}

export const page: Page = {
  id: "sessions", title: "Sessions", group: "Claude", order: 5, icon: "comments", route: "sessions",
  views: [{ id: "list", label: "List", draw: listView }, { id: "tools", label: "Tools & Skills", scope: true, draw: toolsView }],
  // `stale` is the live page's mark of an old index, `{ error, since }`; the snapshot of 2026-11-21 has none.
  attention: (d) => (d.sessions.stale ? [{ tone: "need" as const, text: markLine("Sessions", d.sessions.stale, now(d)) }] : []),
};
