// The list surface (docs/design.md, List surface): one card of a search, filters and grouped rows on one grid, with the
// inspector of the selected row at its right. What the reader sets (the search, the filters, the selected row) lives in
// this module, not in the markup, so a redraw by the router's morph draws it again as the reader left it.
import { keep, kept } from "./address.js";
import { empty, esc, facts, filterBar, linkButton, searchBox } from "./html.js";
import { count } from "./format.js";

/**
 * A row: `key` is its id in the list, `lead` (an id), `main` (the title and its chips) and `cells` (one HTML each) are its columns,
 * `text` is what the search matches, `data` the values the filters match (`{ who: "yours" }`), `inspect` the inspector's HTML,
 * or a function that gives it: a row that is not drawn builds its inspector only when a search brings it up.
 * A group `{ title, count, heads, rows, cap?, more? }`: `heads` names the cell columns, `rows` holds every row, and `cap` is how
 * many of the matches it draws, with an "N of M" line after them. `more` is a line after the rows (after the "N of M" line on a capped group).
 * A filter `{ label, name, options, value? }`: a segmented control after All, or a select past `SEGS` options; `value` is the option it starts on.
 */
const SEGS = 3; // a filter with more options than this is a select: its segments would run past a phone's width
const typed = new Map(); // The search text by list: a reload starts clean, as a search should.
const lists = new Map(); // The groups and cap of each list, whole: the search and the filters match every row, and only the first `cap` matches are drawn.

const stateOf = (id, filters) => {
  const k = kept(`browse.${id}`, {});
  return { q: typed.get(id) ?? "", f: Object.fromEntries(filters.map((f) => { const v = k.f?.[f.name]; return [f.name, v === "" || f.options.includes(v) ? v : f.value ?? ""]; })) };
};
/** Whether the search `q` and the filter values `f` leave out row `r`. */
const left = (r, { q, f }) => Boolean((q.trim() && !r.text.toLowerCase().includes(q.trim().toLowerCase())) || Object.entries(f).some(([k, v]) => v && r.data?.[k] !== v));
const inspect = (r) => (typeof r.inspect === "function" ? r.inspect() : r.inspect);

/** What each group draws: its `hits` (the rows the search and the filters keep) and the first of them, up to its `cap` and what is left of the list's. */
function plan({ groups, cap = Infinity }, st) {
  let room = cap;
  return groups.map((g) => {
    const hits = g.rows.filter((r) => !left(r, st)), drawn = hits.slice(0, Math.min(g.cap ?? Infinity, room));
    room -= drawn.length;
    return { g, hits, drawn };
  });
}

/** The rows of a list on one grid, so the columns of every group line up. The selected row is `sel`. */
function rows(list, st, sel) {
  const on = Boolean(st.q.trim() || Object.values(st.f).some(Boolean)), parts = plan(list, st);
  const row = (r) => `<li class="lrow" tabindex="0" data-key="${esc(r.key)}" aria-current="${r.key === sel}"><span class="lead">${r.lead}</span><span class="main">${r.main}</span>${r.cells.map((c) => `<span class="c">${c}</span>`).join("")}</li>`;
  const group = ({ g, hits, drawn }) => {
    // A group with no rows says so, unless a search or a filter is on: then only the groups with matches draw.
    if ((g.rows.length || on) && !drawn.length) return "";
    const line = g.cap && hits.length > drawn.length ? [`${count(drawn.length)} of ${count(hits.length)}`, g.more].filter(Boolean).join(" · ") : g.cap || on ? "" : g.more;
    return `<li class="lhead"><span class="gt"><h3 class="sub-head">${esc(g.title)}</h3><span class="count">${esc(g.count)}</span></span>${g.heads.map((h) => `<span class="h">${esc(h)}</span>`).join("")}</li>` +
      (g.rows.length ? drawn.map(row).join("") : `<li class="lnone">${empty()}</li>`) + (line ? `<li class="lmore">${line}</li>` : "");
  };
  const hits = parts.reduce((n, p) => n + p.hits.length, 0), shown = parts.reduce((n, p) => n + p.drawn.length, 0);
  if (!list.groups.some((g) => g.rows.length)) return `<li class="lnone">${empty()}</li>`;
  if (!hits && list.groups.some((g) => g.rows.length)) return `<li class="lnone" data-nomatch>${empty("No match")}</li>`;
  return parts.map(group).join("") + (list.cap && hits > shown ? `<li class="lmore">${count(shown)} of ${count(hits)}</li>` : "");
}

/**
 * The list surface: one card with the search, the filters and the rows, and the inspector at the right, below the list under 1100 px.
 * `id` names the list for its kept state; `label` names the card; `search` is the search box's placeholder and `hint` the key it shows.
 * `cap` limits the rows of all groups together, as a group's `cap` limits its own. The inspector opens on the selected row, else the first;
 * each drawn row's own inspector waits in a template.
 */
export function browse({ id, label, search, hint = "", filters = [], groups, cap }) {
  const list = { groups, cap };
  lists.set(id, list);
  const st = stateOf(id, filters), all = groups.flatMap((g) => g.rows), shown = plan(list, st).flatMap((p) => p.drawn);
  const sel = (all.find((r) => r.key === kept(`browse.${id}`, {}).sel) ?? shown[0] ?? all[0])?.key, cur = all.find((r) => r.key === sel);
  const bar = searchBox(`browse-${id}`, st.q, search, hint ? `<span class="hint">${esc(hint)}</span>` : "") +
    (filters.length ? filterBar(filters.map((f) => ({ label: f.label, name: f.name, value: st.f[f.name], data: f.options.length > SEGS, options: [{ value: "", label: "All" }, ...f.options.map((o) => ({ value: o, label: o }))] }))) : "");
  const ins = `<aside class="card ins" aria-label="Inspector">${cur ? inspect(cur) : empty("Select a row")}</aside>`;
  return `<div class="browse" data-browse="${esc(id)}"><section class="card lcard" aria-label="${esc(label)}">${bar}<ul class="lrows" style="--n: ${Math.max(0, ...groups.map((g) => g.heads.length))}">${rows(list, st, sel)}</ul></section>${ins}` +
    shown.map((r) => `<template data-inspect="${esc(r.key)}">${inspect(r)}</template>`).join("") + `</div>`;
}

/** The inspector's content for one item: its id with "Open page" to its page, its title, a status row, its facts, then `body`. `rows` is `[[label, html]]`. */
export const inspector = ({ id, title, status = "", rows: kv = [], body = "", href }) =>
  `<div class="inspect-head"><span class="idp">${esc(id)}</span>${href ? linkButton("Open page", href) : ""}</div><h3>${esc(title)}</h3>${status}${facts(kv)}${body}`;

/** Select `row`: mark it, show its inspector, and keep its key. A row that a search brought up has no template: its inspector is built now. */
function select(row) {
  const box = row.closest(".browse"), id = box.dataset.browse;
  for (const r of box.querySelectorAll(".lrow")) r.setAttribute("aria-current", String(r === row));
  const t = box.querySelector(`template[data-inspect="${CSS.escape(row.dataset.key)}"]`), r = lists.get(id).groups.flatMap((g) => g.rows).find((x) => x.key === row.dataset.key);
  box.querySelector(".ins").innerHTML = t ? t.innerHTML : inspect(r);
  keep(`browse.${id}`, { ...kept(`browse.${id}`, {}), sel: row.dataset.key });
}

/** Draw the rows that match the search and the filters again, from every row of the list. */
function apply(box) {
  const id = box.dataset.browse, f = {};
  for (const c of box.querySelectorAll(".lcard .seg[data-name]")) f[c.dataset.name] = c.querySelector('[aria-pressed="true"]')?.dataset.value ?? "";
  for (const c of box.querySelectorAll(".lcard select[name]")) f[c.name] = c.value;
  box.querySelector(".lrows").innerHTML = rows(lists.get(id), { q: box.querySelector('input[type="search"]').value, f }, kept(`browse.${id}`, {}).sel);
}

/** Keep a filter's value and draw again. */
function filter(box, name, value) {
  const id = box.dataset.browse, k = kept(`browse.${id}`, {});
  keep(`browse.${id}`, { ...k, f: { ...k.f, [name]: value } });
  apply(box);
}

if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const f = e.target.closest?.(".lcard .seg[data-name] button"), r = e.target.closest?.(".lrow");
    if (f) {
      for (const b of f.parentElement.children) b.setAttribute("aria-pressed", String(b === f));
      filter(f.closest(".browse"), f.parentElement.dataset.name, f.dataset.value);
    } else if (r && !e.target.closest("a, button, input, select, textarea, label")) select(r);
  });
  document.addEventListener("change", (e) => {
    if (e.target.matches?.(".lcard select[name]")) filter(e.target.closest(".browse"), e.target.name, e.target.value);
  });
  document.addEventListener("keydown", (e) => {
    const r = e.target.closest?.(".lrow");
    if (r && e.target === r && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(r); }
  });
  document.addEventListener("input", (e) => {
    if (!e.target.matches?.('.lcard input[type="search"]')) return;
    const box = e.target.closest(".browse");
    typed.set(box.dataset.browse, e.target.value);
    apply(box);
  });
}
