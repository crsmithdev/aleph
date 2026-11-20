// The Now view: the factory's front page. Each render function takes the
// /api/factory object and returns an HTML string. No DOM, so tests can call them.
// The page's click handler (router.js) runs the buttons `act` makes.
import { keep, kept, scope } from "./lib/address.js";
import { undecided } from "./lib/decisions.js";
import { cardPct, dur, count, hours, mean, plural, shortModel, when } from "./lib/format.js";
import { actButton, fold, recordState, restoreState, codeText, facts, tabs, wireTabs, tiles, badge, card, chip, sectionHead, meter, dataTable, costHtml, empty, error, esc, idLink, loadingLine, miss, pageHead, priorityBadge, repoIdLink, row, cell, heads, subHead, sortHead, sortRows, nextSort, tag, tone } from "./lib/html.js";
import { shortText, NAMES, runWord, shortId, jobHref, contentText, shownId, issueHref } from "../../lib/naming.ts";
import { panelOf } from "./lib/chart.js";
import { feedRow, heraldRow } from "./lib/feed.js";
import { share, flowOf, statusCards, usable } from "./lib/flow-parts.js";
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
  refresh: 60,
  live: true,
  // `s.flow` is /api/flow for the window with its baseline and `s.memory` the Memory page's data, which `more` adds; the page draws without them first.
  render: (s, _params, q) => { page.state = s; const w = scope(q).window, f = s.flow ?? null; return `<div class="page sp">${renderStatusLine(s, page.stale, w)}${tiles("Scorecard", renderTiles(s, f, w), "scorecard")}<div class="rail"><div class="rail-main">${renderOutcome(f)}${renderPipeline(f, q)}${renderActive(f)}${renderMemory(s.memory ?? null)}</div>${renderHerald(s, page, q)}</div></div>`; },
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
    if (usable(s.flow)) root.querySelector('aleph-chart[key="status/active"]').frame = activeFrame(s.flow);
  },
  // The stream sends the Herald's rows when an event is added; the page draws them at once, until a state with a newer or equal `seq` replaces them.
  event: (root, live) => {
    page.live = live;
    redrawHerald(root);
  },
  swap: (root) => heraldMotion(root),
};

/** What the page keeps between draws: the last rendered state, the shell's out-of-date verdict, the last rows the stream sent (`{ seq, rows }`), and the text and time of the first render of the page load, which no status row repeats or precedes. `renderHerald` takes it as a parameter. */
const page = { state: null, stale: false, live: null, loaded: null };

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

/** The scorecard: lost time, completion, landed, queue wait, usage. `d` is /api/flow for the window `win` with its baseline, or null while it loads. */
export function renderTiles(s, d, win = d?.window ?? "week") {
  return statusCards(s, d, { performance: withWindow(PERFORMANCE, win) });
}

/** The Agent Time card: the kept share, its bar and its legend, with the kept hours of all in the aside. `d` is null while it loads, `{ error }` on a failed load. */
function renderOutcome(d) {
  const outcome = (body, aside = "") => card("Agent Time", body, { id: "outcome", label: "Agent time", aside });
  if (!d) return outcome(loadingLine("the outcomes"));
  if (d.error) return outcome(error(d.error));
  const { kept, hours: lostH } = d.figures;
  return outcome(share(d), lostH === null ? "" : `${esc(hours(kept))} of ${esc(hours(kept + lostH))}`);
}

/** The active-issues frame: per bucket, the issues in each stage (`d.active` of /api/flow), stacked. */
export const activeFrame = (d) => ({
  measure: { name: "Active Issues", unit: "count", agg: "max" },
  over: { kind: "time", window: d.window },
  by: { name: "Stage", keys: [{ key: "intake", name: NAMES.intake, color: "chart-6" }, { key: "queue", name: "Queued", color: "series-4" }, { key: "running", name: "Running", color: "run" }, { key: "landed", name: "Landed", color: "done" }] },
  rows: d.active ?? [],
  form: "area",
});

/** The Active Issues chart above the Pipeline card. `d` is /api/flow for the window, null while it loads, or `{ error }`. */
function renderActive(d) {
  if (!d) return card("Active Issues", loadingLine("the active issues"), { id: "active-issues" });
  if (d.error) return card("Active Issues", error(d.error), { id: "active-issues" });
  return panelOf("status/active", activeFrame(d), "active-issues");
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
/** The health of a stage by its failed share: under 10% fine, to 25% warning, above that alert. */
const health = (share) => (share < 0.1 ? "fine" : share <= 0.25 ? "warning" : "alert");
/** The Pipeline card for the window: each stage a ring with its runs per issue, coloured by its failed share, and its p90 time under it. `d` is /api/flow for the window, null while it loads, or `{ error }`. */
/** The Jobs filter of each stage: its stage tile there and the role of its runs. Review and Recheck have no stage tile, so they filter by role alone; a recheck is a worker run. */
const DRILL = { intake: { stage: "intake", role: "intake" }, queue: { stage: "queue" }, build: { stage: "implement", role: "worker" }, review: { role: "reviewer" }, recheck: { role: "worker" }, land: { stage: "land" } };
/** The Jobs page for a stage, in the window and project of `q`. */
const drillHref = (k, q, extra = {}) => {
  const s = scope(q), out = new URLSearchParams({ ...DRILL[k], ...extra });
  if (s.window !== "week") out.set("window", s.window);
  if (s.project) out.set("project", s.project);
  return `#/factory/jobs?${out}`;
};

export function renderPipeline(d, q = new URLSearchParams()) {
  const box = (body, aside = "") => card("Pipeline", body, { id: "pipeline", aside });
  if (!d) return box(loadingLine("the pipeline"));
  if (d.error) return box(error(d.error));
  const by = new Map((d.stages?.rows ?? []).map((r) => [r.stage, r]));
  const queue = d.phases?.queue;
  const go = (k, tip, body) => `<button type="button" class="pgo" data-inspect="stage" data-target="${esc(k)}" title="${esc(tip)}">${body}</button>`;
  const node = ([k, name]) => {
    if (k === "queue") {
      const has = queue?.count > 0;
      if (!has) return `<div class="pnode wait idle"><span class="ring">wait</span><span class="pn">${esc(name)}</span><span class="pt">${miss("Nothing waited in this window")}</span></div>`;
      return `<div class="pnode wait">${go(k, `Queue: ${plural(queue.count, "wait")}`, `<span class="ring">wait</span><span class="pn">${esc(name)}</span><span class="pt">${esc(dur(queue.p90))}</span>`)}</div>`;
    }
    const r = by.get(k), n = r?.items ? r.runs / r.items : null;
    if (n === null) return `<div class="pnode idle"><span class="ring">–</span><span class="pn">${esc(name)}</span><span class="pt">${miss("Nothing ran in this window")}</span></div>`;
    const share = r.runs ? (r.unusable ?? 0) / r.runs : 0, tone = health(share);
    const tip = `${name}: ${plural(r.runs, "run")} on ${plural(r.items, "issue")}${r.unusable ? `, ${count(r.unusable)} failed` : ""}`;
    return `<div class="pnode ${tone}">${go(k, tip, `<span class="ring">${mean(n)}</span><span class="pn">${esc(name)}</span><span class="pt">${esc(dur(r.p90))}</span>`)}${r.unusable ? `<a class="pf" href="${esc(drillHref(k, q, { unusable: "1" }))}">${cardPct(share)} failed</a>` : `<span class="pf">${cardPct(share)} failed</span>`}</div>`;
  };
  const nodes = Object.entries(PIPE).map(node).join(`<span class="parrow" aria-hidden="true"></span>`);
  return box(`<div class="pflow" role="group" aria-label="Stages">${nodes}</div>`, `<span class="asof">runs / issue in the ring · p90 time under it</span>`);
}

/** A Herald row's element id from its key, so a redraw by morph keeps the row's node and does not reuse it for another row. */
const rowId = (key) => esc(`h-${key.replace(/\s+/g, "-")}`);

/** A short hash of a text, to key a row by its text. */
const hash = (t) => [...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0).toString(36);

/** The key of the Herald's word filter in keep(): the chip word whose event rows the feed shows, or null for every row. */
const WORD = "herald.word";

/** A status text without the "health: " of each health line, which older history entries carry. */
const statusText = (t) => t.replace(/(^|: |; )health: /gi, "$1");

/** The running jobs as rows of the feed's grid under the alerts: the start time, the action word, the ID, the title, a build's size with the breathing dot. Each is keyed by `data-job` so a job that ends leaves the section. A job leaves the state when it ends, so the rows are the state's. */
function runNow(s) {
  const row = (id, who, word, title, t, model, size = "") => feedRow({ tone: "run", at: t, cls: " run-now", attrs: ` data-job="${esc(id)}" id="${rowId(`job ${id}`)}"`,
    body: `<span class="event-line">${tag(word, "run")}${who}<span class="event-title run-title" title="${esc(title)}">${esc(title)}</span>` +
      `<span class="run-size"${model ? ` title="${esc(model)}"` : ""}><span class="run-dot"></span>${esc(size)}</span></span>` });
  const rows = s.runningIssues.map((i) => row(i.id, repoIdLink(i.id, i.href), i.stage, i.title, i.at ?? i.since)).concat(s.running.map((j) => {
    const run = j.run ?? { kind: "build", started: j.started };
    const size = run.kind === "build" ? j.size : "";
    return row(j.id ?? j.name, j.id ? idLink(shownId(j.id), jobHref(j.id)) : itemId(j), runWord(run.kind), j.item?.title || j.name, run.started ?? j.started, j.model, size);
  }));
  return rows.length ? `<section class="herald-running" aria-label="Running">${rows.join("")}</section>` : "";
}

/** The key of the Herald's open tab and Inspector target in keep(): `{ tab, kind, target }`, `kind` "stage" or "class". */
const INSPECT = "herald.inspect";

/** The Inspector pane: the issues of the kept stage or class in `d`, /api/flow for the window; `at` is the kept target. */
function inspector(d, at, q) {
  if (!at.target) return empty();
  if (!d) return loadingLine("the issues");
  if (d.error) return error(d.error);
  const id = (x) => `<td>${x.href ? repoIdLink(x.issue, x.href) : esc(x.issue)}</td>`;
  const table = (head, rows) => (rows.length ? dataTable(head, rows.join("")) : empty());
  if (at.kind === "stage") {
    const rows = d.stages.issues[at.target].map((x) => row([id(x), cell(x.title ?? "", { wide: true }), cell(count(x.runs), { num: true }), cell(dur(x.secs), { num: true }), `<td>${x.failed ? tag("failed", tone("failed")) : ""}</td>`]));
    return `<div class="inspect-head">${subHead(PIPE[at.target])}<a href="${esc(drillHref(at.target, q))}">All jobs</a></div>` + table(heads(["Issue", "Title", "Runs", "Time", ""], ["Runs", "Time"]), rows);
  }
  const rows = d.classes.find((c) => c.key === at.target).top.map((x) => row([id(x), cell(x.title ?? "", { wide: true }), cell(hours(x.hours), { num: true })]));
  return `<div class="inspect-head">${subHead(at.target)}</div>` + table(heads(["Issue", "Title", "Hours"], ["Hours"]), rows);
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

/** The Herald panel: an Events tab with sticky alerts on top and the rolling event history stream below, and an Inspector tab. `st` is the state it keeps between draws; `q` the page's query, the address's by default. */
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

  // The server's history; the page's own verdict on top when it differs, as for a project's scope or an out-of-date state.
  const history = [...(s.herald?.history ?? [])];
  if (history[0]?.text !== cur.text || history[0]?.tone !== cur.tone) history.unshift({ at: s.now, tone: cur.tone, label: cur.label, text: cur.text });

  // A status row is an event row with the new status text only, drawn where the text changes after the page loaded; the page's first render has none.
  st.loaded ??= { at: s.now, text: history[0].text };
  const after = [...history.filter((ev) => ev.at >= st.loaded.at), st.loaded];
  const status = after.slice(0, -1).filter((ev, i) => statusText(ev.text) !== statusText(after[i + 1].text))
    .map((ev) => ({ at: ev.at, key: `status ${hash(`${ev.tone} ${ev.text}`)}`, html: feedRow({ tone: esc(ev.tone), at: ev.at, body: `<span class="event-say">${esc(statusText(ev.text))}</span>` }) }));
  // The status changes and the events in one feed, newest first.
  // A status row's key is its tone and text, numbered from the oldest, so a new status on top does not rename the rows below it.
  const seen = new Map();
  for (const r of [...status].reverse()) { const n = (seen.get(r.key) ?? 0) + 1; seen.set(r.key, n); r.key += ` ${n}`; }
  // The stream's rows stand in for the state's while they are newer.
  const word = kept(WORD);
  const live = st.live && st.live.seq > (s.herald?.seq ?? 0) ? st.live : s.herald;
  const events = (live?.rows ?? []).filter((r) => !word || r.word === word).map((r) => ({ at: r.at, key: r.key, html: heraldRow(r) }));
  const rows = [...status, ...events].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  const feed = rows.map((r) => r.html.replace(/^<\w+/, (t) => `${t} data-key="${esc(r.key)}" id="${rowId(r.key)}"`)).join("");

  // An errored job or an error outranks an Ask: the badge takes the worst alert's tone.
  const badgeHtml = asks.length + errored.length + errors > 0 ? tag("Not OK", tone(errored.length || errors ? "failed" : "waiting")) : tag("OK", tone("done"));

  const at = kept(INSPECT, { tab: "events" });
  const panes = { events: `${sticky}${runNow(s)}<div class="herald-feed">${feed}</div>`, inspector: inspector(s.flow, at, q) };
  const chipHtml = word ? chip("", { cls: "ref-chip herald-word", html: `${esc(word)} <button type="button" class="ref-x" aria-label="Clear">×</button>` }) : "";
  return card("Herald", tabs("Herald", [["events", "Events"], ["inspector", "Inspector"]], panes, at.tab), { id: "herald", cls: "herald-card", aside: `${chipHtml}${badgeHtml}` });
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
