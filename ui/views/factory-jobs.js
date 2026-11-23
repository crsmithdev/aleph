// The Jobs page: Runs (a row per issue with a strip of its runs) and Timing (how long each stage takes). `d` is /api/flow for the window.
import { get, moved, redraw } from "./lib/router.js";
import { setQuery, scope } from "./lib/address.js";
import { cardPct, dur, count, failMessage, hours, MIN_LANDED, money, plural, shortModel, when } from "./lib/format.js";
import { badge, barList, barRow, card, cell, chip, dataTable, esc, filterBar, idLink, legendHtml, meter, miss, row, empty, error, heads, loadingLine, onTile, statCard, statusRow, subHead, cardTrend, tiles, tone } from "./lib/html.js";
import { issueHref, jobHref, NAMES, shownId } from "../../lib/naming.ts";
import { quantile } from "../../lib/windows.ts";
import { panelOf } from "./lib/chart.js";
import { listUrl } from "./lib/jobs-table.js";
import { pageViews, factsLine, figureBand } from "./lib/page.js";
import { browse, inspector } from "./lib/browse.js";
import { runStrip } from "./lib/bars.js";
import { bucketOf, flowOf, flowUrl, lastPeriod, trendOn, usable, windowTrend } from "./lib/flow-parts.js";

export const STAGES = [
  ["lead", NAMES.lead],
  ["intake", NAMES.intake],
  ["queue", NAMES.queue],
  ["implement", NAMES.build],
  ["land", NAMES.land],
];
const PARTS = [["intake", NAMES.intake, "series-1"], ["queue", NAMES.queue, "series-2"], ["implement", NAMES.build, "series-3"], ["land", NAMES.land, "series-4"]];

/** A stage card: p50 / p90 over the window, with the last 24h p50 against the window's as the trend. */
const stageTile = ([key, name], d, day, on) => {
  const c = d.phases[key], dc = day?.phases?.[key], none = !c.count;
  const tr = trendOn(d) && dc?.count && !none ? cardTrend(dc.p50, c.p50, null, { kind: "relative", lowerIsGood: true, tip: `${dur(dc.p50)} in the last 24h, against ${dur(c.p50)} over the window` }) : "";
  return statCard({ k: name, v: none ? "–" : dur(c.p50), v2: none ? "–" : dur(c.p90), q: ["p50", "p90"], trend: tr, key, on });
};

/** The Wait share card: the p50 of queue time over lead time, over the issues that landed in the window; no figure with fewer than `MIN_LANDED`. */
const waitTile = (d) => {
  const { count: n, p50 } = d.wait, few = n < MIN_LANDED;
  return statCard({ k: "Wait share", v: few ? "–" : cardPct(p50), note: plural(n, "issue"), trend: few ? "" : windowTrend(d, "waitShare", p50, { kind: "points", lowerIsGood: true, format: cardPct }) });
};

/** The p50 and p90 of a stage by bucket, as two lines: a bucket with no time is null, a gap. */
export const trendFrame = (d, key, name) => ({
  measure: { name: name, unit: "seconds", agg: "max" },
  over: { kind: "time", window: d.window },
  by: { name: bucketOf(d)[0].toUpperCase() + bucketOf(d).slice(1), keys: [{ key: "p90", name: "p90", color: "hot" }, { key: "p50", name: "p50", color: "run" }] },
  rows: d.buckets.map((b) => ({ at: b.at, p90: b.p90?.[key] ?? null, p50: b[key] ?? null })),
  // The p50 is not a part of the p90, so the panel draws two lines, not stacked areas.
  form: "lines",
});

/** One point per issue with a time for the stage and a filing time, in filing order, coloured by outcome; a point's `href` is its issue. */
export const stripFrame = (d, key, name) => ({
  measure: { name, unit: "seconds", agg: "max" },
  over: { kind: "time", window: d.window },
  by: { name: "Outcome", keys: [{ key: "landed", name: "landed", color: "done" }, { key: "unlanded", name: "unlanded", color: "need" }] },
  rows: (d.times ?? []).filter((i) => ["landed", "unlanded"].includes(i.outcome) && i[key] > 0 && i.filed != null).sort((a, b) => a.filed.localeCompare(b.filed)).map((i) => ({ at: Date.parse(i.filed), name: i.id, href: i.href, [i.outcome]: i[key] })),
  form: "points",
});

/**
 * The 10 slowest stages of an issue: for Lead Time, any of intake, queue, build and land, so an issue with two slow
 * stages has two rows; for another stage, that stage. Ordered by stage, then by issue. Each row is `{ id, href, k, name, secs, label }`.
 */
export function slowest(d, key) {
  const parts = key === "lead" ? PARTS : PARTS.filter(([k]) => k === key);
  const order = (k) => PARTS.findIndex(([p]) => p === k);
  return (d.times ?? []).flatMap((i) => parts.filter(([k]) => i[k] > 0).map(([k, name]) => ({ id: i.id, href: i.href, k, name, secs: i[k], label: key === "lead" ? `${i.id} ${name}` : i.id })))
    .sort((a, b) => b.secs - a.secs).slice(0, 10)
    .sort((a, b) => order(a.k) - order(b.k) || a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/** The slowest rows as bars, one key per stage so each stage keeps its colour; a row links to its issue. */
export const slowestFrame = (d, key) => {
  const top = slowest(d, key), parts = PARTS.filter(([k]) => top.some((r) => r.k === k));
  return {
    measure: { name: "Slowest 10", unit: "seconds", agg: "max" },
    over: { kind: "category" },
    by: { keys: parts.map(([k, name, color]) => ({ key: k, name, color })) },
    rows: top.map((r) => ({ name: r.label, href: r.href, [r.k]: r.secs })),
    form: "stacked",
  };
};

/** Each Jobs chart panel: its key, and its frame from the answer and the stage. */
export const FRAMES = { trend: trendFrame, strip: stripFrame, slowest: slowestFrame };
/** The key of a Jobs chart panel: its frame, its kept form and its kept hidden series are its own. */
export const chartKey = (k) => `factory/jobs/${k}`;

/** A row's cell: text, or `{ td }` for a cell that holds markup or a title. */
const td = (c, o) => (typeof c === "string" ? cell(c, o) : c.td);
const table = (labels, num, rows) => !rows.length ? empty() : dataTable(heads(labels, num), rows.map(([h, ...cells]) => row([td(h, { wide: true }), ...cells.map((c) => td(c, { num: true }))])).join(""), { fit: true });
const none = (reason, wide = true) => ({ td: `<td class="${wide ? "wide" : "num"}">${miss(reason)}</td>` });

const SIZES = ["small", "medium", "large"];
const landedIssues = (d) => (d.times ?? []).filter((i) => i.outcome === "landed" && i.lead > 0);
const buildsOf = (d, size = "") => (d.builds ?? []).filter((b) => !size || b.size === size);

/** The Lead Time by Size rows: the landed issues of each size, and of no size when any; an issue's size is that of its last build. */
function leadBySize(d) {
  const landed = landedIssues(d);
  const rows = [...SIZES, null].map((size) => {
    const xs = landed.filter((i) => i.size === size).map((i) => i.lead);
    return [size ?? none("no size"), count(xs.length), dur(quantile(xs, 0.5)), dur(quantile(xs, 0.9))];
  });
  return landed.length ? rows.filter((r, i) => i < SIZES.length || r[1] !== "0") : [];
}

/** The Build Time by Model rows of the build runs of `size` (all with none), fastest Per Landed first. A model with fewer than `MIN_LANDED` landed issues has no Per Landed and sorts last. */
function buildByModel(d, size = "") {
  const rows = [...Map.groupBy(buildsOf(d, size), (b) => b.model)].map(([model, runs]) => {
    const secs = runs.map((b) => b.secs), issues = [...Map.groupBy(runs.filter((b) => b.issue), (b) => b.issue).values()];
    const retried = issues.filter((x) => x.length > 1).length;
    const landed = issues.filter((x) => x[0].landed).map((x) => x.reduce((t, b) => t + b.secs, 0));
    const per = landed.length >= MIN_LANDED ? quantile(landed, 0.5) : null;
    return { per, count: runs.length, model, cells: [
      model === "unset" ? none("no model") : shortModel(model), count(runs.length), dur(quantile(secs, 0.5)), dur(quantile(secs, 0.9)),
      issues.length ? { td: cell(cardPct(retried / issues.length), { num: true, title: `${retried} of ${plural(issues.length, "issue")}` }) } : none("no issue", false),
      per === null ? none(`${landed.length} landed`, false) : dur(per),
    ] };
  });
  return rows.sort((a, b) => (a.per ?? Infinity) - (b.per ?? Infinity) || b.count - a.count || a.model.localeCompare(b.model));
}

/** A run kind's stage word: a build run is the Implement stage. */
const stage = (kind) => (kind === "build" ? "implement" : kind);
const SHOWN = 50; // issue rows drawn: each drawn row carries an inspector, so 2000 jobs would draw too much
const ROLES = new Set(["maintainer", "monitor", "housekeeper", "investigator", "director"]);
/** A run's seconds: a running run has none yet, so its time is from its start to `now`. */
const secsOf = (r, now) => (r.seconds ?? Math.max(0, (now - Date.parse(r.started)) / 1000));
const sumSecs = (runs, now) => runs.reduce((n, r) => n + secsOf(r, now), 0);
/** The state of a row of runs: running while one runs, else the last run's. */
const stateOf = (runs) => (runs.some((r) => r.state === "running") ? "running" : runs.at(-1).state);
const byStart = (a, b) => Date.parse(a.started) - Date.parse(b.started);

/** The runs as a strip: a segment per run, its colour its state. */
const strip = (runs, now, most, o) => runStrip(runs.map((r) => {
  const s = secsOf(r, now);
  return { secs: s, cls: tone(r.state), tip: `${stage(r.kind)} ${r.state} ${dur(s)}${r.model ? ` · ${shortModel(r.model)}` : ""}` };
}), most, { label: `${plural(runs.length, "run")}, ${dur(sumSecs(runs, now))}`, ...o });

const STATES = legendHtml([["done", "t-land"], ["returned", "t-bad"], ["dropped", "t-aux"], ["running", "t-build"]]);

/** The inspector of one row: its state, facts, its runs as a strip at full width, then as a table. */
function inspect(g, now) {
  const { runs } = g, kv = [["Project", esc(g.repo)], ["Runs", esc(count(runs.length))], ["Took", esc(dur(sumSecs(runs, now)))], ["Cost", g.cost ? esc(money(g.cost)) : ""], ["Last", esc(when(runs.at(-1).started))]];
  const rows = runs.map((r) => row([`<td><a href="${esc(jobHref(r.id))}">${esc(stage(r.kind))}</a></td>`, `<td>${badge(r.state)}</td>`, cell(shortModel(r.model)), cell(dur(secsOf(r, now)), { num: true }), cell(r.cost ? money(r.cost) : "", { num: true })])).join("");
  const body = `${subHead("Runs")}${strip(runs, now, sumSecs(runs, now) || 1, { full: true })}${STATES}${dataTable(heads(["Stage", "State", "Model", "Took", "Cost"], ["Took", "Cost"]), rows)}`;
  return inspector({ id: g.id, title: g.title, status: statusRow(badge(stateOf(runs)), "", ""), rows: kv, body, href: g.href });
}

/** A group of runs `{ key, id, title, href, repo, runs }` as a list row: the id, the title, the strip, the time, the cost and the last start. */
const runRow = (g, now, most) => ({
  key: g.key, lead: idLink(g.id, g.href), main: `<span class="t" title="${esc(g.title)}">${esc(g.title)}</span>${g.chips ?? ""}`,
  cells: [strip(g.runs, now, most), esc(dur(sumSecs(g.runs, now))), g.cost ? esc(money(g.cost)) : "", esc(when(g.runs.at(-1).started))],
  text: `${g.id} ${g.title} ${g.repo}`, inspect: () => inspect(g, now),
});

/** The runs of one issue, oldest first, as a row's group. */
function issueGroup(issue, xs) {
  const runs = [...xs].sort(byStart), repo = runs[0].repo || "aleph";
  return { key: `${repo}/${issue}`, id: shownId(issue, repo), title: runs.at(-1).title, href: issueHref(issue, repo), repo: runs[0].repo, runs, cost: runs.reduce((n, r) => n + (r.cost ?? 0), 0), chips: repo !== "aleph" ? chip(repo) : "" };
}

/** The runs with no issue, by job: a maintainer, monitor, housekeeper, director or investigator by its role, any other by its name. Its id is its newest run. */
function systemGroups(jobs) {
  return [...Map.groupBy(jobs.filter((j) => !j.issue), (j) => (ROLES.has(j.kind) ? j.kind : j.name))].map(([name, xs]) => {
    const runs = [...xs].sort(byStart), last = runs.at(-1);
    return { key: `sys.${name}`, id: last.id.replace(/^job\./, ""), title: name, href: jobHref(last.id), repo: last.repo, runs, cost: runs.reduce((n, r) => n + (r.cost ?? 0), 0) };
  });
}

/** The Runs view: `jobs` is /api/jobs for the window, null while it loads, or the Error of a failed load. `d` is /api/flow, for the landed figure. */
function runsView(d, jobs) {
  if (jobs instanceof Error) return error("Could not load the jobs.", { detail: jobs.message });
  if (!jobs) return loadingLine("jobs");
  const now = Date.now(), midnight = new Date(now).setHours(0, 0, 0, 0), today = jobs.filter((j) => Date.parse(j.started) >= midnight);
  const issues = [...Map.groupBy(jobs.filter((j) => j.issue), (j) => `${j.repo}/${j.issue}`).values()].map((xs) => issueGroup(xs[0].issue, xs))
    .sort((a, b) => Date.parse(b.runs.at(-1).started) - Date.parse(a.runs.at(-1).started));
  const system = systemGroups(jobs);
  // One scale for every strip, so a wider strip is a longer issue.
  const most = Math.max(1, ...[...issues, ...system].map((g) => sumSecs(g.runs, now)));
  const cols = ["Runs", "Took", "Cost", "Last"];
  return factsLine([[count(jobs.filter((j) => j.state === "running").length), "running"], [count(today.length), "runs today"], [money(today.reduce((n, j) => n + (j.cost ?? 0), 0)), "today"], [count(d.issues.landed), "landed"]]) +
    browse({ id: "jobs", label: "Jobs", search: "Search ids and titles", groups: [
      { title: "Issues", count: count(issues.length), heads: cols, rows: issues.map((g) => runRow(g, now, most)), cap: SHOWN },
      { title: "System", count: count(jobs.filter((j) => !j.issue).length), heads: cols, rows: system.map((g) => runRow(g, now, most)) },
    ] });
}

/** The Run Hours by Outcome rows: a bar for each outcome class, in `--error` when the class is lost time. */
function outcomeBars(d) {
  if (!d.classes.length) return empty();
  const most = Math.max(...d.classes.map((c) => c.hours)) || 1;
  return barList(d.classes.map((c) => barRow(`${esc(c.key)} <span class="count">${count(c.runs)}</span>`, 0, esc(hours(c.hours)), { bar: meter([{ pct: (c.hours / most) * 100, cls: c.lost ? "c-err" : "" }], `${c.key} ${hours(c.hours)}`) })).join(""));
}

/** The Timing view: the figure band, the stage tiles, the charts of the stage shown, then the timing tables. `day` is /api/flow for the last 24h, or null. */
function timingView(d, day, q) {
  const key = (STAGES.find((s) => s[0] === q.get("stage")) ?? STAGES[0])[0], [, name] = STAGES.find((s) => s[0] === key), size = q.get("size") || "";
  const P = d.phases, p = (k, f) => (P[k].count ? dur(P[k][f]) : "–"), today = trendOn(d) && day?.phases?.lead?.count ? day.phases.lead.p50 : null;
  const lost = d.classes.filter((c) => c.lost).map((c) => `${c.key} ${hours(c.hours)}`).join(", ");
  return `<div class="views" id="perf">` + figureBand([
    { k: "Lead Time", v: p("lead", "p50"), cmp: today === null ? `p90 ${p("lead", "p90")}` : `${dur(today)} last 24h`, trend: today === null ? "" : today < P.lead.p50 ? "good" : "warn", title: `p50; p90 ${p("lead", "p90")}` },
    { k: "Build", v: p("implement", "p50"), cmp: `p90 ${p("implement", "p90")}`, title: "Implement stage, p50" },
    { k: "First Pass", v: cardPct(d.issues.firstPass), cmp: `of ${count(d.issues.landed)} landed` },
    { k: "Lost Time", v: hours(d.lost.hours), cmp: `${cardPct(d.lost.share)} of run time`, trend: "warn", title: lost },
  ]) + tiles("Stages", STAGES.map((s) => stageTile(s, d, day, s[0] === key)).toSpliced(1, 0, waitTile(d)).join("")) +
    `<div class="trio">${panelOf(chartKey("trend"), trendFrame(d, key, name))}${panelOf(chartKey("strip"), stripFrame(d, key, name))}${panelOf(chartKey("slowest"), slowestFrame(d, key))}</div>` +
    `<div class="pair">${card("Lead Time by Size", table(["Size", "Issues", "p50", "p90"], ["Issues", "p50", "p90"], leadBySize(d)), { count: landedIssues(d).length, label: "Lead time by size" })}` +
    card("Build Time by Model", filterBar([{ label: "Size", name: "size", value: size, options: [{ value: "", label: "All" }, ...SIZES] }]) + table(["Model", "Jobs", "p50", "p90", "Retried", "Per Landed"], ["Jobs", "p50", "p90", "Retried", "Per Landed"], buildByModel(d, size).map((m) => m.cells)), { count: buildsOf(d, size).length, label: "Build time by model" }) + `</div>` +
    `<div class="pair">${card("Checks", table(["Check", "Jobs", "p50", "p90"], ["Jobs", "p50", "p90"], d.checks.map((x) => [x.name, count(x.count), dur(x.p50), dur(x.p90)])))}` +
    card("Run Hours by Outcome", outcomeBars(d), { aside: legendHtml([["lost", "t-bad"]]) }) + `</div></div>`;
}

/** The page: Runs, then Timing. `d` is /api/flow for the window; `day` is /api/flow for the last 24h, or null; `jobs` is /api/jobs for the window, null while it loads, or the Error of a failed load; `q` is the route query. */
export const renderFactoryJobs = (d, day, jobs, q) => pageViews({ title: "Jobs", path: "/factory/jobs", query: q, views: [
  { id: "runs", label: "Runs", draw: () => runsView(d, jobs) },
  { id: "timing", label: "Timing", scope: true, draw: () => timingView(d, day, q) },
] });

/** The old address. */
export const redirect = (hash) => moved(hash, ["#/status/performance", "#/jobs"], "#/factory/jobs");

export const view = {
  path: "/factory/jobs",
  title: "Jobs",
  group: "factory",
  order: 1,
  icon: "stopwatch",
  api: (_params, q = new URLSearchParams()) => flowUrl(scope(q).window, q, true),
  live: true,
  refresh: 60,
  // `d.day` is /api/flow for the last 24h and `d.jobs` is /api/jobs for the window, which `more` adds; the page draws without them first.
  render: (d, _params, q = new URLSearchParams()) => renderFactoryJobs(d, usable(d.day), d.jobs ?? null, q),
  more: async (d, q) => {
    // The API holds 2000 jobs a page and gives `next`, the `before` of the following page, until the window ends.
    const page = async (url) => {
      const r = await get(url);
      if (!r.ok) throw new Error(failMessage(url, r.status, await r.text()));
      const { jobs, next } = await r.json();
      return next ? [...jobs, ...await page(`${listUrl(null, q)}&before=${encodeURIComponent(next)}`)] : jobs;
    };
    const jobs = page(listUrl(null, q)).catch((e) => e);
    return { ...d, day: trendOn(d) ? await flowOf("day", q) : null, jobs: await jobs };
  },
  mount: (root, d, q) => {
    const [key, name] = STAGES.find((s) => s[0] === q.get("stage")) ?? STAGES[0];
    onTile(root.querySelector("#perf"), async (k) => {
      setQuery({ stage: k });
      await redraw();
      root.querySelector(`button[data-tile="${k}"]`)?.focus();
    });
    scope().wire(root);
    // Each panel draws the frame of the stage shown; its form and hidden series are its own.
    for (const [k, fr] of Object.entries(FRAMES)) {
      const el = root.querySelector(`aleph-chart[key="${chartKey(k)}"]`);
      if (el) el.frame = fr(d, key, name);
    }
    // The Size filter changes only what the model table counts, so it redraws and does not fetch.
    root.onclick = async (e) => {
      const b = e.target.closest?.('.seg[data-name="size"] button');
      if (!b) return;
      setQuery({ size: b.dataset.value });
      await redraw();
      root.querySelector('.seg[data-name="size"] button[aria-pressed="true"]')?.focus();
    };
  },
};
