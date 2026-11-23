// The page grammar of design/rules.md (`page-grammar`): the head with its view tabs, the attention rows, the facts line and the figure band.
import { setQuery, scope } from "./address.js";
import { rowsOf } from "./attention.js";
import { esc, linkButton, pageHead, seg } from "./html.js";
import { redraw } from "./router.js";

/** The view of the query `q` among `ids`: its `view`, else the first id, which is the default. */
export const viewOf = (q, ids) => (ids.includes(q.get("view")) ? q.get("view") : ids[0]);

/**
 * The attention rows (Grammar 2): one per problem, in its tone, with its action at the right; nothing when `rows` is empty.
 * @design attention-rows
 */
export const attention = (rows) => (rows.length ? `<div class="attn">${rows.map((r) =>
  `<div class="arow ${r.tone}" role="${r.tone === "error" ? "alert" : "status"}"><span class="event-dot ${r.tone === "need" ? "warning" : r.tone}" aria-hidden="true"></span><span class="t">${esc(r.text)}</span>${r.act ? linkButton(r.act.label, r.act.href) : ""}</div>`).join("")}</div>` : "");

/** The view tabs of a page head: a segmented control with a button for each of `views` `[{ id, label }]`; `cur` is the current id. The first view is the default. */
export const viewTabs = (views, cur) =>
  seg("Views", views.map((v) => ({ label: v.label, on: v.id === cur, attrs: ` data-view="${esc(v.id)}"` })), ` data-default="${esc(views[0].id)}"`);

/**
 * A page of views (Grammar 1 to 5): the head with the title and the view tabs, the scope control on a view with `scope`, the page's
 * attention rows, then the current view. `views` is `[{ id, label, scope?, draw }]` in the page's order (`scope` is `true`, or the options of `scope().bar`); `draw()` is the view's HTML.
 * `path` is the page's route, which names its attention rows. The current view is the hash's `view`: a tab sets it and draws again.
 * The first view is the default and leaves no `view` in the hash.
 * @design page-head
 */
export function pageViews({ title, path, query, views }) {
  const cur = viewOf(query, views.map((v) => v.id)), on = views.find((v) => v.id === cur);
  return `<div class="page views">${pageHead(title, { after: views.length > 1 ? viewTabs(views, cur) : "", aside: on.scope ? scope(query).bar(on.scope === true ? {} : on.scope) : "" })}${attention(rowsOf(path))}${on.draw()}</div>`;
}

/**
 * The facts line of a list view (Grammar 3): at most 4 figures at text size, each `[figure, words]`.
 * @design facts-line
 */
export function factsLine(items) {
  if (items.length > 4) throw new Error("A facts line holds at most 4 figures.");
  return `<p class="factline">${items.map(([v, k]) => `<span><b class="num">${esc(v)}</b> ${esc(k)}</span>`).join(" ")}</p>`;
}

/**
 * The figure band of an analysis view (Grammar 3): at most 4 figures `{ k, v, cmp, trend?, title? }`, each with its comparison; `trend` is "good" or "warn".
 * @design figure-band
 */
export function figureBand(figs) {
  if (figs.length > 4) throw new Error("A figure band holds at most 4 figures.");
  return `<section class="band" aria-label="Figures">${figs.map((f) => `<div class="fig"${f.title ? ` title="${esc(f.title)}"` : ""}><span class="k">${esc(f.k)}</span><b class="num">${esc(f.v)}</b><span class="cmp${f.trend ? ` ${f.trend}` : ""}">${esc(f.cmp)}</span></div>`).join("")}</section>`;
}

if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.(".ph button[data-view]");
    if (!b) return;
    setQuery({ view: b.dataset.view === b.parentElement.dataset.default ? "" : b.dataset.view });
    redraw();
  });
}
