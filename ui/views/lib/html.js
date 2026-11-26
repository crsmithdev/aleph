// Shared HTML parts for the factory UI's views: escaping, the empty and error states, cards, tables, forms, folds and buttons.
// View issues may add to this file but not change what is here (the 2026-11-04 format issue did: a unit follows a number with no space).

import { issueApi, keep, kept } from "./address.js";
import { ago, clock, count, markLine, money, pct, wkText } from "./format.js";
import { noteHref, PRIORITIES, priorityRank, shortId, shortText } from "../../../lib/naming.ts";

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
/** A number cell for a count of bad things (errors, failures): `--error` when above 0. */
export const badCount = (n) => `<td class="num${n > 0 ? " bad" : ""}">${count(n)}</td>`;
const WK_TIP = "An estimate of the share of the weekly plan limit: the cost times the rise in weekly % per Claude dollar this machine spent, fit hour by hour over 28 days, one rate for Fable and one for the other Claude models. A week's estimate missed by about ±25% in holdout, because use off this machine (claude.ai chat, other devices) is not in the dollars. OpenRouter and local models use none of the plan.";
/** The weekly share (HTML) with its tooltip. */
export const wkHtml = (wk) => `<span class="wk" title="${esc(WK_TIP + (wk.pooled ? " One rate prices all models: the window has too little Fable spend for its own rate." : ""))}">${esc(wkText(wk))}</span>`;
/** The cost cell content (HTML): the weekly share first, with its tooltip, then the dollars. */
export const costHtml = (cost, wk) => {
  const dollars = cost === undefined || cost === null ? "" : esc(money(cost));
  if (!wk) return dollars;
  return `${wkHtml(wk)}${dollars ? ` <span class="quiet">${dollars}</span>` : ""}`;
};
/**
 * The one empty state: "No data". Pass `line` only for a state that is not missing data, in at most three words.
 * @design empty-state
 */
export const empty = (line = "No data") => `<div class="empty"><p>${esc(line)}</p></div>`;
/** The loading spinner: one CSS mark, which stands still under prefers-reduced-motion. Only the loading helpers draw it. */
const spin = `<i class="spin" aria-hidden="true"></i>`;
/**
 * An inline loading line: a spinner and "Loading <what>…". Use it for any data that has not returned its first answer; a missing answer after that is empty() or error().
 * @design empty-state
 */
export const loadingLine = (what) => `<p class="quiet" role="status">${spin}Loading ${esc(what)}…</p>`;
/** The first-load state of a view, shown until its API answers. */
export const loading = (title) => `<div class="page"><p class="quiet loading" role="status">${spin}Loading ${esc(title)}…</p></div>`;
/**
 * The error state: what failed, and under Technical details the upstream text.
 * @design empty-state
 */
export const error = (line, { detail = "" } = {}) =>
  `<div class="error" role="alert"><p>${esc(line)}</p>${detail ? fold("Technical details", `<pre>${esc(detail)}</pre>`) : ""}</div>`;
/**
 * A note above data that still shows: `bad` marks that the data is stale or wrong.
 * @design empty-state
 */
export const notice = (line, bad = false, id = "") => `<p class="notice${bad ? " bad" : ""}" role="${bad ? "alert" : "status"}"${id ? ` id="${esc(id)}"` : ""}>${esc(line)}</p>`;
/**
 * A command the reader copies to run; the page's click handler does the copying.
 * @design command
 */
export function cmd(text, { primary = false, hint = "" } = {}) {
  return `<button class="cmd${primary ? " primary" : ""}" type="button" data-cmd="${esc(text)}"><span>${esc(text)}</span>${hint ? `<span class="hint">${esc(hint)}</span>` : ""}<span class="cp">Copy</span></button>`;
}
const safeHref = (u) => /^(https?:\/\/|\/|#|\.{0,2}\/)/i.test(u) || !/^[a-z][\w+.-]*:/i.test(u) ? u : "#";
/** Inline Markdown on escaped text: `code`, [links](url), **bold**, *em*. */
function inline(text) {
  const parts = String(text).split(/(`[^`]+`)/);
  return parts.map((p) => {
    if (/^`[^`]+`$/.test(p)) return `<code>${esc(p.slice(1, -1))}</code>`;
    let out = "", last = 0;
    for (const m of p.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]|\[([^\]]+)\]\(([^)\s]+)\)/g)) {
      out += emph(esc(p.slice(last, m.index)));
      // [[Title]] or [[Title|label]] links to the vault note's page.
      out += m[1] !== undefined
        ? `<a href="${noteHref(m[1].trim())}">${esc((m[2] || m[1]).trim())}</a>`
        : `<a href="${esc(safeHref(m[4]))}">${emph(esc(m[3]))}</a>`;
      last = m.index + m[0].length;
    }
    return out + emph(esc(p.slice(last)));
  }).join("");
}
const emph = (s) => s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
/**
 * Markdown to HTML: headings, lists, pipe tables, fenced code, paragraphs, inline code, links and [[wiki links]]. Everything else is escaped.
 * @design markdown-and-code
 */
export function md(src) {
  const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [], list = null;
  const flushPara = () => { if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`); para = []; };
  const cells = (r) => r.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fence = l.match(/^\s*(```|~~~)/);
    if (fence) {
      flushPara(); flushList();
      const body = [];
      while (++i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i]);
      out.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { flushPara(); flushList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    const li = l.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/);
    if (li) {
      flushPara();
      const tag = li[1] ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push(li[3]);
      continue;
    }
    if (!l.trim()) { flushPara(); flushList(); continue; }
    const head = l.includes("|") && cells(l);
    if (head && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1] ?? "") && cells(lines[i + 1]).length === head.length) {
      flushPara(); flushList();
      const row = (tag, r) => `<tr>${r.map((c) => `<${tag}>${inline(c)}</${tag}>`).join("")}</tr>`;
      const body = [];
      for (i += 2; i < lines.length && lines[i].includes("|"); i++) body.push(row("td", cells(lines[i])));
      i--;
      out.push(`<table><thead>${row("th", head)}</thead><tbody>${body.join("")}</tbody></table>`);
      continue;
    }
    if (list && /^\s+\S/.test(l)) { list.items[list.items.length - 1] += " " + l.trim(); continue; }
    flushList();
    para.push(l.trim());
  }
  flushPara(); flushList();
  return out.join("\n");
}
/** Call the view's optional `mount(root, data)` after its markup is in `root`. Returns whether it ran, or a promise of that when the mount is async; a failed async mount rejects it. */
export function mountView(view, root, data, query) {
  if (typeof view?.mount !== "function") return false;
  const done = view.mount(root, data, query);
  return typeof done?.then === "function" ? done.then(() => true) : true;
}
// Now fills `.diff-panel[data-diff-for]`; Jobs fills `.diff-panel#diff` and removes its `[data-diff]` button once the diff is in.
const PANELS = "[data-diff-for], .diff-panel#diff";
const panelKey = (p) => p.getAttribute?.("data-diff-for") ?? "diff";
const FIELDS = "input, textarea, select";
/** The key of each details: its `data-fold` id (a fold whose summary text changes), else its `data-keep`, else `summary text`, plus its position among the details with the same key. */
function detailsKeys(root) {
  const seen = new Map();
  return [...root.querySelectorAll("details")].map((el) => {
    const text = el.dataset?.fold ?? el.dataset?.keep ?? (el.querySelector("summary")?.textContent ?? "").trim();
    const n = seen.get(text) ?? 0;
    seen.set(text, n + 1);
    return [`${text}#${n}`, el];
  });
}
/** Each clamp button keyed by its clamped text plus its position among the clamps with the same text, so a new row above it does not move the key. */
function clampKeys(root) {
  const seen = new Map();
  return [...root.querySelectorAll(".clamp-btn")].map((b) => {
    const text = b.previousElementSibling?.textContent ?? "";
    const n = seen.get(text) ?? 0;
    seen.set(text, n + 1);
    return [`${text}#${n}`, b];
  });
}
/** Capture what the reader set in `root` (open details, shown diff panels, typed fields) before a refresh re-renders it. */
export function recordState(root) {
  const details = {};
  for (const [key, el] of detailsKeys(root)) {
    const fields = {};
    if (el.open) [...el.querySelectorAll(FIELDS)].forEach((f, i) => { fields[f.name || i] = f.type === "checkbox" || f.type === "radio" ? f.checked : f.value; });
    details[key] = { open: !!el.open, fields };
  }
  const panels = {};
  for (const p of root.querySelectorAll(PANELS)) if (!p.hidden) panels[panelKey(p)] = p.innerHTML;
  const clamps = clampKeys(root);
  const open = clamps.flatMap(([k, b]) => (b.getAttribute("aria-expanded") === "true" ? [k] : []));
  return { details, panels, open, focus: clamps.find(([, b]) => b === globalThis.document?.activeElement)?.[0] };
}
/** Apply a `recordState` record to the freshly rendered `root`. What the new markup no longer has is ignored. */
export function restoreState(root, state) {
  if (!state) return;
  for (const [key, el] of detailsKeys(root)) {
    const s = state.details?.[key];
    if (!s) continue;
    el.open = s.open;
    [...el.querySelectorAll(FIELDS)].forEach((f, i) => {
      const k = f.name || i;
      if (!(k in s.fields)) return;
      if (f.type === "checkbox" || f.type === "radio") f.checked = s.fields[k];
      else f.value = s.fields[k];
    });
  }
  for (const p of root.querySelectorAll(PANELS)) {
    const html = state.panels?.[panelKey(p)];
    if (html === undefined) continue;
    p.innerHTML = html;
    p.hidden = false;
    if (!p.getAttribute?.("data-diff-for")) for (const b of root.querySelectorAll("button[data-diff]")) b.remove();
  }
  const clamps = new Map(clampKeys(root));
  for (const k of state.open ?? []) if (clamps.has(k)) openClamp(clamps.get(k), true);
  clamps.get(state.focus)?.focus();
}
/**
 * A diff as HTML: one span per line, marked by kind. An empty diff says so.
 * @design diff
 */
export const diffHtml = (t) => String(t ?? "").trim()
  ? `<pre>${String(t).split("\n").map((l) => {
      const c = l.startsWith("+++") || l.startsWith("---") || l.startsWith("diff ") || l.startsWith("index ") ? "meta" : l[0] === "+" ? "add" : l[0] === "-" ? "del" : l[0] === "@" ? "hunk" : "";
      return `<span class="l d-${c}">${esc(l)}</span>`;
    }).join("")}</pre>`
  : empty("No changes");
/** Fetch a diff from `url` into `el`: a loading line, then the diff or a `.msg` line. Returns the diff text, or null on a failure. */
export async function loadDiff(el, url) {
  el.innerHTML = loadingLine("the diff");
  const msg = (m) => { el.innerHTML = `<p class="msg">${esc(m)}</p>`; return null; };
  try {
    const res = await fetch(url, { cache: "no-store" });
    const t = await res.text();
    if (!res.ok) return msg(t.trim() || `The diff failed to load (${res.status}).`);
    el.innerHTML = diffHtml(t);
    return t;
  } catch (err) { return msg(`The diff failed to load: ${err.message}`); }
}
const TONES = { "in use": "done", stale: "need", "never offered": "quiet", "lint problem": "error", running: "run", landing: "run", open: "run", landed: "done", passed: "done", done: "done", closed: "done", waiting: "need", working: "run", queued: "run", returned: "error", failed: "error", dropped: "quiet", parked: "parked", exploring: "run", built: "done", reran: "run", escalated: "need", red: "error", filed: "done", answered: "done", human: "need", rule: "done", director: "parked", firefighter: "error", gate: "run" };
/** The badge tone of a state (a job's, land's or issue's): run, done, need, error, or quiet for any other. */
export const tone = (state) => TONES[state] ?? "quiet";

// The CSS for these is in app.css (.ph, table.tbl, .idl, .chips, .fbar, .seg, .pager).
// Column order for every table: id or name, title, state badge, priority, project, labels, numbers, then time.
/**
 * The page header: the serif title (none when `title` is empty), a muted count, and an optional right-hand aside (`aside` is HTML); `head` adds a class to the header.
 * @design page-head
 */
export const pageHead = (title, { count, aside = "", cls = "", after = "", head = "" } = {}) =>
  `<header class="ph${head ? ` ${head}` : ""}">${title ? `<h1${cls ? ` class="${cls}"` : ""}>${esc(title)}</h1>` : ""}${after}${count != null && count !== "" ? `<span class="count">${esc(count)}</span>` : ""}${aside ? `<div class="aside">${aside}</div>` : ""}</header>`;
/**
 * How fresh the page's data is, one word for the right of the page head: `error` when a key's build failed, `updating`
 * while a rebuild runs, `live` on a live view with its stream open, else the age of the oldest key. The title gives each
 * mark's line, then each key with its build time. `keys` is `[key, { at, error, since, rebuild }][]`; "" for no key.
 * @design freshness
 */
export function freshness(title, keys, live, now = Date.now()) {
  const marks = keys.filter(([, k]) => k.error), failed = marks.some(([, k]) => !k.rebuild);
  const oldest = keys.map(([, k]) => k.at).filter(Boolean).sort()[0];
  const word = failed ? "error" : marks.length ? "updating" : live ? "live" : oldest ? ago(oldest, now) : "";
  if (!word) return "";
  const tip = [...marks.map(([, k]) => markLine(title, k, now)), ...keys.map(([key, k]) => `${key} ${clock(k.at)}`)].join("\n");
  return `<span class="age${failed ? " error" : word === "live" ? " live" : ""}" title="${esc(tip)}">${word}</span>`;
}
/** An id as a link: mono, small, muted, underlined on hover. */
/** What an issue waits on, one row each; a wait that never ends says so and offers to remove it. */
export function blockersHtml(waits, repo, id) {
  const rows = waits.map((b) => `<div class="blocker">${b.href ? `<a href="${esc(safeHref(b.href))}">${esc(shortText(b.id, repo))}</a>` : esc(shortText(b.id, repo))}${b.title ? ` <span>${esc(b.title)}</span>` : ""}${b.dead ? ` ${tag(b.dead, "error")}` : b.state ? ` ${tag(b.state)}` : ""}</div>`).join("");
  const dead = waits.filter((b) => b.dead);
  if (!dead.length) return rows;
  const label = `Stop waiting on ${dead.map((b) => shortText(b.id, repo)).join(", ")}`;
  return rows + `<div class="blocker blocker-dead"><span>A dropped issue or a tracker never finishes, so this wait never ends.</span> ${actButton(label, { act: "unblock", path: `${issueApi(repo, id)}/unblock`, label })}</div>`;
}
/** @design link */
export const idLink = (id, href, { title } = {}) => {
  const t = title === undefined ? "" : ` title="${esc(title)}"`;
  return href ? `<a class="idl"${t} href="${esc(safeHref(href))}">${esc(id)}</a>` : `<span class="idp"${t}>${esc(id)}</span>`;
};
/** A commit as its short hash, linked to `url` when there is one. */
export const shaLink = (hash, url) => idLink(String(hash).slice(0, 7), url, { title: hash });
/** "–" for a value that is missing, with the reason as its title. */
export const miss = (reason) => `<span title="${esc(reason)}">–</span>`;
/** A muted line of `parts` (HTML), with a "·" between them; an empty part is left out. */
export const meta = (parts) => `<p class="meta">${parts.filter(Boolean).map((p) => `<span>${p}</span>`).join("")}</p>`;
/** A plain sentence under a head or beside a list. */
export const note = (text) => `<p class="note">${esc(text)}</p>`;
/** A head inside a card, under its title. */
export const subHead = (text) => `<h3 class="sub-head">${esc(text)}</h3>`;
/**
 * One table cell of text: `num` right-aligns it; a `wide` cell is the stretching one and shows its text as its title, or `title`.
 * @design row-and-cell
 */
export const cell = (v, { num = false, wide = false, title } = {}) => {
  const t = title ?? (wide ? v : undefined);
  return `<td${num || wide ? ` class="${[num && "num", wide && "wide"].filter(Boolean).join(" ")}"` : ""}${t === undefined ? "" : ` title="${esc(t)}"`}>${esc(v)}</td>`;
};
/**
 * A table row of `cells` (each from `cell` or other `<td>` HTML).
 * @design row-and-cell
 */
export const row = (cells) => `<tr>${cells.join("")}</tr>`;
/**
 * A stack of rows or cards (HTML).
 * @design list-and-group
 */
export const list = (html) => `<div class="list">${html}</div>`;
/**
 * A named part of a page or card (HTML), with an id to link to.
 * @design list-and-group
 */
export const group = (id, html) => `<div class="grp" id="${esc(id)}">${html}</div>`;
/** The page's place at its top: `« aleph / issues / 628`. Each part is [text, href], and the last part is the page itself; the mark links to `back`. */
export const crumb = (back, parts) => `<nav class="crumb" aria-label="Breadcrumb"><a href="${esc(safeHref(back))}" aria-label="Back">«</a> ${parts.map(([t, h]) => (h ? `<a href="${esc(safeHref(h))}">${esc(t)}</a>` : `<span>${esc(t)}</span>`)).join(" / ")}</nav>`;
/**
 * An id as a link with its short id.
 * @design link
 */
export const repoIdLink = (id, href) => idLink(shortId(id), href);
/**
 * A small badge of any text in one of the badge tones, with an optional title.
 * @design badge
 */
export const tag = (text, tone = "quiet", title) => `<span class="badge ${esc(tone)}"${title === undefined ? "" : ` title="${esc(title)}"`}>${esc(text)}</span>`;
/**
 * A state as a badge, toned by `tone`.
 * @design badge
 */
export const badge = (state) => tag(state, tone(state));
/** A priority as a badge: critical is the alert tone, high the warning tone, medium and low quiet. Missing or unknown reads medium. */
const PRIORITY_TONES = ["quiet", "quiet", "need", "error"];
/** @design badge */
export function priorityBadge(p) {
  const i = priorityRank(p);
  return tag(PRIORITIES[i], PRIORITY_TONES[i], PRIORITIES[i]);
}
/**
 * The status row of a detail page around its built parts: the state, the priority, then the labels.
 * @design status-row
 */
export const statusRow = (state, priority, labels) => `<div class="status-row">${state}${priority}${labels}</div>`;
/** One chip: `text` escaped, or `html` as given; `el` is the tag, `cls` extra classes, `attrs` extra attributes (with a leading space, already escaped). */
export const chip = (text, { el = "span", cls = "", attrs = "", html } = {}) => `<${el} class="chip${cls ? ` ${cls}` : ""}"${attrs}>${html ?? esc(text)}</${el}>`;
/** Built chips in their row; `el` is the row's tag. */
export const chipRow = (html, el = "span") => `<${el} class="chips">${html}</${el}>`;
/**
 * Labels as small rounded chips; "" for none.
 * @design chip
 */
export const chips = (labels) => (labels?.length ? chipRow(labels.map((l) => chip(l, { attrs: ` title="${esc(l)}"` })).join("")) : "");
/** A segmented control. `label` names the group for assistive tech; `items` are `{label, on, attrs, icon?}`, `attrs` the button's own attributes. An `icon` button shows the icon, and its label is the name and the tooltip. */
export const seg = (label, items, attrs = "") =>
  `<div class="seg" role="group" aria-label="${esc(label)}"${attrs}>${items.map((i) => `<button type="button"${i.attrs}${i.icon ? ` aria-label="${esc(i.label)}" title="${esc(i.label)}"` : ""} aria-pressed="${i.on}">${i.icon ? `<wa-icon name="${esc(i.icon)}" aria-hidden="true"></wa-icon>` : esc(i.label)}</button>`).join("")}</div>`;
const opt = (o) => (typeof o === "object" && o ? { value: String(o.value), label: String(o.label ?? o.value) } : { value: String(o), label: String(o) });
/**
 * One row of filter controls, all 28px high. Each group is `{label, name, options, value, data, bare}`; `bare` keeps the label as the accessible name only. A fixed set of
 * options is a segmented control; `data: true` says the options come from the data, and they make a `<select>`.
 * The first option of a filter says All. Options are strings or `{value, label}`. The view wires the events:
 * a segmented button carries `data-name` on its group and `data-value`, pressed is `aria-pressed="true"`.
 * @design filter-bar
 */
export function filterBar(groups) {
  const control = (g) => {
    if (g.html) return g.html;
    const name = esc(g.name ?? "");
    const opts = (g.options ?? []).map(opt);
    const cur = String(g.value ?? opts[0]?.value ?? "");
    if (!g.data) return seg(g.label, opts.map((o) => ({ label: o.label, on: o.value === cur, attrs: ` data-value="${esc(o.value)}"` })), ` data-name="${name}"`);
    return `<select name="${name}" aria-label="${esc(g.label ?? "")}">${opts.map((o) => `<option value="${esc(o.value)}"${o.value === cur ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
  };
  return `<div class="fbar">${groups.map((g) => `<div class="fg">${g.label && !g.bare ? `<span class="fl">${esc(g.label)}</span>` : ""}${control(g)}</div>`).join("")}</div>`;
}
/**
 * The search field over a table. It stays out of what the filters redraw, so it keeps the focus while the reader types.
 * @design search-box
 */
export const searchBox = (ui, value, placeholder, action = "") =>
  `<div class="fbar"><input type="search" name="q" data-ui="${esc(ui)}" value="${esc(value ?? "")}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">${action}</div>`;
/**
 * A search box folded to an icon, for a card's head: it opens on focus and stays open while it holds text. The arguments are those of `searchBox`.
 * @design search-box
 */
export const searchFold = (ui, value, placeholder) =>
  `<label class="sfold"><wa-icon name="magnifying-glass" aria-hidden="true"></wa-icon><input type="search" name="q" data-ui="${esc(ui)}" value="${esc(value ?? "")}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}"></label>`;
/** The tabs of a page that shows one pane at a time: a segmented control over the panes. `items` is `[[id, label]]`; `panes` maps an id to its HTML; `on` is the open id. A button carries `data-tab`; `wireTabs()` switches the panes.
 * With `head`, the control is a card's head beside `head.aside`, and `head.top` sits between the head and the panes, so it shows on every tab.
 * @design tabs
 */
export const tabs = (label, items, panes, on = items[0]?.[0], head) => {
  const bar = seg(label, items.map(([id, l]) => ({ label: l, on: id === on, attrs: ` data-tab="${esc(id)}"` })));
  return `<div class="tabs">${head ? `<div class="sh">${bar}<span class="aside">${head.aside}</span></div>${head.top}` : bar}` +
    items.map(([id]) => `<section data-pane="${esc(id)}"${id === on ? "" : " hidden"}>${panes[id] ?? ""}</section>`).join("") + `</div>`;
};
/** Switch the panes of each `tabs()` under `root` on a click; `onTab(id, el)` (optional) hears it, to keep the pick. */
export function wireTabs(root, onTab) {
  root._onTab = onTab;
  if (root._tabs) return;
  root._tabs = true;
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]"), box = b?.closest(".tabs");
    if (!box) return;
    box.querySelectorAll("button[data-tab]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    box.querySelectorAll(":scope > section[data-pane]").forEach((x) => { x.hidden = x.dataset.pane !== b.dataset.tab; });
    root._onTab?.(b.dataset.tab, box);
  });
}
/** A page's contents beside its `body`: one link per section, in a rail that stays in view. `items` is `[[id, label, sub]]`;
 * a `sub` entry sits indented under the entry before it. The router scrolls an `#id` link in place.
 * @design contents
 */
export const toc = (items, body) =>
  `<div class="toc-wrap"><nav class="toc" aria-label="Contents"><details open><summary>Contents</summary><ol>` +
  items.map(([id, label, sub]) => `<li${sub ? ' class="sub"' : ""}><a href="#${esc(id)}">${esc(label)}</a></li>`).join("") +
  `</ol></details></nav><div class="toc-body">${body}</div></div>`;
/** Marks the entry of the section at the top of the view with `aria-current` (the last entry at the end of the page, a clicked entry until
 * the next scroll by hand or click elsewhere; none when no section is in the band), and closes the contents under 1100px, where they sit above the body. Wiring again drops the last observer and listeners. */
export function wireToc(root) {
  root._toc?.disconnect();
  root._tocOff?.abort();
  const nav = root.querySelector(".toc");
  if (!nav) return;
  if (matchMedia("(max-width: 1100px)").matches) nav.querySelector("details").open = false;
  const links = new Map([...nav.querySelectorAll("a")].map((a) => [a.getAttribute("href").slice(1), a])), seen = new Set();
  let picked = null;
  const mark = () => {
    // The last sections of a page cannot reach the band, so at the end of a page that scrolls the last entry is current.
    const end = scrollY > 0 && scrollY + innerHeight >= document.documentElement.scrollHeight - 1;
    const id = picked ?? (end ? [...links.keys()].pop() : [...links.keys()].find((k) => seen.has(k)));
    for (const [k, a] of links) k === id ? a.setAttribute("aria-current", "location") : a.removeAttribute("aria-current");
    if (!id) return;
    // Scroll the rail, not the page: scrollIntoView() here would stop the router's smooth scroll.
    const a = links.get(id);
    if (a.offsetTop < nav.scrollTop || a.offsetTop + a.offsetHeight > nav.scrollTop + nav.clientHeight) nav.scrollTop = a.offsetTop - nav.clientHeight / 2;
  };
  // A section counts while it crosses the band from 10% to 40% down the view, so a sliver at the top does not; the first in page order is current.
  root._toc = new IntersectionObserver((es) => {
    for (const e of es) e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id);
    mark();
  }, { rootMargin: "-10% 0px -60% 0px" });
  const signal = (root._tocOff = new AbortController()).signal;
  addEventListener("scroll", mark, { passive: true, signal });
  // A clicked entry stays current while the router scrolls to it, which may stop short of the band at the end of a page.
  nav.addEventListener("click", (e) => { const a = e.target.closest?.("a"); if (a) { picked = a.getAttribute("href").slice(1); mark(); } }, { signal });
  for (const t of ["wheel", "touchstart", "keydown"]) addEventListener(t, () => { if (picked) { picked = null; mark(); } }, { passive: true, signal });
  // A click outside the rail also drops the pick, such as one on Edit, which can leave the page at the top with no section in the band.
  addEventListener("click", (e) => { if (picked && !nav.contains(e.target)) { picked = null; mark(); } }, { signal });
  for (const k of links.keys()) { const el = document.getElementById(k); if (el) root._toc.observe(el); }
}
/**
 * A dot and a word for whether something is up: `state` is "fine", "alert" or anything else for unknown (a muted dot). `label` is the whole text.
 * @design status-light
 */
export const statusLight = (state, label) =>
  `<span class="light"><span class="event-dot ${state === "fine" || state === "alert" ? state : ""}" aria-hidden="true"></span>${esc(label)}</span>`;
/**
 * The second click of an action that is hard to undo. Call it on the click: it returns true when it armed the button
 * (the text becomes `text`, in the `.ask` look, for `ms`) and false when the button was already armed, so the action goes on.
 * @design two-click-confirm
 */
export function arm(btn, text, ms = 5000) {
  if (btn.classList.contains("ask")) { clearTimeout(btn._t); return false; }
  const was = btn.textContent;
  btn.classList.add("ask");
  btn.textContent = text;
  btn._t = setTimeout(() => { btn.classList.remove("ask"); btn.textContent = was; }, ms);
  return true;
}
/**
 * A `<select>`: `label` is its accessible name; `options` are strings or `{value, label, disabled}`; `o` has `id` and `attrs` (raw attributes).
 * @design select
 */
export const selectBox = (label, name, options, value, o = {}) =>
  `<select name="${esc(name)}"${o.id ? ` id="${esc(o.id)}"` : ""} aria-label="${esc(label)}"${o.attrs ?? ""}>${options.map((x) => {
    const v = typeof x === "object" ? x : { value: x };
    return `<option value="${esc(v.value)}"${String(v.value) === String(value) ? " selected" : ""}${v.disabled ? " disabled" : ""}>${esc(v.label ?? v.value)}</option>`;
  }).join("")}</select>`;
/**
 * A text, number or search `<input>`; `o` has `id`, `type` (default text) and `attrs` (raw attributes, such as `required` or `pattern`).
 * @design field-and-form
 */
export const inputBox = (name, value, o = {}) =>
  `<input name="${esc(name)}" type="${o.type ?? "text"}"${o.id ? ` id="${esc(o.id)}"` : ""} value="${esc(value ?? "")}"${o.attrs ?? ""}>`;
/**
 * One field of a form: its label over its control; `hint` is a line under it; `check` puts a checkbox control before the label text.
 * @design field-and-form
 */
export const field = (label, control, { hint = "", check = false } = {}) =>
  `<label class="field">${check ? `${control} ${esc(label)}` : `${esc(label)} ${control}`}${hint ? `<small class="hint">${esc(hint)}</small>` : ""}</label>`;
/**
 * A form of fields, stacked, with its submit button and the message beside it; `ui` is the `data-ui` key the view wires.
 * @design field-and-form
 */
export const form = (ui, fields, submit, attrs = "") =>
  `<form class="stack" data-ui="${esc(ui)}"${attrs}>${fields.join("")}${actButton(submit, {}, { primary: true, type: "submit" })} <span class="act-msg" role="status"></span></form>`;
/**
 * One setting: a label, its control and, with `save`, a Save button that submits it alone (a form of its own; the view wires `submit` on `attrs`' data key).
 * `id` is the control's id, so the label names it. Without `save` the control applies on change and the row is a `<div>`. `hint` is a line under the control.
 * `stack` puts the label over the control at any width, for a setting in a narrow card.
 * @design settings-list
 */
export const setting = (label, control, { id, hint = "", save = "", attrs = "", stack = false } = {}) => {
  const body = `<label class="sl"${id ? ` for="${esc(id)}"` : ""}>${esc(label)}</label><span class="sctl">${control}${save ? actButton(save, {}, { type: "submit" }) : ""}</span>` +
    `${hint ? `<small class="hint">${esc(hint)}</small>` : ""}`;
  const cls = stack ? "srow stack" : "srow";
  return save ? `<form class="${cls}"${attrs}>${body}</form>` : `<div class="${cls}"${attrs}>${body}</div>`;
};
const changed = (c) => (c.type === "checkbox" || c.type === "radio" ? c.checked !== c.defaultChecked : c.tagName === "SELECT" ? [...c.options].some((o) => o.selected !== o.defaultSelected) : c.value !== c.defaultValue);
/** Show Save on each setting row of `root` whose control differs from its saved value, and hide it on the others (CSS: `.srow:not(.dirty)`). The router calls it after each draw, since a morph drops the class. */
export const markDirty = (root) => {
  for (const r of root.querySelectorAll(".settings .srow")) r.classList.toggle("dirty", [...r.querySelectorAll(".sctl input, .sctl select, .sctl textarea")].some(changed));
};
if (typeof document !== "undefined") {
  const mark = (e) => { const box = e.target.closest?.(".settings .srow")?.closest(".settings"); if (box) markDirty(box); };
  document.addEventListener("input", mark);
  document.addEventListener("change", mark);
}
/**
 * The rows of `setting()`, one group under a name. The settings of a page live here, not in table cells.
 * @design settings-list
 */
export const settings = (label, rows) => `<div class="settings" role="group" aria-label="${esc(label)}">${rows.join("")}</div>`;
/**
 * A value and its editor in one place: the container's `.editing` class shows the editor and hides the value.
 * @design edit-toggle
 */
export const editable = (shown, editor) => `<span class="view-only">${shown}</span><span class="edit-only">${editor}</span>`;
/** Toggle `.editing` on the `.editable` that holds a `data-editor` button: `start` turns it on, anything else (`cancel`) off and resets its forms. */
export function wireEdit(root) {
  if (root._edit) return;
  root._edit = true;
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-editor]"), box = b?.closest(".editable");
    if (!box) return;
    box.classList.toggle("editing", b.dataset.editor === "start");
    if (b.dataset.editor !== "start") box.querySelectorAll("form").forEach((f) => f.reset());
  });
}

// The address holds what changes the data or what a link shares (the window, the project, a filter); keep() holds
// how a component shows it (a chart's form, its hidden series). One key per component, never per row or item.
/** Each `<details data-keep>` of `root` keeps its open state under its own key, as the reader left it. */
export function wireFolds(root) {
  root.addEventListener("toggle", (e) => {
    const d = e.target.closest?.("details[data-keep]");
    if (d) keep(d.dataset.keep, d.open);
  }, true);
}
/** Apply the kept open state to each fold of the freshly rendered `root`; a fold with no kept state shows its default. */
export function restoreFolds(root) {
  for (const d of root.querySelectorAll("details[data-keep]")) {
    const open = kept(d.dataset.keep);
    if (open != null) d.open = open;
  }
}
/**
 * The trend of a metric card: an arrow and a percent, green when good, amber when bad, muted when `lowerIsGood` is null.
 * `kind` "points" compares shares (0 to 1) in percentage points; "relative" compares times and counts by relative change.
 * The tooltip gives the previous value and the baseline, or `tip`. Empty with no value or no baseline.
 */
export function cardTrend(value, base, prev, { kind, lowerIsGood, format, basis, tip }) {
  if (value === null || value === undefined || base === null || base === undefined) return "";
  const change = kind === "points" ? (value - base) * 100 : base === 0 ? (value === 0 ? 0 : NaN) : ((value - base) / base) * 100;
  if (Number.isNaN(change)) return "";
  const down = change < 0;
  const title = tip ?? `${prev === null || prev === undefined ? "No previous value" : `Previous ${format(prev)}`}; baseline ${format(base)}, ${basis}${kind === "points" ? " (change in percentage points)" : ""}`;
  if (change === 0) return `<span class="tr" title="${esc(title)}">▬ 0%</span>`;
  const tone = lowerIsGood === null ? "" : down === lowerIsGood ? " good" : " warn";
  return `<span class="tr${tone}" title="${esc(title)}">${down ? "▼" : "▲"} ${pct(Math.abs(change))}</span>`;
}
/**
 * A metric card, 3 rows: the key and the trend; the value and the second value; one line of qualifier or note.
 * `v` is text; `v2` is text, or an array of texts for a third value on; `q` names each value, `[first, second, ...]`; `note` is text when there is no `q`;
 * `trend` is HTML from `cardTrend`; `extra` is HTML (a bar) between the value and row 3; `title` is a definition for the tooltip.
 * With `key` it selects the detail below it (a button with `data-tile` and `aria-pressed`); with `href` it goes to another page.
 * While a figure waits (`loading`) or its fetch failed (`failed`, the error line), a mark takes the trend's place and an
 * undefined `v` or `v2` leaves its space blank, so the card keeps its height.
 * @design metric-card
 */
export function statCard({ k, v, v2, q, note, title, trend = "", extra = "", href, key, on = false, loading = false, failed = "" }) {
  const rest = [v2].flat().filter((x) => x !== undefined);
  const row3 = q ? `<span class="q"><span>${esc(q[0])}</span>${q.slice(1).map((n) => `<span class="m"> / ${esc(n)}</span>`).join("")}</span>`
    : note ? `<span class="q m" title="${esc(note)}">${esc(note)}</span>` : "";
  const shown = [v, ...rest].filter((x) => x !== undefined).join(" / ");
  const tip = ` title="${esc([shown && `${k} ${shown}`, q?.join(" / "), title].filter(Boolean).join(", "))}"`;
  const mark = failed ? `<i class="spin bad" role="img" aria-label="${esc(failed)}" title="${esc(failed)}">!</i>`
    : loading ? `<i class="spin" role="status" aria-label="Loading"></i>` : trend;
  const inner = `<span class="r1"><span class="k">${esc(k)}</span>${mark}</span><b>${v === undefined ? "&nbsp;" : esc(v)}${rest.map((x) => `<em> / ${esc(x)}</em>`).join("")}</b>${extra}${row3}`;
  if (key) return `<button type="button" class="tile sc"${tip} data-tile="${esc(key)}" aria-pressed="${on}">${inner}</button>`;
  return href ? `<a class="tile sc"${tip} href="${esc(href)}">${inner}</a>` : `<div class="tile sc"${tip}>${inner}</div>`;
}
export const tiles = (label, html, id) => `<section class="tiles"${id ? ` id="${esc(id)}"` : ""} aria-label="${esc(label)}">${html}</section>`;
/** Call `fn(key)` when a tile or another selector with `data-tile` under `el` is clicked. */
export function onTile(el, fn) {
  if (!el || el._tile) return;
  el._tile = true;
  el.addEventListener("click", (e) => {
    const b = e.target.closest?.("button[data-tile]");
    if (b) fn(b.dataset.tile);
  });
}
/**
 * A block of a page: the section head (`sectionHead`'s options; `id` is also the section's id), `lede` as one summary sentence, then its body. `label` is the aria label, the title by default. An empty title draws no head, for a body of `tabs()` with a card head.
 * @design card
 */
export const card = (title, body, { count, aside, id, level, cls = "", label = title, lede } = {}) =>
  `<section class="card${cls ? ` ${cls}` : ""}"${id ? ` id="${esc(id)}"` : ""} aria-label="${esc(label)}">${title ? sectionHead(title, { count, aside, id, level }) : ""}${lede ? `<p class="lede">${esc(lede)}</p>` : ""}${body}</section>`;
/**
 * A card split 3 : 1 by a rule: the head and `main` on the left, `side` on the right.
 * @design split-card
 */
export const splitCard = (title, main, side, { aside, id, label = title } = {}) =>
  `<section class="card duo"${id ? ` id="${esc(id)}"` : ""} aria-label="${esc(label)}"><div class="duo-main">${sectionHead(title, { aside })}${main}</div><div class="duo-side">${side}</div></section>`;
/** The side stats of a split card: each `{ k, v, note, state, title }` a key over a value; `state` colours the value by `tone(state)`; `title` is its tooltip. */
export const sideStats = (items) =>
  `<dl class="sstats">${items.map(({ k, v, note, state, title }) => `<div${title ? ` title="${esc(title)}"` : ""}><dt>${esc(k)}</dt><dd><b${state ? ` class="${tone(state)}"` : ""}>${esc(v)}</b>${note ? `<span>${esc(note)}</span>` : ""}</dd></div>`).join("")}</dl>`;
/**
 * The one table: `head` is the cells of the header row, or "" for none; `rows` the rows.
 * @design table
 */
export const dataTable = (head, rows, { fit = false, id = "" } = {}) =>
  `<div class="tscroll"><table class="tbl${fit ? " fit" : ""}"${id ? ` id="${esc(id)}"` : ""}>${head ? `<thead><tr>${head}</tr></thead>` : ""}<tbody>${rows}</tbody></table></div>`;
/** A row that starts a day in an event log: `text` across all `cols` columns. */
export const dayRow = (text, cols) => `<tr class="day"><th colspan="${cols}" scope="colgroup">${esc(text)}</th></tr>`;
/** Plain header cells from labels; a label in `num` is right-aligned. */
export const heads = (labels, num = []) => labels.map((l) => `<th${num.includes(l) ? ' class="num"' : ""}>${esc(l)}</th>`).join("");
/** A column head as an icon with its name in `title`: a stopwatch over a duration, a clock over the time of an event. A duration is a number column. */
export const iconHead = (icon, label, { el = "th", num = icon === "stopwatch" } = {}) =>
  `<${el}${num ? ' class="num"' : ""} title="${esc(label)}" aria-label="${esc(label)}"><wa-icon name="${esc(icon)}" aria-hidden="true"></wa-icon></${el}>`;
/**
 * A 10px bar: `parts` is one share in percent, or segments `{pct, cls}` in percent of the whole bar. `label` (plain text)
 * is the text alternative; with none the bar is hidden from assistive tech, for a bar beside its visible value.
 * `mark` is a tick at that percent.
 * @design meter
 */
export function meter(parts, label, { mark = null } = {}) {
  const segs = (Array.isArray(parts) ? parts.filter((s) => s.pct > 0) : [{ pct: parts }]).map((s) => `<i${s.cls ? ` class="${s.cls}"` : ""} style="width:${Number(s.pct).toFixed(1)}%"></i>`).join("");
  return `<span class="meter" ${label ? `role="img" aria-label="${esc(label)}" title="${esc(label)}"` : 'aria-hidden="true"'}>${segs}${mark === null ? "" : `<b style="left:${mark}%"></b>`}</span>`;
}
/**
 * One row of a bar list: a label (HTML), a bar and a value (HTML). `pct` is the bar's width, or `bar` is HTML in its place.
 * `top` marks the largest; with `key` the row is a selector, as a tile is.
 * @design meter
 */
export function barRow(label, pct, value, { top = false, key, on = false, bar } = {}) {
  const inner = `<span class="bl">${label}</span>${bar ?? meter(pct)}<span class="bv">${value}</span>`;
  const cls = `barrow${top ? " top" : ""}`;
  return key ? `<button type="button" class="${cls}" data-tile="${esc(key)}" aria-pressed="${on}">${inner}</button>` : `<div class="${cls}">${inner}</div>`;
}
/** The rows of a bar list on one grid, so their bars start and end together. */
export const barList = (rows) => `<div class="bars">${rows}</div>`;
/**
 * The HTML legend: one `<li>` per `[label, cls]`; a `cls` gives the item a swatch that CSS colours.
 * @design legend
 */
export const legendHtml = (items) => `<ul class="legend">${items.map(([label, cls]) => `<li>${cls ? `<i class="${cls}"></i>` : ""}${esc(label)}</li>`).join("")}</ul>`;
const param = (q, k) => (typeof q.get === "function" ? q.get(k) : q[k]);
/** The page number in the query `q` (URLSearchParams or object): 1 unless `page` is a larger whole number. */
export function pageOf(q) {
  return Math.max(1, Number.parseInt(param(q, "page"), 10) || 1);
}
/** `page` held to the pages that `total` rows fill, `step` to a page: a page past the end is the last page. */
const pageIn = (page, total, step) => Math.min(Math.max(1, page), Math.max(1, Math.ceil(total / step)));
/** The rows of page `page` of `rows`, `step` to a page. */
export const pageRows = (rows, page, step = 50) => { const p = pageIn(page, rows.length, step); return rows.slice((p - 1) * step, p * step); };
/** A copy of `rows` in the order of `sort` ({key, dir}); `by[key](row)` is the value, `tie(a, b)` orders equal rows. */
export const sortRows = (rows, by, sort, tie) => [...rows].sort((a, b) => {
  const x = by[sort.key](a), y = by[sort.key](b);
  const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
  return c * sort.dir || (tie ? tie(a, b) : 0);
});
/** A pager button: a chevron glyph, its words in `aria-label` and `title`; `data` goes on as `data-*`. */
const turn = (icon, label, data) => actButton("", data, { cls: "glyph" }).replace("><", ` aria-label="${esc(label)}" title="${esc(label)}"><wa-icon name="${icon}" aria-hidden="true"></wa-icon><`);
/**
 * Under a long table: a left chevron, "51–100 of 345", a right chevron. `data-page` holds the page each goes to, or
 * for a list paged by cursor (`at`, the rows before this page), `back` and `fwd` are the `data-*` of each button.
 * @design pager
 */
export function pager(page, total, step = 50, { cls = "", at, back, fwd } = {}) {
  const p = pageIn(page, total, step), from = at ?? (p - 1) * step, to = Math.min(total, from + step);
  const prev = from > 0 ? turn("chevron-left", `Previous ${step}`, back ?? { page: p - 1 }) : "", next = to < total ? turn("chevron-right", `Next ${Math.min(step, total - to)}`, fwd ?? { page: p + 1 }) : "";
  return `<div class="pager${cls ? ` ${cls}` : ""}">${prev}<span class="of">${to - from > 1 && total > step ? `${from + 1}–${to}` : to} of ${total}</span>${next}</div>`;
}
/** Show page `page` of the rows in `box` (its `tbody` rows, or its list items) and hide the rest. */
function turnPage(box, page, step = 50) {
  const rows = [...box.querySelectorAll(":scope tbody > tr, :scope > ul > li")], p = pageIn(page, rows.length, step);
  rows.forEach((r, i) => { r.hidden = i < (p - 1) * step || i >= p * step; });
  box.querySelector(".pager").outerHTML = pager(p, rows.length, step);
}
/**
 * A `dataTable` that shows `step` rows and a pager that turns the page in place. `rows` is an array of `<tr>` strings.
 * @design pager
 */
export const pagedTable = (head, rows, step = 50) =>
  `<div class="paged" data-step="${step}">${dataTable(head, rows.map((r, i) => (i < step ? r : r.replace("<tr", "<tr hidden"))).join(""))}${rows.length > step ? pager(1, rows.length, step) : ""}</div>`;
/** Open or close the clamped text before the button `b`, and set the button to match. */
function openClamp(b, open) {
  b.previousElementSibling.classList.toggle("clamp", !open);
  b.setAttribute("aria-expanded", String(open));
  b.textContent = open ? "Show less" : "Show more";
}

if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.(".paged .pager button[data-page]");
    if (!b) return;
    const box = b.closest(".paged");
    turnPage(box, Number(b.dataset.page), Number(box.dataset.step) || 50);
  });
  // After a page turn, bring the top of the table into view. Capture runs before the view's handler draws the table
  // again, so the box is found while the button is still in it; a box drawn again is found by its id.
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.(".pager button"), box = b?.closest(".paged, [id]");
    if (!box) return;
    requestAnimationFrame(() => {
      const el = box.isConnected ? box : box.id && document.getElementById(box.id);
      if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
    });
  }, true);
}
/** A sortable header cell; `sort` is `{key, dir}` (dir 1 up, -1 down). Every table shows the same arrow. */
export function sortHead(label, key, sort, { num = false } = {}) {
  const on = sort?.key === key;
  return `<th${num ? ' class="num"' : ""}${on ? ` aria-sort="${sort.dir > 0 ? "ascending" : "descending"}"` : ""}><button type="button" data-sort="${esc(key)}">${esc(label)}<span class="arr" aria-hidden="true">${on ? (sort.dir > 0 ? "▲" : "▼") : ""}</span></button></th>`;
}
export const sectionHead = (title, { count, aside, id, level = 2 } = {}) =>
  `<div class="sh"><h${level}${id ? ` id="h-${esc(id)}"` : ""}>${esc(title)}</h${level}>${count != null ? `<span class="count">${esc(count)}</span>` : ""}${aside ? `<span class="aside">${aside}</span>` : ""}</div>`;
/** Long text, clamped, with a button that opens and closes it. `html` is HTML. */
export const clamp = (html) => `<div class="clamp">${html}</div><button class="link clamp-btn" type="button" aria-expanded="false">Show more</button>`;
/**
 * A fold: `summary` and `body` are HTML. `keep` keeps its open state across page loads; `id` names the fold for a refresh (page memory, no storage), where its summary text changes; `cls` is the fold's class, as `more` for technical details; `head` is the summary's class.
 * @design disclosure
 */
export const fold = (summary, body, { open = false, keep = "", id = "", cls = "", head = "" } = {}) =>
  `<details${cls ? ` class="${esc(cls)}"` : ""}${id ? ` data-fold="${esc(id)}"` : ""}${keep ? ` data-keep="${esc(keep)}"` : ""}${open ? " open" : ""}><summary${head ? ` class="${esc(head)}"` : ""}>${summary}</summary>${body}</details>`;
/**
 * The first `n` rows of a list; the rest sit under a "N more" fold. `row` returns the HTML inside one `<li>`.
 * @design disclosure
 */
export const moreFold = (items, row, n = 10) => {
  const ul = (xs) => `<ul class="tight">${xs.map((x) => `<li>${row(x)}</li>`).join("")}</ul>`;
  return ul(items.slice(0, n)) + (items.length > n ? fold(`${items.length - n} more`, ul(items.slice(n))) : "");
};

if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.(".clamp-btn");
    if (!b) return;
    openClamp(b, b.getAttribute("aria-expanded") !== "true");
  });
}
/**
 * Shows `text` in the `.act-msg` line beside `el`, and makes the line when there is none.
 * @design form-message
 */
export function say(el, text) {
  let n = el.parentElement.querySelector(".act-msg");
  if (!n) { n = document.createElement("span"); n.className = "act-msg"; n.setAttribute("role", "alert"); el.after(n); }
  n.textContent = text;
}
/**
 * An `.act` button: `data` becomes data attributes; `o` has `primary`, `kind` ("danger", "small" or "always"), `cls` (more classes) and `type` (default button).
 * @design button
 */
export const actButton = (label, data = {}, o = {}) =>
  `<button class="act${o.primary ? " primary" : ""}${o.kind ? ` ${esc(o.kind)}` : ""}${o.cls ? ` ${o.cls}` : ""}" type="${o.type ?? "button"}"` +
  Object.entries(data).map(([k, v]) => ` data-${esc(k)}="${esc(v)}"`).join("") + `>${esc(label)}</button>`;
/**
 * A row action: a small `actButton` in a last `td.acts` cell.
 * @design row-actions
 */
export const rowAct = (label, data) => `<td class="acts">${actButton(label, data, { kind: "small" })}</td>`;
/**
 * A link that looks like a button, to another page: navigation only. `label` names the page; `href` goes through `safeHref`.
 * @design link-button
 */
export const linkButton = (label, href) => `<a class="act" href="${esc(safeHref(href))}">${esc(label)}</a>`;
/**
 * Text with its `code` spans set as code, escaped.
 * @design markdown-and-code
 */
export const codeText = (t) => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>");
/** One fact of a facts list; "" for an empty value. `v` is HTML. */
export const fact = (k, v) => (v ? `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>` : "");
/**
 * The facts list of `[label, html]` pairs.
 * @design fact-list
 */
export const facts = (rows) => `<dl class="facts">${rows.map(([k, v]) => fact(k, v)).join("")}</dl>`;
/** The Run now button of an issue (`runNow` from the API: null when it starts the issue, else the gate's text; `note` is its short note), or nothing when `runNow` is absent. A gate that binds shows it disabled, the note beside it and the text as the title. */
export const runNowButton = (repo, ref, runNow, note) => (runNow === undefined ? "" : `<span class="run-now">${runNow === null
  ? `${actButton("Run now", { act: "run", path: `${issueApi(repo, ref)}/run`, label: "Run now" })}<span class="act-msg" role="status"></span>`
  : `<button class="act" type="button" disabled title="${esc(runNow)}">Run now</button> <span class="quiet">${esc(note)}</span>`}</span>`);
