// The Tools view: a table each for tools, hooks and verify-gate denials.
// `data` is /api/activity.
import { empty, error, esc } from "../lib.js";

export const view = {
  path: "/activity",
  title: "Tools",
  group: "activity",
  order: 2,
  api: "/api/activity?days=7",
  refresh: 60,
  render: (d) => renderActivity(d),
};

const STYLE = `<style>
.act table { border-collapse: collapse; width: 100%; font: 13px var(--sans); }
.act th, .act td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--rule-2); }
.act th { color: var(--muted); font-weight: 500; }
.act td.n, .act th.n { text-align: right; font-variant-numeric: tabular-nums; }
.act .bad { color: var(--stuck); }
</style>`;

const sh = (title, aside = "") => `<div class="sh"><h2>${esc(title)}</h2>${aside ? `<span class="aside">${esc(aside)}</span>` : ""}</div>`;
const table = (head, rows) =>
  `<table><thead><tr>${head.map(([h, n]) => `<th${n ? ' class="n"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;

const counts = (rows, word) => rows.length
  ? table([[word], ["Calls", 1], ["Errors", 1]], rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${r.calls}</td><td class="n${r.errors ? " bad" : ""}">${r.errors}</td></tr>`))
  : empty(`No ${word.toLowerCase()} calls in this period.`);

export function renderActivity(a) {
  if (!a) return `<div class="page">${error("No data.")}</div>`;
  const lf = a.langfuse === "off" ? empty("Langfuse is not configured.", "Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in <code>~/.aleph/.env</code>.")
    : a.langfuse === "error" ? error(`Langfuse failed: ${a.error}`, "Check that Langfuse is running, then reload.") : "";
  return `${STYLE}<div class="page act"><h1>Tools</h1>` + (lf ||
    sh("Tools") + counts(a.tools, "Tool") +
    sh("Hooks") + counts(a.hooks, "Hook") +
    sh("Verify-gate denials", String(a.denials.total)) +
    (a.denials.recent.length ? table([["When"], ["Reason"]], a.denials.recent.map((r) => `<tr><td>${esc(r.at.slice(0, 16).replace("T", " "))}</td><td>${esc(r.reason)}</td></tr>`)) : empty("The gate denied nothing in this period."))) +
    `</div>`;
}
