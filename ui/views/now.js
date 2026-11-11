// The Now view: the factory's front page. Each render function takes the
// /api/factory object and returns an HTML string. No DOM, so tests can call them.
// The page's click handler (router.js) runs the buttons `act` makes.
import { actButton, fold, recordState, restoreState, clock, codeText, facts, tiles, badge, card, sectionHead, meter, dataTable, blockersHtml, dur, costHtml, empty, error, esc, idLink, mean, loadingLine, pageHead, priorityBadge, repoIdLink, shortModel, sortHead, sortRows, nextSort, tag, tone, when, scope } from "../lib.js";
import { shortText, NAMES, shortId, jobHref, contentText, shownId, issueHref, say } from "../../lib/naming.ts";
import { bar, flowOf, statusCards, usable } from "./speed.js";
import { act, actMsg, askCard, askShell, checkFacts, itemId, metaRow, shell as jobCard, statLines, trailerLine } from "./cards.js";
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
  render: (s, _params, q) => { lastState = s; const w = scope(q).window, f = s.flow ?? null; return `<div class="page sp">${renderStatusLine(s, outOfDateNow, w)}${tiles("Scorecard", renderTiles(s, usable(f), w), "scorecard")}<div class="rail"><div class="rail-main">${renderOutcome(f)}${renderPipeline(f)}${renderLanes(s)}</div>${renderHerald(s)}</div></div>`; },
  more: async (s, q) => ({ ...s, flow: await flowOf(scope(q).window, q, true) }),
  // The shell calls this when the out-of-date verdict changes: the sentence is drawn again from the last state.
  outOfDate: (root, b) => { outOfDateNow = b; const el = root.querySelector(".shead .say"); if (el && lastState) el.outerHTML = renderLede(lastState, b); },
  mount: (root, _s, q) => { scope(q).wire(root); wireHeraldJump(root); },
  // An event from the stream goes into the Herald at once; the reload that follows draws it from the state.
  event: (root, ev) => {
    streamed.push(ev);
    if (streamed.length > HERALD_KEEP) streamed.shift();
    const h = root.querySelector("#herald");
    if (!h || !lastState) return;
    const saved = recordState(h);
    h.outerHTML = renderHerald(lastState);
    restoreState(root.querySelector("#herald"), saved);
  },
};

let lastState = null, outOfDateNow = false;

const EFFICIENCY = "#/flow", PERFORMANCE = "#/factory/jobs";
/** A link to another page that keeps the window; week is the default and stays out of the address. */
const withWindow = (href, win) => (win === "week" ? href : `${href}?window=${win}`);

/** The scorecard: lost time, completion, landed, queue wait, usage. `d` is /api/flow for the window `win` with its baseline, or null while it loads. */
export function renderTiles(s, d, win = d?.window ?? "week") {
  return statusCards(s, d, { efficiency: withWindow(EFFICIENCY, win), performance: withWindow(PERFORMANCE, win) });
}

/** The outcome bar. `d` is null while it loads, `{ error }` on a failed load. */
function renderOutcome(d) {
  const outcome = (body) => card("Agent Time", body, { id: "outcome", label: "Agent time" });
  if (!d) return outcome(loadingLine("the outcomes"));
  if (d.error) return outcome(error(d.error));
  return outcome(bar(d));
}

/** The pipeline stages in order, with their names; the monitor's other roles (facts, director, monitor…) are not stages of an issue. Queue is the wait before the first build, not a run. */
const PIPE = Object.fromEntries(["intake", "queue", "build", "review", "recheck", "land"].map((k) => [k, NAMES[k]]));
/** The health of a stage by its failed share: under 10% fine, to 25% warning, above that alert. */
const health = (share) => (share < 0.1 ? "fine" : share <= 0.25 ? "warning" : "alert");
/** The Pipeline card for the window: each stage a ring with its runs per issue, coloured by its failed share, and its p90 time under it. `d` is /api/flow for the window, null while it loads, or `{ error }`. */
export function renderPipeline(d) {
  const box = (body, aside = "") => card("Pipeline", body, { id: "pipeline", aside });
  if (!d) return box(loadingLine("the pipeline"));
  if (d.error) return box(error(d.error));
  const by = new Map((d.stages?.rows ?? []).map((r) => [r.stage, r]));
  const queue = d.phases?.queue;
  const node = ([k, name]) => {
    if (k === "queue") {
      const has = queue?.count > 0;
      return `<div class="pnode wait${has ? "" : " idle"}" title="${esc(has ? `Queue: ${queue.count} waits` : "Queue: no wait")}"><span class="ring">wait</span>` +
        `<span class="pn">${esc(name)}</span><span class="pt">${has ? esc(dur(queue.p90)) : "no wait"}</span></div>`;
    }
    const r = by.get(k), n = r?.items ? r.runs / r.items : null;
    if (n === null) return `<div class="pnode idle" title="${esc(`${name}: no run`)}"><span class="ring">–</span><span class="pn">${esc(name)}</span><span class="pt">no run</span></div>`;
    const share = r.runs ? (r.unusable ?? 0) / r.runs : 0, tone = health(share);
    const tip = `${name}: ${r.runs} runs on ${r.items} issues${r.unusable ? `, ${r.unusable} failed` : ""}`;
    return `<div class="pnode ${tone}" title="${esc(tip)}"><span class="ring">${mean(n)}</span><span class="pn">${esc(name)}</span>` +
      `<span class="pt">${esc(dur(r.p90))}</span><span class="pf">${Math.round(share * 100)}% failed</span></div>`;
  };
  const nodes = Object.entries(PIPE).map(node).join(`<span class="parrow" aria-hidden="true"></span>`);
  return box(`<div class="pflow" role="group" aria-label="Stages">${nodes}</div>`, `<span class="asof">runs / issue in the ring · p90 time under it</span>`);
}

/** A finding as HTML: **text** and each number or percentage in bold; all other text escaped. */
export function findingHtml(text) {
  return esc(text).split(/\*\*(.+?)\*\*/).map((part, i) => i % 2 ? `<b>${part}</b>`
    : part.replace(/(&#?\w+;)|(\$?\d+(?:[.,]\d+)*%?)/g, (m, entity) => (entity ? m : `<b>${m}</b>`))).join("");
}

/** The findings of a Monitor report as a numbered list, each through findingHtml(). */
export const findingsList = (findings) => `<ol class="findings">${findings.map((f) => `<li>${findingHtml(f)}</li>`).join("")}</ol>`;

/** A feed row in two columns: the time (the clock, or the day), then the body's HTML. `cls` is added to the row's class, `bodyCls` to the body's, `by` is the actor. */
function feedRow({ tone, at, body, by, cls = "", bodyCls = "" }) {
  return `<div class="event-row ${tone}${cls}"${by === undefined ? "" : ` data-by="${esc(by)}"`}>` +
    `<span class="event-time">${esc(at ? (clock(at) || when(at)) : "")}</span>` +
    `<span class="event-body${bodyCls}">${body}</span></div>`;
}

/** The events the stream sent since the page loaded, oldest first; the Herald merges them with the state's. */
let streamed = [];
const HERALD_KEEP = 50;

/** The events of the state and of the stream, each once, newest first. */
export function heraldEvents(s, more = streamed) {
  const key = (e) => `${e.at} ${e.by} ${e.subject} ${e.action} ${(e.on ?? []).join(",")}`;
  const all = new Map([...(s.herald?.events ?? []), ...more].map((e) => [key(e), e]));
  return [...all.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, HERALD_KEEP);
}

/** A piece of `say`: text escaped, a job ID linked to its job page, an issue ID to its issue page, any other ID as text. */
const saidHtml = (p) => {
  if (typeof p === "string") return esc(p);
  const to = p.id.includes("#") ? jobHref(shownId(p.id)) : issueHref(p.id);
  return to ? idLink(shownId(p.id), to) : `<span class="event-id">${esc(shownId(p.id))}</span>`;
};

/** The actions that say an issue waits: the ledger calls each one "waiting". */
const WAITS = new Set(["waiting", "paused", "red", "after", "full", "gpu", "busy", "parent", "credit"]);
/** The mark of a run's result in an older row. */
const MARK = { passed: "✓", landed: "✓", done: "✓", failed: "✗", returned: "✗", dropped: "✗" };
/** The leading verb of a sentence after its ID, with the words that only join it to the rest. */
const VERB = /^ ?(?:(?:is|has|asks|proposes|hit) |\S+(?: up| its checks)?(?: by| for| to)?(?::|$| ))\s*/;

/** A routing note, "cost … model M tier T p P", as "T · M · p P"; any other note as it is. */
const routeText = (note = "") => {
  const m = Object.fromEntries([...note.matchAll(/(\w+) (\S+)/g)].map(([, k, v]) => [k, v]));
  return m.tier ? `${m.tier} · ${shortModel(m.model?.split("/").pop())} · p ${m.p}` : note;
};

/** An event's sentence in two parts of HTML: its leading ID, and what follows the verb ("the factory is paused", "past its time box"). */
function parts(ev) {
  // Adjacent text pieces as one, so the verb's colon and the reason after it ("failed", ": past its time box") read as one.
  const said = say(ev).reduce((out, p) => (typeof p === "string" && typeof out.at(-1) === "string" ? [...out.slice(0, -1), out.at(-1) + p] : [...out, p]), []);
  const lead = typeof said[0] === "string" ? "" : saidHtml(said.shift());
  if (typeof said[0] === "string") said[0] = said[0].replace(VERB, "");
  return { lead, rest: said.map(saidHtml).join("").trim() };
}

/** The job of an event, `a1878#2`, if it names one. */
const jobOf = (ev) => ev.on?.find((x) => x.includes("#"));

/** The state word of an event's row: "waiting" for each wait, the run's kind before a run's result ("build passed"), else the action. */
function stateWord(ev, run) {
  if (WAITS.has(ev.action)) return "waiting";
  if (ev.action === "started") return "picked up";
  if (ev.action === "landed" || !run) return ev.action;
  return `${run} ${ev.action}`;
}

/** An event's row: the time, then the issue's title, and under it the state, the ID and what the sentence adds. A chat turn's line is its message; a routing event's is its tier and model. `more` is the count of older rows folded behind it; `run` is the kind of the event's run. */
export function eventRow(ev, titles = {}, chats = {}, more = 0, run = "") {
  const chat = ev.subject === "chat", route = ev.action === "routed";
  const title = chat || route ? "" : titles[ev.subject] ?? "";
  const { lead, rest } = chat || route ? { lead: "", rest: "" } : parts(ev);
  const word = stateWord(ev, run);
  const line = chat ? esc(chats[ev.on?.[0]]?.title ?? "")
    : route ? esc(routeText(ev.note))
    : `<span class="event-state">${esc(word)}</span>${[lead, rest !== word && rest].filter(Boolean).join(" · ")}`;
  return feedRow({ tone: tone(ev.action), at: ev.at, by: ev.by, cls: route ? " sys" : "",
    body: `${title ? `<span class="event-title" title="${esc(title)}">${esc(title)}</span>` : ""}` +
      `<span class="event-say">${line}${more ? `<span class="event-more">+${more}</span>` : ""}</span>${!chat && !route && ev.note ? `<span class="reason">${esc(ev.note)}</span>` : ""}` });
}

/** An older event as a label and a short text: a run's kind and "#2 ✓", "waits" and what it waits for, or the action and what the sentence adds. */
function brief(ev, runs = {}, chats = {}) {
  const job = jobOf(ev), run = runs[job], n = job?.match(/#\d+$/)?.[0] ?? "";
  const cut = (s) => esc(s ?? "");
  if (ev.subject === "chat") return { ev, label: "", text: cut(chats[ev.on?.[0]]?.title) };
  if (ev.action === "routed") return { ev, label: "routed", text: cut(routeText(ev.note)) };
  const { lead, rest } = parts(ev), note = ev.note ? ` <span class="reason">${cut(ev.note)}</span>` : "";
  if (WAITS.has(ev.action)) return { ev, label: "waits", text: (rest || lead) + note };
  if (run) return { ev, label: run, text: `${n} ${MARK[ev.action] ? `<span class="brief-mark">${MARK[ev.action]}</span>` : cut(ev.action)}${rest ? ` ${rest}` : ""}${note}` };
  return { ev, label: ev.action === "started" ? "picked" : ev.action, text: (rest || lead) + note };
}

/** The older rows of a group, newest first: no start of a job with another event, nor of a run kind with a newer one, and a run of waits as one row. */
function briefs([latest, ...earlier], runs = {}, chats = {}) {
  // The gate can log a job's start after its result, so any other event of the job hides the start.
  const ended = new Set([latest, ...earlier].filter((ev) => ev.action !== "running").map(jobOf));
  const seen = new Set([runs[jobOf(latest)]]), out = [];
  for (const ev of earlier) {
    const job = jobOf(ev), run = runs[job];
    if (ev.action === "running" && (ended.has(job) || (run && seen.has(run)))) continue;
    seen.add(run);
    const b = brief(ev, runs, chats), last = out.at(-1);
    if (last?.label === "waits" && b.label === "waits") last.text += `, ${b.text}`;
    else out.push(b);
  }
  return out;
}

/** An older row: the time, the label and the text, in the event's tone. */
const briefRow = ({ ev, label, text }) => `<div class="event-brief ${tone(ev.action)}"><span class="event-time">${esc(clock(ev.at) || when(ev.at))}</span>` +
  `<span class="brief-label">${esc(label)}</span><span class="brief-text">${text}</span></div>`;

/** Rows of `groups`, each `[id, events]` newest first: the newest event's row, with the older ones briefly behind it; `row(ev, more)` draws the head. The fold is named by `id`, so it keeps its state when its text or place changes. */
const grouped = (groups, row, runs, chats) => groups.map(([id, events]) => {
  const older = briefs(events, runs, chats);
  return { at: events[0].at, html: older.length ? fold(row(events[0], older.length), `<div class="herald-older">${older.map(briefRow).join("")}</div>`, { cls: "herald-group", id }) : row(events[0]) };
});

/** The rows of the issue events: one per subject, its newest event, with its older events behind an expand control. */
function issueRows(events, titles = {}, runs = {}) {
  const by = new Map();
  for (const ev of events) if (ev.subject !== "chat") by.set(ev.subject, [...(by.get(ev.subject) ?? []), ev]);
  return grouped([...by].map(([k, v]) => [`issue:${k}`, v]), (ev, more) => eventRow(ev, titles, {}, more, runs[jobOf(ev)]), runs);
}

/** The rows of the chat events, newest first: one per session, its latest turn's newest event, with the earlier turns' behind an expand control. */
function chatRows(events, chats = {}) {
  const turns = new Set(), sessions = new Map();
  for (const ev of events) {
    const turn = ev.on?.[0];
    if (ev.subject !== "chat" || turns.has(turn)) continue;
    turns.add(turn);
    const key = chats[turn]?.session ?? turn;
    sessions.set(key, [...(sessions.get(key) ?? []), ev]);
  }
  return grouped([...sessions].map(([k, v]) => [`chat:${k}`, v]), (ev, more) => eventRow(ev, {}, chats, more), {}, chats);
}

/** A status text without the "health: " of each health line, which older history entries carry. */
const statusText = (t) => t.replace(/(^|: |; )health: /gi, "$1");

/** The Herald panel: sticky alerts on top, rolling event history stream below. */
export function renderHerald(s) {
  const cur = verdict(s, outOfDateNow);
  // An error is not pinned: the newest event already says it, and is marked live instead.
  const asks = (s.asks ?? []).map((i) => askCard(i, s.now));
  const stuck = (s.stuck ?? []).map(stuckRow(s));
  const errs = cur.errors, errors = errs.length;
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

  // A status row is the status sentence in its tone between two rules, with no label; the live row is a card that adds each error line the sentence lacks.
  const status = history.map((ev, i) => ({ at: ev.at ?? "", html: feedRow({ tone: esc(ev.tone), at: ev.at, cls: i === 0 && errors ? " live" : " status", bodyCls: ` ${esc(ev.tone)}`,
    body: `${esc(statusText(ev.text))}${(i === 0 && errors ? errs.map((l) => l.text) : ev.reason ? [ev.reason] : []).map(statusText).filter((l) => !ev.text.includes(l)).map((l) => `<span class="reason">${esc(l)}</span>`).join("")}` }) }));
  // The status changes and the events in one feed, newest first; the live status row stays on top.
  const live = errors ? status.shift() : null;
  const events = heraldEvents(s);
  const rows = [...status, ...issueRows(events, s.herald?.titles, s.herald?.runs), ...chatRows(events, s.herald?.chats)].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  const feed = (live ? [live, ...rows] : rows).map((r) => r.html).join("");

  // A stuck job or an error outranks an Ask: the badge takes the worst alert's tone.
  const badgeHtml = asks.length + stuck.length + errors > 0 ? tag("Not OK", stuck.length || errors ? "stuck" : "need") : tag("OK", "done");

  return `<section id="herald" class="card herald-card" aria-label="Herald">` +
    `<div class="sh"><h2 id="h-herald">Herald</h2><div class="aside">${badgeHtml}</div></div>` +
    sticky +
    `<div class="herald-feed">${feed}</div>` +
  `</section>`;
}

function wireHeraldJump(root) {
  root.querySelector?.(".shead .say")?.addEventListener?.("click", (e) => {
    if (e.target.closest?.("a")) return;
    const herald = root.querySelector?.("#herald");
    if (herald) {
      herald.scrollIntoView?.({ behavior: "smooth", block: "center" });
      herald.classList?.add("pulsing");
      setTimeout(() => herald.classList?.remove("pulsing"), 1200);
    }
  });
}

/** The page head: the time and the status sentence in place of a title, then the window control with Pause or Resume next to it. */
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

/** The one folded "Details" of an Issues row; `key` keeps it open across refreshes. */
const more = (key, body) => fold("Details", `<div class="body">${body}</div>`, { cls: "more", keep: `more:${key}` });

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


/** The count of a section: `N of cap` where a cap applies. */
const section = (id, title, n, body, cap) =>
  sectionHead(title, { id, count: n === null ? null : `${n}${cap > 0 ? ` of ${cap}` : ""}` }) + body;

const cards = (html, cls = "") => `<div class="cards${cls ? " " + cls : ""}">${html}</div>`;

/** The title of a card: one line, an ellipsis after that. */
const titleOf = (title, href) => (href ? `<a href="${esc(href)}" class="t" title="${esc(title)}">${esc(title)}</a>` : `<span class="t" title="${esc(title)}">${esc(title)}</span>`);

/** An item card of a lane: the 2-line face (the meta row, then the title on 1 line); `below` is HTML after the face. */
function laneCard(id, cls, row, title, href, below = "") {
  return `<article class="job-card small lane-card ${cls}" data-annotate="${esc(shortId(id))}">${row}${titleOf(title, href)}${below}</article>`;
}

/** A lane: header with the count, its cards or one quiet line; an empty lane is marked `none`. */
const lane = (id, title, n, rows, none, cap = 0) =>
  `<section id="lane-${id}" class="lane${rows ? "" : " none"}" aria-labelledby="h-${id}">${section(id, title, n, rows ? cards(rows, "one") : empty(none), cap)}</section>`;

/** Done: the done parts and issues /api/factory sends, newest first, each its own card. */
function doneLane(s) {
  const rows = (s.done ?? []).map((i) =>
    laneCard(i.id, "done-row", metaRow({ id: repoIdLink(i.id, i.href), chips: badge("done") + priorityBadge(i.priority), part: i.part, at: i.finished, since: i.since, now: s.now, end: i.finished }), i.title, i.href)).join("");
  return lane("done", "Done", (s.done ?? []).length, rows, "Nothing is done yet.", s.doneCount ?? 0);
}

function queuedLane(s) {
  const rows = (s.queued ?? []).map((w) => {
    const dead = (w.waits ?? []).filter((b) => b.dead);
    const id = repoIdLink(`${w.repo}-${w.id}`, issueHref(`${w.repo}-${w.id}`), w.repo);
    const hold = holdLine(w.ev);
    return laneCard(`${w.repo}-${w.id}`, "queued-row", metaRow({ id, chips: (hold ? "" : badge(w.stage ?? "queued")) + priorityBadge(w.priority), part: w.part, at: w.at, since: w.since, now: s.now, hold }), w.title, "",
      dead.length ? `<div class="blockers">${blockersHtml(dead, w.repo, w.id)}</div>` : "");
  }).join("");
  return lane("queued", "Queued", (s.queued ?? []).length, rows, "Nothing is queued.");
}

/** A parent that waits to close: all its parts are done. */
function runningIssue(i, now) {
  return laneCard(i.id, "run-row issue-run", metaRow({ id: repoIdLink(i.id, i.href), chips: badge(i.stage) + priorityBadge(i.priority), at: i.at, since: i.since, now }), i.title, i.href);
}

const TIERS = { haiku: "low", sonnet: "medium", opus: "high" };

/** The Running lane's rows: intake, land and agent runs. The count is the live agent runs, as the cap counts them. */
function runningLane(s) {
  const issues = (s.runningIssues ?? []).map((i) => runningIssue(i, s.now)).join("");
  const rows = issues + (s.running ?? []).map((j) => {
    const run = j.run ?? { kind: "build", started: j.started };
    const worker = run.kind === "build";
    const kind = worker ? "worker" : run.kind;
    const tier = TIERS[j.tier ?? shortModel(j.model)];
    const label = worker ? ["worker", tier, j.model && shortModel(j.model)].filter(Boolean).join(" · ") : kind;
    return laneCard(j.name, `run-row kind-${kind}`, metaRow({ id: itemId(j), chips: `${tag(label, "run", j.phase || kind)}` + priorityBadge(j.item?.priority), part: j.part, at: run.started, since: j.started, now: s.now }), j.item?.title || j.name, jobHref(j.id));
  }).join("");
  return lane("running", "Running", s.factory.liveRuns ?? (s.runningIssues ?? []).length + (s.running ?? []).length, rows, "Nothing is running.", s.factory.liveCap ?? 0);
}

/** The three lanes: Running and Queued in one row, Done the full width under them. */
export function renderLanes(s) {
  return `<div class="lanes"><div class="lanes-top">${runningLane(s)}${queuedLane(s)}</div>${doneLane(s)}</div>`;
}


/** Awaiting you: the asks, each marked input or approval, then the stuck and failed jobs; absent when nothing awaits Chris. */
export function renderNeeds(s) {
  const asks = (s.asks ?? []).map((i) => askCard(i, s.now)).concat(verdict(s).errors.map(errorRow));
  if (!asks.length && !s.stuck.length) return "";
  const group = (id, n, html, wrap) => (n ? `<div class="grp" id="${id}">${wrap(html)}</div>` : "");
  return `<section id="needs" class="needs" aria-labelledby="h-needs">${sectionHead("Alerts", { id: "needs", count: asks.length + s.stuck.length })}` +
    group("awaiting", asks.length, asks.join(""), list) + group("jobs-stuck", s.stuck.length, s.stuck.map(stuckRow(s)).join(""), list) + `</section>`;
}

/** The agent line of a held or stuck job: a live run exists for it. */
const agentLine = (j) => (j?.agent ? `<span class="agent">Agent working</span>` : "");
/** One Jobs card in the compact size: the id, the title, one sentence of why, the buttons; `jobDetails` is the one Details behind it. */
/** The one Details behind a stuck row: the blocker, the whole reason, then the job's details. */
const jobDetails = (s, j) => details(s, j,
  (j.blocker ? `<p class="quiet q">Blocker <a href="${esc(j.blocker.href)}">${esc(j.blocker.id)}</a>: ${esc(j.blocker.title)}</p>` : "") +
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
  }[j.cause] ?? (j.condition === "failed" ? "The run failed." : "The run stopped.");
};
const stuckRow = (s) => (j) => {
  const b = j.blocker;
  const blocker = b && shortText(b.id);
  const hold = b ? holdLine({ action: "after", on: [b.id] }) : stuckSentence(j);
  const job = (verb) => `/api/jobs/${encodeURIComponent(j.id)}/${verb}`;
  const first = b ? actButton(`Wait for ${blocker}`, { act: "wait", name: j.name, path: job("wait"), body: JSON.stringify({ on: b.id }), label: `Wait for ${blocker}` }, { primary: true }) : actButton("Re-check", { act: "recheck", name: j.name, path: job("recheck"), label: "Re-check" });
  const meta = metaRow({ id: repoIdLink(j.name, jobHref(j.id), j.repo), chips: j.item?.priority ? priorityBadge(j.item.priority) : "", part: j.part, at: j.run?.started ?? j.started, since: j.started, now: s.now });
  const opt = (button, hint) => `<div class="choice">${button}<div class="choice-text"><span class="effect">${codeText(hint)}</span></div></div>`;
  return alertCard("stuck", j.name, meta, j.item?.title || j.name, hold,
    `<div class="actions choices">${opt(first, b ? `Makes the issue run after ${blocker} and drops the stuck job; nothing starts until ${blocker} lands.` : "Runs the job again.")}${opt(actButton("Drop", { act: "drop", name: j.name, path: job("drop"), confirm: "1", label: "Drop" }), "Discards the job's branch; the issue stays open.")}${actMsg(j.name)}</div>` +
    agentLine(j) + jobDetails(s, j));
};


/** An error line as a card: the action word and the line, because the page has no action that fixes it. */
const errorRow = (l) => alertCard("error", l.text, "", `${l.key === "red-main" ? "fix" : "check"} ${l.text}`, "");

/** "10/28 14:05": the time of the state. */
const renderAsOf = (s) => when(s.now);

/** The Pause or Resume button of the page head. */
export function renderControls(s) {
  return s.factory.paused ? ctl("resume", "Resume") : ctl("pause", "Pause");
}
const ctl = (verb, label) =>
  actButton(label, { act: verb, path: `/api/factory/${verb}`, ...(verb === "pause" ? { confirm: "1" } : {}), label }, { cls: "warn" });
