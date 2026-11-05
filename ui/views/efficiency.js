// The Efficiency page: where agent time went, in hours. `d` is /api/speed for the window.
import { card, empty, meter, sentence, statCard, dataTable, esc, hashQuery, keepProject, projectNow, scopeBar, withProject, heads, onTile, pageHead, pct, repoIdLink, keepWindow, setQuery, tiles, windowOf, wireScope, pagedTable } from "../lib.js";
import { bar, cardHours, cardPct, figuresOf, hours, lostClasses, lastPeriod, mergeCauses, plural, weekText, windowTrend } from "./speed.js";

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
  if (c) return { title: c.name, causes: [...(c.causes ?? [])].sort((a, b) => b.hours - a.hours), top: (c.top ?? []).slice(0, TOP_ISSUES) };
  const causes = mergeCauses(d), lost = lostClasses(d);
  return {
    title: "Lost Time",
    causes,
    top: lost.flatMap((x) => x.top ?? []).sort((a, b) => b.hours - a.hours).slice(0, TOP_ISSUES),
  };
}

function scorecard(d, key) {
  const fixed = (d.classes ?? []).find((c) => c.key === "fixed"), f = figuresOf(d);
  const pct = { kind: "points", format: cardPct }, flaky = d.baseline?.base?.flaky;
  const usage = d.issues.week;
  return statCard({ k: "Lost time", v: cardPct(f.lost), ...(f.lost == null ? {} : { v2: cardHours(f.hours) }), trend: windowTrend(d, "lost", f.lost, { ...pct, lowerIsGood: true }), key: ALL, on: key === ALL }) +
    statCard({ k: "First pass", v: cardPct(f.firstPass), note: f.firstPass === null ? "no issue landed" : "lands with no fix round", trend: windowTrend(d, "firstPass", f.firstPass, { ...pct, lowerIsGood: false }), key: "landed", on: key === "landed" }) +
    statCard({ k: "Reruns", v: String(d.flaky), note: "passed on rerun", trend: flaky == null ? "" : windowTrend(d, "flaky", d.flaky, { kind: "relative", lowerIsGood: true, format: String }), key: FLAKES, on: key === FLAKES }) +
    statCard({ k: "Fix rounds", v: String(fixed?.runs ?? 0), note: `${hours(fixed?.hours ?? 0)} on ${plural(fixed?.issues ?? 0, "issue")}`, key: "fixed", on: key === "fixed" }) +
    statCard({ k: "Usage per issue", v: usage === null ? "–" : weekText(usage), note: usage === null ? "needs 6 hours of usage snapshots" : "of the weekly limit, median", ...(usage === null ? {} : { key: USAGE, on: key === USAGE }) });
}

const causeBars = (s) => {
  const size = (x) => x.hours ?? x.runs, max = size(s.causes[0] ?? {}) ?? 0;
  return pagedTable(heads(["Cause", "Took", "Runs", "Bar"], ["Took", "Runs"]), s.causes.map((x) =>
    `<tr><td title="${esc(x.name)}">${esc(x.name)}</td><td class="num">${x.hours === undefined ? "" : esc(hours(x.hours))}</td><td class="num">${x.runs}</td><td>${meter(max > 0 ? (size(x) / max) * 100 : 0)}</td></tr>`));
};

const topTable = (rows) => dataTable(heads(["Issue", "Why", "Took", "Runs"], ["Took", "Runs"]), rows.map((x) =>
  `<tr><td>${x.href ? repoIdLink(x.goal, x.href) : esc(x.goal)}</td><td class="wide" title="${esc(`${x.title ? `${x.title}. ` : ""}${x.reason || "No reason recorded."}`)}">${x.title ? `${esc(x.title)}. ` : ""}${esc(x.reason || "No reason recorded.")}</td><td class="num">${esc(hours(x.hours))}</td><td class="num">${x.runs}</td></tr>`).join(""));

const usageTable = (rows) => pagedTable(heads(["Issue", "Usage", "Runs"], ["Usage", "Runs"]), rows.map((x) =>
  `<tr><td${x.title ? ` title="${esc(x.title)}"` : ""}>${x.href ? repoIdLink(x.goal, x.href) : esc(x.goal)}</td><td class="num">${esc(weekText(x.week))}</td><td class="num">${x.runs}</td></tr>`));

function usagePage(d, key) {
  const total = (d.classes ?? []).reduce((a, c) => a + c.hours, 0), nc = d.notCounted, s = selection(d, key);
  const scope = scopeBar(projectNow(), d.window ?? "week");
  return `<div class="page sp" id="eff">${pageHead("Efficiency", { count: lastPeriod(d), aside: scope })}${tiles("Quality", scorecard(d, key))}` +
    card("Agent Time by Outcome", bar(d, key), { label: "Agent time by outcome", aside: `${esc(hours(total))} counted${nc?.runs ? ` · ${esc(plural(nc.runs, "run"))}, ${esc(hours(nc.hours))}, have no outcome yet` : ""}` }) +
    card("Usage per Issue, Largest First", s.top.length ? usageTable(s.top) : empty("No issue to show."), { label: "Usage per issue, largest first" }) + `</div>`;
}

/** The page body for a selection. `d` is /api/speed for the window, with its `baseline` when there is one. */
export function renderEfficiency(d, key = ALL) {
  if (key === USAGE) return usagePage(d, key);
  const s = selection(d, key), total = (d.classes ?? []).reduce((a, c) => a + c.hours, 0), nc = d.notCounted;
  const scope = scopeBar(projectNow(), d.window ?? "week");
  return `<div class="page sp" id="eff">${pageHead("Efficiency", { count: lastPeriod(d), aside: scope })}${tiles("Quality", scorecard(d, key))}` +
    card("Agent Time by Outcome", bar(d, key), { label: "Agent time by outcome", aside: `${esc(hours(total))} counted${nc?.runs ? ` · ${esc(plural(nc.runs, "run"))}, ${esc(hours(nc.hours))}, have no outcome yet` : ""}` }) +
    `<div class="pair">${card(`${s.title} Causes`, s.causes.length ? causeBars(s) : empty("No cause to show."), { label: sentence(`${s.title} causes`) })}` +
    (key === FLAKES ? "" : card(`${s.title} Issues`, s.top.length ? topTable(s.top) : empty("No issue to show."), { label: sentence(`${s.title} issues`) })) + `</div></div>`;
}

/** The old address. */
export const redirect = (hash) => (String(hash ?? "").split("?")[0] === "#/status/efficiency" ? "#/factory/efficiency" : null);

const picked = () => hashQuery().get("tile") ?? ALL;

export const view = {
  path: "/factory/efficiency",
  title: "Efficiency",
  group: "factory",
  order: 1,
  icon: "chart-pie",
  api: (_params, q = new URLSearchParams()) => withProject(`/api/speed?window=${windowOf(q)}&baseline=1`, q),
  refresh: 60,
  render: (d, _params, q) => renderEfficiency(d, q?.get("tile") ?? ALL),
  mount: async (root, d) => {
    keepWindow(d.window ?? windowOf(hashQuery()));
    keepProject(projectNow());
    const draw = () => { root.innerHTML = renderEfficiency(d, picked()); wire(); };
    const wire = () => {
      const page = root.querySelector("#eff");
      wireScope(root);
      onTile(page, (k) => {
        setQuery({ tile: k === ALL ? "" : k });
        draw();
        root.querySelector(`.tiles button[data-tile="${k}"], .obar button[data-tile="${k}"]`)?.focus();
      });
    };
    wire();
  },
};
