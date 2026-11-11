// The Flow page (was Efficiency): where agent time went, in hours. `d` is /api/flow for the window.
import { redraw } from "../router.js";
import { cell, count, card, empty, hours, meter, plural, row, sentence, statCard, dataTable, esc, heads, onTile, pageHead, pct, repoIdLink, setQuery, tiles, pagedTable, scope } from "../lib.js";
import { bar, cardHours, cardPct, mergeCauses, windowTrend } from "./speed.js";

const TOP_ISSUES = 5;
const ALL = "all", FLAKES = "flakes", USAGE = "usage";

/** What the cards show for a selection: a class, the reruns, or all the lost classes together. */
export function selection(d, key) {
  if (key === FLAKES) {
    const rows = d.flakes ?? [];
    return { title: "Reruns", causes: rows.map((f) => ({ name: f.name, runs: f.count })), top: [] };
  }
  if (key === USAGE) return { title: "Usage per issue", causes: [], top: d.issues?.usage ?? [] };
  const c = key !== ALL && (d.classes ?? []).find((x) => x.key === key);
  if (c) return { title: c.key[0].toUpperCase() + c.key.slice(1), causes: [...(c.causes ?? [])].sort((a, b) => b.hours - a.hours), top: (c.top ?? []).slice(0, TOP_ISSUES) };
  const causes = mergeCauses(d), lost = (d.classes ?? []).filter((x) => x.lost);
  return {
    title: "Lost Time",
    causes,
    top: lost.flatMap((x) => x.top ?? []).sort((a, b) => b.hours - a.hours).slice(0, TOP_ISSUES),
  };
}

function scorecard(d, key) {
  const returned = (d.classes ?? []).find((c) => c.key === "returned"), f = d.figures;
  const points = { kind: "points", format: cardPct }, flaky = d.baseline?.base?.flaky;
  const usage = d.issues.week;
  return statCard({ k: "Lost time", v: cardPct(f.lost), ...(f.lost == null ? {} : { v2: cardHours(f.hours), q: ["lost", "hours"] }), trend: windowTrend(d, "lost", f.lost, { ...points, lowerIsGood: true }), key: ALL, on: key === ALL }) +
    statCard({ k: "Landed", v: cardPct(f.firstPass), note: f.firstPass === null ? "no issue landed" : "lands with no fix round", trend: windowTrend(d, "firstPass", f.firstPass, { ...points, lowerIsGood: false }), key: "landed", on: key === "landed" }) +
    statCard({ k: "Reruns", v: count(d.flaky), note: "passed on rerun", trend: flaky == null ? "" : windowTrend(d, "flaky", d.flaky, { kind: "relative", lowerIsGood: true, format: count }), key: FLAKES, on: key === FLAKES }) +
    statCard({ k: "Returned", v: count(returned?.runs ?? 0), note: `${hours(returned?.hours ?? 0)} on ${plural(returned?.issues ?? 0, "issue")}`, key: "returned", on: key === "returned" }) +
    statCard({ k: "Usage per issue", v: usage === null ? "–" : pct(usage), note: usage === null ? "needs 6 hours of usage snapshots" : "p50 of weekly limit", ...(usage === null ? {} : { key: USAGE, on: key === USAGE }) });
}

const causeBars = (s) => {
  const size = (x) => x.hours ?? x.runs, max = size(s.causes[0] ?? {}) ?? 0, share = (x) => (max > 0 ? (size(x) / max) * 100 : 0);
  return pagedTable(heads(["Cause", "Took", "Jobs", "Bar"], ["Took", "Jobs"]), s.causes.map((x) =>
    row([cell(x.name, { wide: true }), cell(hours(x.hours), { num: true }), cell(count(x.runs), { num: true }), `<td>${meter(share(x), `${x.name}, ${pct(share(x))} of the largest`)}</td>`])));
};

const topTable = (rows) => dataTable(heads(["Issue", "Why", "Took", "Jobs"], ["Took", "Jobs"]), rows.map((x) =>
  row([`<td>${x.href ? repoIdLink(x.goal, x.href) : esc(x.goal)}</td>`, cell(`${x.title ? `${x.title}. ` : ""}${x.reason || "No reason recorded."}`, { wide: true }), cell(hours(x.hours), { num: true }), cell(count(x.runs), { num: true })])).join(""));

const usageTable = (rows) => pagedTable(heads(["Issue", "Usage", "Jobs"], ["Usage", "Jobs"]), rows.map((x) =>
  row([`<td${x.title ? ` title="${esc(x.title)}"` : ""}>${x.href ? repoIdLink(x.goal, x.href) : esc(x.goal)}</td>`, cell(pct(x.week), { num: true }), cell(count(x.runs), { num: true })])));

function usagePage(d, key) {
  const total = (d.classes ?? []).reduce((a, c) => a + c.hours, 0), nc = d.notCounted, s = selection(d, key);
  const head = scope().bar({ value: d.window ?? "week" });
  return `<div class="page sp" id="eff">${pageHead("Flow", { aside: head })}${tiles("Quality", scorecard(d, key))}` +
    card("Agent Time by Outcome", bar(d, key), { label: "Agent time by outcome", aside: `${esc(hours(total))} counted`, lede: nc?.runs ? `${plural(nc.runs, "job")}, ${hours(nc.hours)}, have no outcome yet` : undefined }) +
    card("Usage per Issue, Largest First", s.top.length ? usageTable(s.top) : empty("No issue to show.", "Widen the window or clear the project."), { label: "Usage per issue, largest first" }) + `</div>`;
}

/** The page body for a selection. `d` is /api/flow for the window, with its `baseline` when there is one. */
export function renderEfficiency(d, key = ALL) {
  if (key === USAGE) return usagePage(d, key);
  const s = selection(d, key), total = (d.classes ?? []).reduce((a, c) => a + c.hours, 0), nc = d.notCounted;
  const head = scope().bar({ value: d.window ?? "week" });
  return `<div class="page sp" id="eff">${pageHead("Flow", { aside: head })}${tiles("Quality", scorecard(d, key))}` +
    card("Agent Time by Outcome", bar(d, key), { label: "Agent time by outcome", aside: `${esc(hours(total))} counted`, lede: nc?.runs ? `${plural(nc.runs, "job")}, ${hours(nc.hours)}, have no outcome yet` : undefined }) +
    `<div class="pair">${card(`${s.title} Causes`, s.causes.length ? causeBars(s) : empty("No cause to show.", "Widen the window or clear the project."), { label: sentence(`${s.title} causes`) })}` +
    (key === FLAKES ? "" : card(`${s.title} Issues`, s.top.length ? topTable(s.top) : empty("No issue to show.", "Widen the window or clear the project."), { label: sentence(`${s.title} issues`) })) + `</div></div>`;
}

/** The old addresses. */
export const redirect = (hash) => {
  const [path, query] = String(hash ?? "").split(/\?(.*)/s);
  return ["#/status/efficiency", "#/factory/efficiency"].includes(path) ? `#/flow${query ? `?${query}` : ""}` : null;
};

export const view = {
  path: "/flow",
  title: "Flow",
  group: "factory",
  order: 1,
  icon: "chart-pie",
  api: (_params, q = new URLSearchParams()) => { const s = scope(q); return s.url(`/api/flow?window=${s.window}&baseline=1`); },
  live: true,
  refresh: 60,
  render: (d, _params, q) => renderEfficiency(d, q?.get("tile") ?? ALL),
  mount: (root) => {
    scope().wire(root);
    onTile(root.querySelector("#eff"), async (k) => {
      setQuery({ tile: k === ALL ? "" : k });
      await redraw();
      root.querySelector(`.tiles button[data-tile="${k}"], .obar button[data-tile="${k}"]`)?.focus();
    });
  },
};
