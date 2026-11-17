// Builds index.html from a snapshot of /api/issues (issues.json) with the real kit helpers, so the mock's markup is the UI's.
// Run: bun docs/mocks/issues-refit/build.ts
import { statCard, tiles, cardTrend, dataTable, sortHead, heads, badge, priorityBadge, chips, chip, idLink, card, searchBox, filterBar, cell, pageHead, actButton, field, inputBox, selectBox, esc, tag } from "../../../ui/views/lib/html.js";
import { count, days, dur, money, pct, when } from "../../../ui/views/lib/format.js";

const dir = import.meta.dir;
const { issues: I } = await Bun.file(`${dir}/issues.json`).json();
const DAY = 864e5, t = (s?: string) => Date.parse(s ?? "") || 0;
const at = new Date("2026-11-16T23:59:00-08:00").getTime();
const closed = (r: any) => r.status === "done" || r.status === "dropped";
const inSpan = (a: number, b: number, k: string) => I.filter((r: any) => t(r[k]) >= a && t(r[k]) < b && (k !== "closedTime" || closed(r)));
const backlogAt = (x: number) => I.filter((r: any) => t(r.createdTime) && t(r.createdTime) < x && (!t(r.closedTime) || t(r.closedTime) >= x)).length;
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };

const wk = at - 7 * DAY, wk2 = at - 14 * DAY;
const filed = inSpan(wk, at, "createdTime").length, filedBefore = inSpan(wk2, wk, "createdTime").length;
const shut = inSpan(wk, at, "closedTime"), shutBefore = inSpan(wk2, wk, "closedTime").length;
const active = I.filter((r: any) => r.status === "open"), parked = I.filter((r: any) => r.status === "parked").length;
const backlog = active.length + parked, backlogBefore = backlogAt(wk);
const spans = shut.map((r: any) => (t(r.closedTime) - t(r.createdTime)) / 1000).filter((s: number) => s > 0);
const spansBefore = inSpan(wk2, wk, "closedTime").map((r: any) => (t(r.closedTime) - t(r.createdTime)) / 1000).filter((s: number) => s > 0);
const stages = Object.entries(Object.groupBy(active, (r: any) => r.stage)).map(([k, v]) => `${(v as any[]).length} ${k}`).join(", ");

// One bucket per day of the week shown.
const day0 = new Date(at); day0.setHours(0, 0, 0, 0);
const buckets = Array.from({ length: 7 }, (_, i) => day0.getTime() - (6 - i) * DAY);
const daily = buckets.map((s) => ({ s, label: new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" }), filed: inSpan(s, s + DAY, "createdTime").length, closed: inSpan(s, s + DAY, "closedTime").length, active: 0, parked: 0 }));
// The store keeps no history of parked, so the backlog over time is one series: open or parked at each day's end.
for (const d of daily) d.active = backlogAt(Math.min(d.s + DAY, at));

// ---- Charts: inline SVG with the chart tokens, standing in for <aleph-chart>. ----
const W = 560, H = 200, L = 36, B = 22;
const yAxis = (max: number, h = H) => [0, 0.5, 1].map((f) => { const y = h - B - f * (h - B - 8); return `<line x1="${L}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--rule-2)"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${count(Math.round(max * f))}</text>`; }).join("");
const xLabels = (n: number, labels: string[]) => labels.map((l, i) => `<text x="${L + ((i + 0.5) * (W - L)) / n}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`).join("");
const svg = (body: string, h = H) => `<svg class="mock-chart" viewBox="0 0 ${W} ${h}" role="img">${body}</svg>`;
const legend = (keys: [string, string][]) => `<div class="mock-legend">${keys.map(([n, c]) => `<span><i style="background:var(--${c})"></i>${esc(n)}</span>`).join("")}</div>`;
const panel = (title: string, body: string, cls = "") => `<section class="card mock-panel${cls}"><div class="sh"><h2>${esc(title)}</h2></div>${body}</section>`;

function columns(rows: typeof daily, keys: [string, string][]) {
  const max = Math.max(...rows.flatMap((r: any) => keys.map(([k]) => r[k]))) * 1.1, slot = (W - L) / rows.length, bw = (slot * 0.7) / keys.length;
  const bars = rows.map((r: any, i) => keys.map(([k, c], j) => { const h = (r[k] / max) * (H - B - 8); return `<rect x="${L + i * slot + slot * 0.15 + j * bw}" y="${H - B - h}" width="${bw - 2}" height="${h}" fill="var(--${c})" rx="2"><title>${r.label} ${k}: ${r[k]}</title></rect>`; }).join("")).join("");
  return svg(yAxis(max) + bars + xLabels(rows.length, rows.map((r) => r.label)));
}
function diverging(rows: typeof daily) {
  const nets = rows.map((r) => r.filed - r.closed), max = Math.max(...nets.map(Math.abs), 1) * 1.2, mid = (H - B) / 2 + 4, slot = (W - L) / rows.length;
  const bars = nets.map((n, i) => { const h = (Math.abs(n) / max) * (mid - 8); return `<rect x="${L + i * slot + slot * 0.25}" y="${n > 0 ? mid - h : mid}" width="${slot * 0.5}" height="${Math.max(h, 1)}" fill="var(--${n > 0 ? "need" : "done"})" rx="2"><title>${rows[i].label}: ${n > 0 ? "+" : ""}${n}</title></rect><text x="${L + (i + 0.5) * slot}" y="${n > 0 ? mid - h - 4 : mid + h + 12}" text-anchor="middle">${n > 0 ? "+" : ""}${n}</text>`; }).join("");
  return svg(`<line x1="${L}" x2="${W}" y1="${mid}" y2="${mid}" stroke="var(--rule)"/><text x="${L - 6}" y="${mid + 4}" text-anchor="end">0</text>${bars}${xLabels(rows.length, rows.map((r) => r.label))}`);
}
function area(rows: typeof daily) {
  const max = Math.max(...rows.map((r) => r.active)) * 1.15, x = (i: number) => L + (i * (W - L - 10)) / (rows.length - 1) + 5, y = (v: number) => H - B - (v / max) * (H - B - 8);
  const path = (f: (r: any) => number, g: (r: any) => number) => `M${rows.map((r, i) => `${x(i)},${y(f(r))}`).join(" L")} L${[...rows].reverse().map((r, i) => `${x(rows.length - 1 - i)},${y(g(r))}`).join(" L")} Z`;
  return svg(yAxis(max) + `<path d="${path((r) => r.active, () => 0)}" fill="var(--series-1)" fill-opacity=".7"/>` + rows.map((r, i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${r.label}</text>`).join(""));
}
function hbars(kinds: { k: string; p50: number | null; p90: number | null }[]) {
  // A narrower box than the others: this panel takes one column, so its text keeps the same size.
  const w = 300, max = Math.max(...kinds.map((k) => k.p90 ?? 0)) * 1.3, row = 34, h = kinds.length * row + 26, x = (v: number) => 60 + (v / max) * (w - 70);
  return `<svg class="mock-chart" viewBox="0 0 ${w} ${h}" role="img">` + kinds.map((k, i) => `<text x="52" y="${i * row + 22}" text-anchor="end">${k.k}</text>` + (k.p50 == null ? `<text x="64" y="${i * row + 22}" fill="var(--muted)">–</text>` : `<rect x="60" y="${i * row + 8}" width="${x(k.p90!) - 60}" height="8" fill="var(--rule)" rx="2"/><rect x="60" y="${i * row + 18}" width="${x(k.p50) - 60}" height="8" fill="var(--series-1)" rx="2"/><text x="${x(k.p90!) + 4}" y="${i * row + 16}" fill="var(--muted)">${dur(k.p90!)}</text><text x="${x(k.p50) + 4}" y="${i * row + 26}">${dur(k.p50)}</text>`)).join("") + `</svg>`;
}
const KINDS = ["task", "bug", "check", "flake"];
const close = KINDS.map((k) => { const xs = shut.filter((r: any) => r.kind === k).map((r: any) => (t(r.closedTime) - t(r.createdTime)) / 1000).filter((s: number) => s > 0); return { k, p50: q(xs, 0.5), p90: q(xs, 0.9) }; });

// ---- Tiles ----
const trendRel = (v: number, b: number, low: boolean | null, tip: string) => cardTrend(v, b, b, { kind: "relative", lowerIsGood: low, tip });
const rate = (100 * shut.length) / filed, rateBefore = (100 * shutBefore) / filedBefore;
const tilesA = tiles("Issue numbers",
  statCard({ k: "Active", v: count(active.length), note: "in work", trend: "" }) +
  statCard({ k: "Backlog", v: count(backlog), trend: trendRel(backlog, backlogBefore, true, `${count(backlogBefore)} a week ago`), q: undefined, note: `${count(parked)} parked` }) +
  statCard({ k: "Net", v: `${filed - shut.length > 0 ? "+" : ""}${filed - shut.length}`, v2: undefined, q: undefined, note: "filed − closed" }) +
  statCard({ k: "Close rate", v: pct(rate), q: ["closed", "filed"], v2: undefined, note: `${count(shut.length)} of ${count(filed)}`, trend: cardTrend(rate / 100, rateBefore / 100, rateBefore / 100, { kind: "points", lowerIsGood: false, tip: `${pct(rateBefore)} the week before` }) }) +
  statCard({ k: "Time to close", v: dur(q(spans, 0.5)!), v2: dur(q(spans, 0.9)!), q: ["p50", "p90"], trend: trendRel(q(spans, 0.5)!, q(spansBefore, 0.5)!, true, `${dur(q(spansBefore, 0.5)!)} the week before`) }));
const perDay = (n: number) => Math.round(n / 7);
const tilesB = tiles("Issue rates",
  statCard({ k: "Backlog", v: count(backlog), v2: count(active.length), q: ["open", "active"], trend: trendRel(backlog, backlogBefore, true, `${count(backlogBefore)} a week ago`) }) +
  statCard({ k: "Filed per day", v: count(perDay(filed)), trend: trendRel(filed, filedBefore, null, `${count(perDay(filedBefore))} the week before`) }) +
  statCard({ k: "Closed per day", v: count(perDay(shut.length)), trend: trendRel(shut.length, shutBefore, false, `${count(perDay(shutBefore))} the week before`) }) +
  statCard({ k: "Time to close", v: dur(q(spans, 0.5)!), v2: dur(q(spans, 0.9)!), q: ["p50", "p90"] }));

// ---- Table: one id form, the fold column first, labels capped at two chips ----
const pick = ["3197", "3206", "3207", "3208", "3209", "3210", "3211", "3198", "3201"];
const rowsOf = pick.map((n) => I.find((r: any) => r.ref === n && r.repo === "aleph") ?? I.find((r: any) => r.ref === n)).filter(Boolean);
const code = (r: any) => (r.repo === "aleph" ? "a" : r.repo === "aleph-tools" ? "at" : r.repo);
const capChips = (ls: string[]) => chips(ls.slice(0, 2)) + (ls.length > 2 ? `<span class="quiet" title="${esc(ls.slice(2).join(", "))}"> +${ls.length - 2}</span>` : "");
const foldCell = (r: any) => (["3197", "3198"].includes(r.ref) ? `<td class="fold-col"><button class="fold" aria-expanded="${r.ref === "3197"}">${r.ref === "3197" ? "▾" : "▸"}</button></td>` : `<td class="fold-col"></td>`);
const tableRow = (r: any) => `<tr class="rowlink${r.parent ? " sub-row" : ""}">${foldCell(r)}<td>${idLink(`${code(r)}${r.ref}`, "#")}</td><td class="wide" title="${esc(r.title)}"><a href="#">${esc(r.title)}</a></td><td>${badge(r.stage)}</td><td>${priorityBadge(r.priority)}</td>${cell(r.repo)}<td>${capChips(r.labels ?? [])}</td>${cell(count(r.notes), { num: true })}${cell(count(r.runs), { num: true })}${cell(money(r.cost), { num: true })}<td class="time">${esc(when(new Date(t(r.updatedTime))))}</td></tr>`;
const head = `<th class="fold-col"></th>` + heads(["Id", "Title", "Stage", "Priority", "Project", "Labels", "Notes", "Jobs", "Cost", "Updated"], ["Notes", "Jobs", "Cost", "Updated"]);
const table = dataTable(head, rowsOf.map(tableRow).join(""));

// ---- Filing options ----
const projSel = selectBox("Project", "repo", ["aleph", "aleph-tools", "sidetone"], "aleph");
const fileRow = (qtext: string) => `<tr class="rowlink file-row"><td class="fold-col">+</td><td><span class="idp">new</span></td><td class="wide"><a href="#">File “${esc(qtext)}”</a> <span class="quiet">in aleph · Enter</span></td><td colspan="8"></td></tr>`;
const searchMatches = rowsOf.slice(4, 6).map(tableRow).join("");
const optF1 = card("Issues", `${searchBox("f1", "chevron fold column")}${dataTable(head, fileRow("chevron fold column") + searchMatches)}`, { count: 2 });
const optF2 = `${pageHead("Issues", { aside: `<span class="quick-file">${inputBox("t", "", { attrs: ' placeholder="New issue title" aria-label="New issue title"' })}${projSel}${actButton("File", {}, { primary: true })}</span>` })}`;
const drawer = `<aside class="mock-drawer card"><div class="sh"><h2>File an Issue</h2><button class="link">Close</button></div>${field("Project", projSel)}${field("Title", inputBox("title", "Put the fold button first in the Issues table"))}${field("Text", `<textarea rows="6">## Outcome\n\nThe chevron sits in its own first column.</textarea>`)}${field("Media", `<div class="drop quiet">Paste or drop images</div>`)}<div class="acts">${actButton("File", {}, { primary: true })}</div></aside>`;
const optF3 = `<div class="drawer-stage"><div class="behind">${pageHead("Issues", { aside: actButton("File", {}, { primary: true }) })}<div class="ghost"></div><div class="ghost"></div></div>${drawer}</div>`;
const optF4 = `<div class="paste-stage"><div class="toast card"><b>Screenshot pasted</b><span class="quiet">File it as a new issue?</span>${actButton("File", {}, { primary: true })} ${actButton("Cancel", {})}</div></div>`;

const pros = (rows: [string, string, string][]) => `<table class="tbl fit mock-pc"><thead><tr><th>Option</th><th>For</th><th>Against</th></tr></thead><tbody>${rows.map((r) => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("")}</tbody></table>`;

const ids = dataTable(heads(["Where", "Now", "Mock"]), [
  ["Issues table, aleph", `<span class="mono">a&nbsp;3202</span>`, idLink("a3202", "#")],
  ["Issues table, aleph-tools", `<span class="mono">at3201</span>`, idLink("at3201", "#")],
  ["CLI and Herald (<code>shownKey</code>)", `<span class="mono">a-03197</span>`, idLink("a3197", "#")],
  ["Job (<code>shownKey</code>)", `<span class="mono">j-09739</span>`, idLink("j9739", "#")],
  ["File form placeholder", `<span class="mono">repo-n, repo-n.k</span>`, `<span class="mono">a3202, a3202.1</span>`],
].map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join(""), { fit: true });

const note = (html: string) => `<p class="mocknote">${html}</p>`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Mock: Issues page refit</title>
<link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/hack-font/3.3.0/web/hack.min.css" rel="stylesheet">
<link rel="stylesheet" href="app.css"><style>
/* Mock chrome and stand-ins only. Everything else is app.css and the kit helpers' markup. */
body { margin: 0; }
.wrap { max-width: 1240px; margin: 0 auto; padding: var(--sp-16) var(--sp-24) var(--sp-48); }
.mockbar { position: sticky; top: 0; z-index: 10; display: flex; gap: var(--sp-16); padding: var(--sp-8) var(--sp-24); background: var(--sunk); border-bottom: 1px solid var(--rule); font: var(--fw-mid) var(--fs-sm) var(--sans); }
.mockbar a { color: var(--ink); }
h2.mock-h { font: var(--fw-strong) var(--fs-2xl) var(--sans); margin: var(--sp-40) 0 var(--sp-8); }
h3.mock-o { font: var(--fw-strong) var(--fs-lg) var(--sans); margin: var(--sp-24) 0 var(--sp-8); }
.mocknote { margin: var(--sp-8) 0 var(--sp-16); padding: var(--sp-8) var(--sp-12); border-left: 3px solid var(--run); background: var(--surface); font: var(--fs-sm)/1.5 var(--sans); color: var(--ink-2); max-width: 90ch; }
.mock-grid { display: grid; grid-template-columns: 2fr 1fr; gap: var(--sp-16); }
.mock-grid.two { grid-template-columns: 1fr 1fr; }
.mock-panel .mock-chart { width: 100%; height: auto; font: 11px var(--sans); fill: var(--ink); }
.mock-legend { display: flex; gap: var(--sp-12); justify-content: flex-end; font-size: var(--fs-xs); }
.mock-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
td.fold-col, th.fold-col { width: var(--sp-16); padding-right: var(--sp-4); color: var(--muted); }
.sub-row td:nth-child(3) { padding-left: var(--sp-16); }
.file-row td { background: var(--sunk); }
.quick-file { display: flex; gap: var(--sp-8); align-items: center; }
.quick-file input { width: 32ch; }
.drawer-stage, .paste-stage { position: relative; min-height: 460px; border: 1px dashed var(--rule); border-radius: var(--r-card); overflow: hidden; padding: var(--sp-12); }
.drawer-stage .behind { opacity: .45; }
.ghost { height: 90px; margin: var(--sp-12) 0; background: var(--surface); border-radius: var(--r-card); }
.mock-drawer { position: absolute; top: 0; right: 0; bottom: 0; width: 380px; margin: 0; border-radius: 0; box-shadow: var(--card-lift); display: flex; flex-direction: column; gap: var(--sp-8); }
.mock-drawer textarea { width: 100%; }
.drop { border: 1px dashed var(--rule); padding: var(--sp-12); text-align: center; border-radius: var(--r-ctl); }
.paste-stage { min-height: 140px; }
.paste-stage .toast { position: absolute; right: var(--sp-16); bottom: var(--sp-16); display: flex; gap: var(--sp-8); align-items: center; margin: 0; }
.mock-pc td { vertical-align: top; white-space: normal; }
</style></head><body>
<nav class="mockbar"><a href="#tiles">Tiles</a><a href="#charts">Charts</a><a href="#table">Table</a><a href="#ids">IDs</a><a href="#file">Filing</a></nav>
<div class="wrap page">
<p class="quiet">Data: /api/issues snapshot of 2026-11-16, window Week. Charts are inline SVG stand-ins for &lt;aleph-chart&gt;.</p>

<h2 class="mock-h" id="tiles">Metric cards</h2>
${note(`Open Age and Jobs are gone. No card shows the store total (1,830). Each card shows a level or a change of the work, so a busy week does not dwarf the backlog.`)}
<h3 class="mock-o">A · levels and change (recommended)</h3>
<div data-annotate="metric-card/a">${tilesA}</div>
${note(`<b>Active</b> is open issues (${stages}). <b>Backlog</b> is open plus parked; its trend compares to a week ago. <b>Net</b> is filed minus closed: above 0, the backlog grows. <b>Close rate</b> is closed per filed. <b>Time to close</b> replaces Open Age with p50 / p90 of the issues closed this week.`)}
<h3 class="mock-o">B · rates</h3>
<div data-annotate="metric-card/b">${tilesB}</div>
${note(`Per-day rates hold the same scale in Hour, Day, Week and Month. Net is left for the chart.`)}

<h2 class="mock-h" id="charts">Charts</h2>
${note(`The Tests chart is gone. The old backlog chart stacked a level (open by priority) with two flows (filed, closed): ${filed} filed buried ${backlog} open. Each panel now shows one measure on one axis (design.md, Chart panel).`)}
<div class="mock-grid" data-annotate="chart/flow">
${panel("Issues Filed and Closed by Day", legend([["filed", "series-2"], ["closed", "done"]]) + columns(daily, [["filed", "series-2"], ["closed", "done"]]))}
${panel("Time to Close by Kind", legend([["p50", "series-1"], ["p90", "rule"]]) + hbars(close))}
</div>
<div class="mock-grid two" data-annotate="chart/backlog" style="margin-top:var(--sp-16)">
${panel("Backlog by Day", area(daily))}
${panel("Net Change by Day", legend([["grew", "need"], ["shrank", "done"]]) + diverging(daily))}
</div>
${note(`Pick one of the two flow views: <b>Filed and Closed</b> columns show volume, <b>Net Change</b> shows only the difference, so a 291-close day and a 4-close day read on one scale. Backlog by Day drops the priority split: 3 of ${backlog} open or parked issues are high or critical, so the split showed one colour. The store keeps no parked history, so active vs parked over time needs a new record.`)}

<h2 class="mock-h" id="table">Table</h2>
${note(`The fold button has its own first column (design.md, Table: "the row's fold button, id or name, title…"), so ids line up whether or not a row has parts. Labels show two chips and <span class="mono">+N</span>, so the title takes the spare width.`)}
<div data-annotate="table/issues">${card("Issues", table, { count: rowsOf.length })}</div>

<h2 class="mock-h" id="ids">IDs</h2>
${note(`One form everywhere: code then number, no dash, no padding. Risk: the project <b>interview</b> has the code <span class="mono">i</span>, which is also the letter of an issue key with no code.`)}
<div data-annotate="id/forms">${ids}</div>

<h2 class="mock-h" id="file">Filing an issue</h2>
${note(`The draft issue page is out. Four other ways, none of which costs page height when idle.`)}
<h3 class="mock-o">F1 · file from the search (recommended)</h3>
<div data-annotate="file/search">${optF1}</div>
${note(`Type in the search box. The first row offers <b>File “…”</b> in the scoped project. Enter on it files the title and opens the new issue page, where Edit and Attach already exist. You see the near matches before you file, so duplicates drop.`)}
<h3 class="mock-o">F2 · one line in the page head</h3>
<div data-annotate="file/head">${optF2}</div>
<h3 class="mock-o">F3 · a drawer from a File button (or the key n)</h3>
<div data-annotate="file/drawer">${optF3}</div>
<h3 class="mock-o">F4 · paste anywhere on Issues</h3>
<div data-annotate="file/paste">${optF4}</div>
${pros([
  ["F1 search", "No new control; dedupe for free; one keystroke path", "Title only at first; text and media go on the issue page after; intake can start before you add text"],
  ["F2 head line", "Always visible; one line", "Takes head space beside the scope bar; on a phone it wraps; a second text box next to search"],
  ["F3 drawer", "Full form with media; page stays in view", "A new component (no drawer in design.md); most code; focus trap and Escape to build"],
  ["F4 paste", "Fastest path from a screenshot", "Hidden: nothing shows it exists; needs F1 or F3 behind it for the title"],
])}
${note(`Intake starts when an issue is filed. For F1 and F2, a title-only issue reaches intake with no text. Fix: hold intake until the first edit or for a set time, or accept that intake asks.`)}
</div></body></html>`;
await Bun.write(`${dir}/index.html`, html);
console.log("wrote", `${dir}/index.html`, { filed, shut: shut.length, backlog, backlogBefore, active: active.length, parked });
