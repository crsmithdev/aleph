// The Now view: the factory's front page. Each render function takes the
// /api/factory object and returns an HTML string. No DOM, so tests can call them.
// The page's click handler (router.js) runs the buttons `act` makes.
import { actButton, fold, keep, kept, recordState, restoreState, clock, codeText, facts, tiles, badge, card, sectionHead, meter, dataTable, dur, costHtml, count, empty, error, esc, hours, idLink, mean, money, loadingLine, miss, pageHead, pct, plural, priorityBadge, repoIdLink, shortModel, sortHead, sortRows, nextSort, tag, tone, undecided, when, scope } from "../lib.js";
import { shortText, NAMES, shortId, jobHref, contentText, shownId, issueHref, targetOf, whoOf } from "../../lib/naming.ts";
import { panelOf } from "../chart.js";
import { detail, eventRow, feedRow, isIssue, isRouting, jobOf, parts, routeText, stateWord } from "../feed.js";
import { share, flowOf, statusCards, usable } from "../flow-parts.js";
import { actMsg, askCard, askShell, checkFacts, itemId, metaRow, statLines, trailerLine } from "../ask-cards.js";
import { verdict } from "../../lib/status-words.ts";

export const view = {
  path: "/",
  title: "Status",
  group: "factory",
  order: -3,
  icon: "gauge-high",
  api: (_params, q = new URLSearchParams()) => { const s = scope(q); return s.url(`/api/factory?window=${s.window}`); },
  refresh: 60,
  live: true,
  // `s.flow` is /api/flow for the window with its baseline, which `more` adds; the page draws without it first.
  render: (s, _params, q) => { lastState = s; const w = scope(q).window, f = s.flow ?? null; return `<div class="page sp">${renderStatusLine(s, page.stale, w)}${tiles("Scorecard", renderTiles(s, f, w), "scorecard")}<div class="rail"><div class="rail-main">${renderOutcome(f)}${renderPipeline(f, q)}${renderActive(f)}</div>${renderHerald(s)}</div></div>`; },
  more: async (s, q) => ({ ...s, flow: await flowOf(scope(q).window, q, true) }),
  // The shell calls this when the out-of-date verdict changes: the sentence is drawn again from the last state.
  outOfDate: (root, b) => { page.stale = b; const el = root.querySelector(".shead .say"); if (el && lastState) el.outerHTML = renderLede(lastState, b); },
  mount: (root, s, q) => {
    scope(q).wire(root); wireHeraldJump(root);
    root.onchange = (e) => {
      if (!e.target.matches?.('#herald input[name="show"]')) return;
      keep(SHOW, { ...kept(SHOW, ALL), [e.target.value]: e.target.checked });
      redrawHerald(root);
    };
    if (usable(s.flow)) root.querySelector('aleph-chart[key="status/active"]').frame = activeFrame(s.flow);
  },
  // An event from the stream goes into the Herald at once; the reload that follows draws it from the state.
  event: (root, ev) => {
    page.streamed.push(ev);
    if (page.streamed.length > HERALD_KEEP) page.streamed.shift();
    redrawHerald(root);
  },
  swap: (root) => heraldMotion(root),
};

let lastState = null;
/** What the Herald keeps between draws: the shell's out-of-date verdict, the events the stream sent since the page loaded (oldest first), and the text and time of the first render of the page load, which no status row repeats or precedes. `renderHerald` takes it as a parameter. */
const page = { stale: false, streamed: [], loaded: null };

/** The Herald drawn again from the last state, with its folds and motion kept. */
function redrawHerald(root) {
  const h = root.querySelector("#herald");
  if (!h || !lastState) return;
  const saved = recordState(h), moved = heraldMotion(root);
  h.outerHTML = renderHerald(lastState);
  restoreState(root.querySelector("#herald"), saved);
  moved();
}

const EFFICIENCY = "#/flow", PERFORMANCE = "#/factory/jobs";
/** A link to another page that keeps the window; week is the default and stays out of the address. */
const withWindow = (href, win) => (win === "week" ? href : `${href}?window=${win}`);

/** The scorecard: lost time, completion, landed, queue wait, usage. `d` is /api/flow for the window `win` with its baseline, or null while it loads. */
export function renderTiles(s, d, win = d?.window ?? "week") {
  return statusCards(s, d, { efficiency: withWindow(EFFICIENCY, win), performance: withWindow(PERFORMANCE, win) });
}

/** The Agent Time card: the kept share, its bar and its legend, with the kept hours of all in the aside. `d` is null while it loads, `{ error }` on a failed load. */
function renderOutcome(d) {
  const outcome = (body, aside = "") => card("Agent Time", body, { id: "outcome", label: "Agent time", aside });
  if (!d) return outcome(loadingLine("the outcomes"));
  if (d.error) return outcome(error(d.error));
  const cs = d.classes, sum = (xs) => xs.reduce((a, c) => a + c.hours, 0), total = sum(cs);
  return outcome(share(d), total > 0 ? `${esc(hours(sum(cs.filter((c) => !c.lost))))} of ${esc(hours(total))}` : "");
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
export function renderActive(d) {
  if (!d) return card("Active Issues", loadingLine("the active issues"), { id: "active-issues" });
  if (d.error) return card("Active Issues", error(d.error), { id: "active-issues" });
  return panelOf("status/active", activeFrame(d), "active-issues");
}

/** The pipeline stages in order, with their names; the monitor's other roles (facts, director, monitor…) are not stages of an issue. Queue is the wait before the first build, not a run. */
const PIPE = Object.fromEntries(["intake", "queue", "build", "review", "recheck", "land"].map((k) => [k, NAMES[k]]));
/** The health of a stage by its failed share: under 10% fine, to 25% warning, above that alert. */
const health = (share) => (share < 0.1 ? "fine" : share <= 0.25 ? "warning" : "alert");
/** The Pipeline card for the window: each stage a ring with its runs per issue, coloured by its failed share, and its p90 time under it. `d` is /api/flow for the window, null while it loads, or `{ error }`. */
/** The Jobs filter of each stage: its stage tile there and the role of its runs. Review and Recheck have no stage tile, so they filter by role alone; a recheck is a worker run. */
const DRILL = { intake: { stage: "intake", role: "intake" }, queue: { stage: "queue" }, build: { stage: "implement", role: "worker" }, review: { role: "reviewer" }, recheck: { role: "worker" }, land: { stage: "land" } };
/** The Jobs page for a stage, in the window and project of `q`. */
export const drillHref = (k, q, extra = {}) => {
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
  const go = (k, tip, body) => `<a class="pgo" href="${esc(drillHref(k, q))}" title="${esc(tip)}">${body}</a>`;
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
    return `<div class="pnode ${tone}">${go(k, tip, `<span class="ring">${mean(n)}</span><span class="pn">${esc(name)}</span><span class="pt">${esc(dur(r.p90))}</span>`)}${r.unusable ? `<a class="pf" href="${esc(drillHref(k, q, { unusable: "1" }))}">${pct(share * 100)} failed</a>` : `<span class="pf">${pct(share * 100)} failed</span>`}</div>`;
  };
  const nodes = Object.entries(PIPE).map(node).join(`<span class="parrow" aria-hidden="true"></span>`);
  return box(`<div class="pflow" role="group" aria-label="Stages">${nodes}</div>`, `<span class="asof">runs / issue in the ring · p90 time under it</span>`);
}

/** A Herald row's element id from its key, so a redraw by morph keeps the row's node and does not reuse it for another row. */
const rowId = (key) => esc(`h-${key.replace(/\s+/g, "-")}`);

/** A short hash of a text, to key a row by its text. */
const hash = (t) => [...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0).toString(36);

/** An event row as the rows below read it: its time in `at`, its subject in `by`, the issue or routine it is about in `subject`, its job in `on`, its detail in `note`, and the run facts of its job; `row` is the row itself. */
const shaped = (r) => ({ row: r, at: r.time, by: r.subject, subject: targetOf(r), on: [r.object], note: r.detail, size: r.size ?? undefined, model: r.model ?? undefined, cost: r.cost ?? undefined, commit: r.commit_sha ?? undefined, action: r.action, project: r.project ?? undefined });

/** An event's identity: the same event from the stream and from the state has the same key. */
const eventKey = (e) => `${e.at} ${e.by} ${e.subject} ${e.action} ${(e.on ?? []).join(",")}`;

/** The key of the Herald's Work and Factory toggles in keep(): whether each shows its events. */
const SHOW = "herald.show", ALL = { work: true, factory: true };

const HERALD_KEEP = 50;

/** The events of the state and of the stream, each once, newest first. */
export function heraldEvents(s, more = page.streamed) {
  const all = new Map([...(s.herald?.events ?? []), ...more].map(shaped).map((e) => [eventKey(e), e]));
  return [...all.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, HERALD_KEEP);
}

/** The holds: an issue's state while it waits, not an event, so the feed leaves them out. The ones that need Chris are alerts. */
const WAITS = new Set(["held", "waiting", "paused", "red", "after", "full", "gpu", "busy", "parent", "credit"]);
/** The word for a run kind in a row's line: a build run implements the issue. */
const role = (kind) => (kind === "build" ? "implement" : kind);
/** The mark of a run's result in an older row. */
const MARK = { passed: "✓", landed: "✓", done: "✓", failed: "✗", returned: "✗", dropped: "✗" };
/** The newest event of `all` (newest first) at or before `at` that `ok` takes. */
const lastBefore = (all, at, ok) => all.find((e) => e.at <= at && ok(e));

/** A job's facts after its mark: for a build, the size it was routed to and the model it ran on, both from its start's event, then a land's commit, its time and its cost. */
function jobFacts(ev, job, run, all) {
  // The job's first start: the gate logs it again as the run moves on after its result.
  const start = all.findLast((e) => e.action === "running" && jobOf(e) === job && e.at <= ev.at);
  const picked = start && run === "build" ? lastBefore(all, start.at, (e) => e.action === "started" && /^model /.test(e.note ?? "")) : undefined;
  const model = picked?.note.slice(6);
  const took = start && ev !== start ? dur((Date.parse(ev.at) - Date.parse(start.at)) / 1000) : "";
  return [picked?.size, model, ev.commit && String(ev.commit).slice(0, 7), took, ev.cost !== undefined && money(ev.cost)].filter(Boolean).map(esc).join(" · ");
}

/** An older event as a label and a short text: a run's kind, then its linked job ID, its mark and its facts; or the chip word and what the sentence adds. `all` is the group's events, newest first. */
function brief(ev, runs = {}, all = [ev]) {
  const job = jobOf(ev), run = runs[job];
  const cut = (s) => esc(s ?? "");
  if (ev.action === "routed") return { ev, label: "routed", text: cut(routeText(ev)) };
  if (ev.action === "stalled") return { ev, label: "", text: `stalled ${esc(shownId(ev.subject, ev.project))}${run ? ` · ${esc(role(run))}` : ""}` };
  const { lead, rest } = parts(ev), more = detail(ev) && ` ${detail(ev)}`;
  if (run) {
    const fx = jobFacts(ev, job, run, all);
    return { ev, label: role(run), text: `${idLink(shownId(job), jobHref(job))} ${MARK[ev.action] ? `<span class="brief-mark">${MARK[ev.action]}</span>` : cut(ev.action)}${rest ? ` ${rest}` : ""}${fx ? ` ${fx}` : ""}${more}` };
  }
  // The group already names its issue, so a row whose sentence adds only the actor says who did it.
  const by = ev.by && whoOf(ev.by, ev.row.subject_role);
  const said = isIssue(ev.subject) && by && (!rest || rest === esc(by)) ? `by ${esc(by)}` : rest || lead;
  return { ev, label: stateWord(ev), text: said + more };
}

/** The rows of a group's fold, newest first: its events but a head with no run and no detail, which its row says; no start of a job with another event, nor of a run kind with a newer one, and no routing or start of an issue that a later job start draws as that job's facts. */
function briefs(all, runs = {}) {
  const drawn = (ev) => (ev.action === "routed" || ev.action === "started") && all.some((e) => e.action === "running" && jobOf(e) && e.at >= ev.at);
  // The gate can log a job's start after its result, so any other event of the job hides the start.
  const ended = new Set(all.filter((ev) => ev.action !== "running").map(jobOf));
  const seen = new Set(), out = [];
  for (const ev of all) {
    const job = jobOf(ev), run = runs[job];
    if (ev === all[0] && !isRouting(ev) && !run && (!ev.note || ev.action === "routed")) continue;
    if (ev.action === "running" && (ended.has(job) || (run && seen.has(run)))) continue;
    if (drawn(ev)) continue;
    seen.add(run);
    out.push(brief(ev, runs, all));
  }
  return out;
}

/** An older row: the time, the label and the text, in the event's tone. */
const briefRow = ({ ev, label, text }) => `<div class="event-brief ${tone(ev.action)}"><span class="event-time">${esc(clock(ev.at) || when(ev.at))}</span>` +
  `<span class="brief-label" title="${esc(label)}">${esc(label)}</span><span class="brief-text" title="${text.replace(/<[^>]*>/g, "")}">${text}</span></div>`;

/** Rows of `groups`, each `[id, events]` newest first: the newest event's row, but a stall, with the events briefly behind it, the head's run among them; `row(head, more)` draws the head. The fold is named by `id`, so it keeps its state when its text or place changes. */
const grouped = (groups, row, runs) => groups.map(([id, events]) => {
  const head = events.find((e) => e.action !== "stalled") ?? events[0];
  const inner = briefs([head, ...events.filter((e) => e !== head)], runs).map(briefRow);
  return { at: head.at, key: id, html: inner.length ? fold(row(head, inner.length), `<div class="herald-older">${inner.join("")}</div>`, { cls: "herald-group", id }) : row(head, 0) };
});

/** The past word of each verb a housekeeper change's detail starts with (`retitle: New title`). */
const VERBS = { close: "closed", drop: "dropped", retitle: "retitled", reprioritize: "reprioritized", note: "commented", unpark: "unparked" };

/** A routine run that ended and changed nothing has no row; one still running, or one that failed, has. */
const FAILED = ["failed", "returned", "dropped"];

/**
 * The rows of the issue and routine events. An issue's row is one per attempt (`attempts`: the first job of a job's `prev` chain), its older events in the fold;
 * an event with no job takes the attempt of the one before it, else of the first. A routine's run is one row that says "N changes", each change a line in its fold.
 */
function eventRows(events, titles = {}, runs = {}, attempts = {}, reviewed = {}) {
  const issues = new Map(), routine = new Map(), first = new Map(), add = (m, k, ev) => m.set(k, [ev, ...(m.get(k) ?? [])]);
  const live = [...events].reverse().filter((ev) => !WAITS.has(ev.action)), attemptOf = (ev) => attempts[jobOf(ev)] ?? "";
  for (const ev of live) if (isIssue(ev.subject) && attemptOf(ev) && !first.has(ev.subject)) first.set(ev.subject, attemptOf(ev));
  const runIds = new Set(live.filter((ev) => !isIssue(ev.subject) && jobOf(ev)).map(jobOf)), now = new Map(first);
  for (const ev of live) {
    if (ev.action === "changed" && runIds.has(ev.by)) add(routine, ev.by, ev);
    else if (isIssue(ev.subject)) { now.set(ev.subject, attemptOf(ev) || now.get(ev.subject) || ""); add(issues, `${ev.subject}${now.get(ev.subject) && `:${now.get(ev.subject)}`}`, ev); }
    else if (jobOf(ev)) add(routine, jobOf(ev), ev);
    else add(issues, ev.subject, ev);
  }
  const runRows = [...routine].flatMap(([job, evs]) => {
    const head = evs.find((e) => e.action !== "changed") ?? evs[0], changes = evs.filter((e) => e.action === "changed");
    if (!changes.length && !FAILED.includes(head.action) && !evs.every((e) => e.action === "running")) return [];
    const verb = (c) => { const m = /^(\w+): ([\s\S]*)$/.exec(c.note ?? ""); return m && Object.hasOwn(VERBS, m[1]) ? m : null; };
    const lines = [...changes].reverse().map((c) => { const m = verb(c), note = m ? m[2] : c.note;
      return briefRow({ ev: c, label: m ? VERBS[m[1]] : stateWord(c), text: `${idLink(shownId(c.subject, c.project), issueHref(c.subject, c.project))}${note ? ` ${esc(note)}` : ""}` }); });
    const count = (v) => changes.filter((c) => verb(c)?.[1] === v).length;
    const said = !changes.length ? "" : [reviewed[job] !== undefined && `reviewed ${reviewed[job]}`, ...changes.every(verb) ? Object.keys(VERBS).filter(count).map((v) => `${VERBS[v]} ${count(v)}`) : [plural(changes.length, "change")]].filter(Boolean).join(" · ");
    const row = eventRow(head, titles, changes.length, said);
    return [{ at: head.at, key: `event ${hash(eventKey(head))}`, html: lines.length ? fold(row, `<div class="herald-older">${lines.join("")}</div>`, { cls: "herald-group", id: `issue:${head.subject}:${job}` }) : row }];
  });
  return [...grouped([...issues].map(([k, v]) => [`issue:${k}`, v]), (ev, more) => eventRow(ev, titles, more), runs), ...runRows];
}

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
    return row(j.id ?? j.name, j.id ? idLink(shownId(j.id), jobHref(j.id)) : itemId(j), role(run.kind), j.item?.title || j.name, run.started ?? j.started, j.model, size);
  }));
  return rows.length ? `<section class="herald-running" aria-label="Running">${rows.join("")}</section>` : "";
}

/** The Herald panel: sticky alerts on top, rolling event history stream below. `st` is the state it keeps between draws. */
export function renderHerald(s, st = page) {
  const cur = verdict(s, st.stale);
  // An error is not pinned: the newest event already says it.
  const asks = undecided(s.asks).map((i) => askCard(i, s.now));
  const stuck = (s.stuck ?? []).map(stuckRow(s));
  const errors = cur.errors.length;
  const group = (id, n, html, wrap) => (n ? `<div class="grp" id="${id}">${wrap(html)}</div>` : "");

  const sticky = asks.length + stuck.length > 0
    ? `<section id="needs" class="needs herald-sticky" aria-label="Alerts">` +
        group("awaiting", asks.length, asks.join(""), list) +
        group("jobs-stuck", stuck.length, stuck.join(""), list) +
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
  // The Work and Factory toggles: an event whose target is an issue is Work, any other is Factory.
  const show = kept(SHOW, ALL);
  const events = heraldEvents(s, st.streamed).filter((e) => show[isIssue(e.subject) ? "work" : "factory"]);
  // A chat conversation is one row, read from its session: its last turn's time, its latest prompt.
  const chats = (s.herald?.chats ?? []).map((c) => ({ at: c.last, key: `chat ${c.id}`, html: feedRow({ tone: "quiet", at: c.last, by: "claude",
    body: `<span class="event-line">${tag("chat", "quiet")}${idLink(c.id.slice(0, 8))}<span class="event-title" title="${esc(c.title)}">${esc(c.title)}</span><span></span></span>` }) }));
  const rows = [...status, ...chats, ...eventRows(events, s.herald?.titles, s.herald?.runs, s.herald?.attempts, s.herald?.reviewed)].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  const feed = rows.map((r) => r.html.replace(/^<\w+/, (t) => `${t} data-key="${esc(r.key)}" id="${rowId(r.key)}"`)).join("");

  // A stuck job or an error outranks an Ask: the badge takes the worst alert's tone.
  const badgeHtml = asks.length + stuck.length + errors > 0 ? tag("Not OK", tone(stuck.length || errors ? "failed" : "waiting")) : tag("OK", tone("done"));

  return card("Herald", `${sticky}${runNow(s)}<div class="herald-show">${["work", "factory"].map((k) => `<label><input type="checkbox" name="show" value="${k}"${show[k] ? " checked" : ""}> ${k === "work" ? "Work" : "Factory"}</label>`).join("")}</div><div class="herald-feed">${feed}</div>`, { id: "herald", cls: "herald-card", aside: badgeHtml });
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

/** The details of a held or stuck job: everything the row's one sentence leaves out. */
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


/** The agent line of a held or stuck job: a live run exists for it. */
const agentLine = (j) => (j?.agent ? `<span class="agent">Agent working</span>` : "");
/** One Jobs card in the compact size: the id, the title, one sentence of why, the buttons; `jobDetails` is the one Technical details behind it. */
/** The one Technical details behind a stuck row: the blocker, the whole reason, then the job's details. */
const jobDetails = (s, j) => details(s, j,
  (j.blocker ? `<p class="quiet q">Blocker ${idLink(j.blocker.id, j.blocker.href)}: ${esc(j.blocker.title)}</p>` : "") +
  (j.reason ? `<p class="quiet q">${esc(j.reason)}</p>` : ""));

/** A stuck, failed or error card in the Ask card structure and the red tone: `meta` and the fold sit inside the box; `body` follows the fold. An empty `problem` leaves the situation line out. */
const alertCard = (kind, key, meta, title, problem, body = "") =>
  askShell(kind, `data-annotate="${esc(shortId(key))}" data-kind="${kind}" data-card="unstick"`, key, meta, kind === "error" ? "Error" : "Stuck", title, "", problem ? `<p class="situation">${esc(problem)}</p>` : "", body);
/** One plain sentence of what went wrong for a stuck job, from its cause; a time box or a stall takes its length from the reason. */
const stuckSentence = (j) => {
  const span = /(\d+)[- ](minute|second)/.exec(j.reason ?? "");
  const check = j.checkName ? `The check ${j.checkName}` : "A check";
  return {
    timeout: `The worker ran past its ${span ? `${span[1]}-${span[2]} ` : ""}time box and was stopped.`,
    stalled: `The worker gave no output${span ? ` for ${span[1]} ${span[2]}s` : ""} and was stopped.`,
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
const stuckRow = (s) => (j) => {
  const b = j.blocker;
  const blocker = b && shortText(b.id);
  const hold = b ? holdLine({ action: "after", detail: b.id }) : stuckSentence(j);
  const job = (verb) => `/api/jobs/${encodeURIComponent(j.id)}/${verb}`;
  const first = b ? actButton(`Wait for ${blocker}`, { act: "wait", name: j.name, path: job("wait"), body: JSON.stringify({ on: b.id }), label: `Wait for ${blocker}` }, { primary: true }) : actButton("Re-check", { act: "recheck", name: j.name, path: job("recheck"), label: "Re-check" });
  const meta = metaRow({ id: repoIdLink(j.name, jobHref(j.id), j.repo), chips: j.item?.priority ? priorityBadge(j.item.priority) : "", part: j.part, at: j.run?.started ?? j.started, since: j.started, now: s.now });
  const opt = (button, hint) => `<div class="choice">${button}<div class="choice-text"><span class="effect">${codeText(hint)}</span></div></div>`;
  return alertCard("stuck", j.name, meta, j.item?.title || j.name, hold,
    `<div class="actions choices">${opt(first, b ? `Makes the issue run after ${blocker} and drops the stuck job; nothing starts until ${blocker} lands.` : "Runs the job's checks again; starts no worker.")}${opt(actButton("Drop", { act: "drop", name: j.name, path: job("drop"), confirm: "1", label: "Drop" }), "Discards the job's branch; the issue stays open.")}${actMsg(j.name)}</div>` +
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
