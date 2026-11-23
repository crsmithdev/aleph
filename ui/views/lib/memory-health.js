// The Health view and the Needs-you strip of the Memory page. `m` is /api/memory with `steps` and `decay` (/api/memory/processes)
// and `rows` (/api/memory/log). Offered: the recall hook or `aleph memory recall` returned the note to an agent.
// Offer dates start when the recall log does, so a note written before the first one may be unused or unrecorded.
import { noteHref } from "../../../lib/naming.ts";
import { count, day, localMs, plural, when } from "./format.js";
import { barList, barRow, card, cell, chip, dataTable, empty, esc, facts, heads, meter, miss, row, rowAct, subHead, tag } from "./html.js";
import { figureBand } from "./page.js";
import { panelOf } from "./chart.js";

const DAY = 86_400_000;
export const link = (title) => `<a href="${noteHref(title)}">${esc(title)}</a>`;
export const shortDay = (s) => (s ? day(localMs(String(s).slice(0, 10))) : "");
const tab = (t) => `#/memory?view=${t}`;
/** Whether recall offered note `n` in the 7 days before `now`. */
export const offered = (n, now = Date.now()) => !!n.read && now - localMs(n.read) <= 7 * DAY;
/** The local day of a log row: a recall's `at` is a day, a write's an ISO time. */
export const dayOf = (at) => (at.length === 10 ? at : new Date(at).toLocaleDateString("en-CA"));
/** The local day `n` days before today. */
export const daysBack = (n, now = Date.now()) => new Date(now - n * DAY).toLocaleDateString("en-CA");
/** True for a log row that wrote an episode page, not a note. */
export const isEpisode = (r) => r.kind === "write" && r.why.startsWith("episode of");

/** Note writes in the 7 days to today, and the median and range of the three 7-day sums before them. */
export function writeWeeks(rows, now = Date.now()) {
  const days = rows.filter((r) => r.kind === "write" && !isEpisode(r)).map((r) => dayOf(r.at));
  const sum = (w) => days.filter((d) => d > daysBack(7 * w + 7, now) && d <= daysBack(7 * w, now)).length;
  const [week, ...before] = [0, 1, 2, 3].map(sum), sorted = [...before].sort((a, b) => a - b);
  return { week, median: sorted[1], lo: sorted[0], hi: sorted[2] };
}

/** The cut core lines, the refusals, the unoffered reads and the notes far past their re-check, each only over its act-threshold: `[key, tone, text, href, tip]`. */
export function needList(m) {
  const cut = Object.values(m.start ?? {}).reduce((n, s) => n + s.cut, 0), refused = m.lint?.refuse.length ?? 0;
  const unoffered = m.misses?.unoffered_reads ?? 0, late = (m.processes?.decay.stale ?? []).filter((s) => s.over > 30).length;
  // prettier-ignore
  const items = [
    [cut > 0, "start", "need", `${plural(cut, "core line")} cut`, tab("health"), "Shows when a core line is cut from a start context."],
    [refused > 0, "refused", "error", `${plural(refused, "note")} refused`, tab("health"), "Shows when lint refuses a note."],
    [unoffered > 10, "reads", "need", `${count(unoffered)} reads nobody offered`, tab("health"), "Shows when more than 10 wiki reads in 7 days had no offer in their turn."],
    [late > 0, "re-check", "need", `${plural(late, "note")} over 30 d late`, tab("health"), "Shows when a note is more than 30 days past its re-check date."],
  ].filter(([on]) => on);
  return items.map(([, ...item]) => item);
}

/** The links of `needList(m)`. */
export const needItems = (m) => needList(m).map(([k, t, text, href, tip]) => `<a href="${href}" title="${esc(tip)}">${tag(k, t)} ${esc(text)}</a>`);

/**
 * The Needs-you strip of `needItems(m)`; nothing when none is over its threshold.
 * @design needs-you-strip
 */
export function needs(m, now = Date.now()) {
  const items = needItems(m);
  return items.length ? `<div class="mstrip" role="status"><b>Needs you</b>${items.join("")}</div>` : "";
}

/** The share of its budget at which the Start Context card marks a start context as full. */
const FULL = 0.95;
const B = (n) => `${count(n)} B`;

/** How to clear each lint rule; another rule shows no fix. */
const FIX = {
  stale: "re-check the note, then update its date", "relative-date": "replace “today” with the date",
  template: "add a claim, an as-of marker or a section", dangling: "fix or remove the link", untracked: "put it through aleph memory write",
};

/** The frame of note writes and recalls per local day over the last `n` days, oldest first. An episode page is no note write: a regeneration writes thousands in a day. */
export function flowFrame(rows, now = Date.now(), n = 14) {
  const per = (keep) => Map.groupBy(rows.filter(keep), (r) => dayOf(r.at));
  const writes = per((r) => r.kind === "write" && !isEpisode(r)), recalls = per((r) => r.kind === "recall");
  return {
    measure: { name: "Writes and Recalls", unit: "count", agg: "sum" }, over: { kind: "time", window: "month" },
    by: { keys: [{ key: "writes", name: "writes" }, { key: "recalls", name: "recalls" }] },
    rows: Array.from({ length: n }, (_, i) => daysBack(n - 1 - i, now)).map((d) => ({ at: localMs(d), writes: writes.get(d)?.length ?? 0, recalls: recalls.get(d)?.length ?? 0 })),
  };
}

/** The lint findings by rule, most first: `{ rule, n, refused, notes }`. */
const rulesOf = (lint) => [...Map.groupBy([...lint.refuse.map((f) => ({ ...f, refused: true })), ...lint.warn], (f) => f.rule)]
  .map(([rule, fs]) => ({ rule, n: fs.length, refused: fs.some((f) => f.refused), notes: [...new Set(fs.map((f) => f.note))], detail: fs[0].detail }))
  .sort((a, b) => b.n - a.n);

const noteLink = (title) => `<td class="wide" title="${esc(title)}">${link(title)}</td>`;
const scopeChip = (s) => (s && s !== "aleph" ? chip(s) : "");

/** The memory steps of the tick: a result of "ok" is quiet, a failure is a badge with its detail, another result shows its detail. */
const jobsCard = (steps) => card("Memory Jobs", dataTable(heads(["Job", "Runs", "Last", "Next", "Result"]), steps.map((x) => row([
  `<td title="${esc(x.does)}">${esc(x.name)}</td>`, cell(x.runs), `<td class="time">${x.last ? esc(when(x.last)) : miss("Never run")}</td>`, `<td class="time">${x.next ? esc(when(x.next)) : miss("Not scheduled")}</td>`,
  !x.result ? `<td>${miss("No result")}</td>` : x.result === "ok" ? `<td class="quiet">ok</td>` : x.result.startsWith("failed") ? `<td>${tag("failed", "error", x.detail ?? undefined)}</td>` : cell(x.detail ?? x.result, { wide: true, title: x.result }),
])).join("")), { count: count(steps.length) });

/** The Health view: the figure band, the charts 2 across, the memory jobs, then the lint fixes and the stale notes. The flow chart's frame is set in mount. */
export function renderHealth(m, now = Date.now()) {
  const notes = m.notes ?? [], ms = m.misses, s = m.start.aleph, stale = m.decay?.stale ?? [], w = writeWeeks(m.rows ?? [], now);
  const used = notes.filter((n) => offered(n, now)).length, never = notes.filter((n) => !n.read).length, rules = rulesOf(m.lint);
  const found = rules.reduce((n, r) => n + r.n, 0), refused = m.lint.refuse.length;
  const figs = figureBand([
    { k: "Start Context", v: B(s.bytes), cmp: `${B(s.budget - s.bytes)} left of ${B(s.budget)}`, trend: s.bytes >= FULL * s.budget ? "warn" : "good" },
    { k: "Offered, 7 Days", v: count(used), cmp: `of ${count(notes.length)} notes` },
    { k: "Lint", v: count(found), cmp: `${count(refused)} refused`, trend: refused ? "warn" : "good" },
    { k: "Writes, 7 Days", v: count(w.week), cmp: `median week ${count(w.median)}` },
  ]);

  const offers = notes.length ? barList([["Offered, 7 days", used], ["Earlier", notes.length - used - never], ["Never", never]].map(([k, v]) => barRow(esc(k), (v / notes.length) * 100, count(v))).join("")) : empty();
  const quality = ms ? facts([["Recalls", `${count(ms.recalls)} in ${count(ms.days)} days`], ["Empty", count(ms.empty)], ["Reformulated", count(ms.reformulated)], ["Unoffered reads", count(ms.unoffered_reads)]]) : "";
  const start = barList(Object.entries(m.start).map(([k, x]) => barRow(esc(k), 0, `${B(x.bytes)} / ${B(x.budget)}`, { bar: meter((x.bytes / x.budget) * 100, `${k} ${B(x.bytes)} of ${B(x.budget)}`, { mark: FULL * 100 }) })).join("")) +
    subHead("Largest Core Lines") + dataTable(heads(["Core line", "Scope", "Bytes"], ["Bytes"]), [...s.core].sort((a, b) => b.bytes - a.bytes).slice(0, 5).map((c) => row([noteLink(c.title), `<td>${scopeChip(c.scope)}</td>`, cell(B(c.bytes), { num: true })])).join("")) +
    // A restore sets the core line back through vault write, which demotes the oldest line again if this one does not fit.
    subHead("Demoted") + (s.demoted?.length ? dataTable(heads(["Core line", "By", "Day", "Action"]), s.demoted.map((d) => row([noteLink(d.title), cell(d.by), cell(shortDay(d.on)),
      rowAct("Restore", { act: "restore", label: "Restore", name: d.title, path: `/api/memory/notes/${encodeURIComponent(d.title)}/core`, body: JSON.stringify({ core: d.core }) })])).join("")) : empty());
  const most = Math.max(1, ...rules.map((r) => r.n));
  const lint = rules.length ? barList(rules.map((r) => barRow(`<code>${esc(r.rule)}</code>${r.refused ? ` ${tag("refused", "error")}` : ""}`, 0, count(r.n), { bar: meter([{ pct: (r.n / most) * 100, cls: r.refused ? "c-err" : "" }], `${r.rule} ${r.n}`) })).join("")) : empty();
  const fixes = rules.length ? dataTable(heads(["Rule", "Fix", "Notes"]), rules.map((r) => row([`<td><code>${esc(r.rule)}</code></td>`, cell(FIX[r.rule] ?? r.detail, { wide: true }), cell(r.notes.join(", "), { wide: true, title: r.notes.join("\n") })])).join("")) : empty();
  const late = stale.slice(0, 8), lates = late.length ? dataTable(heads(["Note", "Window", "Over"], ["Window", "Over"]), late.map((x) => row([
    `<td class="wide" title="${esc(x.detail)}">${link(x.note)}</td>`, cell(`${count(x.window)} d`, { num: true }), cell(`+${count(x.over)} d`, { num: true }),
  ])).join("")) : empty();

  return `${figs}<div class="pair">${panelOf("memory/flow", flowFrame(m.rows ?? [], now))}${card("Offers", offers + quality, { aside: `of ${count(notes.length)} notes` })}</div>` +
    `<div class="pair">${card("Start Context", start, { aside: `line at ${Math.round(FULL * 100)}%` })}${card("Lint by Rule", lint, { count: count(found) })}</div>` +
    `${jobsCard(m.steps)}<div class="pair">${card("Lint Fixes", fixes, { count: count(rules.length) })}${card("Stale Notes", lates, { count: count(stale.length), aside: stale.length > late.length ? `${count(late.length)} most late` : "" })}</div>`;
}
