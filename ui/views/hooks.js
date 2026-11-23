// The Hooks page: three views of the hooks of `hooks/hooks.json`, the Stop-hook holds and the hook errors of the scope's window and project.
// List has a row per hook with its outcomes, Holds the holds log by hook with the Langfuse hook calls and denials, Errors the hook errors by cause.
// `data` is /api/hooks in the scope of the address. One hook's page, on /api/hooks/:event/:name, filters its holds log by Who, Kind and Outcome from the address (`?who=workers&out=false`).
import { scope, setQuery } from "./lib/address.js";
import { sessionHref } from "../../lib/naming.ts";
import { redraw } from "./lib/router.js";
import { count, day, dur, plural, when } from "./lib/format.js";
import { DAY, WINDOWS } from "../../lib/windows.ts";
import { panelOf } from "./lib/chart.js";
import { badCount, barList, barRow, card, cell, chip, chips, codeText, crumb, dataTable, empty, error, esc, facts, filterBar, fold, heads, idLink, legendHtml, meter, miss, note, pageHead, pageOf, pageRows, pager, row, rowAct, statusRow, subHead, tag } from "./lib/html.js";
import { browse, inspector } from "./lib/browse.js";
import { rowBar } from "./lib/bars.js";
import { factsLine, pageViews } from "./lib/page.js";
import { detailPanel, renderKpis } from "./lib/timeline.js";

export const view = {
  path: "/hooks",
  title: "Hooks",
  icon: "plug",
  group: "claude",
  order: 2,
  api: (_params, q = new URLSearchParams()) => { const s = scope(q); return s.url(`/api/hooks?window=${s.window}`); },
  render: (d, _params, q) => renderHooks(d, q),
  mount: (root) => scope().wire(root),
};

// A hold's outcome, in the order the meter draws them, the useful first: key (the state, in lower case), label, meter class, badge tone.
// prettier-ignore
const OUTS = [
  ["caught",    "Caught",    "o-caught",  "done"],
  ["handoff",   "Handoff",   "o-handoff", "done"],
  ["held up",   "Held Up",   "o-held",    "quiet"],
  ["false",     "False",     "o-false",   "error"],
  ["no reply",  "No Reply",  "o-none",    "need"],
  ["no effect", "No Effect", "o-dead",    "parked"],
];
// A hold's kind as the page names it (ui/api/hooks.ts `kindOf`).
const KIND = { "unbacked hash": "hash", "doc-claim": "doc claim", "new-copy": "new copy", "boundary+new-copy": "both", "compacted, handoff": "compacted" };
const kindName = (k) => KIND[k] ?? k;
const PAGE = 50;
const whoOf = (h) => (h.who === "interactive" ? "interactive" : "workers");
const hookHref = (h) => `#/hooks/${encodeURIComponent(h.event)}/${encodeURIComponent(h.name)}`;

/** The note of an outcome legend, or nothing with no groups: the outcomes come from a keyword pass over each hold's reply. */
const guide = (groups) => !groups.length ? "" : note("Guide only");
/** Whether a factory worker runs the hook, as a badge. */
const workers = (h) => tag(h.workers, h.workers === "runs" ? "run" : "quiet");

/** The outcome legend over a table of holds by kind, with the outcome as one meter per row. A kind's name and Show set the log's filters. */
function holdsBy(groups) {
  if (!groups.length) return empty();
  const rows = groups.map((g) => {
    const n = (k) => g.outcomes[k] ?? 0;
    return row([`<td><button type="button" class="link" data-kind="${esc(g.kind)}">${esc(kindName(g.kind))}</button></td>`, cell(count(g.holds), { num: true }), cell(count(g.interactive), { num: true }), cell(count(g.workers), { num: true }),
      `<td>${meter(OUTS.map(([k, , cls]) => ({ pct: (100 * n(k)) / g.holds, cls })), OUTS.map(([k]) => `${k} ${n(k)}`).join(", "))}</td>`,
      ...OUTS.map(([k]) => cell(count(n(k)), { num: true })), rowAct("Show", { kind: g.kind })]);
  });
  const nums = ["Holds", "Interactive", "Workers", ...OUTS.map((o) => o[1])];
  return legendHtml(OUTS.map(([, name, cls]) => [name, cls])) + dataTable(heads(["Kind", "Holds", "Interactive", "Workers", "Outcome", ...OUTS.map((o) => o[1]), "Action"], nums), rows.join(""));
}

/** A card with `detailPanel`'s arguments, for the list page. */
const asCard = (title, n, body, id) => card(title, body, { count: n, id });

/** The holds per day, one row per day that `window` up to `now` touches. The frame's window only names the x label format. */
export const holdsFrame = (holds, window, now = Date.now()) => {
  const per = Map.groupBy(holds, (h) => day(h.t));
  // Local midnight `i` days after the window's first day: setHours rolls 24 h over to the next calendar day, DST or not.
  const at = (i) => new Date(now - WINDOWS[window]).setHours(24 * i, 0, 0, 0);
  return {
    measure: { name: "Holds by Day", unit: "count", agg: "sum" },
    over: { kind: "time", window: "week" },
    by: { keys: [{ key: "holds", name: "Holds" }] },
    legend: false,
    rows: Array.from({ length: Math.floor((now - at(0)) / DAY) + 1 }, (_, i) => ({ at: at(i), holds: per.get(day(at(i)))?.length ?? 0 })),
  };
};

/** The Holds by Day chart under `key`, in the window of the query `q`; with no holds, its card says so. */
const perDay = (holds, q, key) => holds.length ? panelOf(key, holdsFrame(holds, scope(q).window)) : asCard("Holds by Day", "0", empty());

/** Errors by cause, each with its fix. */
const errorsTable = (errors) => !errors.length ? empty() : dataTable(heads(["Cause", "Hooks", "Event", "Fix", "Errors", "Sessions", "Last"], ["Errors", "Sessions"]), errors.map((e) =>
  row([cell(e.cause), cell(hooksOf(e).join(", "), { wide: true }), cell(uniq(e.pairs.map((x) => x.event)).join(", ")), e.fix ? cell(e.fix) : `<td>${miss("no known fix")}</td>`,
    badCount(e.n), cell(count(e.sessions), { num: true }), `<td class="time">${esc(when(e.last))}</td>`])).join(""));

const uniq = (xs) => [...new Set(xs)].sort();
/** The hook names of an error cause, from its (hook, event) pairs. */
const hooksOf = (e) => uniq(e.pairs.map((x) => x.hook));
/** The cause hit `hook` on `event`. */
const hit = (e, hook, event) => e.pairs.some((x) => x.hook === hook && x.event === event);
/** The filters of the holds log from the address. */
const filtersOf = (q) => Object.fromEntries(["who", "kind", "out"].map((k) => [k, q?.get(k) ?? ""]));

/** The holds log, drawn by `box`, newest first, with its filters from the query `q`. */
function holdsLog(holds, q, box) {
  const f = filtersOf(q);
  const shown = holds.filter((h) => (!f.who || whoOf(h) === f.who) && (!f.kind || h.kind === f.kind) && (!f.out || h.out === f.out));
  const rows = shown.map((h) => {
    const [, , , tone] = OUTS.find((o) => o[0] === h.out);
    return row([`<td class="time lead">${esc(when(h.t))}</td>`, `<td>${idLink(h.sid.slice(0, 8), sessionHref(h.sid))}</td>`,
      cell(kindName(h.kind)), cell(h.who), `<td>${tag(h.out, tone)}</td>`, cell(h.why, { wide: true })]);
  });
  if (!holds.length) return box("Holds", "0", empty(), "holds");
  const page = pageOf(q ?? new URLSearchParams());
  const bar = filterBar([
    { label: "Who", bare: true, name: "who", value: f.who, options: [{ value: "", label: "All" }, { value: "interactive", label: "Interactive" }, { value: "workers", label: "Workers" }] },
    { label: "Kind", name: "kind", data: true, value: f.kind, options: [{ value: "", label: "All Kinds" }, ...uniq(holds.map((h) => h.kind)).map((k) => ({ value: k, label: kindName(k) }))] },
    { label: "Outcome", name: "out", data: true, value: f.out, options: [{ value: "", label: "All Outcomes" }, ...OUTS.map(([k, name]) => ({ value: k, label: name }))] },
  ]);
  const table = dataTable(heads(["Time", "Session", "Kind", "Who", "Outcome", "Reason"]), pageRows(rows, page, PAGE).join(""));
  return box("Holds", count(shown.length), bar + (shown.length ? table + pager(page, shown.length, PAGE) : empty()), "holds");
}

/** The count of each outcome in `holds`, in OUTS order: `[key, label, count]`. */
const outcomes = (holds) => OUTS.map(([k, name]) => [k, name, holds.filter((h) => h.out === k).length]);

/** The inspector of one hook: its facts, its outcomes and kinds, its newest holds and its error causes. */
function inspectHook(h, d, mine, causes) {
  const kinds = d.byHook.filter((g) => g.hook === h.name && g.event === h.event);
  const kv = [
    ["Matcher", h.matcher ? codeText(`\`${h.matcher}\``) : miss("all")], ["File", codeText(`\`${h.file}\``)], ["Mode", h.mode ? esc(h.mode) : miss("sync")],
    ["Timeout", esc(dur(h.timeout))], ["Workers", esc(h.workers)], ["Holds", h.holds ? esc(count(h.holds)) : ""],
    ["Changed", h.changed ? `${esc(day(h.changed.t))} <span class="idp" title="${esc(h.changed.subject)}">${esc(h.changed.hash.slice(0, 8))}</span>` : ""],
  ];
  const outs = h.holds ? subHead("Outcomes") + barList(outcomes(mine).filter(([, , n]) => n).map(([k, name, n]) => barRow(esc(name), 0, count(n), { bar: meter([{ pct: (100 * n) / h.holds, cls: OUTS.find((o) => o[0] === k)[2] }], "") })).join("")) : "";
  const kindTable = kinds.length > 1 ? subHead("Kinds") + dataTable(heads(["Kind", "Holds", "Interactive", "Workers"], ["Holds", "Interactive", "Workers"]),
    kinds.map((g) => row([cell(kindName(g.kind)), cell(count(g.holds), { num: true }), cell(count(g.interactive), { num: true }), cell(count(g.workers), { num: true })])).join("")) : "";
  const newest = mine.length ? subHead("Newest Holds") + `<ul>${mine.slice(0, 2).map((x) => `<li>${tag(x.out, OUTS.find((o) => o[0] === x.out)[3])} <span class="idp">${esc(when(x.t))}</span><p>${esc(x.why)}</p></li>`).join("")}</ul>` : "";
  const errs = causes.length ? subHead("Errors") + `<ul>${causes.map((e) => `<li>${esc(e.cause)} <span class="quiet">${esc(count(e.n))} · ${esc(e.fix || "no fix")}</span></li>`).join("")}</ul>` : "";
  return inspector({ id: h.event, title: h.name, rows: kv, body: outs + kindTable + newest + errs, href: hookHref(h) });
}

/** One hook as a row: its name and only what differs from the defaults (no `sync`, no `runs`), its outcomes, holds and error causes; `event` names its event. */
function hookRow(h, d, event) {
  const mine = d.holds.filter((x) => x.event === h.event && x.hook === h.name), causes = d.errors.filter((e) => hit(e, h.name, h.event));
  const main = `<span class="t">${esc(h.name)}</span>${event ? chip(h.event) : ""}${h.matcher ? codeText(`\`${h.matcher}\``) : ""}${h.mode ? chip(h.mode) : ""}${h.workers === "skips" ? chip("skips workers") : ""}`;
  const errs = causes.length ? `<span title="${esc(causes.map((e) => e.cause).join(", "))}">${esc(plural(causes.length, "cause"))}</span>` : "";
  const bar = h.holds ? rowBar(OUTS.map(([k, , cls]) => ({ pct: (100 * mine.filter((x) => x.out === k).length) / h.holds, cls })), outcomes(mine).filter(([, , n]) => n).map(([k, , n]) => `${k} ${n}`).join(", ")) : "";
  return { key: `${h.event}/${h.name}`, lead: "", main, inspect: inspectHook(h, d, mine, causes), data: { workers: h.workers }, cells: [bar, h.holds ? esc(count(h.holds)) : "", errs], text: `${h.event} ${h.name} ${h.file} ${h.matcher}` };
}

/** The hooks that hold first, then the others by event; the events with one hook fold into Other, where each row names its event. */
function listView(d) {
  const holding = d.hooks.filter((h) => h.holds).sort((a, b) => b.holds - a.holds), events = [...Map.groupBy(d.hooks.filter((h) => !h.holds), (h) => h.event)];
  const shared = events.filter(([, hs]) => hs.length > 1), lone = events.filter(([, hs]) => hs.length === 1).map(([, hs]) => hs[0]);
  const none = ["", "", ""], n = (k) => count(d.holds.filter((h) => h.out === k).length);
  const groups = [
    { title: "Hold", count: count(holding.length), heads: ["Outcomes", "Holds", "Errors"], rows: holding.map((h) => hookRow(h, d, true)) },
    ...shared.map(([e, hs]) => ({ title: e, count: count(hs.length), heads: none, rows: hs.map((h) => hookRow(h, d, false)) })),
    { title: "Other", count: count(lone.length), heads: none, rows: lone.map((h) => hookRow(h, d, true)) },
  ].filter((g) => g.rows.length);
  return `<div class="hkkey">${factsLine([[count(d.holds.length), "holds"], [n("caught"), "caught"], [n("false"), "false"], [n("no effect"), "no effect"]])}${legendHtml(OUTS.map(([, name, cls]) => [name, cls]))}${guide(d.byHook)}</div>` +
    browse({ id: "hooks", label: "Hooks", search: "Search hooks", filters: [{ label: "Workers", name: "workers", options: ["runs", "skips"] }], groups });
}

/** The inspector of one hold: its outcome, its session and the hook's reply. */
const inspectHold = (x) => inspector({
  id: x.sid.slice(0, 8), title: `${x.hook} · ${kindName(x.kind)}`, status: statusRow(tag(x.out, OUTS.find((o) => o[0] === x.out)[3]), x.who === "interactive" ? "" : chip(x.who), ""),
  rows: [["When", esc(when(x.t))], ["Session", idLink(x.sid.slice(0, 8), sessionHref(x.sid))], ["Who", esc(x.who)]], body: `${subHead("Reason")}<p>${esc(x.why)}</p>`, href: sessionHref(x.sid),
});

/** A Langfuse read of `calls` (null while it runs) drawn by `draw`, or the line of why it has nothing. */
const callsBody = (c, draw) => !c ? empty("Loading") : c.langfuse === "off" ? empty("Langfuse off") : c.langfuse === "error" ? error("The calls did not load.", { detail: c.error }) : draw(c);

/** The hooks Langfuse saw run and the verify gate's denials, as the Sessions page had them. */
const gateCards = (c) => `<div class="pair">${card("Hooks", callsBody(c, ({ hooks }) => hooks.length
  ? dataTable(heads(["Hook", "Calls", "Errors", "Last Call"], ["Calls", "Errors", "Last Call"]), hooks.map((h) => row([cell(h.name, { wide: true }), cell(count(h.calls), { num: true }), badCount(h.errors), `<td class="time">${esc(when(h.lastAt))}</td>`])).join(""))
  : empty()))}${card("Verify-Gate Denials", callsBody(c, ({ denials }) => denials.recent.length
  ? dataTable(heads(["Denied", "Reason"]), denials.recent.map((r) => row([`<td class="time lead">${esc(when(r.at))}</td>`, cell(r.reason, { wide: true })])).join(""))
  : empty()), { count: c?.langfuse === "ok" ? count(c.denials.total) : undefined, label: "Verify-gate denials" })}</div>`;

const LOG = 50; // holds a hook's group draws; the group's count is all of them

/** One group per hook that held, its holds newest first, then the Langfuse calls and denials. */
function holdsView(d) {
  const groups = [...Map.groupBy(d.holds, (x) => x.hook)].sort((a, b) => b[1].length - a[1].length).map(([hook, xs]) => {
    // The kind most of the hook's holds have is its default, so a row names only another kind.
    const usual = [...Map.groupBy(xs, (x) => x.kind)].sort((a, b) => b[1].length - a[1].length)[0][0];
    return {
      title: hook, count: count(xs.length), heads: ["", "Outcome"], cap: LOG,
      rows: xs.map((x) => ({
        key: `${x.t}/${x.sid}`, lead: `<span class="idp">${esc(when(x.t))}</span>`, inspect: () => inspectHold(x), data: { out: x.out, who: x.who },
        main: `<span class="t" title="${esc(x.why)}">${esc(x.why)}</span>${x.kind !== usual ? chip(kindName(x.kind)) : ""}`,
        cells: [x.who === "interactive" ? "" : chip(x.who), tag(x.out, OUTS.find((o) => o[0] === x.out)[3])], text: `${x.sid} ${x.hook} ${x.kind} ${x.why}`,
      })),
    };
  });
  const who = (k) => count(d.holds.filter((h) => (k === "interactive") === (h.who === "interactive")).length);
  return factsLine([[count(d.holds.length), "holds"], [who("interactive"), "interactive"], [who("workers"), "workers"]]) +
    browse({ id: "holds", label: "Holds", search: "Search holds", filters: [{ label: "Outcome", name: "out", options: OUTS.map(([k]) => k) }, { label: "Who", name: "who", options: [...new Set(d.holds.map((x) => x.who))].sort() }], groups }) + gateCards(d.calls);
}

function errorsView(d) {
  const n = d.errors.reduce((s, e) => s + e.n, 0);
  const groups = d.errors.map((e) => ({
    title: e.cause, count: count(e.n), heads: ["Events"],
    more: `${e.fix ? `Fix: ${esc(e.fix)}` : "No fix"} · ${esc(plural(e.sessions, "session"))} · last ${esc(when(e.last))}`,
    rows: hooksOf(e).map((name) => {
      // A hook the cause names but hooks.json does not hold is gone: its file moved or the hook was cut.
      const own = d.hooks.filter((h) => h.name === name && hit(e, name, h.event)), gone = !d.hooks.some((h) => h.name === name), events = gone ? e.pairs.filter((x) => x.hook === name).map((x) => x.event) : own.map((h) => h.event);
      return {
        key: `${e.cause}/${name}`, lead: "", text: `${e.cause} ${name} ${events.join(" ")}`,
        main: `<span class="t">${esc(name)}</span>${gone ? tag("not in hooks.json", "need") : ""}`, cells: [esc(events.join(", "))],
        inspect: inspector({
          id: e.cause, title: name, href: own[0] ? hookHref(own[0]) : "#/hooks",
          rows: [["Errors", esc(count(e.n))], ["Sessions", esc(count(e.sessions))], ["Last", esc(when(e.last))], ["Fix", e.fix ? esc(e.fix) : miss("none")], ["Events", esc(events.join(", "))]],
          body: `${subHead("Same Cause")}${chips(hooksOf(e).filter((x) => x !== name))}`,
        }),
      };
    }),
  }));
  return factsLine([[count(n), "errors"], [count(d.errors.length), "causes"], [count(d.errors.filter((e) => e.fix).length), "with a fix"]]) + browse({ id: "errors", label: "Errors", search: "Search errors", groups });
}

export const renderHooks = (d, q) => pageViews({ title: "Hooks", path: "/hooks", query: q, views: [
  { id: "list", label: "List", scope: true, draw: () => listView(d) },
  { id: "holds", label: "Holds", scope: true, draw: () => holdsView(d) },
  { id: "errors", label: "Errors", scope: true, draw: () => errorsView(d) },
] });

/** Set the log's filters and page in the address and draw again. */
const go = (changes) => { setQuery(changes); redraw(); };

/** Draws the Holds by Day chart and wires the log's filters, its pager and the Show buttons that set its filters. */
function mountHook(root, d, q) {
  scope().wire(root);
  const el = root.querySelector("aleph-chart");
  if (el) el.frame = holdsFrame(d.holds, scope(q).window);
  root.onclick = (e) => {
    const b = e.target.closest?.("button");
    if (b?.matches("#holds .seg button")) return go({ [b.parentElement.dataset.name]: b.dataset.value, page: "" });
    if (b?.matches("#holds button[data-page]")) return go({ page: b.dataset.page });
    if (b?.dataset.kind === undefined) return;
    go({ who: "", out: "", page: "", kind: b.dataset.kind });
    root.querySelector("#holds")?.scrollIntoView({ behavior: "smooth" });
  };
  root.onchange = (e) => { if (e.target.matches?.("#holds select")) go({ [e.target.name]: e.target.value, page: "" }); };
}

const hookView = {
  path: "/hooks/:event/:name",
  title: "Hook",
  group: "claude",
  api: (p, q = new URLSearchParams()) => { const s = scope(q); return s.url(`/api/hooks/${encodeURIComponent(p.event)}/${encodeURIComponent(p.name)}?window=${s.window}`); },
  render: (d, _params, q) => renderHook(d, q),
  mount: mountHook,
};

/** One hook's page: its facts, its holds (outcomes, kinds, days, log), its errors and its source, one fold per file. */
export function renderHook(d, q) {
  const xs = d.holds;
  return `<div class="page dp-page">${crumb("#/hooks", [["hooks", "#/hooks"], [d.event], [d.name]])}` +
    pageHead(d.name, { aside: scope(q).bar() }) +
    facts([["Event", esc(d.event)], ["Matcher", d.matcher ? codeText(`\`${d.matcher}\``) : miss("matches all")], ["Command", codeText(`\`${d.command}\``)],
      ["Mode", d.mode ? esc(d.mode) : miss("sync by default")], ["Timeout", dur(d.timeout)], ["Workers", workers(d)]]) +
    (xs.length ? renderKpis([{ k: "Holds", v: count(xs.length) }, ...outcomes(xs).filter(([, , n]) => n).map(([, k, n]) => ({ k, v: count(n) }))]) +
      detailPanel("Holds by Kind", count(d.byKind.length) + guide(d.byKind), holdsBy(d.byKind)) +
      perDay(xs, q, `hooks/${d.event}/${d.name}`) +
      holdsLog(xs, q, detailPanel) : "") +
    (d.errors.length ? detailPanel("Errors", count(d.errors.reduce((s, e) => s + e.n, 0)), errorsTable(d.errors)) : "") +
    detailPanel("Source", count(d.source.length), !d.source.length ? empty("The whole CLI") : d.source.map((s) =>
      fold(`<code>${esc(s.file)}</code> <span class="quiet">${count(s.text.split("\n").length)} lines</span>`, `<div class="md"><pre>${esc(s.text)}</pre></div>`)).join("")) +
    `</div>`;
}

export const views = [view, hookView];
