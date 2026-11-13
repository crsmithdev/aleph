// The Now view: the factory's front page. Each render function takes the
// /api/factory object and returns an HTML string. No DOM, so tests can call them.
// The page's click handler (router.js) runs the buttons `act` makes.
import { actButton, fold, recordState, restoreState, clock, codeText, facts, tiles, badge, card, sectionHead, meter, dataTable, dur, costHtml, count, empty, error, esc, hours, idLink, mean, loadingLine, miss, pageHead, pct, plural, priorityBadge, repoIdLink, shortModel, sortHead, sortRows, nextSort, tag, tone, undecided, when, scope } from "../lib.js";
import { shortText, NAMES, shortId, jobHref, contentText, shownId, issueHref, parseId, say as sayParts } from "../../lib/naming.ts";
import { panelOf } from "../chart.js";
import { share, flowOf, statusCards, usable } from "./speed.js";
import { actMsg, askCard, askShell, checkFacts, itemId, metaRow, statLines, trailerLine } from "./cards.js";
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
  render: (s, _params, q) => { lastState = s; const w = scope(q).window, f = s.flow ?? null; return `<div class="page sp">${renderStatusLine(s, outOfDateNow, w)}${tiles("Scorecard", renderTiles(s, usable(f), w), "scorecard")}<div class="rail"><div class="rail-main">${renderOutcome(f)}${renderPipeline(f, q)}${renderActive(f)}</div>${renderHerald(s)}</div></div>`; },
  more: async (s, q) => ({ ...s, flow: await flowOf(scope(q).window, q, true) }),
  // The shell calls this when the out-of-date verdict changes: the sentence is drawn again from the last state.
  outOfDate: (root, b) => { outOfDateNow = b; const el = root.querySelector(".shead .say"); if (el && lastState) el.outerHTML = renderLede(lastState, b); },
  mount: (root, s, q) => {
    scope(q).wire(root); wireHeraldJump(root);
    if (usable(s.flow)) root.querySelector('aleph-chart[key="status/active"]').frame = activeFrame(s.flow);
  },
  // An event from the stream goes into the Herald at once; the reload that follows draws it from the state.
  event: (root, ev) => {
    streamed.push(ev);
    if (streamed.length > HERALD_KEEP) streamed.shift();
    const h = root.querySelector("#herald");
    if (!h || !lastState) return;
    const saved = recordState(h), moved = heraldMotion(root);
    h.outerHTML = renderHerald(lastState);
    restoreState(root.querySelector("#herald"), saved);
    moved();
  },
  swap: (root) => heraldMotion(root),
};

let lastState = null, outOfDateNow = false;

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
  const cs = d.classes ?? [], sum = (xs) => xs.reduce((a, c) => a + c.hours, 0), total = sum(cs);
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

/** A short hash of a text, to key a row by its text. */
const hash = (t) => [...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0).toString(36);

/** An event's identity: the same event from the stream and from the state has the same key. */
const eventKey = (e) => `${e.at} ${e.by} ${e.subject} ${e.action} ${(e.on ?? []).join(",")}`;

/** The events the stream sent since the page loaded, oldest first; the Herald merges them with the state's. */
let streamed = [];
const HERALD_KEEP = 50;

/** The events of the state and of the stream, each once, newest first. */
export function heraldEvents(s, more = streamed) {
  const all = new Map([...(s.herald?.events ?? []), ...more].map((e) => [eventKey(e), e]));
  return [...all.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, HERALD_KEEP);
}

/** A piece of `say`: text escaped, a job ID linked to its job page, an issue ID to its issue page, any other ID as text. */
const saidHtml = (p) => {
  if (typeof p === "string") return esc(p);
  const to = p.id.includes("#") ? jobHref(shownId(p.id)) : issueHref(p.id);
  return idLink(shownId(p.id), to);
};

/** The holds: an issue's state while it waits, not an event, so the feed leaves them out. The ones that need Chris are alerts. */
const WAITS = new Set(["waiting", "paused", "red", "after", "full", "gpu", "busy", "parent", "credit"]);
/** An issue's subject (`aleph-2118`), not a routine's (`housekeeper`). */
const isIssue = (subject) => Boolean(parseId(subject));
/** The role of a run kind in a row's line: a build is the worker's job. */
const role = (kind) => (kind === "build" ? "worker" : kind);
/** The mark of a run's result in an older row. */
const MARK = { passed: "✓", landed: "✓", done: "✓", failed: "✗", returned: "✗", dropped: "✗" };
/** The leading verb of a sentence after its ID, with the words that only join it to the rest. */
const VERB = /^ ?(?:(?:is|has|asks|proposes|hit) |\S+(?: up| its checks)?(?: by| for| to)?(?::|$| ))\s*/;

/** What a routing event chose, "worker-medium · sonnet · p 0.99 · $0.00003", from its fields. An event from before the fields has a note, "cost … model M tier T p P", read as "T · M · p P"; any other note as it is. */
const routeText = (ev) => {
  if (ev.tier) return [ev.tier, ev.model, `p ${ev.p}`, ev.cost !== undefined && `$${Number(ev.cost.toFixed(5))}`].filter(Boolean).join(" · ");
  const note = ev.note ?? "";
  const m = Object.fromEntries([...note.matchAll(/(\w+) (\S+)/g)].map(([, k, v]) => [k, v]));
  return m.tier ? `${m.tier} · ${shortModel(m.model?.split("/").pop())} · p ${m.p}` : note;
};

/** What an event's own fields add to its row, as HTML: a routing event's choice, a tally's counts with the issues it changed linked. */
function detail(ev) {
  if (ev.tier) return `→ ${esc(routeText(ev))}`;
  if (!ev.tally) return "";
  const ids = (ev.on ?? []).filter((x) => !x.includes("#")).map((x) => idLink(shownId(x), issueHref(x)));
  return [esc(Object.entries(ev.tally).map(([k, n]) => `${TALLY[k] ?? k} ${n}`).join(" · ")), ids.join(" ")].filter(Boolean).join(" ");
}

/** The past word of a housekeeper action. A note reads "commented", in the tally too. */
const DID = { close: "closed", drop: "dropped", retitle: "retitled", reprioritize: "reprioritized", note: "commented", unpark: "unparked" };
const TALLY = { noted: "commented" };

/** A run's changes as sub-items for its fold, one per issue: the linked issue, then its actions' past words in the order they ran. */
function changeRows(ev) {
  const by = new Map();
  for (const c of ev.changes ?? []) by.set(c.id, [...(by.get(c.id) ?? []), DID[c.do] ?? c.do]);
  return [...by].map(([id, did]) => `<div class="event-brief event-change"><span class="event-time"></span>` +
    `<span class="brief-label">${idLink(shownId(id), issueHref(id))}</span><span class="brief-text">${esc(did.join(" · "))}</span></div>`);
}

/** An event's sentence in two parts of HTML: its leading ID, and what follows the verb ("the factory is paused", "past its time box"). */
function parts(ev) {
  // Adjacent text pieces as one, so the verb's colon and the reason after it ("failed", ": past its time box") read as one.
  const said = sayParts(ev).reduce((out, p) => (typeof p === "string" && typeof out.at(-1) === "string" ? [...out.slice(0, -1), out.at(-1) + p] : [...out, p]), []);
  const lead = typeof said[0] === "string" ? "" : saidHtml(said.shift());
  if (typeof said[0] === "string") said[0] = said[0].replace(VERB, "");
  return { lead, rest: said.map(saidHtml).join("").trim() };
}

/** The job of an event, `a1878#2`, if it names one. */
const jobOf = (ev) => ev.on?.find((x) => x.includes("#"));

/** The chip of an event: what happened, never who. A done closes an issue, or ends a routine's run; a start or a running run is "started". */
function stateWord(ev) {
  if (ev.action === "done") return isIssue(ev.subject) ? "closed" : "ended";
  return ev.action === "started" || ev.action === "running" ? "started" : ev.action;
}
/** A chip's tone: filing starts work and an ended routine changes no issue, so neither is a success. */
const CHIP_TONES = { filed: "quiet", ended: "quiet", closed: "done", started: "run" };
const chipTone = (word) => CHIP_TONES[word] ?? tone(word);

/** An event's row: the time, then the issue's title, and under it the state, the ID and what the sentence adds. A chat turn's line is its message; a routing event's is its tier and model. `more` is the count of older rows folded behind it; `run` is the kind of the event's run. */
export function eventRow(ev, titles = {}, chats = {}, more = 0, run = "") {
  const chat = ev.subject === "chat", route = ev.action === "routed" && !ev.tier;
  const title = chat || route ? "" : titles[ev.subject] ?? "";
  const { lead, rest } = chat || route ? { lead: "", rest: "" } : parts(ev);
  const word = stateWord(ev), who = run && isIssue(ev.subject) ? `${esc(role(run))} ` : "";
  const line = chat ? esc(chats[ev.on?.[0]]?.title ?? "")
    : route ? esc(routeText(ev))
    : `${tag(word, chipTone(word))} ${[lead && who + lead, rest !== ev.action && rest, detail(ev)].filter(Boolean).join(" · ")}`;
  return feedRow({ tone: chipTone(word), at: ev.at, by: ev.by, cls: route ? " sys" : "",
    body: `${title ? `<span class="event-title" title="${esc(title)}">${esc(title)}</span>` : ""}` +
      `<span class="event-say">${line}${more ? `<span class="event-more">+${more}</span>` : ""}</span>${!chat && !route && ev.note ? `<span class="reason" title="${esc(ev.note)}">${esc(ev.note)}</span>` : ""}` });
}

/** An older event as a label and a short text: a run's role and "#2 ✓", or the chip word and what the sentence adds. */
function brief(ev, runs = {}, chats = {}) {
  const job = jobOf(ev), run = runs[job], n = job?.match(/#\d+$/)?.[0] ?? "";
  const cut = (s) => esc(s ?? "");
  if (ev.subject === "chat") return { ev, label: "", text: cut(chats[ev.on?.[0]]?.title) };
  if (ev.action === "routed") return { ev, label: "routed", text: cut(routeText(ev)) };
  const { lead, rest } = parts(ev), more = detail(ev) && ` ${detail(ev)}`, note = ev.note ? ` <span class="reason" title="${cut(ev.note)}">${cut(ev.note)}</span>` : "";
  if (run) return { ev, label: role(run), text: `${n} ${MARK[ev.action] ? `<span class="brief-mark">${MARK[ev.action]}</span>` : cut(ev.action)}${rest ? ` ${rest}` : ""}${more}${note}` };
  return { ev, label: stateWord(ev), text: (rest || lead) + more + note };
}

/** The older rows of a group, newest first: no start of a job with another event, nor of a run kind with a newer one. */
function briefs([latest, ...earlier], runs = {}, chats = {}) {
  // The gate can log a job's start after its result, so any other event of the job hides the start.
  const ended = new Set([latest, ...earlier].filter((ev) => ev.action !== "running").map(jobOf));
  const seen = new Set([runs[jobOf(latest)]]), out = [];
  for (const ev of earlier) {
    const job = jobOf(ev), run = runs[job];
    if (ev.action === "running" && (ended.has(job) || (run && seen.has(run)))) continue;
    seen.add(run);
    out.push(brief(ev, runs, chats));
  }
  return out;
}

/** An older row: the time, the label and the text, in the event's tone. */
const briefRow = ({ ev, label, text }) => `<div class="event-brief ${tone(ev.action)}"><span class="event-time">${esc(clock(ev.at) || when(ev.at))}</span>` +
  `<span class="brief-label" title="${esc(label)}">${esc(label)}</span><span class="brief-text" title="${text.replace(/<[^>]*>/g, "")}">${text}</span></div>`;

/** Rows of `groups`, each `[id, events]` newest first: the newest event's row, with the older ones briefly behind it; `row(ev, more)` draws the head. The fold is named by `id`, so it keeps its state when its text or place changes. */
const grouped = (groups, row, runs, chats) => groups.map(([id, events]) => {
  const inner = [...changeRows(events[0]), ...briefs(events, runs, chats).map(briefRow)];
  return { at: events[0].at, key: `event ${hash(eventKey(events[0]))}`, html: inner.length ? fold(row(events[0], inner.length), `<div class="herald-older">${inner.join("")}</div>`, { cls: "herald-group", id }) : row(events[0]) };
});

/** The rows of the issue events: one per subject, its newest event, with its older events behind an expand control. */
function issueRows(events, titles = {}, runs = {}) {
  const by = new Map();
  // An issue's runs share its row; any other subject (the housekeeper) is one row per run, so a row's older events belong to one run.
  const groupOf = (ev) => (isIssue(ev.subject) || !jobOf(ev) ? ev.subject : `${ev.subject}:${jobOf(ev)}`);
  for (const ev of events) if (ev.subject !== "chat" && !WAITS.has(ev.action)) by.set(groupOf(ev), [...(by.get(groupOf(ev)) ?? []), ev]);
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

/** The running jobs as compact rows under the alerts, each keyed by `data-job` so a job that ends leaves the section. A job leaves the state when it ends, so the rows are the state's. */
function runNow(s) {
  const at = (t) => esc(clock(t) || when(t));
  const row = (id, who, label, title, t, model) => `<div class="run-now" data-job="${esc(id)}"><span class="run-dot"></span>${who}<span class="run-label"${model ? ` title="${esc(model)}"` : ""}>${esc(label)}</span>` +
    `<span class="run-title" title="${esc(title)}">${esc(title)}</span><span class="event-time">${at(t)}</span></div>`;
  const rows = (s.runningIssues ?? []).map((i) => row(i.id, repoIdLink(i.id, i.href), i.stage, i.title, i.at ?? i.since)).concat((s.running ?? []).map((j) => {
    const run = j.run ?? { kind: "build", started: j.started };
    // A job's tier is the Claude model it asked for: its model, or, when another backend served it, its recorded tier.
    const tier = TIERS[j.tier ?? shortModel(j.model)];
    const label = run.kind === "build" ? ["worker", tier].filter(Boolean).join(" · ") : run.kind;
    return row(j.id ?? j.name, j.id ? idLink(shownId(j.id), jobHref(j.id)) : itemId(j), label, j.item?.title || j.name, run.started ?? j.started, j.model);
  }));
  return rows.length ? `<section class="herald-running" aria-label="Running">${rows.join("")}</section>` : "";
}

/** The Herald panel: sticky alerts on top, rolling event history stream below. */
export function renderHerald(s) {
  const cur = verdict(s, outOfDateNow);
  // An error is not pinned: the newest event already says it, and is marked live instead.
  const asks = undecided(s.asks ?? []).map((i) => askCard(i, s.now));
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

  // A status row is an ordinary event row with the status sentence as its body; the live row is a card that adds each error line the sentence lacks.
  const status = history.map((ev, i) => ({ at: ev.at ?? "", key: `status ${hash(`${ev.tone} ${ev.text}`)}`, html: feedRow({ tone: esc(ev.tone), at: ev.at, cls: i === 0 && errors ? " live" : "", bodyCls: i === 0 && errors ? ` ${esc(ev.tone)}` : "",
    body: `<span class="event-say">${esc(statusText(ev.text))}</span>${(i === 0 && errors ? errs.map((l) => l.text) : ev.reason ? [ev.reason] : []).map(statusText).filter((l) => !ev.text.includes(l)).map((l) => `<span class="reason" title="${esc(l)}">${esc(l)}</span>`).join("")}` }) }));
  // The status changes and the events in one feed, newest first; the live status row stays on top.
  // A status row's key is its tone and text, numbered from the oldest, so a new status on top does not rename the rows below it.
  const seen = new Map();
  for (const r of [...status].reverse()) { const n = (seen.get(r.key) ?? 0) + 1; seen.set(r.key, n); r.key += ` ${n}`; }
  const live = errors ? status.shift() : null;
  const events = heraldEvents(s);
  const rows = [...status, ...issueRows(events, s.herald?.titles, s.herald?.runs), ...chatRows(events, s.herald?.chats)].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  const feed = (live ? [live, ...rows] : rows).map((r) => r.html.replace(/^<\w+/, (t) => `${t} data-key="${esc(r.key)}"`)).join("");

  // A stuck job or an error outranks an Ask: the badge takes the worst alert's tone.
  const badgeHtml = asks.length + stuck.length + errors > 0 ? tag("Not OK", stuck.length || errors ? "stuck" : "need") : tag("OK", "done");

  return card("Herald", `${sticky}${runNow(s)}<div class="herald-feed">${feed}</div>`, { id: "herald", cls: "herald-card", aside: badgeHtml });
}

/** The Herald's animated rows: the running jobs and the feed's top rows. */
const heraldRows = (h) => h.querySelectorAll(".run-now[data-job], .herald-feed > [data-key]");
const rowKey = (r) => (r.dataset.job ? `job ${r.dataset.job}` : r.dataset.key);

/**
 * Record the Herald's rows before a redraw; the function it returns animates them from there to where the redraw put them.
 * A new feed row grows and holds a tint. A new running row grows and its parts drop in. A running row that ends fades out
 * in place while the new feed rows fade in. Every other row glides to its new place. Nothing moves under reduced motion.
 */
function heraldMotion(root) {
  const h = root.querySelector("#herald");
  // A page with no matchMedia (the tests' DOM) has no layout to animate either.
  if (!h || !globalThis.matchMedia || matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  const was = new Map([...heraldRows(h)].map((r) => [rowKey(r), { r, box: r.getBoundingClientRect() }]));
  return () => {
    const now = root.querySelector("#herald");
    if (!now) return;
    const css = getComputedStyle(now), mid = parseFloat(css.getPropertyValue("--t-mid")), easing = css.getPropertyValue("--ease").trim();
    const rows = [...heraldRows(now)], keys = new Set(rows.map(rowKey));
    const ended = [...was].filter(([k]) => k.startsWith("job ") && !keys.has(k)).map(([, v]) => v);
    const grow = (r) => r.animate([{ height: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px" }, { height: `${r.getBoundingClientRect().height}px`, opacity: 1 }], { duration: mid, easing });
    // The new rows start first, at height 0, so the glide below measures the rows from where the growth starts.
    for (const r of rows.filter((r) => !was.has(rowKey(r)))) {
      if (r.dataset.job) {
        grow(r);
        for (const c of r.children) c.animate([{ transform: "translateY(-8px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 260, delay: 60, easing, fill: "backwards" });
      } else if (ended.length) r.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 80, easing: "ease-out", fill: "backwards" });
      else {
        grow(r);
        r.animate([{ background: "var(--run-bg)" }, { background: "var(--run-bg)", offset: 0.35 }, { background: "transparent" }], { duration: 1500, easing: "ease-out" });
      }
    }
    for (const r of rows) {
      const old = was.get(rowKey(r)), dy = old ? old.box.top - r.getBoundingClientRect().top : 0;
      if (Math.abs(dy) > 0.5) r.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: mid, easing });
    }
    // A ghost of each ended row fades where the row was; the card is its containing block.
    const base = now.getBoundingClientRect();
    for (const { r, box } of ended) {
      const ghost = r.cloneNode(true);
      ghost.removeAttribute("data-job");
      Object.assign(ghost.style, { position: "absolute", left: `${box.left - base.left - now.clientLeft}px`, top: `${box.top - base.top - now.clientTop}px`, width: `${box.width}px`, margin: "0", pointerEvents: "none" });
      now.append(ghost);
      ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: mid, easing: "ease-out" }).finished.then(() => ghost.remove());
    }
  };
}

function wireHeraldJump(root) {
  root.querySelector?.(".shead .say")?.addEventListener?.("click", (e) => {
    if (e.target.closest?.("a")) return;
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

const TIERS = { haiku: "low", sonnet: "medium", opus: "high" };


/** Awaiting you: the asks, each marked input or approval, then the stuck and failed jobs; absent when nothing awaits Chris. */
export function renderNeeds(s) {
  const asks = undecided(s.asks ?? []).map((i) => askCard(i, s.now)).concat(verdict(s).errors.map(errorRow));
  if (!asks.length && !s.stuck.length) return "";
  const group = (id, n, html, wrap) => (n ? `<div class="grp" id="${id}">${wrap(html)}</div>` : "");
  return `<section id="needs" class="needs" aria-labelledby="h-needs">${sectionHead("Alerts", { id: "needs", count: asks.length + s.stuck.length })}` +
    group("awaiting", asks.length, asks.join(""), list) + group("jobs-stuck", s.stuck.length, s.stuck.map(stuckRow(s)).join(""), list) + `</section>`;
}

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
