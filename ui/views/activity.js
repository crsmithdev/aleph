// The Tools view: a table each for tools, hooks and verify-gate denials.
// `data` is /api/activity. Each table shows 50 rows and a pager.
import { empty, error, esc, pageHead, pager, when } from "../lib.js";

export const view = {
  path: "/activity",
  title: "Tools",
  group: "claude",
  order: 2,
  api: "/api/activity?days=7",
  refresh: 60,
  render: (d) => renderActivity(d),
  mount: (root, d) => mountActivity(root, d),
};

const STEP = 50;
const STYLE = `<style>
.act td.bad { color: var(--stuck); }
</style>`;

const sh = (title, aside = "") => `<div class="sh"><h2>${esc(title)}</h2>${aside ? `<span class="aside">${esc(aside)}</span>` : ""}</div>`;
/** A table of the first `shown` rows and its pager. `head` is [label, cls] pairs; `rows` are the row HTML strings. */
const table = (key, head, rows, shown) =>
  `<div class="tscroll"><table class="tbl" data-table="${key}"><thead><tr>${head.map(([h, c]) => `<th${c ? ` class="${c}"` : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.slice(0, shown).join("")}</tbody></table></div>` +
  (rows.length > STEP ? `<div data-pager="${key}">${pager(shown, rows.length, STEP)}</div>` : "");

const counts = (key, rows, word, shown) => rows.length
  ? table(key, [[word], ["Calls", "num"], ["Errors", "num"]], rows.map((r) => `<tr><td class="wide">${esc(r.name)}</td><td class="num">${r.calls}</td><td class="num${r.errors ? " bad" : ""}">${r.errors}</td></tr>`), shown)
  : empty(`No ${word.toLowerCase()} calls in this period.`);

/** The page's contents: the header and the tables. `shown` is how many rows each table shows, by key (tools, hooks, denials); 50 when absent. */
function body(a, shown) {
  const n = (k) => shown[k] ?? STEP;
  const lf = a.langfuse === "off" ? empty("Langfuse is not configured.", "Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in <code>~/.aleph/.env</code>.")
    : a.langfuse === "error" ? error(`Langfuse failed: ${a.error}`, "Check that Langfuse is running, then reload.") : "";
  return pageHead("Tools") + (lf ||
    sh("Tools") + counts("tools", a.tools, "Tool", n("tools")) +
    sh("Hooks") + counts("hooks", a.hooks, "Hook", n("hooks")) +
    sh("Verify-gate denials", String(a.denials.total)) +
    (a.denials.recent.length ? table("denials", [["Reason"], ["When"]], a.denials.recent.map((r) => `<tr><td class="wide">${esc(r.reason)}</td><td class="time">${esc(when(r.at))}</td></tr>`), n("denials")) : empty("The gate denied nothing in this period.")));
}

export function renderActivity(a) {
  if (!a) return `<div class="page">${error("No data.")}</div>`;
  return `${STYLE}<div class="page act">${body(a, {})}</div>`;
}

export function mountActivity(root, d) {
  const page = root.querySelector?.(".act");
  if (!page || !d) return;
  const shown = {};
  page.addEventListener("click", (ev) => {
    const b = ev.target?.closest?.("button[data-more]");
    const key = b?.closest("[data-pager]")?.dataset.pager;
    if (!key) return;
    shown[key] = (shown[key] ?? STEP) + Number(b.dataset.more);
    page.innerHTML = body(d, shown);
  });
}
