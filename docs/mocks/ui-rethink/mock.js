// The UI re-think mock's behaviour: view tabs by the URL hash, row select into the inspector, the list filters,
// Save after a change, and the theme. Not part of the design.
const KEY = "ui-rethink-theme";
if (new URLSearchParams(location.search).has("thumb")) document.documentElement.classList.add("thumb");

function theme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  for (const b of document.querySelectorAll("[data-set-theme]")) b.setAttribute("aria-pressed", b.dataset.setTheme === t);
}

/** Show the pane the hash names, else the first; the window control shows only on a view it changes. */
function show() {
  const panes = [...document.querySelectorAll(".rt-pane")];
  if (!panes.length) return;
  const id = panes.some((p) => p.dataset.pane === location.hash.slice(1)) ? location.hash.slice(1) : panes[0].dataset.pane;
  for (const p of panes) p.hidden = p.dataset.pane !== id;
  for (const b of document.querySelectorAll("[data-view]")) b.setAttribute("aria-pressed", b.dataset.view === id);
  for (const s of document.querySelectorAll(".rt-scope")) s.hidden = !s.dataset.scope.split(" ").includes(id);
}

function select(row) {
  const box = row.closest(".rt-browse");
  for (const r of box.querySelectorAll(".rt-row")) r.setAttribute("aria-selected", r === row);
  const t = box.parentElement.querySelector(`template[data-inspect="${CSS.escape(row.dataset.key)}"]`);
  if (t) box.querySelector(".rt-ins").replaceChildren(t.content.cloneNode(true));
}

/** Hide the rows the search and the filters leave out, and a group head with no row left. */
function filter(list) {
  const q = list.querySelector('input[type="search"]').value.trim().toLowerCase();
  const on = [...list.querySelectorAll(".seg[data-name]")].map((s) => [s.dataset.name, s.querySelector('[aria-pressed="true"]')?.dataset.value ?? ""]).filter(([, v]) => v);
  let head = null, shown = 0;
  const close = () => { if (head) head.hidden = !shown; };
  for (const li of list.querySelectorAll(".rt-rows > li")) {
    if (li.classList.contains("rt-ghead")) { close(); head = li; shown = 0; continue; }
    if (!li.classList.contains("rt-row")) { li.hidden = Boolean(q || on.length); continue; }
    li.hidden = Boolean((q && !li.dataset.text.includes(q)) || on.some(([k, v]) => li.dataset[k] !== v));
    if (!li.hidden) shown++;
  }
  close();
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-set-theme]"), v = e.target.closest("[data-view]"), r = e.target.closest(".rt-row"), f = e.target.closest(".rt-list .seg[data-name] button");
  if (t) { localStorage.setItem(KEY, t.dataset.setTheme); theme(t.dataset.setTheme); }
  if (v) location.hash = v.dataset.view;
  if (r && !e.target.closest("a")) select(r);
  if (f) { for (const b of f.parentElement.children) b.setAttribute("aria-pressed", b === f); filter(f.closest(".rt-list")); }
});
document.addEventListener("keydown", (e) => {
  const r = e.target.closest?.(".rt-row");
  if (r && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(r); }
});
document.addEventListener("input", (e) => {
  if (e.target.matches('.rt-list input[type="search"]')) filter(e.target.closest(".rt-list"));
  e.target.closest(".settings .srow")?.classList.add("dirty");
});
document.addEventListener("change", (e) => e.target.closest(".settings .srow")?.classList.add("dirty"));
document.addEventListener("submit", (e) => { e.preventDefault(); e.target.classList.remove("dirty"); });
addEventListener("hashchange", show);

theme(localStorage.getItem(KEY) ?? "");
show();
const fit = () => { for (const s of document.querySelectorAll(".shot")) s.style.setProperty("--k", s.clientWidth / 1440); };
addEventListener("resize", fit);
fit();
