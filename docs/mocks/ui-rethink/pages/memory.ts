// The Memory page: Notes (one type at a time, in pages, the inspector at the right), Health (a figure band, the charts
// 2 across, then their tables and the Memory Jobs that left Automation) and Log (the memory log as a list). README, Pages.
import { MEMORY_TYPES } from "../../../../lib/naming.ts";
import { badge, barList, barRow, card, cell, chip, dataTable, esc, facts, filterBar, heads, meter, miss, pager, row, searchBox, statusRow, subHead, tag } from "../../../../ui/views/lib/html.js";
import { count, day, dur, localMs, when } from "../../../../ui/views/lib/format.js";
import { band, charts, columns, factsLine, inspector, legend, list, LIVE, now, rows, type Data, type Group, type Page, type Row, type Series } from "../kit.ts";

/** The share of its budget at which a start context needs Chris, as the memory row of docs/mocks/status-redesign has it. */
const FULL = 0.95;
const DAY = 86_400_000;
/** How to clear each lint rule, as the live Lint card says it (ui/views/lib/memory-health.js, FIX). */
const FIX: Record<string, string> = {
  stale: "re-check the note, then update its date", "relative-date": "replace “today” with the date",
  template: "add a claim, an as-of marker or a section", dangling: "fix or remove the link", untracked: "put it through aleph memory write",
};

/** A local day, from a date or an ISO time, in the snapshot's year. */
const date = (s: string, d: Data) => (s ? day(s.length > 10 ? Date.parse(s) : localMs(s), new Date(now(d))) : "");
/** The lint findings and the refused ones among them. */
const lintCounts = (d: Data) => {
  const lint = d.memory.lint, sum = (xs: any[]) => xs.reduce((n, l) => n + l.n, 0);
  return { found: sum(lint), refused: sum(lint.filter((l: any) => l.refused)) };
};
const offers = (it: any) => (it.history ?? []).reduce((n: number, x: number) => n + x, 0);
/** The live link of a memory: a note or a day has its own page; a rule or a handoff opens selected on Notes. */
const href = (it: any) => `${LIVE}${it.href ?? `#/memory?item=${encodeURIComponent(`${it.source}:${it.key}`)}`}`;
/** A scope chip, with no chip for the default scope `aleph` (README, Decision 6). */
const scope = (s: string) => (s && s !== "aleph" ? chip(s) : "");
/** The words of a note's state, as the live inspector has them: offered in 7 days, earlier, or never. */
const state = (it: any, d: Data) => (!it.read ? "never offered" : now(d) - localMs(it.read) <= 7 * DAY ? "in use" : "stale");

/** Offers per day over the snapshot's 30 days; the axis names only its ends. */
function offerChart(it: any, d: Data) {
  const h: number[] = it.history ?? [], T = now(d);
  if (!h.some(Boolean)) return "";
  const labels = h.map((_, i) => (i === 0 || i === h.length - 1 ? date(new Date(T - (h.length - 1 - i) * DAY).toISOString(), d) : ""));
  return `${subHead("Offers, 30 Days")}${columns(labels, [{ name: "offers", color: "series-1", values: h }], { h: 96 })}`;
}

/** The inspector of one memory: its type and source, its facts, its text, how it reaches the agent, and its offers. */
function inspectNote(it: any, d: Data) {
  const type = MEMORY_TYPES.find((t) => t.id === it.type)!.name, note = it.source === "note";
  const kv: [string, string][] = [
    ["Kind", esc(it.kind ?? "")], ["Scope", esc(it.scope)], ["Written", esc(date(it.at, d))],
    ["Last offered", note ? esc(it.read ? date(it.read, d) : "never") : ""], ["Offers", note && offers(it) ? `${count(offers(it))} in 30 days` : ""],
  ];
  const body = `<p class="rt-clip">${esc(it.text)}</p><div class="mreach rt-memory-reach">${subHead("Reaches the Agent")}<p>${esc(it.effect)}</p></div>${note ? offerChart(it, d) : ""}`;
  return inspector({ id: `${type} · ${it.source}`, title: it.title, status: note ? statusRow(badge(state(it, d)), "", "") : "", rows: kv, body, href: href(it) });
}

/** Each type's row: the title, a scope chip, and the cells its type has (README, Notes). */
// prettier-ignore
const LAYOUT: Record<string, { heads: string[]; cells: (it: any, d: Data) => string[]; more?: (it: any) => string }> = {
  semantic:   { heads: ["Offers", "Offered", "Written"], cells: (it, d) => [offers(it) ? count(offers(it)) : "", it.read ? esc(date(it.read, d)) : `<span class="quiet">never</span>`, esc(date(it.at, d))] },
  procedural: { heads: ["Updated"], cells: (it, d) => [esc(date(it.at, d))] },
  episodic:   { heads: [], cells: () => [], more: (it) => `<span class="quiet">${esc(it.text)}</span>` },
  working:    { heads: ["Age"], cells: (it, d) => [esc(dur((now(d) - Date.parse(it.at)) / 1000))] },
};

const noteRow = (it: any, d: Data): Row => ({
  key: `${it.source}:${it.key}`, lead: "", inspect: inspectNote(it, d), data: { type: it.type },
  main: `<span class="t" title="${esc(it.title)}">${esc(it.title)}</span>${scope(it.scope)}${LAYOUT[it.type].more?.(it) ?? ""}`,
  cells: LAYOUT[it.type].cells(it, d), text: `${it.title} ${it.text} ${it.scope} ${it.kind ?? ""}`,
});

/**
 * The Notes surface: the kit's list surface with a Type filter that has no All, so one type shows at a time. Each type's
 * rows and pager wait in a block that the pressed type shows (STYLE); mock.js filters the rows inside it.
 */
function notesList(d: Data) {
  const M = d.memory, types = MEMORY_TYPES.filter((t) => M.notes[t.id]);
  const blocks = types.map((t, i) => {
    const xs = M.notes[t.id], group: Group = { title: t.name, count: count(M.types[t.id]), heads: LAYOUT[t.id].heads, rows: xs.map((it: any) => noteRow(it, d)) };
    // A page is what the snapshot holds of the type: 28 semantic notes, 8 of each other type.
    return { group, html: `<div class="rt-memory-type" data-type="${t.id}">${rows([group], { select: i === 0 })}${pager(1, M.types[t.id], xs.length)}</div>` };
  });
  const bar = searchBox("rt-notes", "", "Search memory") + filterBar([{ label: "Type", name: "type", value: types[0].id, options: types.map((t) => ({ value: t.id, label: t.name })) }]);
  const all = blocks.flatMap((b) => b.group.rows);
  return `<div class="browse rt-browse">${card("", bar + blocks.map((b) => b.html).join(""), { label: "Notes", cls: "rt-list rt-memory-notes" })}<aside class="card ins rt-ins" aria-label="Inspector">${all[0].inspect}</aside></div>` +
    all.map((r) => `<template data-inspect="${esc(r.key)}">${r.inspect}</template>`).join("");
}

/** One block per type shows only while its Type button is pressed. */
const STYLE = (types: string[]) => `<style>.rt-memory-type { display: none; }
${types.map((t) => `.rt-memory-notes:has([data-name="type"] [data-value="${t}"][aria-pressed="true"]) .rt-memory-type[data-type="${t}"]`).join(",\n")} { display: block; }
.rt-memory-type .pager { padding: var(--sp-6) var(--sp-8) 0; border-top: 1px solid var(--rule-2); }
.rt-memory-reach { margin: 0; }
.rt-memory-reach p { margin: var(--sp-4) 0 0; }</style>`;

function notesView(d: Data) {
  const M = d.memory;
  return STYLE(MEMORY_TYPES.filter((t) => M.notes[t.id]).map((t) => t.id)) +
    factsLine([[count(M.total), "notes"], [count(M.offered), "offered in 7 days"], [count(M.never), "never offered"], [count(M.staleTotal), "past re-check"]]) + notesList(d);
}

/** Note writes and recalls over the snapshot's 14 days: the last 7 and the 7 before. */
function weeks(d: Data) {
  const w = d.memory.writes, sum = (xs: any[]) => xs.reduce((n, x) => n + x.writes, 0);
  return { week: sum(w.slice(-7)), before: sum(w.slice(-14, -7)) };
}

function healthView(d: Data) {
  const M = d.memory, s = M.start.aleph, w = weeks(d), T = new Date(now(d));
  const { found, refused } = lintCounts(d);
  const B = (n: number) => `${count(n)} B`;
  const figs = band([
    { k: "Start Context", v: B(s.bytes), cmp: `${B(s.budget - s.bytes)} left of ${B(s.budget)}`, trend: s.bytes >= FULL * s.budget ? "warn" : "good" },
    { k: "Offered, 7 Days", v: count(M.offered), cmp: `of ${count(M.total)} notes` },
    { k: "Lint", v: count(found), cmp: `${count(refused)} refused`, trend: refused ? "warn" : "good" },
    { k: "Writes, 7 Days", v: count(w.week), cmp: `${count(w.before)} the week before` },
  ]);

  const flow: Series[] = [{ name: "writes", color: "series-1", values: M.writes.map((x: any) => x.writes) }, { name: "recalls", color: "series-2", values: M.writes.map((x: any) => x.recalls) }];
  const dayNo = M.writes.map((x: any) => String(new Date(x.at).getDate()));
  const earlier = M.total - M.offered - M.never, ms = M.misses;
  const offered = barList([["Offered, 7 days", M.offered], ["Earlier", earlier], ["Never", M.never]].map(([k, v]) => barRow(esc(k), ((v as number) / M.total) * 100, count(v))).join("")) +
    facts([["Recalls", `${count(ms.recalls)} in ${count(ms.days)} days`], ["Empty", count(ms.empty)], ["Reformulated", count(ms.reformulated)], ["Unoffered reads", count(ms.unoffered_reads)]]);
  const core = [...s.core].sort((a: any, b: any) => b.bytes - a.bytes).slice(0, 5);
  const start = barList(Object.entries<any>(M.start).map(([k, x]) => barRow(esc(k), 0, `${B(x.bytes)} / ${B(x.budget)}`, { bar: meter((x.bytes / x.budget) * 100, `${k} ${B(x.bytes)} of ${B(x.budget)}`, { mark: FULL * 100 }) })).join("")) +
    subHead("Largest Core Lines") + dataTable(heads(["Core line", "Scope", "Bytes"], ["Bytes"]), core.map((c: any) => row([
      `<td class="wide" title="${esc(c.title)}"><a href="${LIVE}#/memory/${encodeURIComponent(c.title)}">${esc(c.title)}</a></td>`, `<td>${scope(c.scope)}</td>`, cell(B(c.bytes), { num: true }),
    ])).join(""));
  const lintMost = Math.max(...M.lint.map((l: any) => l.n));
  const lint = barList(M.lint.map((l: any) => barRow(`<code>${esc(l.rule)}</code>${l.refused ? ` ${tag("refused", "error")}` : ""}`, 0, count(l.n), { bar: meter([{ pct: (l.n / lintMost) * 100, cls: l.refused ? "c-err" : "" }], `${l.rule} ${l.n}`) })).join(""));

  const jobs = dataTable(heads(["Job", "Runs", "Last", "Next", "Result"]), M.steps.map((x: any) => row([
    `<td title="${esc(x.does)}">${esc(x.name)}</td>`, cell(x.runs), `<td class="time">${esc(when(x.last, T))}</td>`, `<td class="time">${esc(when(x.next, T))}</td>`,
    x.result === "ok" ? `<td class="quiet">ok</td>` : cell(x.detail ?? x.result, { wide: true, title: x.result }),
  ])).join(""));
  const fixes = dataTable(heads(["Rule", "Fix", "Notes"]), M.lint.map((l: any) => row([`<td><code>${esc(l.rule)}</code></td>`, FIX[l.rule] ? cell(FIX[l.rule]) : `<td>${miss("no known fix")}</td>`, cell(l.notes.join(", "), { wide: true, title: l.notes.join("\n") })])).join(""));
  const stale = dataTable(heads(["Note", "Window", "Over"], ["Window", "Over"]), M.stale.map((x: any) => row([
    `<td class="wide" title="${esc(x.detail)}"><a href="${LIVE}#/memory/${encodeURIComponent(x.note)}">${esc(x.note)}</a></td>`, cell(`${count(x.window)} d`, { num: true }), cell(`+${count(x.over)} d`, { num: true }),
  ])).join(""));

  return figs + charts([
    card("Writes and Recalls", columns(dayNo, flow), { aside: legend(flow) }),
    card("Offers", offered, { aside: `of ${count(M.total)} notes` }),
    card("Start Context", start, { aside: `line at ${Math.round(FULL * 100)}%` }),
    card("Lint by Rule", lint, { count: count(found) }),
  ]) + card("Memory Jobs", jobs, { count: count(M.steps.length) }) + charts([
    card("Lint Fixes", fixes, { count: count(M.lint.length) }),
    card("Stale Notes", stale, { count: count(M.staleTotal), aside: `${count(M.stale.length)} most late` }),
  ]);
}

/** The inspector of one log row: what happened to which note, and why, or the query and the notes it returned. */
function inspectLog(r: any, d: Data) {
  const recall = r.kind === "recall", link = (t: string) => `<a href="${LIVE}#/memory/${encodeURIComponent(t)}">${esc(t)}</a>`;
  const back = recall && r.titles.length ? `${subHead("Returned")}<ul>${r.titles.map((t: string) => `<li>${link(t)}</li>`).join("")}</ul>` : "";
  const at = r.at.length > 10 ? when(r.at, new Date(now(d))) : date(r.at, d);
  return inspector({ id: r.op, title: r.note, rows: [["When", esc(at)], ["Returned", recall ? esc(count(r.titles.length)) : ""]], body: `${subHead(recall ? "Query" : "Why")}<p class="rt-clip">${esc(r.why)}</p>${back}`, href: `${LIVE}#/memory?tab=log` });
}

function logView(d: Data) {
  const L = d.memory.log, recalls = L.filter((r: any) => r.kind === "recall").length;
  // The recall log keeps a day, a write its time: the lead is the time of a write, blank for a recall.
  const time = (r: any) => (r.at.length > 10 ? new Date(r.at).toTimeString().slice(0, 5) : "");
  const logRow = (r: any, i: number): Row => ({
    key: `log-${i}`, lead: `<span class="idp">${esc(time(r))}</span>`, inspect: inspectLog(r, d), data: { kind: r.op },
    main: `<span class="t" title="${esc(r.why)}">${esc(r.note)}</span>${r.titles.length > 1 ? `<span class="quiet">+${count(r.titles.length - 1)}</span>` : ""}`,
    cells: [r.op === "recall" ? `<span class="quiet">recall</span>` : chip(r.op)], text: `${r.note} ${r.why} ${r.op}`,
  });
  const days = [...Map.groupBy(L.map((r: any, i: number) => [r, i] as const), ([r]) => date(r.at, d))];
  const groups: Group[] = days.map(([k, xs]) => ({ title: k, count: count(xs.length), heads: [""], rows: xs.map(([r, i]) => logRow(r, i)) }));
  return factsLine([[count(recalls), "recalls"], [count(L.length - recalls), "writes"]]) +
    list({ label: "Log", search: "Search the log", filters: [{ label: "Kind", name: "kind", options: [...new Set<string>(L.map((r: any) => r.op))] }], groups });
}

export const page: Page = {
  id: "memory", title: "Memory", group: "Claude", order: 6, icon: "brain", route: "memory",
  views: [{ id: "notes", label: "Notes", draw: notesView }, { id: "health", label: "Health", draw: healthView }, { id: "log", label: "Log", draw: logView }],
  attention: (d) => {
    const start = d.memory.start.aleph, { found, refused } = lintCounts(d);
    return [
      ...(start.bytes >= FULL * start.budget ? [{ tone: "need" as const, text: `Start context ${count(start.bytes)} B of ${count(start.budget)} B` }] : []),
      // A refused note is the error tone, as the live Needs-you strip has it (ui/views/lib/memory-health.js).
      ...(refused ? [{ tone: "error" as const, text: `${count(found)} lint findings, ${count(refused)} refused` }] : []),
    ];
  },
};
