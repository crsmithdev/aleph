// The Now view: the factory's front page. Each render function takes the
// /api/factory object and returns an HTML string. No DOM, so tests can call them.
// The page's click handler (router.js) runs the buttons `act` makes.
import { keep, kept, scope } from "./lib/address.js";
import { undecided } from "./lib/decisions.js";
import { cardPct, dur, count, hours, mean, plural, shortModel, when } from "./lib/format.js";
import { actButton, fold, recordState, restoreState, codeText, facts, tabs, wireTabs, tiles, badge, card, chip, splitCard, sideStats, legendHtml, sectionHead, meter, dataTable, costHtml, empty, error, esc, idLink, loadingLine, miss, pageHead, priorityBadge, repoIdLink, row, cell, heads, subHead, sortHead, sortRows, nextSort, tag, tone } from "./lib/html.js";
import { shortText, NAMES, runWord, shortId, jobHref, contentText, shownId, issueHref } from "../../lib/naming.ts";
import { panelOf, title as chartTitle } from "./lib/chart.js";
import { feedRow, heraldRow } from "./lib/feed.js";
import { flowOf, statusCards, usable } from "./lib/flow-parts.js";
import { actMsg, askCard, askShell, checkFacts, itemId, metaRow, statLines, trailerLine } from "./lib/ask-cards.js";
import { verdict } from "../../lib/status-words.ts";
import { needItems } from "./lib/memory-health.js";
import { get } from "./lib/router.js";

export const view = {
  path: "/",
  title: "Status",
  group: "factory",
  order: -3,
  icon: "gauge-high",
  api: (_params, q = new URLSearchParams()) => { const s = scope(q); return s.url(`/api/factory?window=${s.window}`); },
  live: true,
  // `s.flow` is /api/flow for the window with its baseline and `s.memory` the Memory page's data, which `more` adds; the page draws without them first.
  render: (s, _params, q) => { page.state = s; const w = scope(q).window, f = s.flow ?? null; return `<div class="page sp">${renderStatusLine(s, page.stale, w)}${tiles("Scorecard", renderTiles(s, f, w), "scorecard")}<div class="rail"><div class="rail-main">${renderPipeline(f, q, (s.errored ?? []).length)}${renderIssues(f)}${renderMemory(s.memory ?? null)}</div>${renderHerald(s, page, q)}</div></div>`; },
  more: async (s, q) => { const [flow, memory] = await Promise.all([flowOf(scope(q).window, q, true), memoryOf(q)]); return { ...s, flow, memory }; },
  // The shell calls this when the out-of-date verdict changes: the sentence is drawn again from the last state.
  outOfDate: (root, b) => { page.stale = b; const el = root.querySelector(".shead .say"); if (el && page.state) el.outerHTML = renderLede(page.state, b); },
  mount: (root, s, q) => {
    scope(q).wire(root); wireHeraldJump(root); wireInspect(root);
    // A feed row's chip word filters the feed to its word; the X of the aside's chip clears it.
    root.onclick = (e) => {
      const b = e.target.closest?.("#herald .herald-feed .event-line > .badge:first-child, #herald .herald-word .ref-x");
      if (!b) return;
      e.preventDefault();
      keep(WORD, b.matches(".ref-x") ? null : b.textContent);
      redrawHerald(root);
    };
    if (usable(s.flow)) { root.querySelector('aleph-chart[key="status/active"]').frame = activeFrame(s.flow); root.querySelector('aleph-chart[key="status/speed"]').frame = speedFrame(s.flow); }
  },
  // The stream sends the Herald's rows when an event is added; the page draws them at once, until a state with a newer or equal `seq` replaces them.
  event: (root, live) => {
    page.live = live;
    redrawHerald(root);
  },
  swap: (root) => heraldMotion(root),
};

/** What the page keeps between draws: the last rendered state, the shell's out-of-date verdict, and the last rows the stream sent (`{ seq, rows }`). `renderHerald` takes it as a parameter. */
const page = { state: null, stale: false, live: null };

/** The Herald drawn again from the last state, with its folds and motion kept. */
function redrawHerald(root) {
  const h = root.querySelector("#herald");
  if (!h || !page.state) return;
  const saved = recordState(h), moved = heraldMotion(root);
  h.outerHTML = renderHerald(page.state);
  restoreState(root.querySelector("#herald"), saved);
  moved();
}

const PERFORMANCE = "#/factory/jobs";
/** A link to another page that keeps the window; week is the default and stays out of the address. */
const withWindow = (href, win) => (win === "week" ? href : `${href}?window=${win}`);

/** The scorecard: efficiency, completion, issues, jobs, usage. `d` is /api/flow for the window `win` with its baseline, or null while it loads. */
export function renderTiles(s, d, win = d?.window ?? "week") {
  return statusCards(s, d, { performance: withWindow(PERFORMANCE, win) });
}

/** The active-issues frame: per bucket, the issues in each stage (`d.active` of /api/flow), stacked. */
export const activeFrame = (d) => ({
  measure: { name: "Active Issues", unit: "count", agg: "max" },
  over: { kind: "time", window: d.window },
  by: { name: "Stage", keys: [{ key: "intake", name: NAMES.intake, color: "chart-6" }, { key: "queue", name: "Queued", color: "series-4" }, { key: "running", name: "Running", color: "run" }, { key: "landed", name: "Landed", color: "done" }] },
  rows: d.active ?? [],
  form: "area",
});

/** The legend swatch class of each chart colour the speed chart uses. */
const SWATCH = { "chart-6": "c-s6", "series-4": "c-s4", run: "c-run", done: "c-done" };
/** The longest column the speed chart draws, in seconds: a slow bucket is cut there, so it does not flatten the rest. */
const SPEED_CAP = 1800;
/** The speed frame: per bucket, the median seconds of each phase that ended in it (`d.buckets` of /api/flow), stacked. The colours are Active Issues'. */
export const speedFrame = (d) => ({
  measure: { name: "Median Time", unit: "seconds", agg: "max" },
  over: { kind: "time", window: d.window },
  by: { name: "Phase", keys: [{ key: "intake", name: NAMES.intake, color: "chart-6" }, { key: "queue", name: NAMES.queue, color: "series-4" }, { key: "implement", name: NAMES.build, color: "run" }, { key: "land", name: NAMES.land, color: "done" }] },
  rows: (d.buckets ?? []).map((b) => ({ at: b.at, intake: b.intake, queue: b.queue, implement: b.implement, land: b.land })),
  form: "columns",
  cap: SPEED_CAP,
  legend: false,
});

/** The Issues card: the active issues over the window on the left, the median time of each phase on the right. `d` is /api/flow for the window, null while it loads, or `{ error }`. */
function renderIssues(d) {
  if (!d) return card("Issues", loadingLine("the issues"), { id: "issues" });
  if (d.error) return card("Issues", error(d.error), { id: "issues" });
  const speed = speedFrame(d);
  // The speed chart is a quarter of the card wide, too narrow for the chart's own legend, so the legend is under it.
  const keys = legendHtml(speed.by.keys.map((k) => [k.name, SWATCH[k.color]]));
  return splitCard("Issues", panelOf("status/active", activeFrame(d), "", { bare: true }), subHead(chartTitle(speed)) + panelOf("status/speed", speed, "", { bare: true }) + keys, { id: "issues" });
}

/** /api/memory in the project of `q` with /api/memory/processes as `processes`, as the Memory page combines them; `{ error }` when a load fails. */
async function memoryOf(q) {
  try {
    const [m, processes] = await Promise.all([scope(q).url("/api/memory"), "/api/memory/processes"].map(async (url) => {
      const res = await get(url);
      if (!res.ok) throw new Error(`Could not load Memory (${res.status}).`);
      return res.json();
    }));
    return { ...m, processes };
  } catch (e) { return { error: e.message }; }
}

/** The Memory card: the memory items that wait for Chris, as the Memory page's Needs-you strip lists them. `m` is null while it loads, or `{ error }`. */
function renderMemory(m) {
  const box = (body) => card("Memory", body, { id: "memory" });
  if (!m) return box(loadingLine("the memory"));
  if (m.error) return box(error(m.error));
  const items = needItems(m);
  return box(items.length ? list(items.join("")) : empty());
}

/** The pipeline stages in order, with their names; the monitor's other roles (facts, director, monitor…) are not stages of an issue. Queue is the wait before the first build, not a run. */
const PIPE = Object.fromEntries(["intake", "queue", "build", "review", "recheck", "land"].map((k) => [k, NAMES[k]]));
/** The tone of a stage's failed share: under 10% none, to 25% need, above that error. */
const health = (share) => (share < 0.1 ? "" : share <= 0.25 ? "need" : "error");
/** The Jobs filter of each stage: its stage tile there and the role of its runs. Review and Recheck have no stage tile, so they filter by role alone; a recheck is a worker run. */
const DRILL = { intake: { stage: "intake", role: "intake" }, queue: { stage: "queue" }, build: { stage: "implement", role: "worker" }, review: { role: "reviewer" }, recheck: { role: "worker" }, land: { stage: "land" } };
/** The Jobs page for a stage, in the window and project of `q`. */
const drillHref = (k, q, extra = {}) => {
  const s = scope(q), out = new URLSearchParams({ ...DRILL[k], ...extra });
  if (s.window !== "week") out.set("window", s.window);
  if (s.project) out.set("project", s.project);
  return `#/factory/jobs?${out}`;
};

/** The Pipeline card for the window: a row per stage with its runs per issue, p90 time, failed share and agent hours on one scale, where Implement's bar splits its hours by outcome; the issue counts of the window on the right. `d` is /api/flow for the window, null while it loads, or `{ error }`; `errored` is the errored jobs now. */
export function renderPipeline(d, q = new URLSearchParams(), errored = 0) {
  if (!d) return card("Pipeline", loadingLine("the pipeline"), { id: "pipeline" });
  if (d.error) return card("Pipeline", error(d.error), { id: "pipeline" });
  const by = new Map((d.stages?.rows ?? []).map((r) => [r.stage, r]));
  const queue = d.phases?.queue, { kept, hours: lostH } = d.figures ?? {};
  const classes = (d.classes ?? []).filter((c) => c.hours > 0);
  // Implement's hours are its outcome classes', so its bar and the legend add up; the other stages' are runs times minutes.
  const agentH = (k) => (k === "build" ? kept + (lostH ?? 0) : by.get(k) ? (by.get(k).runs * by.get(k).minutes) / 60 : 0);
  const most = Math.max(...Object.keys(PIPE).filter((k) => k !== "queue").map(agentH));
  const go = (k, name, tip) => `<td><button type="button" class="pgo" data-inspect="stage" data-target="${esc(k)}" title="${esc(tip)}">${esc(name)}</button></td>`;
  const num = (html) => `<td class="num">${html}</td>`, wide = (html = "") => `<td class="wide">${html}</td>`;
  const bar = (k) => {
    if (k !== "build") return wide(meter(most ? (agentH(k) / most) * 100 : 0));
    return wide(meter(classes.map((c) => ({ pct: (c.hours / most) * 100, cls: `seg-${c.key}` })), classes.map((c) => `${c.key} ${hours(c.hours)}`).join(", ")));
  };
  const line = ([k, name]) => {
    if (k === "queue") {
      const none = miss("A wait has no runs");
      return row([go(k, name, `Queue: ${plural(queue?.count ?? 0, "wait")}`), num(none), num(queue?.count > 0 ? esc(dur(queue.p90)) : miss("Nothing waited in this window")), num(none), wide(), num(miss("A wait has no agent"))]);
    }
    const r = by.get(k);
    if (!r?.items) return row([go(k, name, `${name}: no runs`), num(miss("Nothing ran in this window")), cell("–", { num: true }), cell("–", { num: true }), wide(), cell("–", { num: true })]);
    const share = r.runs ? (r.unusable ?? 0) / r.runs : 0, t = health(share);
    const tip = `${name}: ${plural(r.runs, "run")} on ${plural(r.items, "issue")}${r.unusable ? `, ${count(r.unusable)} failed` : ""}`;
    const failed = r.unusable ? num(`<a class="pf${t ? ` ${t}` : ""}" href="${esc(drillHref(k, q, { unusable: "1" }))}">${cardPct(share)}</a>`) : cell(cardPct(share), { num: true });
    return row([go(k, name, tip), cell(mean(r.runs / r.items), { num: true }), cell(dur(r.p90), { num: true }), failed, bar(k), cell(hours(agentH(k)), { num: true })]);
  };
  const table = dataTable(heads(["Stage", "Runs / Issue", "p90", "Failed", "", "Agent"], ["Runs / Issue", "p90", "Failed", "Agent"]), Object.entries(PIPE).map(line).join(""), { fit: true });
  const legend = legendHtml(classes.map((c) => [`${c.key} ${hours(c.hours)}`, `seg-${c.key}`, `data-inspect="class" data-target="${esc(c.key)}" title="${esc(c.text ?? c.key)}"`]));
  const intake = by.get("intake")?.items ?? 0, open = d.open ?? { open: 0, parked: 0 };
  const side = sideStats([
    { k: "Filed", v: count(d.filed?.all ?? 0) },
    { k: "Intake", v: count(intake) },
    { k: "Landed", v: count(d.done ?? 0), state: "landed" },
    { k: "Dropped", v: count(d.dropped ?? 0) },
    { k: "Open", v: count(open.open), note: open.parked ? `+${count(open.parked)}` : "", title: `${plural(open.open, "open issue")}, ${plural(open.parked, "parked issue")}` },
    { k: "Errored", v: count(errored), note: "now", state: errored ? "failed" : "" },
  ]);
  return splitCard("Pipeline", table, side, { id: "pipeline", aside: legend });
}

/** A Herald row's element id from its key, so a redraw by morph keeps the row's node and does not reuse it for another row. */
const rowId = (key) => esc(`h-${key.replace(/\s+/g, "-")}`);

/** The key of the Herald's word filter in keep(): the chip word whose event rows the feed shows, or null for every row. */
const WORD = "herald.word";

/** A job's ID linked to its page; a job with no ID links its item. */
const jobLink = (j) => (j.id ? idLink(shownId(j.id), jobHref(j.id)) : itemId(j));

/** The running jobs as rows of the feed's grid under the alerts: the start time, the action word, the ID, the title, a build's size with the breathing dot. Each is keyed by `data-job` so a job that ends leaves the section. A job leaves the state when it ends, so the rows are the state's. */
function runNow(s) {
  const row = (id, who, word, title, t, model, size = "") => feedRow({ tone: "run", at: t, cls: " run-now", attrs: ` data-job="${esc(id)}" id="${rowId(`job ${id}`)}"`,
    body: `<span class="event-line">${tag(word, "run")}${who}<span class="event-title run-title" title="${esc(title)}">${esc(title)}</span>` +
      `<span class="run-size"${model ? ` title="${esc(model)}"` : ""}><span class="run-dot"></span>${esc(size)}</span></span>` });
  const rows = s.runningIssues.map((i) => row(i.id, repoIdLink(i.id, i.href), i.stage, i.title, i.at ?? i.since)).concat(s.running.map((j) => {
    const run = j.run ?? { kind: "build", started: j.started };
    const size = run.kind === "build" ? j.size : "";
    return row(j.id ?? j.name, jobLink(j), runWord(run.kind), j.item?.title || j.name, run.started ?? j.started, j.model, size);
  }));
  return rows.length ? `<section class="herald-running" aria-label="Running">${rows.join("")}</section>` : "";
}

/** The Active pane: one list of the running issues, then the queued issues, then the running jobs, each row linked to its page. */
function active(s) {
  const rows = [
    ...s.runningIssues.map((i) => [repoIdLink(i.id, i.href), i.title]),
    ...(s.queued ?? []).map((q) => { const id = `${q.repo}-${q.id}`; return [repoIdLink(id, issueHref(id)), q.title]; }),
    ...s.running.map((j) => [jobLink(j), j.item?.title || j.name]),
  ];
  return rows.length ? dataTable("", rows.map(([id, title]) => row([`<td>${id}</td>`, cell(title, { wide: true })])).join("")) : empty();
}

/** The key of the Herald's open tab and Inspector target in keep(): `{ tab, kind, target }`, `kind` "stage" or "class", or "failures" with no target. */
const INSPECT = "herald.inspect";

/** The Inspector pane: the issues of the kept stage or class in `d`, /api/flow for the window, else its failed issues; `at` is the kept target. */
function inspector(d, at, q) {
  if (!d) return loadingLine("the issues");
  if (d.error) return error(d.error);
  const id = (x) => `<td>${x.href ? repoIdLink(x.issue, x.href) : esc(x.issue)}</td>`;
  const table = (head, rows) => (rows.length ? dataTable(head, rows.join("")) : empty());
  // A click on it keeps no target, so the pane goes back to the failures.
  const back = `<button type="button" class="pgo" data-inspect="failures">Failures</button>`;
  if (!at.target) {
    const rows = d.failures.map((x) => row([id(x), cell(x.title ?? "", { wide: true }), cell(PIPE[x.stage]), cell(when(x.at), { num: true })]));
    return `<div class="inspect-head">${subHead("Failures")}</div>` + table(heads(["Issue", "Title", "Stage", "Failed"], ["Failed"]), rows);
  }
  if (at.kind === "stage") {
    const rows = d.stages.issues[at.target].map((x) => row([id(x), cell(x.title ?? "", { wide: true }), cell(count(x.runs), { num: true }), cell(dur(x.secs), { num: true }), `<td>${x.failed ? tag("failed", tone("failed")) : ""}</td>`]));
    return `<div class="inspect-head">${subHead(PIPE[at.target])}<span>${back} <a href="${esc(drillHref(at.target, q))}">All jobs</a></span></div>` + table(heads(["Issue", "Title", "Runs", "Time", ""], ["Runs", "Time"]), rows);
  }
  const rows = d.classes.find((c) => c.key === at.target).top.map((x) => row([id(x), cell(x.title ?? "", { wide: true }), cell(hours(x.hours), { num: true })]));
  return `<div class="inspect-head">${subHead(at.target)}${back}</div>` + table(heads(["Issue", "Title", "Hours"], ["Hours"]), rows);
}

/** Open the Inspector on a click of a Pipeline stage or an Agent Time line, and keep the tab a click opens. */
function wireInspect(root) {
  const el = root.querySelector(".page");
  wireTabs(el, (tab) => keep(INSPECT, { ...kept(INSPECT, {}), tab }));
  if (el._inspect) return;
  el._inspect = true;
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-inspect]");
    if (!b) return;
    keep(INSPECT, { tab: "inspector", kind: b.dataset.inspect, target: b.dataset.target });
    redrawHerald(root);
  });
}

/** The Herald panel: its tabs as the head, the alerts under them on every tab, then an Events tab with the rolling event history stream, an Active tab and an Inspector tab. `st` is the state it keeps between draws; `q` the page's query, the address's by default. */
export function renderHerald(s, st = page, q) {
  const cur = verdict(s, st.stale);
  // An error is not pinned: the newest event already says it.
  const asks = undecided(s.asks).map((i) => askCard(i, s.now));
  const errored = (s.errored ?? []).map(errorRow(s));
  const errors = cur.errors.length;
  const group = (id, n, html, wrap) => (n ? `<div class="grp" id="${id}">${wrap(html)}</div>` : "");

  const sticky = asks.length + errored.length > 0
    ? `<section id="needs" class="needs herald-sticky" aria-label="Alerts">` +
        group("awaiting", asks.length, asks.join(""), list) +
        group("jobs-error", errored.length, errored.join(""), list) +
      `</section>`
    : "";

  // The stream's rows stand in for the state's while they are newer.
  const word = kept(WORD);
  const live = st.live && st.live.seq > (s.herald?.seq ?? 0) ? st.live : s.herald;
  const rows = (live?.rows ?? []).filter((r) => !word || r.word === word).sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  const feed = rows.map((r) => heraldRow(r).replace(/^<\w+/, (t) => `${t} data-key="${esc(r.key)}" id="${rowId(r.key)}"`)).join("");

  // An errored job or an error outranks an Ask: the badge takes the worst alert's tone.
  const badgeHtml = asks.length + errored.length + errors > 0 ? tag("Not OK", tone(errored.length || errors ? "failed" : "waiting")) : tag("OK", tone("done"));

  const at = kept(INSPECT, { tab: "events" });
  const panes = { events: `${runNow(s)}<div class="herald-feed">${feed}</div>`, active: active(s), inspector: inspector(s.flow, at, q) };
  const chipHtml = word ? chip("", { cls: "ref-chip herald-word", html: `${esc(word)} <button type="button" class="ref-x" aria-label="Clear">×</button>` }) : "";
  return card("", tabs("Herald", [["events", "Events"], ["active", "Active"], ["inspector", "Inspector"]], panes, at.tab, { aside: `${chipHtml}${badgeHtml}`, top: sticky }), { id: "herald", cls: "herald-card", label: "Herald" });
}

/** The Herald's animated rows: the running jobs and the feed's top rows. */
const heraldRows = (h) => h.querySelectorAll(".run-now[data-job], .herald-feed > [data-key]");
const rowKey = (r) => (r.dataset.job ? `job ${r.dataset.job}` : r.dataset.key);

/**
 * Record the Herald's rows before a redraw; the function it returns animates them from there to where the redraw put them.
 * A new feed row grows and holds a tint. A new running row grows and its parts drop in. A running row that ends fades out
 * in place while the new feed rows fade in; a feed row that leaves fades out the same way. Every other row glides to its new place. Nothing moves under reduced motion.
 * The rows' running animations stop once every box is read, so a second redraw measures the row where it is and no old glide is left on it.
 */
function heraldMotion(root) {
  const h = root.querySelector("#herald");
  // A page with no matchMedia (the tests' DOM) has no layout to animate either.
  if (!h || !globalThis.matchMedia || matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  // A copy of each row, for a redraw by morph reuses a row's node for another row.
  const was = new Map([...heraldRows(h)].map((r) => [rowKey(r), { r: r.cloneNode(true), box: r.getBoundingClientRect() }]));
  // Only once every box is read: a stopped growth moves the rows below it. CSS animations, as the run dot's breath, do not start again once stopped, so they stay.
  for (const r of heraldRows(h)) for (const a of r.getAnimations({ subtree: true })) if (a.constructor === Animation) a.cancel();
  return () => {
    const now = root.querySelector("#herald");
    if (!now) return;
    const css = getComputedStyle(now), mid = parseFloat(css.getPropertyValue("--t-mid")), easing = css.getPropertyValue("--ease").trim();
    const rows = [...heraldRows(now)], keys = new Set(rows.map(rowKey));
    const gone = [...was].filter(([k]) => !keys.has(k)), ended = gone.filter(([k]) => k.startsWith("job "));
    // A growing row clips its content, which the shrunk height would cut off.
    const grow = (r) => r.animate([{ height: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px", overflow: "clip" }, { height: `${r.getBoundingClientRect().height}px`, opacity: 1, overflow: "clip" }], { duration: mid, easing });
    // The new rows start first, at height 0, so the glide below measures the rows from where the growth starts.
    for (const r of rows.filter((r) => !was.has(rowKey(r)))) {
      if (r.dataset.job) {
        grow(r);
        for (const c of r.children) c.animate([{ transform: "translateY(-8px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 260, delay: 60, easing, fill: "backwards" });
      } else if (ended.length) r.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 80, easing: "ease-out", fill: "backwards" });
      else {
        grow(r);
        r.animate([{ background: "var(--run-bg)" }, { background: "var(--run-bg)", offset: 0.35 }, { background: "var(--surface)" }], { duration: 1500, easing: "ease-out" });
      }
    }
    for (const r of rows) {
      const old = was.get(rowKey(r)), dy = old ? old.box.top - r.getBoundingClientRect().top : 0;
      if (Math.abs(dy) > 0.5) r.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: mid, easing });
    }
    // A ghost of each row that left fades where the row was; the card is its containing block.
    const base = now.getBoundingClientRect();
    for (const [, { r, box }] of gone) {
      const ghost = r.cloneNode(true);
      for (const a of ["data-job", "data-key", "id"]) ghost.removeAttribute(a);
      Object.assign(ghost.style, { position: "absolute", left: `${box.left - base.left - now.clientLeft}px`, top: `${box.top - base.top - now.clientTop}px`, width: `${box.width}px`, margin: "0", pointerEvents: "none" });
      now.append(ghost);
      ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: mid, easing: "ease-out" }).finished.then(() => ghost.remove());
    }
  };
}

function wireHeraldJump(root) {
  // On the head, which a redraw keeps and which `outOfDate` leaves in place; the sentence inside it is drawn again.
  const head = root.querySelector?.(".shead");
  if (!head || head._jump) return;
  head._jump = true;
  head.addEventListener?.("click", (e) => {
    if (!e.target.closest?.(".say") || e.target.closest?.("a")) return;
    const herald = root.querySelector?.("#herald");
    if (herald) {
      herald.scrollIntoView?.({ behavior: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth", block: "center" });
      herald.classList?.add("pulsing");
      setTimeout(() => herald.classList?.remove("pulsing"), 1200);
    }
  });
}

/** The page head: the time and the status sentence in the status tone, then the window control with Pause or Resume next to it. It has no title: the head is the factory's status at a glance. */
function renderStatusLine(s, stale = false, w = "day") {
  const bar = scope().bar({ value: w, after: renderControls(s) });
  return pageHead("", { head: "shead", after: `<span class="asof">${renderAsOf(s)}</span>${renderLede(s, stale)}`, aside: bar });
}

/** The status sentence of `verdict`, each part a link to its card but the plain ones. */
export function renderLede(s, stale = false) {
  const v = verdict(s, stale);
  const parts = v.parts.map((p) => (p.href ? `<a href="${p.href}">${esc(p.text)}</a>` : esc(p.text))).join("; ");
  return `<span class="say ${v.tone === "alert" ? "error" : v.tone === "ask" ? "warning" : v.tone}">${esc(v.head)}${parts}.</span>`;
}

const list = (html) => `<div class="list">${html}</div>`;

/** The one folded "Technical details" of an Issues row; `key` keeps it open across refreshes. */
const more = (key, body) => fold("Technical details", `<div class="body">${body}</div>`, { cls: "more", keep: `more:${key}` });

/** The details of a held or errored job: everything the row's one sentence leaves out. */
function details(s, j, extra = "") {
  const parts = extra + (j.question ? `<p class="quiet q">${esc(j.question)}</p>` : "") +
    facts([["Started", esc(when(j.started, new Date(s.now)))], ["Phase", esc(j.phase)], ["Cost", j.cost !== undefined && costHtml(j.cost, j.wk)], ["Model", j.model && esc(shortModel(j.model))], ...checkFacts(j)]) +
    (failed(j) ? `<p class="quiet q">Last check that failed: <b>${esc(failed(j).name)}</b>, ${esc(dur(failed(j).seconds))}</p>` : "") +
    (j.stat ? `<div class="ev one"><div><h4>Diff</h4><pre class="stat">${statLines(j.stat)}</pre></div></div>` : "") +
    trailerLine(j, s.now) +
    (j.defaults.length ? `<h4>Defaults taken</h4><ul>${j.defaults.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "") +
    (j.followups.length ? `<h4>Follow-ups</h4><ul>${j.followups.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "");
  return more(j.name, parts);
}

const failed = (j) => (j.checks || []).findLast((c) => !c.ok);

/** What a card's line says for a hold: the action word and the event's content, as `busy a1372 → issues.js` or `after a9`. */
const holdLine = (ev) => (ev ? [ev.action, contentText(ev)].filter(Boolean).join(" ") : "");


/** The agent line of a held or errored job: a live run exists for it. */
const agentLine = (j) => (j?.agent ? `<span class="agent">Agent working</span>` : "");
/** One Jobs card in the compact size: the id, the title, one sentence of why, the buttons; `jobDetails` is the one Technical details behind it. */
/** The one Technical details behind an errored row: the blocker, the whole reason, then the job's details. */
const jobDetails = (s, j) => details(s, j,
  (j.blocker ? `<p class="quiet q">Blocker ${idLink(j.blocker.id, j.blocker.href)}: ${esc(j.blocker.title)}</p>` : "") +
  (j.reason ? `<p class="quiet q">${esc(j.reason)}</p>` : ""));

/** An error card in the Ask card structure and the red tone: `meta` and the fold sit inside the box; `body` follows the fold. An empty `problem` leaves the situation line out. */
const alertCard = (key, meta, title, problem, body = "") =>
  askShell("error", `data-annotate="${esc(shortId(key))}" data-kind="error" data-card="unstick"`, key, meta, "Error", title, "", problem ? `<p class="situation">${esc(problem)}</p>` : "", body);
/** One plain sentence of what went wrong for an errored job, from its cause; a time box or a stall takes its length from `limit`, in seconds. */
const errorSentence = (j) => {
  const span = j.limit ? (j.limit % 60 === 0 ? [j.limit / 60, "minute"] : [j.limit, "second"]) : null;
  const check = j.checkName ? `The check ${j.checkName}` : "A check";
  return {
    timeout: `The worker ran past its ${span ? `${span[0]}-${span[1]} ` : ""}time box and was stopped.`,
    stalled: `The worker gave no output${span ? ` for ${span[0]} ${span[1]}s` : ""} and was stopped.`,
    check: `${check} failed.`,
    infra: j.checkName ? `${check} gave no verdict.` : "A factory step failed outside the work.",
    "no-commit": "The worker made no commit.",
    locked: "Another run held the job's lock.",
    credit: "The API account ran out of credit.",
    conflict: "The branch has a merge conflict with main.",
    moved: "Main moved during the land.",
    review: "The reviewer held the change.",
    unanswered: "The agent ended without an answer.",
  }[j.cause] ?? (j.state === "failed" ? "The run failed." : "The run stopped.");
};
const errorRow = (s) => (j) => {
  const b = j.blocker;
  const blocker = b && shortText(b.id);
  const hold = b ? holdLine({ action: "after", detail: b.id }) : errorSentence(j);
  const job = (verb) => `/api/jobs/${encodeURIComponent(j.id)}/${verb}`;
  const first = b ? actButton(`Wait for ${blocker}`, { act: "wait", name: j.name, path: job("wait"), body: JSON.stringify({ on: b.id }), label: `Wait for ${blocker}` }, { primary: true }) : actButton("Re-check", { act: "recheck", name: j.name, path: job("recheck"), label: "Re-check" });
  const meta = metaRow({ id: repoIdLink(j.name, jobHref(j.id), j.repo), chips: j.item?.priority ? priorityBadge(j.item.priority) : "", part: j.part, at: j.run?.started ?? j.started, since: j.started, now: s.now });
  const opt = (button, hint) => `<div class="choice">${button}<div class="choice-text"><span class="effect">${codeText(hint)}</span></div></div>`;
  return alertCard(j.name, meta, j.item?.title || j.name, hold,
    `<div class="actions choices">${opt(first, b ? `Makes the issue run after ${blocker} and drops the errored job; nothing starts until ${blocker} lands.` : "Runs the job's checks again; starts no worker.")}${opt(actButton("Drop", { act: "drop", name: j.name, path: job("drop"), confirm: "1", label: "Drop" }), "Discards the job's branch; the issue stays open.")}${actMsg(j.name)}</div>` +
    agentLine(j) + jobDetails(s, j));
};


/** "10/28 14:05": the time of the state. */
const renderAsOf = (s) => when(s.now);

/** The Pause or Resume button of the page head. */
export function renderControls(s) {
  return s.factory.paused ? ctl("resume", "Resume") : ctl("pause", "Pause");
}
const ctl = (verb, label) =>
  actButton(label, { act: verb, path: `/api/factory/${verb}`, ...(verb === "pause" ? { confirm: "1" } : {}), label }, { cls: "warn" });
