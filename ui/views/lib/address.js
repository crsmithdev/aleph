// What the address holds (the hash's query, the window, the project), what the browser keeps per component, and the POST helper.

import { shortId } from "../../../lib/naming.ts";
import { FACTORY } from "../../../lib/windows.ts";
import { esc, filterBar } from "./html.js";

/** The value last kept for `key`, else `fallback`. Storage can be missing or blocked. */
export function kept(key, fallback = null) {
  try { const v = localStorage.getItem(`aleph.${key}`); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
/** Keep `value` (JSON) for `key`. With no storage the value is lost, and the component shows its default. */
export function keep(key, value) {
  try { localStorage.setItem(`aleph.${key}`, JSON.stringify(value)); } catch { /* no storage */ }
}
/** The hash's query. */
export const hashQuery = () => new URLSearchParams(location.hash.split("?")[1] ?? "");
/** A hash split into its path and query; a hash with no path (`#?window=day`) is the path `/`. */
export function parseHash(hash) {
  const h = hash.replace(/^#/, "");
  const i = h.indexOf("?");
  return { path: (i < 0 ? h : h.slice(0, i)) || "/", query: new URLSearchParams(i < 0 ? "" : h.slice(i + 1)) };
}
const withQuery = (changes) => {
  const path = parseHash(location.hash).path;
  const q = hashQuery();
  for (const [k, v] of Object.entries(changes)) { if (v) q.set(k, v); else q.delete(k); }
  return `#${path}${q.toString() ? `?${q}` : ""}`;
};
/** Change the hash's query with no reload: for a selection, a sort or a filter the view redraws itself. */
export const setQuery = (changes) => history.replaceState(null, "", withQuery(changes));
/** Change the hash's query and load the route again: for a filter that changes what the API returns. */
export const goQuery = (changes) => { location.hash = withQuery(changes); };
/** The `.fbar` in `.ph` holds what scopes the whole page; each change goes to the hash and loads the route again. */
export function wireScope(root) {
  const ph = root.querySelector?.(".ph");
  if (!ph || ph._scope) return;
  ph._scope = true;
  ph.addEventListener("click", (e) => {
    const b = e.target.closest?.(".seg button");
    if (b) { remember(b.parentElement.dataset.name, b.dataset.value); goQuery({ [b.parentElement.dataset.name]: b.dataset.value }); }
  });
  ph.addEventListener("change", (e) => {
    if (!e.target.matches?.("select")) return;
    remember(e.target.name, e.target.value);
    goQuery({ [e.target.name]: e.target.value });
  });
  const select = ph.querySelector?.('select[name="project"]');
  if (select) projectKeysOnce().then((keys) => { if (keys.length) select.innerHTML = projectOptions(select.value, (select.dataset.more ?? "").split(" ").filter(Boolean)); });
}
const OPTIONS = FACTORY.map((w) => ({ value: w, label: w[0].toUpperCase() + w.slice(1) }));
const isWindow = (w) => FACTORY.includes(w);
/** Remember the project ("" is All) or a window of the Factory pages across the pages; any other control is not kept. */
export function remember(name, value) {
  if (name === "project") keep("project", value || "");
  if (name === "window" && isWindow(value)) keep("window", value);
}
/** The registry's repos from /api/projects: `{ key: { code, issues, onboarded } }`. */
let projects = {};
let keysLoad = null;
/** The registry's repo keys, fetched once; a failed fetch gives [] and is tried again by the next call. */
export const projectKeysOnce = () => keysLoad ??= fetch("/api/projects").then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((all) => {
  const keys = Object.keys(all);
  if (keys.length) projects = all;
  else keysLoad = null;
  return keys;
});
/**
 * The options of the Project select: All and aleph, then the other onboarded repos, then the other repos with an open issue,
 * each with its count of open issues, once /api/projects has answered. A project of `more` or `cur` goes among the rest, though it has no open issue; one that the registry does not hold goes last, with no count.
 */
function projectOptions(cur, more = []) {
  const item = (value, label) => `<option value="${esc(value)}"${value === cur ? " selected" : ""}>${esc(label)}</option>`;
  const named = (k) => item(k, `${k} (${projects[k].issues})`);
  const keys = Object.keys(projects).sort(), rest = keys.filter((k) => k !== "aleph");
  const total = keys.reduce((n, k) => n + projects[k].issues, 0);
  const groups = [
    rest.filter((k) => projects[k].onboarded).map(named),
    [...rest.filter((k) => !projects[k].onboarded && (projects[k].issues > 0 || k === cur || more.includes(k))).map(named),
      ...[...new Set([...more, cur])].filter((k) => k && !projects[k]).sort().map((k) => item(k, k))],
  ].filter((g) => g.length);
  return [item("", keys.length ? `All Projects (${total})` : "All Projects"), ...(projects.aleph ? [named("aleph")] : []), ...groups.map((g) => `<hr>${g.join("")}`)].join("");
}
/**
 * The scope of a page from its query `q`, the address's by default. The project ("" is All) and the window come from the
 * address first, then the last one chosen, else All and week.
 * - `url(path)`: the request URL of `path` in the project.
 * - `bar(o)`: the head's Project select, then the window control, then `o.after` (html for a control of the page). `o.more`
 *   adds project names the page knows, `o.project` and `o.value` replace the two
 *   values shown, and `o.name` and `o.options` replace the window control (a window other than `window` is not kept).
 *   `o.window: false` leaves the window control out, for a page whose data takes no window.
 * - `wire(root)`: keep the project and the window in storage and in the address (replaced in place, with no reload; week
 *   stays out of it), and send each change of the bar to the address, which loads the route again.
 */
export function scope(q = typeof location === "undefined" ? new URLSearchParams() : hashQuery()) {
  const w = q.get("window"), t = kept("window");
  const project = q.get("project") || kept("project", ""), window = isWindow(w) ? w : isWindow(t) ? t : "week";
  return {
    project,
    window,
    url: (path) => (project ? `${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(project)}` : path),
    bar: (o = {}) => filterBar([
      { html: `<select name="project" aria-label="Project"${o.more?.length ? ` data-more="${esc(o.more.join(" "))}"` : ""}>${projectOptions(o.project ?? project, o.more)}</select>` },
      ...(o.window === false ? [] : [{ label: "Window", bare: true, name: o.name ?? "window", value: o.value ?? window, options: o.options ?? OPTIONS }]),
      ...(o.after ? [{ html: o.after }] : []),
    ]),
    wire: (root) => {
      remember("window", window);
      remember("project", project);
      if (window !== "week" && hashQuery().get("window") !== window) setQuery({ window });
      if (project && hashQuery().get("project") !== project) setQuery({ project });
      wireScope(root);
    },
  };
}
/** POSTs `body` as JSON with the header the server wants. Resolves to the JSON reply; throws its `error`, or the text of a reply that is not JSON, when the reply is not ok. */
export async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "X-Aleph-UI": "1", "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(data?.error || text.trim() || `answered ${res.status}`);
  return data ?? {};
}
/** The API path of issue `<repo>-<ref>`: `/api/issues/a1430`. */
export const issueApi = (repo, ref) => `/api/issues/${encodeURIComponent(shortId(`${repo}-${ref}`))}`;
