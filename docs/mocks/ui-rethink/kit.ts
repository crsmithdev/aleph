// The kit of the UI re-think mock: the page frame and each part of the page grammar (README, Page grammar), built
// from the helpers of ui/views/lib. A page module in pages/ draws its views from these parts only.
import { card, esc, facts, filterBar, legendHtml, linkButton, searchBox, seg, setting, settings } from "../../../ui/views/lib/html.js";
import { count } from "../../../ui/views/lib/format.js";

/** data.public.json: the snapshot of 2026-11-21 with each private text replaced (README, Data). */
export type Data = any;
/** Item links go to the live UI, so a click in the mock opens the real issue, job or session. */
export const LIVE = "http://aleph.home/";
/** "Now" for every page: the time of the snapshot, never the clock, so two builds write the same files. */
export const now = (d: Data) => Date.parse(d.at);

// ---- The registry ----

export type Tone = "error" | "need";
/** One problem on a page (README, Decision 3): its tone, its line, and the action that removes it. */
export type Attention = { tone: Tone; text: string; act?: { label: string; href: string } };
/** One tab of a page. With no `draw`, the view is not built yet. `scope` shows the window control on this view only. */
export type View = { id: string; label: string; scope?: boolean; draw?: (d: Data) => string };
/** What `pages/<id>.ts` exports as `page`. build.ts finds each file, so a new page is one new file. */
export type Page = {
  id: string; title: string; group: "Factory" | "Claude"; order: number;
  /** The Font Awesome name of the live sidebar's icon. */
  icon: string;
  /** The live route, after `#/`. */
  route: string;
  views: View[];
  attention: (d: Data) => Attention[];
};

export const liveHref = (p: Page) => `${LIVE}#/${p.route}`;
export const built = (p: Page) => p.views.every((v) => v.draw);
/** The tone of a page's sidebar dot: error over need, "" for no problem. */
export const worst = (rows: Attention[]) => (rows.some((r) => r.tone === "error") ? "error" : rows.length ? "need" : "");
/** The event-dot class of a tone: `.event-dot` names the need tone "warning". */
const dot = (tone: string) => `<span class="event-dot ${tone === "need" ? "warning" : tone}" aria-hidden="true"></span>`;

// ---- The frame ----

const HEAD = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,">
<link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/hack-font/3.3.0/web/hack.min.css" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.14.0/dist-cdn/styles/themes/default.css">
<script type="module" src="https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.14.0/dist-cdn/webawesome.loader.js"></script>
<link rel="stylesheet" href="app.css"><link rel="stylesheet" href="mock.css"><script src="mock.js" defer></script>`;

/** The mock's own bar, not part of the design: the overview, each page, and the theme. */
const mockbar = (pages: Page[], current: string) => `<div class="mockbar"><b>UI re-think</b><a href="index.html"${current === "index" ? ' aria-current="page"' : ""}>Overview</a>` +
  pages.map((p) => `<a href="${p.id}.html"${p.id === current ? ' aria-current="page"' : ""}>${esc(p.title)}</a>`).join("") +
  `<span class="mb-r"><span>Theme</span>${seg("Theme", [["", "System"], ["light", "Light"], ["dark", "Dark"]].map(([k, l]) => ({ label: l, on: k === "", attrs: ` data-set-theme="${k}"` })))}</span></div>`;

/** A whole HTML document. */
export const doc = (title: string, pages: Page[], current: string, body: string) =>
  `<!doctype html><html lang="en"><head><title>${esc(title)}</title>${HEAD}</head><body>${mockbar(pages, current)}${body}</body></html>\n`;

const MARK = `<a class="mark" href="index.html"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="39" fill="none" stroke="currentColor" stroke-width="12"></circle><circle cx="35.5" cy="64.5" r="20" fill="currentColor"></circle></svg>aleph</a>`;

/** The sidebar: each group's pages in order, a tone dot on a page with an attention row. `groups` defaults to each page's own group. */
export function sidebar(pages: Page[], d: Data, current: string, groups?: [string, string[]][]) {
  const by = groups ?? (["Factory", "Claude"] as const).map((g) => [g, pages.filter((p) => p.group === g).map((p) => p.id)] as [string, string[]]);
  const link = (p: Page) => {
    const rows = p.attention(d), tone = worst(rows);
    return `<li><a href="${p.id}.html" title="${esc(p.title)}"${p.id === current ? ' aria-current="page"' : ""}><wa-icon name="${esc(p.icon)}" aria-hidden="true"></wa-icon><span class="lbl">${esc(p.title)}</span>` +
      `${tone ? `<span class="rt-dot" title="${esc(rows.map((r) => r.text).join("; "))}">${dot(tone)}</span>` : ""}</a></li>`;
  };
  const items = by.map(([g, ids]) => `<li class="head">${esc(g)}</li>${ids.map((id) => link(pages.find((p) => p.id === id)!)).join("")}`).join("");
  return `<nav class="side" aria-label="Views">${MARK}<div id="nav"><ul>${items}</ul></div></nav>`;
}

/** The page head (Grammar 1): the title in the display face, the view tabs beside it, the window at the right on a view it changes. */
export function pageHead(p: Page) {
  const tabs = p.views.length > 1 ? seg("Views", p.views.map((v, i) => ({ label: v.label, on: i === 0, attrs: ` data-view="${esc(v.id)}"` }))) : "";
  const scoped = p.views.filter((v) => v.scope).map((v) => v.id);
  const scope = scoped.length ? `<div class="aside"><div class="rt-scope" data-scope="${esc(scoped.join(" "))}">${seg("Window", ["Day", "Week", "Month"].map((l) => ({ label: l, on: l === "Week", attrs: "" })))}</div></div>` : "";
  return `<header class="ph rt-head"><h1>${esc(p.title)}</h1>${tabs}${scope}</header>`;
}

/** A page of the mock: the sidebar, the head, the attention rows, then one pane per view, the first shown. */
export function frame(p: Page, pages: Page[], d: Data) {
  const panes = p.views.map((v, i) => `<section class="rt-pane" data-pane="${esc(v.id)}"${i ? " hidden" : ""} aria-label="${esc(v.label)}">${v.draw ? v.draw(d) : card("", `<div class="empty"><p>Not built</p></div>`, { label: v.label })}</section>`).join("");
  return doc(`${p.title} · UI re-think`, pages, p.id, `<div class="shell">${sidebar(pages, d, p.id)}<main><div class="page rt-page">${pageHead(p)}${attention(p.attention(d))}${panes}</div></main></div>`);
}

// ---- The parts of a view ----

/** The attention rows (Grammar 2): one per problem, in its tone, with its action at the right; nothing when there is no problem. */
export const attention = (rows: Attention[]) => (rows.length ? `<div class="rt-att">${rows.map((r) =>
  `<div class="rt-arow ${r.tone}" role="${r.tone === "error" ? "alert" : "status"}">${dot(r.tone)}<span class="t">${esc(r.text)}</span>${r.act ? linkButton(r.act.label, r.act.href) : ""}</div>`).join("")}</div>` : "");

/** The facts line of a list view (Grammar 3): at most 4 figures at text size, each `[figure, words]`. */
export function factsLine(items: [string, string][]) {
  if (items.length > 4) throw new Error("A facts line holds at most 4 figures (README, Decision 4).");
  return `<p class="rt-facts">${items.map(([v, k]) => `<span><b class="num">${esc(v)}</b> ${esc(k)}</span>`).join(" ")}</p>`;
}

/** One figure of a band: its key, its value and what it compares with; `trend` tones the comparison. */
export type Figure = { k: string; v: string; cmp: string; trend?: "good" | "warn"; title?: string };
/** The figure band of an analysis view (Grammar 3): at most 4 figures, each with its comparison. */
export function band(figs: Figure[]) {
  if (figs.length > 4) throw new Error("A figure band holds at most 4 figures (README, Decision 4).");
  return `<section class="rt-band" aria-label="Figures">${figs.map((f) => `<div class="rt-fig"${f.title ? ` title="${esc(f.title)}"` : ""}><span class="k">${esc(f.k)}</span><b class="num">${esc(f.v)}</b><span class="cmp${f.trend ? ` ${f.trend}` : ""}">${esc(f.cmp)}</span></div>`).join("")}</section>`;
}

/** One row of a list: `lead` (an id), `main` (the title and its chips) and `cells` (HTML) are its columns; `inspect` is the inspector's HTML for it. `data` are the values the filters match. */
export type Row = { key: string; lead: string; main: string; cells: string[]; text: string; data?: Record<string, string>; inspect: string };
/** A group of rows under its name and count; `heads` names the cell columns. `more` is a line after the rows. */
export type Group = { title: string; count: string; heads: string[]; rows: Row[]; more?: string };

/** The rows of a list (Grammar 4), on one grid so the columns of every group line up. The first row of the first group is selected. */
export function rows(groups: Group[], { select = true } = {}) {
  const n = Math.max(...groups.map((g) => g.heads.length)), first = groups.find((g) => g.rows.length)?.rows[0]?.key;
  const row = (r: Row) => `<li class="rt-row mrow" tabindex="0" data-key="${esc(r.key)}" data-text="${esc(r.text.toLowerCase())}"${Object.entries(r.data ?? {}).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("")} aria-selected="${select && r.key === first}">` +
    `<span class="lead">${r.lead}</span><span class="main">${r.main}</span>${r.cells.map((c) => `<span class="c">${c}</span>`).join("")}</li>`;
  const group = (g: Group) => `<li class="rt-ghead"><span class="gt"><h3 class="sub-head">${esc(g.title)}</h3><span class="count">${esc(g.count)}</span></span>${g.heads.map((h) => `<span class="h">${esc(h)}</span>`).join("")}</li>` +
    (g.rows.length ? g.rows.map(row).join("") : `<li class="rt-none"><div class="empty"><p>No data</p></div></li>`) + (g.more ? `<li class="rt-more">${g.more}</li>` : "");
  return `<ul class="rt-rows" style="--n: ${n}">${groups.map(group).join("")}</ul>`;
}

/** A filter of the list: a segmented control, the one control type of a list surface. */
export type Filter = { label: string; name: string; options: string[] };

/**
 * The list surface (Grammar 4): one card with the search, the filters and the rows, and the inspector at the right,
 * which goes below the list under 1100 px. The inspector opens on the first row; each row's own inspector waits in a template.
 */
export function list({ label, search, hint = "", filters = [], groups }: { label: string; search: string; hint?: string; filters?: Filter[]; groups: Group[] }) {
  const all = groups.flatMap((g) => g.rows);
  const bar = `${searchBox(`rt-${label.toLowerCase()}`, "", search, hint ? `<span class="hint">${esc(hint)}</span>` : "")}` +
    (filters.length ? filterBar(filters.map((f) => ({ label: f.label, name: f.name, options: [{ value: "", label: "All" }, ...f.options.map((o) => ({ value: o, label: o }))] }))) : "");
  const ins = `<aside class="card ins rt-ins" aria-label="Inspector">${all[0]?.inspect ?? `<div class="empty"><p>Select a row</p></div>`}</aside>`;
  return `<div class="browse rt-browse">${card("", `${bar}${rows(groups)}`, { label, cls: "rt-list" })}${ins}</div>` +
    all.map((r) => `<template data-inspect="${esc(r.key)}">${r.inspect}</template>`).join("");
}

/** The inspector's content for one item: its id and title, a status row, its facts, then `body`, and "Open page" to the live detail page. */
export const inspector = ({ id, title, status = "", rows: kv, body = "", href }: { id: string; title: string; status?: string; rows: [string, string][]; body?: string; href: string }) =>
  `<div class="inspect-head"><span class="idp">${esc(id)}</span>${linkButton("Open page", href)}</div><h3>${esc(title)}</h3>${status}${facts(kv)}${body}`;

/** Setting rows (Grammar, Limits views): each row's Save shows only after its control changes (README, Decision 8). */
export const settingRows = (label: string, items: { label: string; id: string; control: string; hint?: string }[]) =>
  settings(label, items.map((s) => setting(s.label, s.control, { id: s.id, hint: s.hint, save: "Save" })));

// ---- Charts: inline SVG in chart tokens ----

/** A series of a chart: `color` is a chart or tone token without its dashes (`series-1`, `done`, `muted`), so its class is `k-<color>`. */
export type Series = { name: string; color: string; values: number[] };
const TOP = 14, FOOT = 20; // px above the plot, for the top value; px under it, for the labels

/** The legend of a chart's series, for its card's aside. */
export const legend = (series: Series[]) => legendHtml(series.map((s) => [s.name, `k-${s.color}`]));
const axis = (labels: string[], h: number) => labels.map((l, i) => `<text x="${(((i + 0.5) * 100) / labels.length).toFixed(2)}%" y="${h - 4}" text-anchor="middle">${esc(l)}</text>`).join("");
const scale = (most: number, h: number, fmt: (n: number) => string) => `<line class="grid" x1="0" x2="100%" y1="${TOP}" y2="${TOP}"></line><text class="v" x="0" y="${TOP - 4}">${esc(fmt(most))}</text><line class="base" x1="0" x2="100%" y1="${h - FOOT}" y2="${h - FOOT}"></line>`;
const aria = (labels: string[], series: Series[], fmt: (n: number) => string) => esc(series.map((s) => `${s.name}: ${s.values.map((v, i) => `${labels[i]} ${fmt(v)}`).join(", ")}`).join("; "));

/** Columns per label, `h` px tall: stacked, or side by side. The top line gives the largest value. */
export function columns(labels: string[], series: Series[], { stacked = false, h = 180, fmt = count }: { stacked?: boolean; h?: number; fmt?: (n: number) => string } = {}) {
  const sums = labels.map((_, i) => series.reduce((n, s) => n + s.values[i], 0));
  const most = Math.max(1, ...(stacked ? sums : series.flatMap((s) => s.values))), plot = h - TOP - FOOT, slot = 100 / labels.length;
  const y = (v: number) => (v / most) * plot;
  const bars = labels.map((l, i) => {
    let base = h - FOOT;
    return series.map((s, j) => {
      const bh = y(s.values[i]), w = stacked ? slot * 0.56 : (slot * 0.7) / series.length, x = i * slot + (stacked ? slot * 0.22 : slot * 0.15 + j * w);
      const top = stacked ? base - bh : h - FOOT - bh;
      if (stacked) base -= bh;
      return bh ? `<rect class="k-${s.color}" x="${x.toFixed(2)}%" y="${top.toFixed(1)}" width="${(w * 0.92).toFixed(2)}%" height="${bh.toFixed(1)}"><title>${esc(`${l} · ${s.name} ${fmt(s.values[i])}`)}</title></rect>` : "";
    }).join("");
  }).join("");
  return `<svg class="rt-chart" role="img" aria-label="${aria(labels, series, fmt)}" width="100%" height="${h}">${scale(most, h, fmt)}${bars}${axis(labels, h)}</svg>`;
}

/** Lines per series over the labels, `h` px tall, a point at each value. The top line gives the largest value. */
export function lines(labels: string[], series: Series[], { h = 180, fmt = count }: { h?: number; fmt?: (n: number) => string } = {}) {
  const most = Math.max(1, ...series.flatMap((s) => s.values)), plot = h - TOP - FOOT, slot = 100 / labels.length;
  const x = (i: number) => (i + 0.5) * slot, y = (v: number) => 100 - (v / most) * 100;
  // The path stretches in a box of 100 by 100; the points and the labels stay round in the outer box.
  const paths = `<svg x="0" y="${TOP}" width="100%" height="${plot}" viewBox="0 0 100 100" preserveAspectRatio="none">${series.map((s) => `<polyline class="k-${s.color}" points="${s.values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ")}" vector-effect="non-scaling-stroke"></polyline>`).join("")}</svg>`;
  const points = series.map((s) => s.values.map((v, i) => `<circle class="k-${s.color}" cx="${x(i).toFixed(2)}%" cy="${(TOP + (y(v) / 100) * plot).toFixed(1)}" r="3"><title>${esc(`${labels[i]} · ${s.name} ${fmt(v)}`)}</title></circle>`).join("")).join("");
  return `<svg class="rt-chart" role="img" aria-label="${aria(labels, series, fmt)}" width="100%" height="${h}">${scale(most, h, fmt)}${paths}${points}${axis(labels, h)}</svg>`;
}

/** The charts of an analysis view (Grammar 5): 2 across, 1 under 1100 px. Each is a `card()`. */
export const charts = (cards: string[]) => `<div class="rt-charts">${cards.join("")}</div>`;
