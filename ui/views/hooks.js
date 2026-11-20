// The Hooks page: the Stop-hook holds and the hook errors of the scope's window and project, and the hooks of `hooks/hooks.json`.
// `data` is /api/hooks in the scope of the address. The holds log filters by Who, Hook, Kind and Outcome from the address (`?who=workers&out=false`).
// One hook's page, on /api/hooks/:event/:name, draws the same parts.
import { scope, setQuery } from "./lib/address.js";
import { redraw } from "./lib/router.js";
import { count, day, when } from "./lib/format.js";
import { DAY, WINDOWS } from "../../lib/windows.ts";
import { panelOf } from "./lib/chart.js";
import { badCount, card, cell, codeText, crumb, dataTable, empty, esc, facts, filterBar, heads, idLink, legendHtml, meter, miss, note, pageHead, pageOf, pageRows, pager, row, rowAct, statCard, tag, tiles } from "./lib/html.js";
import { detailPanel, renderKpis } from "./lib/timeline.js";

export const view = {
  path: "/hooks",
  title: "Hooks",
  icon: "plug",
  group: "claude",
  order: 2,
  api: (_params, q = new URLSearchParams()) => { const s = scope(q); return s.url(`/api/hooks?window=${s.window}`); },
  render: (d, _params, q) => renderHooks(d, q),
  mount,
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

/** The outcome legend, labelled a guide: the outcomes come from a keyword pass over each hold's reply. */
const legend = legendHtml(OUTS.map(([k, , cls]) => [k, cls])) + note("Guide only");

/** A table of holds by kind, with the outcome as one meter per row; `hookCol` adds the hook. Show sets the log's filters. */
function holdsBy(groups, hookCol = true) {
  if (!groups.length) return empty();
  const rows = groups.map((g) => {
    const n = (k) => g.outcomes[k] ?? 0;
    return row([cell(hookCol ? g.hook : kindName(g.kind)), ...(hookCol ? [cell(kindName(g.kind))] : []), cell(g.holds, { num: true }), cell(g.interactive, { num: true }), cell(g.workers, { num: true }),
      `<td>${meter(OUTS.map(([k, , cls]) => ({ pct: (100 * n(k)) / g.holds, cls })), OUTS.map(([k]) => `${k} ${n(k)}`).join(", "))}</td>`,
      ...OUTS.map(([k]) => cell(n(k) || "", { num: true })), rowAct("Show", { kind: g.kind, ...(hookCol ? { hook: g.hook } : {}) })]);
  });
  const nums = ["Holds", "Interactive", "Workers", ...OUTS.map((o) => o[1])];
  return legend + dataTable(heads([...(hookCol ? ["Hook"] : []), "Kind", "Holds", "Interactive", "Workers", "Outcome", ...OUTS.map((o) => o[1]), "Action"], nums), rows.join(""));
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
  row([cell(e.cause), cell(e.hooks.join(", "), { wide: true }), cell(e.events.join(", ")), e.fix ? cell(e.fix) : `<td>${miss("no known fix")}</td>`,
    badCount(e.n), cell(e.sessions, { num: true }), `<td class="time">${esc(when(e.last))}</td>`])).join(""));

/** The filters of the holds log from the address. */
const filtersOf = (q) => Object.fromEntries(["who", "hook", "kind", "out"].map((k) => [k, q?.get(k) ?? ""]));
const uniq = (xs) => [...new Set(xs)].sort();

/** The holds log, drawn by `box`, newest first, with its filters from the query `q`; `hookCol` adds the Hook column and filter. */
function holdsLog(holds, q, box, hookCol = true) {
  const f = filtersOf(q);
  const shown = holds.filter((h) => (!f.who || whoOf(h) === f.who) && (!f.hook || h.hook === f.hook) && (!f.kind || h.kind === f.kind) && (!f.out || h.out === f.out));
  const rows = shown.map((h) => {
    const [, , , tone] = OUTS.find((o) => o[0] === h.out);
    return row([`<td class="time lead">${esc(when(h.t))}</td>`, `<td>${idLink(h.sid.slice(0, 8), `#/sessions/${encodeURIComponent(h.sid)}`)}</td>`, ...(hookCol ? [cell(h.hook)] : []),
      cell(kindName(h.kind)), cell(h.who), `<td>${tag(h.out, tone)}</td>`, cell(h.why, { wide: true })]);
  });
  if (!holds.length) return box("Holds", "0", empty(), "holds");
  const page = pageOf(q ?? new URLSearchParams());
  const bar = filterBar([
    { label: "Who", bare: true, name: "who", value: f.who, options: [{ value: "", label: "All" }, { value: "interactive", label: "Interactive" }, { value: "workers", label: "Workers" }] },
    ...(hookCol ? [{ label: "Hook", name: "hook", data: true, value: f.hook, options: [{ value: "", label: "All Hooks" }, ...uniq(holds.map((h) => h.hook))] }] : []),
    { label: "Kind", name: "kind", data: true, value: f.kind, options: [{ value: "", label: "All Kinds" }, ...uniq(holds.map((h) => h.kind)).map((k) => ({ value: k, label: kindName(k) }))] },
    { label: "Outcome", name: "out", data: true, value: f.out, options: [{ value: "", label: "All Outcomes" }, ...OUTS.map(([k, name]) => ({ value: k, label: name }))] },
  ]);
  const table = dataTable(heads(["Time", "Session", ...(hookCol ? ["Hook"] : []), "Kind", "Who", "Outcome", "Reason"]), pageRows(rows, page, PAGE).join(""));
  return box("Holds", count(shown.length), bar + (shown.length ? table + pager(page, shown.length, PAGE) : empty()), "holds");
}

/** The count of each outcome in `holds`, in OUTS order: `[key, label, count]`. */
const outcomes = (holds) => OUTS.map(([k, name]) => [k, name, holds.filter((h) => h.out === k).length]);

export function renderHooks(d, q) {
  const errs = d.errors.reduce((s, e) => s + e.n, 0), n = (k) => count(d.holds.filter((h) => h.out === k).length);
  const inv = d.hooks.map((h) => `<tr class="rowlink">${[cell(h.event), `<td class="wide" title="${esc(h.name)}"><a href="${esc(hookHref(h))}">${esc(h.name)}</a></td>`, `<td>${h.matcher ? codeText(`\`${h.matcher}\``) : miss("matches all")}</td>`,
    `<td>${codeText(`\`${h.file}\``)}</td>`, h.mode ? cell(h.mode) : `<td>${miss("sync by default")}</td>`, cell(h.timeout, { num: true }), cell(h.holds || "", { num: true })].join("")}</tr>`).join("");
  return `<div class="page">` +
    pageHead("Hooks", { aside: scope(q).bar() }) +
    tiles("Metrics", [{ k: "Holds", v: count(d.holds.length) }, { k: "Caught", v: n("caught") }, { k: "False", v: n("false") }, { k: "No Effect", v: n("no effect") }, { k: "Errors", v: count(errs) }].map(statCard).join("")) +
    card("Holds by Hook", holdsBy(d.byHook), { count: count(d.byHook.length) }) +
    perDay(d.holds, q, "hooks/day") +
    card("Errors by Cause", errorsTable(d.errors), { count: count(d.errors.length) }) +
    card("Hooks", !d.hooks.length ? empty() : dataTable(heads(["Event", "Hook", "Matcher", "File", "Mode", "Timeout s", "Holds"], ["Timeout s", "Holds"]), inv),{ count: String(d.hooks.length) }) +
    holdsLog(d.holds, q, asCard) +
    `</div>`;
}

/** Set the log's filters and page in the address and draw again. */
const go = (changes) => { setQuery(changes); redraw(); };

/** Draws the Holds by Day chart and wires the log's filters, its pager and the Show buttons that set its filters. */
function mount(root, d, q) {
  scope().wire(root);
  const el = root.querySelector("aleph-chart");
  if (el) el.frame = holdsFrame(d.holds, scope(q).window);
  root.onclick = (e) => {
    const b = e.target.closest?.("button");
    if (b?.matches("#holds .seg button")) return go({ [b.parentElement.dataset.name]: b.dataset.value, page: "" });
    if (b?.matches("#holds button[data-page]")) return go({ page: b.dataset.page });
    if (b?.dataset.kind === undefined) return;
    go({ who: "", out: "", page: "", kind: b.dataset.kind, ...(b.dataset.hook ? { hook: b.dataset.hook } : {}) });
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
  mount,
};

/** One hook's page: its facts, its holds (outcomes, kinds, days, log) and its errors. */
export function renderHook(d, q) {
  const xs = d.holds;
  return `<div class="page dp-page">${crumb("#/hooks", [["hooks", "#/hooks"], [d.event], [d.name]])}` +
    pageHead(d.name, { aside: scope(q).bar() }) +
    facts([["Event", esc(d.event)], ["Matcher", d.matcher && codeText(`\`${d.matcher}\``)], ["File", codeText(`\`${d.file}\``)], ["Mode", d.mode], ["Timeout", `${d.timeout} s`]]) +
    (xs.length ? renderKpis([{ k: "Holds", v: count(xs.length) }, ...outcomes(xs).filter(([, , n]) => n).map(([, k, n]) => ({ k, v: count(n) }))]) +
      detailPanel("Holds by Kind", count(d.byKind.length), holdsBy(d.byKind, false)) +
      perDay(xs, q, `hooks/${d.event}/${d.name}`) +
      holdsLog(xs, q, detailPanel, false) : "") +
    (d.errors.length ? detailPanel("Errors", count(d.errors.reduce((s, e) => s + e.n, 0)), errorsTable(d.errors)) : "") +
    `</div>`;
}

export const views = [view, hookView];
