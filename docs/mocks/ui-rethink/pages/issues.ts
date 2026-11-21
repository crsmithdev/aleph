// The Issues page: List (groups Open, Parked and Closed, defaults hidden) and Flow (the tiles and charts that left the
// list, as a figure band and charts 2 across). README, Pages and "Issues, List".
import { badge, barList, barRow, card, cell, chip, chips, dataTable, esc, heads, idLink, meter, priorityBadge, row, statusRow, subHead, tag, tone } from "../../../../ui/views/lib/html.js";
import { cardPct, count, day, dur, money, shortModel, when } from "../../../../ui/views/lib/format.js";
import { band, charts, columns, factsLine, inspector, legend, lines, list, LIVE, now, type Data, type Figure, type Group, type Page, type Row, type Series } from "../kit.ts";

/** A run kind's stage word: a build run is the Implement stage. */
const STAGE: Record<string, string> = { intake: "intake", build: "implement", review: "review", recheck: "recheck", land: "land" };
const href = (r: any) => `${LIVE}#/issues/${r.repo}/${r.id.replace(/^\D+/, "")}`;
/** A run's seconds: a running run has a negative `secs`, so its time is from its start to now. */
const secs = (run: any, T: number) => (run.secs < 0 ? (T - Date.parse(run.started)) / 1000 : run.secs);
const running = (r: any) => Array.isArray(r.runs) && r.runs.some((x: any) => x.state === "running");

/** The title and only what differs from the defaults: no medium, no task, no aleph (README, Decision 6). */
const main = (r: any) => `<span class="t" title="${esc(r.title)}">${esc(r.title)}</span>` +
  `${r.priority !== "medium" ? priorityBadge(r.priority) : ""}${r.kind !== "task" ? chip(r.kind) : ""}${r.repo !== "aleph" ? chip(r.repo) : ""}${chips(r.labels)}`;

/** The runs of an issue: a table where the snapshot has the list, a count where it has only the number. */
function runs(r: any, T: number) {
  if (!Array.isArray(r.runs) || !r.runs.length) return "";
  const body = r.runs.map((x: any) => row([cell(STAGE[x.kind] ?? x.kind), `<td>${badge(x.state)}</td>`, cell(shortModel(x.model)), cell(dur(secs(x, T)), { num: true }), cell(x.cost ? money(x.cost) : "", { num: true })])).join("");
  return `${subHead("Runs")}${dataTable(heads(["Stage", "State", "Model", "Took", "Cost"], ["Took", "Cost"]), body)}`;
}

/** The inspector of one issue: its state, facts, runs, request and last note. */
function inspect(r: any, d: Data) {
  const T = now(d), at = new Date(T), shut = r.closed ? Date.parse(r.closed) : null;
  const status = statusRow(badge(running(r) ? "running" : r.status), priorityBadge(r.priority), chips(r.labels));
  const kv: [string, string][] = [
    ["Project", esc(r.repo)], ["Kind", esc(r.kind)], ["Source", esc(r.source)],
    ["Filed", esc(when(r.created, at))], ["Closed", esc(when(r.closed, at))],
    [shut ? "Took" : "Age", esc(dur(((shut ?? T) - Date.parse(r.created)) / 1000))],
    ["Cost", r.cost ? esc(money(r.cost)) : ""], ["Runs", Array.isArray(r.runs) ? "" : esc(count(r.runs))], ["Notes", r.notes ? esc(count(r.notes)) : ""],
  ];
  const req = r.request ? `${subHead("Request")}<p class="rt-clip">${esc(r.request)}</p>` : "";
  const note = r.note ? `${subHead("Last Note")}<p class="rt-clip">${esc(r.note.text)}</p><p class="meta">${esc(when(r.note.at, at))}</p>` : "";
  return inspector({ id: r.id, title: r.title, status, rows: kv, body: `${runs(r, T)}${req}${note}`, href: href(r) });
}

/** One issue as a list row; `cells` are its state, cost and time. */
const issueRow = (r: any, d: Data, cells: string[]): Row => ({
  key: r.id, lead: idLink(r.id, href(r)), main: main(r), cells, inspect: inspect(r, d),
  text: `${r.id} ${r.title} ${r.repo} ${r.kind} ${r.labels.join(" ")}`, data: { project: r.repo, kind: r.kind },
});
const cost = (r: any) => (r.cost ? esc(money(r.cost)) : "");
const age = (r: any, T: number) => esc(dur((T - Date.parse(r.created)) / 1000));

/** The groups of the list: Open (running first), Parked, then the newest closed issues of the snapshot. index.html draws them for Open choice 3. */
export function groups(d: Data): Group[] {
  const I = d.issues, T = now(d);
  const open = I.active.filter((r: any) => r.status === "open").sort((a: any, b: any) => Number(running(b)) - Number(running(a)));
  const parked = I.active.filter((r: any) => r.status === "parked");
  const closedAll = I.counts.done + I.counts.dropped;
  // A done row is a muted word, a dropped row its badge: done is the default end (README, Decision 6).
  const end = (r: any) => (r.status === "done" ? `<span class="quiet">done</span>` : badge(r.status));
  return [
    { title: "Open", count: count(open.length), heads: ["", "Cost", "Age"], rows: open.map((r: any) => issueRow(r, d, [running(r) ? badge("running") : tag(r.stage, tone(r.stage)), cost(r), age(r, T)])) },
    { title: "Parked", count: count(parked.length), heads: ["", "Cost", "Age"], rows: parked.map((r: any) => issueRow(r, d, ["", cost(r), age(r, T)])) },
    {
      title: "Closed", count: count(closedAll), heads: ["", "Cost", "Took"], more: `${count(I.closed.length)} of ${count(closedAll)}`,
      rows: I.closed.map((r: any) => issueRow(r, d, [end(r), cost(r), esc(dur((Date.parse(r.closed) - Date.parse(r.created)) / 1000))])),
    },
  ];
}

function listView(d: Data) {
  const I = d.issues, rows = [...I.active, ...I.closed];
  const kinds = [...new Set<string>(rows.map((r: any) => r.kind))], repos = [...new Set<string>(rows.map((r: any) => r.repo))];
  return factsLine([[count(I.counts.open), "open"], [count(I.counts.parked), "parked"], [count(I.closedWeek), "closed this week"], [dur(I.p50), "to close, p50"]]) +
    list({ label: "Issues", search: "Search or file an issue", hint: "Ctrl+Enter files", filters: [{ label: "Project", name: "project", options: repos }, { label: "Kind", name: "kind", options: kinds }], groups: groups(d) });
}

const weekday = (ms: number) => new Date(ms).toLocaleDateString("en-US", { weekday: "short" });
const SOURCES: [string, string][] = [["agent", "series-1"], ["worker", "series-2"], ["memory", "series-3"], ["chris", "series-4"]];

/** Time to close per kind: the p50 as the fill, the p90 as the mark, on a log scale from 1 minute, because the kinds span 15m to 16d. */
function closeBars(d: Data) {
  const ks = d.issues.kinds, lo = Math.log(60), hi = Math.log(Math.max(...ks.map((k: any) => k.p90)));
  const at = (s: number) => Math.max(1, ((Math.log(s) - lo) / (hi - lo)) * 100);
  return barList(ks.map((k: any) => barRow(`${esc(k.kind)} <span class="count">${count(k.closed)}</span>`, 0, `${esc(dur(k.p50))} / ${esc(dur(k.p90))}`,
    { bar: `<span class="rt-log">${meter(at(k.p50), `p50 ${dur(k.p50)}, p90 ${dur(k.p90)}`, { mark: Math.round(at(k.p90)) })}</span>` })).join(""));
}

/** The figures of the Flow band, each with its comparison. index.html draws them for Open choice 2. */
export function flowFigures(d: Data): Figure[] {
  const I = d.issues, first = I.days[0], last = I.days.at(-1);
  return [
    { k: "Filed", v: count(I.filed), cmp: `${count(I.closedWeek)} closed` },
    { k: "Time to Close", v: dur(I.p50), cmp: `${dur(I.p50Before)} the week before`, trend: I.p50 > I.p50Before ? "warn" : "good", title: `p50; p90 ${dur(I.p90)}` },
    { k: "Backlog", v: count(last.backlog), cmp: `${count(first.backlog)} on ${day(first.at, new Date(now(d)))}`, trend: last.backlog < first.backlog ? "good" : "warn" },
    { k: "Dropped", v: cardPct(I.droppedWeek / I.closedWeek), cmp: `${count(I.droppedWeek)} of ${count(I.closedWeek)}` },
  ];
}

function flowView(d: Data) {
  const I = d.issues, days = I.days, labels = days.map((x: any) => weekday(x.at));
  const flow: Series[] = [{ name: "filed", color: "series-1", values: days.map((x: any) => x.filed) }, { name: "closed", color: "done", values: days.map((x: any) => x.closed) }];
  const source: Series[] = SOURCES.map(([k, c]) => ({ name: k, color: c, values: days.map((x: any) => x.source[k] ?? 0) }));
  const backlog: Series[] = [{ name: "backlog", color: "series-1", values: days.map((x: any) => x.backlog) }];
  const table = dataTable(heads(["Kind", "Closed", "Dropped", "p50", "p90"], ["Closed", "Dropped", "p50", "p90"]),
    I.kinds.map((k: any) => row([cell(k.kind), cell(count(k.closed), { num: true }), cell(count(k.dropped), { num: true }), cell(dur(k.p50), { num: true }), cell(dur(k.p90), { num: true })])).join(""));
  return band(flowFigures(d)) + charts([
    card("Filed and Closed", columns(labels, flow), { aside: legend(flow) }),
    card("Filed by Source", columns(labels, source, { stacked: true }), { aside: legend(source) }),
    card("Time to Close", closeBars(d), { aside: "p50 / p90, log" }),
    card("Backlog", lines(labels, backlog), { aside: "start of day" }),
  ]) + card("Closed by Kind", table, { count: count(I.kinds.length), aside: "7 days" });
}

export const page: Page = {
  id: "issues", title: "Issues", group: "Factory", order: 3, icon: "list-check", route: "issues",
  views: [{ id: "list", label: "List", draw: listView }, { id: "flow", label: "Flow", scope: true, draw: flowView }],
  // An open issue whose last run failed or came back waits on a decision; the snapshot has none (README, Pages).
  attention: (d) => d.issues.active.filter((r: any) => r.status === "open" && Array.isArray(r.runs) && ["failed", "returned"].includes(r.runs.at(-1)?.state))
    .map((r: any) => ({ tone: "need" as const, text: `${r.id} ${r.runs.at(-1).state}: ${r.title}`, act: { label: "Open", href: href(r) } })),
};
