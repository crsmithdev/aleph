// The Tools view: a table each for tools, hooks and verify-gate denials.
// `data` is /api/activity. Each table shows 50 rows and a pager.
import { empty, error, esc, filterBar, numCell, pageHead, pager, sectionHead, when } from "../lib.js";

export const view = {
  path: "/activity",
  title: "Tools",
  group: "claude",
  order: 2,
  api: (_params, q = new URLSearchParams()) => {
    const out = new URLSearchParams({ days: q.get("days") || "7" });
    if (q.get("project")) out.set("project", q.get("project"));
    return `/api/activity?${out}`;
  },
  refresh: 60,
  render: (d, _params, query) => renderActivity(d, Object.fromEntries(query ?? [])),
  mount: (root, d, query) => mountActivity(root, d, Object.fromEntries(query ?? [])),
};

const STEP = 50;
/** A table of the first `shown` rows and its pager. `head` is [label, cls] pairs; `rows` are the row HTML strings. */
const table = (key, head, rows, shown) =>
  `<div class="tscroll"><table class="tbl fit" data-table="${key}"><thead><tr>${head.map(([h, c]) => `<th${c ? ` class="${c}"` : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.slice(0, shown).join("")}</tbody></table></div>` +
  (rows.length > STEP ? `<div data-pager="${key}">${pager(shown, rows.length, STEP)}</div>` : "");

const counts = (key, rows, word, shown) => rows.length
  ? table(key, [[word], ["Calls", "num"], ["Errors", "num"], ["Last"]], rows.map((r) => `<tr><td class="wide">${esc(r.name)}</td>${numCell(r.calls, { bad: false })}${numCell(r.errors)}<td class="time">${esc(when(r.lastAt))}</td></tr>`), shown)
  : empty(`No ${word.toLowerCase()} calls in this period.`);

/** The page's contents: the header and the tables. `shown` is how many rows each table shows, by key (tools, hooks, denials); 50 when absent. */
function body(a, shown, f = {}) {
  const projects = a.projects ?? [];
  const bar = filterBar([
    { label: "Project", name: "project", value: projects.includes(f.project) ? f.project : "", options: [{ value: "", label: "All" }, ...projects] },
    { label: "Window", name: "days", value: f.days || "7", options: [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }] },
  ]);
  const n = (k) => shown[k] ?? STEP;
  const lf = a.langfuse === "off" ? empty("Langfuse is not configured.", "Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in <code>~/.aleph/.env</code>.")
    : a.langfuse === "error" ? error(`Langfuse failed: ${a.error}`, "Check that Langfuse is running, then reload.") : "";
  return pageHead("Tools", { count: lf ? "" : String(a.tools.length) }) + bar + (lf ||
    counts("tools", a.tools, "Tool", n("tools")) +
    sectionHead("Hooks") + counts("hooks", a.hooks, "Hook", n("hooks")) +
    sectionHead("Verify-gate denials", { count: a.denials.total }) +
    (a.denials.recent.length ? table("denials", [["Reason"], ["When"]], a.denials.recent.map((r) => `<tr><td class="wide">${esc(r.reason)}</td><td class="time">${esc(when(r.at))}</td></tr>`), n("denials")) : empty("The gate denied nothing in this period.")));
}

export function renderActivity(a, f = {}) {
  if (!a) return `<div class="page">${error("No data.")}</div>`;
  return `<div class="page tools">${body(a, {}, f)}</div>`;
}

export function mountActivity(root, d, f = {}) {
  const page = root.querySelector?.(".tools");
  if (!page || !d) return;
  const shown = {};
  const go = (name, value) => {
    const q = new URLSearchParams(Object.entries({ days: f.days, project: f.project, [name]: value }).filter(([, v]) => v));
    location.hash = `#/activity${q.toString() ? `?${q}` : ""}`;
  };
  page.addEventListener("change", (ev) => { if (ev.target.matches?.(".fbar select")) go(ev.target.name, ev.target.value); });
  page.addEventListener("click", (ev) => {
    const seg = ev.target?.closest?.(".seg button");
    if (seg) return go(seg.parentElement.dataset.name, seg.dataset.value);
    const b = ev.target?.closest?.("button[data-more]");
    const key = b?.closest("[data-pager]")?.dataset.pager;
    if (!key) return;
    shown[key] = (shown[key] ?? STEP) + Number(b.dataset.more);
    page.innerHTML = body(d, shown, f);
  });
}
