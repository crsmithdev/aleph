// The Hooks page: the Stop-hook holds and the hook errors of the scope's window and project, and the hooks of `hooks/hooks.json`.
// `data` is /api/hooks in the scope of the address. The holds log filters by Who, Hook, Kind and Outcome from the address (`?who=workers&out=false`).
// One hook's page, on /api/hooks/:event/:name, draws the same parts.
import { scope, setQuery } from "./lib/address.js";
import { redraw } from "./lib/router.js";
import { count, day, when } from "./lib/format.js";
import { barList, barRow, cell, codeText, crumb, dataTable, empty, esc, facts, filterBar, heads, idLink, legendHtml, meter, note, pageHead, pageOf, pageRows, pager, row, tag } from "./lib/html.js";
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

/** A table of holds by kind, with the outcome as one meter per row; `hookCol` adds the hook. A name sets the log's filters. */
function holdsBy(groups, hookCol = true) {
  if (!groups.length) return empty();
  const rows = groups.map((g) => {
    const n = (k) => g.outcomes[k] ?? 0;
    const show = `<button type="button" class="link" data-kind="${esc(g.kind)}"${hookCol ? ` data-hook="${esc(g.hook)}"` : ""} title="Show these holds">${esc(hookCol ? g.hook : kindName(g.kind))}</button>`;
    return row([`<td>${show}</td>`, ...(hookCol ? [cell(kindName(g.kind))] : []), cell(g.holds, { num: true }), cell(g.interactive, { num: true }), cell(g.workers, { num: true }),
      `<td>${meter(OUTS.map(([k, , cls]) => ({ pct: (100 * n(k)) / g.holds, cls })), OUTS.map(([k]) => `${k} ${n(k)}`).join(", "))}</td>`,
      ...OUTS.map(([k]) => cell(n(k) || "", { num: true }))]);
  });
  const nums = ["Holds", "Interactive", "Workers", ...OUTS.map((o) => o[1])];
  return legend + dataTable(heads([...(hookCol ? ["Hook"] : []), "Kind", "Holds", "Interactive", "Workers", "Outcome", ...OUTS.map((o) => o[1])], nums), rows.join(""));
}

/** The Holds by Day panel: a bar list, oldest first, the largest day marked, its head the day count. */
function perDay(holds) {
  if (!holds.length) return detailPanel("Holds by Day", "0", empty());
  const days = [...Map.groupBy([...holds].reverse(), (h) => day(h.t)).entries()], most = Math.max(...days.map(([, xs]) => xs.length));
  return detailPanel("Holds by Day", count(days.length), barList(days.map(([d, xs]) => barRow(esc(d), (100 * xs.length) / most, String(xs.length), { top: xs.length === most })).join("")));
}

/** Errors by cause, each with its fix. */
const errorsTable = (errors) => !errors.length ? empty() : dataTable(heads(["Cause", "Hooks", "Event", "Errors", "Sessions", "Fix", "Last"], ["Errors", "Sessions"]), errors.map((e) =>
  row([cell(e.cause), cell(e.hooks.join(", "), { wide: true }), cell(e.events.join(", ")),
    cell(e.n, { num: true }), cell(e.sessions, { num: true }), cell(e.fix), `<td class="time">${esc(when(e.last))}</td>`])).join(""));

/** The filters of the holds log from the address. */
const filtersOf = (q) => Object.fromEntries(["who", "hook", "kind", "out"].map((k) => [k, q?.get(k) ?? ""]));
const uniq = (xs) => [...new Set(xs)].sort();

/** The holds log, newest first, with its filters from the query `q`; `hookCol` adds the Hook column and filter. */
function holdsLog(holds, q, hookCol = true) {
  const f = filtersOf(q);
  const shown = holds.filter((h) => (!f.who || whoOf(h) === f.who) && (!f.hook || h.hook === f.hook) && (!f.kind || h.kind === f.kind) && (!f.out || h.out === f.out));
  const rows = shown.map((h) => {
    const [, , , tone] = OUTS.find((o) => o[0] === h.out);
    return row([`<td class="time lead">${esc(when(h.t))}</td>`, `<td>${idLink(h.sid.slice(0, 8), `#/sessions/${encodeURIComponent(h.sid)}`)}</td>`, ...(hookCol ? [cell(h.hook)] : []),
      cell(kindName(h.kind)), cell(h.who), `<td>${tag(h.out, tone)}</td>`, cell(h.why, { wide: true })]);
  });
  if (!holds.length) return detailPanel("Holds", "0", empty(), "holds");
  const page = pageOf(q ?? new URLSearchParams());
  const bar = filterBar([
    { label: "Who", bare: true, name: "who", value: f.who, options: [{ value: "", label: "All" }, { value: "interactive", label: "Interactive" }, { value: "workers", label: "Workers" }] },
    ...(hookCol ? [{ label: "Hook", name: "hook", data: true, value: f.hook, options: [{ value: "", label: "All Hooks" }, ...uniq(holds.map((h) => h.hook))] }] : []),
    { label: "Kind", name: "kind", data: true, value: f.kind, options: [{ value: "", label: "All Kinds" }, ...uniq(holds.map((h) => h.kind)).map((k) => ({ value: k, label: kindName(k) }))] },
    { label: "Outcome", name: "out", data: true, value: f.out, options: [{ value: "", label: "All Outcomes" }, ...OUTS.map(([k, name]) => ({ value: k, label: name }))] },
  ]);
  const table = dataTable(heads(["Time", "Session", ...(hookCol ? ["Hook"] : []), "Kind", "Who", "Outcome", "Reason"]), pageRows(rows, page, PAGE).join(""));
  return detailPanel("Holds", count(shown.length), bar + (shown.length ? table + pager(page, shown.length, PAGE) : empty()), "holds");
}

/** The count of each outcome in `holds`, in OUTS order: `[key, label, count]`. */
const outcomes = (holds) => OUTS.map(([k, name]) => [k, name, holds.filter((h) => h.out === k).length]);

export function renderHooks(d, q) {
  const errs = d.errors.reduce((s, e) => s + e.n, 0), n = (k) => count(d.holds.filter((h) => h.out === k).length);
  const inv = d.hooks.map((h) => row([cell(h.event), `<td><a href="${esc(hookHref(h))}">${esc(h.name)}</a></td>`, `<td>${h.matcher ? codeText(`\`${h.matcher}\``) : ""}</td>`,
    `<td>${codeText(`\`${h.file}\``)}</td>`, cell(h.mode), cell(h.timeout, { num: true }), cell(h.holds || "", { num: true })])).join("");
  return `<div class="page dp-page">` +
    pageHead("Hooks", { aside: scope(q).bar() }) +
    renderKpis([{ k: "Holds", v: count(d.holds.length) }, { k: "Caught", v: n("caught") }, { k: "False", v: n("false") }, { k: "No Effect", v: n("no effect") }, { k: "Errors", v: count(errs) }]) +
    detailPanel("Holds by Hook", count(d.byHook.length), holdsBy(d.byHook)) +
    perDay(d.holds) +
    detailPanel("Errors by Cause", count(d.errors.length), errorsTable(d.errors)) +
    detailPanel("Hooks", String(d.hooks.length), dataTable(heads(["Event", "Hook", "Matcher", "File", "Mode", "Timeout s", "Holds"], ["Timeout s", "Holds"]), inv)) +
    holdsLog(d.holds, q) +
    `</div>`;
}

/** Set the log's filters and page in the address and draw again. */
const go = (changes) => { setQuery(changes); redraw(); };

/** Wires the log's filters, its pager and the names that set its filters. */
function mount(root) {
  scope().wire(root);
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
    facts([["Event", esc(d.event)], ["Matcher", d.matcher ? codeText(`\`${d.matcher}\``) : "all"], ["File", codeText(`\`${d.file}\``)], ["Mode", d.mode || "sync"], ["Timeout", `${d.timeout} s`]]) +
    (xs.length ? renderKpis([{ k: "Holds", v: count(xs.length) }, ...outcomes(xs).filter(([, , n]) => n).map(([, k, n]) => ({ k, v: count(n) }))]) +
      detailPanel("Holds by Kind", count(d.byKind.length), holdsBy(d.byKind, false)) +
      perDay(xs) : "") +
    holdsLog(xs, q, false) +
    detailPanel("Errors", count(d.errors.reduce((s, e) => s + e.n, 0)), errorsTable(d.errors)) +
    `</div>`;
}

export const views = [view, hookView];
