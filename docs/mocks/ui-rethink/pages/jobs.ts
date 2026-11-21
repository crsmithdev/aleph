// The Jobs page: Runs (one row per issue with a strip of its runs, then the system runs) and Timing (the tiles and
// tables that left the list, as a figure band, charts 2 across and the tables). README, Pages and "Jobs, Runs".
import { badge, barList, barRow, card, cell, chip, dataTable, esc, heads, idLink, legendHtml, meter, miss, row, statusRow, subHead, tone } from "../../../../ui/views/lib/html.js";
import { cardPct, count, dur, hours, money, shortModel, when } from "../../../../ui/views/lib/format.js";
import { band, charts, columns, factsLine, inspector, lines, legend, list, LIVE, now, type Data, type Group, type Page, type Row, type Series } from "../kit.ts";

/** A run kind's stage word: a build run is the Implement stage. */
const stage = (kind: string) => (kind === "build" ? "implement" : kind);
const jobHref = (id: string) => `${LIVE}#/jobs/${encodeURIComponent(id)}`;
const issueHref = (g: any) => `${LIVE}#/issues/${g.repo}/${g.key.replace(/^\D+/, "")}`;
/** A run's seconds: a running run has no `secs`, so its time is from its start to now; the snapshot read some runs after `at`, so 0 at least. */
const secs = (run: any, T: number) => (run.state === "running" ? Math.max(0, (T - Date.parse(run.started)) / 1000) : run.secs ?? 0);
const total = (runs: any[], T: number) => runs.reduce((n, r) => n + secs(r, T), 0);
/** The colour class of a run's state: its tone, with quiet drawn in `--muted`. */
const k = (state: string) => `k-${tone(state) === "quiet" ? "muted" : tone(state)}`;
/** The state of a row of runs: running while one runs, else its last run's state. */
const state = (runs: any[]) => (runs.some((r) => r.state === "running") ? "running" : runs.at(-1).state);

// The strip and its segments; `.k-*` (mock.css) sets each segment's `--c`. A segment keeps 2px, so a 3s land shows.
const STYLE = `<style>
.rt-jobs-strip { display: flex; gap: 1px; width: 14em; height: var(--bar-h); background: var(--sunk); border-radius: var(--r-hair); overflow: hidden; }
.rt-jobs-strip.full { width: 100%; }
.rt-jobs-strip > i { display: block; flex: none; min-width: 2px; background: var(--c); }
.rt-jobs-strip.full + .legend { margin-top: calc(-1 * var(--sp-4)); }
</style>`;

/** The runs as one strip: a segment per run, its width its share of `most` seconds, its colour its state. */
function strip(runs: any[], T: number, most: number, cls = "") {
  const segs = runs.map((r) => {
    const s = secs(r, T), tip = `${stage(r.kind)} ${r.state} ${dur(s)}${r.model ? ` · ${shortModel(r.model)}` : ""}`;
    return `<i class="${k(r.state)}" style="width:${((s / most) * 100).toFixed(2)}%" title="${esc(tip)}"></i>`;
  }).join("");
  return `<span class="rt-jobs-strip${cls}" role="img" aria-label="${esc(`${count(runs.length)} runs, ${dur(total(runs, T))}`)}">${segs}</span>`;
}

/** The runs of a row as a table, each stage linked to its job page. */
const runTable = (runs: any[], T: number) => dataTable(heads(["Stage", "State", "Model", "Took", "Cost"], ["Took", "Cost"]),
  runs.map((r) => row([`<td><a href="${esc(jobHref(r.id))}">${esc(stage(r.kind))}</a></td>`, `<td>${badge(r.state)}</td>`, cell(shortModel(r.model)), cell(dur(secs(r, T)), { num: true }), cell(r.cost ? money(r.cost) : "", { num: true })])).join(""));

/** The legend of the strip's colours, for the inspector under its own strip. */
const STATES = legendHtml([["done", "k-done"], ["returned", "k-error"], ["dropped", "k-muted"], ["running", "k-run"]]);

/** The inspector of one row: its state, facts, its runs as a strip at full width, then as a table. */
function inspect({ id, title, href, runs, repo, cost }: { id: string; title: string; href: string; runs: any[]; repo?: string; cost: number }, T: number) {
  const kv: [string, string][] = [["Project", repo ? esc(repo) : ""], ["Runs", esc(count(runs.length))], ["Took", esc(dur(total(runs, T)))], ["Cost", cost ? esc(money(cost)) : ""], ["Last", esc(when(runs.at(-1).started, new Date(T)))]];
  const body = `${subHead("Runs")}${strip(runs, T, total(runs, T) || 1, " full")}${STATES}${runTable(runs, T)}`;
  return inspector({ id, title, status: statusRow(badge(state(runs)), "", ""), rows: kv, body, href });
}

/** One row of runs: the id, the title and its chips, then the strip (a running run is its blue segment), the time, the cost and the last start. */
function runRow(r: { key: string; id: string; title: string; href: string; runs: any[]; repo?: string; cost: number; chips: string }, T: number, most: number): Row {
  return {
    key: r.key, lead: idLink(r.id, r.href), main: `<span class="t" title="${esc(r.title)}">${esc(r.title)}</span>${r.chips}`,
    cells: [strip(r.runs, T, most), esc(dur(total(r.runs, T))), r.cost ? esc(money(r.cost)) : "", esc(when(r.runs.at(-1).started, new Date(T)))],
    text: `${r.id} ${r.title} ${r.repo ?? ""}`, inspect: inspect(r, T),
  };
}

/** The system runs by job: a maintainer, monitor, housekeeper or investigator run by its kind, a named job with no issue by its name. Its id is its newest run. */
function systemJobs(d: Data) {
  const ROLE = new Set(["maintainer", "monitor", "housekeeper", "investigator"]);
  const by = Map.groupBy(d.jobs.system, (r: any) => (ROLE.has(r.kind) ? r.kind : r.name));
  return [...by].map(([name, xs]) => {
    const runs = [...xs].sort((a: any, b: any) => Date.parse(a.started) - Date.parse(b.started));
    return { key: `sys.${name}`, id: runs.at(-1).id.replace(/^job\./, ""), title: name, href: jobHref(runs.at(-1).id), runs, cost: runs.reduce((n: number, r: any) => n + (r.cost ?? 0), 0), chips: "" };
  });
}

function runsView(d: Data) {
  const J = d.jobs, T = now(d);
  const issues = J.grouped.map((g: any) => ({ key: g.key, id: g.id, title: g.title, href: issueHref(g), runs: g.runs, repo: g.repo, cost: g.cost, chips: g.repo !== "aleph" ? chip(g.repo) : "" }));
  const system = systemJobs(d);
  // One scale for every strip, so a wider strip is a longer issue.
  const most = Math.max(...[...issues, ...system].map((r) => total(r.runs, T)));
  const groups: Group[] = [
    { title: "Issues", count: count(J.groups), heads: ["Runs", "Took", "Cost", "Last"], rows: issues.map((r: any) => runRow(r, T, most)), more: `${count(issues.length)} of ${count(J.groups)}` },
    { title: "System", count: count(J.system.length), heads: ["Runs", "Took", "Cost", "Last"], rows: system.map((r) => runRow(r, T, most)) },
  ];
  return STYLE + factsLine([[count(J.states.running), "running"], [count(J.runsToday), "runs today"], [money(J.costToday), "today"], [count(J.landed), "landed this week"]]) +
    list({ label: "Jobs", search: "Search ids and titles", groups });
}

const weekday = (ms: number) => new Date(ms).toLocaleDateString("en-US", { weekday: "short" });
const PHASES = ["intake", "queue", "implement", "land"];

/** The stages as p50 fills with p90 marks, on a log scale from 1 second, because they span 24s to 6h. */
function stageBars(d: Data) {
  const P = d.jobs.phases, hi = Math.log(Math.max(...PHASES.map((key) => P[key].p90)));
  const at = (s: number) => Math.max(1, (Math.log(Math.max(1, s)) / hi) * 100);
  return barList(PHASES.map((key) => barRow(`${esc(key)} <span class="count">${count(P[key].count)}</span>`, 0, `${esc(dur(P[key].p50))} / ${esc(dur(P[key].p90))}`,
    { bar: `<span class="rt-log">${meter(at(P[key].p50), `p50 ${dur(P[key].p50)}, p90 ${dur(P[key].p90)}`, { mark: Math.round(at(P[key].p90)) })}</span>` })).join(""));
}

/** Where the run hours went, by outcome: a lost outcome's bar is `--error`. */
function outcomeBars(d: Data) {
  const C = d.jobs.classes, most = Math.max(...C.map((c: any) => c.hours));
  return barList(C.map((c: any) => barRow(`${esc(c.key)} <span class="count">${count(c.runs)}</span>`, 0, esc(hours(c.hours)),
    { bar: meter([{ pct: (c.hours / most) * 100, cls: c.lost ? "c-err" : "" }], `${c.key} ${hours(c.hours)}`) })).join(""));
}

const numTable = (labels: string[], body: string[][]) => dataTable(heads(labels, labels.slice(1)), body.map(([h, ...xs]) => row([`<td class="wide">${h}</td>`, ...xs.map((x) => `<td class="num">${x}</td>`)])).join(""));

function timingView(d: Data) {
  const J = d.jobs, P = J.phases, days = J.days, today = days.at(-1), labels = days.map((x: any) => weekday(x.at));
  const lead: Series[] = [{ name: "p50", color: "run", values: days.map((x: any) => x.p50) }, { name: "p90", color: "muted", values: days.map((x: any) => x.p90) }];
  const runs: Series[] = [{ name: "runs", color: "series-1", values: days.map((x: any) => x.runs) }];
  const lost = J.classes.filter((c: any) => c.lost);
  return band([
    { k: "Lead Time", v: dur(P.lead.p50), cmp: `${dur(today.p50)} today`, trend: today.p50 < P.lead.p50 ? "good" : "warn", title: `p50; p90 ${dur(P.lead.p90)}` },
    { k: "Build", v: dur(P.implement.p50), cmp: `p90 ${dur(P.implement.p90)}`, title: "Implement stage, p50" },
    { k: "First Pass", v: cardPct(J.firstPass), cmp: `of ${count(J.landed)} landed` },
    { k: "Lost Time", v: hours(J.lost.hours), cmp: `${cardPct(J.lost.share)} of run time`, trend: "warn", title: lost.map((c: any) => `${c.key} ${hours(c.hours)}`).join(", ") },
  ]) + charts([
    card("Lead Time", lines(labels, lead, { fmt: dur }), { aside: legend(lead) }),
    card("Runs", columns(labels, runs), { aside: "per day" }),
    card("Stages", stageBars(d), { aside: "p50 / p90, log" }),
    card("Run Hours by Outcome", outcomeBars(d), { aside: legendHtml([["lost", "c-err"]]) }),
    card("Build Time by Model", numTable(["Model", "Jobs", "p50", "p90", "Retried", "Per Landed"], J.byModel.map((m: any) => [
      m.model === "unset" ? miss("no model") : esc(shortModel(m.model)), count(m.runs), dur(m.p50), dur(m.p90), cardPct(m.retried), m.perLanded === null ? miss("under 20 landed") : dur(m.perLanded)])), { count: count(J.byModel.reduce((n: number, m: any) => n + m.runs, 0)) }),
    card("Lead Time by Size", numTable(["Size", "Issues", "p50", "p90"], J.bySize.map((s: any) => [s.size ? esc(s.size) : miss("no size"), count(s.issues), dur(s.p50), dur(s.p90)])), { count: count(J.landed) }),
    card("Slowest Stages", numTable(["Issue", "Took"], J.slowest.map((s: any) => [`${idLink(s.id, `${LIVE}#/issues/aleph/${s.id.slice(1)}`)} <span class="quiet">${esc(s.stage)}</span>`, dur(s.secs)]))),
    card("Checks", numTable(["Check", "Jobs", "p50", "p90"], J.checks.map((c: any) => [esc(c.name), count(c.count), dur(c.p50), dur(c.p90)]))),
  ]);
}

export const page: Page = {
  id: "jobs", title: "Jobs", group: "Factory", order: 4, icon: "stopwatch", route: "factory/jobs",
  views: [{ id: "runs", label: "Runs", draw: runsView }, { id: "timing", label: "Timing", scope: true, draw: timingView }],
  attention: () => [],
};
