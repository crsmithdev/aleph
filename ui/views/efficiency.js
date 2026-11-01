// The Efficiency page: where agent time went, in hours. `d` is /api/speed for the window.
import { barList, barRow, card, dataTable, esc, filterBar, hashQuery, heads, onTile, pageHead, repoIdLink, keepWindow, setQuery, small, tile, tiles, WINDOWS, windowOf, wireScope } from "../lib.js";
import { firstPassTile, hours, loadSpeed, lostClasses, lastPeriod, lostTile, mergeCauses, pctText, period, plural, trendOn, usable, weekText } from "./speed.js";

const TOP_ISSUES = 5;
const REPO = "aleph";
const ALL = "all", FLAKES = "flakes", USAGE = "usage";

/** What the cards show for a selection: a class, the reruns, or all the lost classes together. */
export function selection(d, key) {
  if (key === FLAKES) {
    const rows = d.flakes ?? [];
    return { title: "Reruns", text: "Checks that failed, then passed on a rerun of the same tree.", size: `${plural(d.flaky, "rerun")}.`, causes: rows.map((f) => ({ name: f.name, runs: f.count })), top: [] };
  }
  if (key === USAGE) return { title: "Usage per issue", text: "Landed issues by the share of the weekly limit their agent runs took.", size: `${plural((d.issues?.usage ?? []).length, "issue")}.`, causes: [], top: d.issues?.usage ?? [] };
  const c = key !== ALL && (d.classes ?? []).find((x) => x.key === key);
  if (c) return { title: c.name, text: c.text, size: `${plural(c.runs, "run")} on ${plural(c.issues, "issue")}.`, causes: [...(c.causes ?? [])].sort((a, b) => b.hours - a.hours), top: (c.top ?? []).slice(0, TOP_ISSUES) };
  const causes = mergeCauses(d), lost = lostClasses(d), first = causes[0], sum = causes.reduce((a, x) => a + x.hours, 0);
  const names = lost.filter((x) => x.hours > 0).map((x) => x.name);
  return {
    title: "Lost time",
    text: `${names.join(", ").replace(/, ([^,]*)$/, " and $1") || "Nothing"} together.${first ? ` The first cause is ${pctText(first.hours / sum)} of the loss.` : ""}`,
    size: `${plural(lost.reduce((a, x) => a + x.runs, 0), "run")}.`,
    causes,
    top: lost.flatMap((x) => x.top ?? []).sort((a, b) => b.hours - a.hours).slice(0, TOP_ISSUES),
  };
}

function scorecard(d, day, key) {
  const fixed = (d.classes ?? []).find((c) => c.key === "fixed");
  return lostTile(d, day, { key: ALL, on: key === ALL }) + firstPassTile(d, day, { key: "landed", on: key === "landed" }) +
    tile({ k: "Reruns", v: String(d.flaky), body: small("checks passed on rerun") + (day && trendOn(d) ? small(`${day.flaky} in the last 24 h`) : ""), key: FLAKES, on: key === FLAKES }) +
    tile({ k: "Fix rounds", v: String(fixed?.runs ?? 0), body: small(`${hours(fixed?.hours ?? 0)} on ${plural(fixed?.issues ?? 0, "issue")}`), key: "fixed", on: key === "fixed" }) +
    tile({ k: "Usage per issue", v: d.issues.week === null ? "–" : weekText(d.issues.week), body: small(d.issues.week === null ? "needs 6 hours of usage snapshots" : "of the weekly limit, median"), ...(d.issues.week === null ? {} : { key: USAGE, on: key === USAGE }) });
}

function bar(d, key) {
  const cs = (d.classes ?? []).filter((c) => c.hours > 0), total = cs.reduce((a, c) => a + c.hours, 0);
  if (!(total > 0)) return `<p>No agent run of an issue ended in the ${lastPeriod(d)}.</p>`;
  const seg = (c) => `<button type="button" class="seg-${esc(c.key)}" data-tile="${esc(c.key)}" style="flex:${c.hours}" aria-pressed="${c.key === key}" title="${esc(c.text)}"><b>${esc(c.name)}</b><span>${esc(hours(c.hours))} · ${Math.round((c.hours / total) * 100)}%</span></button>`;
  return `<div class="obar" role="group" aria-label="Agent time by outcome">${cs.map(seg).join("")}</div>`;
}

const causeBars = (s) => {
  const size = (x) => x.hours ?? x.runs, max = size(s.causes[0] ?? {}) ?? 0;
  return barList(s.causes.map((x, i) => barRow(`<b>${esc(x.name)}</b>`, max > 0 ? (size(x) / max) * 100 : 0, x.hours === undefined ? esc(plural(x.runs, "rerun")) : `${esc(hours(x.hours))} · ${esc(plural(x.runs, "run"))}`, { top: i === 0 })).join(""));
};

const topTable = (rows) => dataTable(heads(["Issue", "Why", "Hours", "Runs"], ["Hours", "Runs"]), rows.map((x) =>
  `<tr><td>${x.href ? repoIdLink(x.goal, x.href) : esc(x.goal)}</td><td class="wide" title="${esc(`${x.title ? `${x.title}. ` : ""}${x.reason || "No reason recorded."}`)}">${x.title ? `${esc(x.title)}. ` : ""}${esc(x.reason || "No reason recorded.")}</td><td class="num">${esc(hours(x.hours))}</td><td class="num">${x.runs}</td></tr>`).join(""));

/** The issue that "File an issue" files for a selection: its first cause as the title, its runs and reasons as the body. The reruns have no hours to file. */
export function issueFor(d, key) {
  const s = selection(d, key), first = s.causes[0];
  if (!first || key === FLAKES) return null;
  const rows = s.top.map((x) => `- ${x.goal}: ${hours(x.hours)}, ${plural(x.runs, "run")}. ${x.reason || "No reason recorded."}`);
  return { repo: REPO, title: `Lost time: ${first.name}`, body: `${first.name}: ${hours(first.hours)}, ${plural(first.runs, "run")} in the last ${period(d)}.\n\n${s.title}, the issues that cost the most:\n${rows.join("\n")}` };
}

/** Post the issue for a selection. It returns the answer of the server. */
export async function fileIssue(d, key, fetcher = fetch) {
  const res = await fetcher("/api/issues", { method: "POST", headers: { "Content-Type": "application/json", "X-Aleph-UI": "1" }, body: JSON.stringify(issueFor(d, key)) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? `Could not file the issue (${res.status}).`);
  return out;
}

const usageTable = (rows) => dataTable(heads(["Issue", "Usage", "Runs"], ["Usage", "Runs"]), rows.map((x) =>
  `<tr><td${x.title ? ` title="${esc(x.title)}"` : ""}>${x.href ? repoIdLink(x.goal, x.href) : esc(x.goal)}</td><td class="num">${esc(weekText(x.week))}</td><td class="num">${x.runs}</td></tr>`).join(""));

function usagePage(d, day, key) {
  const total = (d.classes ?? []).reduce((a, c) => a + c.hours, 0), nc = d.notCounted, s = selection(d, key);
  const scope = filterBar([{ name: "window", value: d.window ?? "week", options: WINDOWS }]);
  return `<div class="page sp" id="eff">${pageHead("Efficiency", { count: lastPeriod(d), aside: scope })}${tiles("Quality", scorecard(d, day, key))}` +
    card("Agent time by outcome", bar(d, key), { aside: `${esc(hours(total))} counted${nc?.runs ? ` · ${esc(plural(nc.runs, "run"))}, ${esc(hours(nc.hours))}, have no outcome yet` : ""}` }) +
    card("Usage per issue, largest first", s.top.length ? usageTable(s.top) : "<p>No issue to show.</p>") + `</div>`;
}

/** The page body for a selection. `day` is /api/speed for the last 24 h, or null. */
export function renderEfficiency(d, day, key = ALL) {
  if (key === USAGE) return usagePage(d, day, key);
  const s = selection(d, key), total = (d.classes ?? []).reduce((a, c) => a + c.hours, 0), nc = d.notCounted;
  const file = issueFor(d, key);
  const scope = filterBar([{ name: "window", value: d.window ?? "week", options: WINDOWS }]);
  return `<div class="page sp" id="eff">${pageHead("Efficiency", { count: lastPeriod(d), aside: scope })}${tiles("Quality", scorecard(d, day, key))}` +
    card("Agent time by outcome", bar(d, key), { aside: `${esc(hours(total))} counted${nc?.runs ? ` · ${esc(plural(nc.runs, "run"))}, ${esc(hours(nc.hours))}, have no outcome yet` : ""}` }) +
    card(`${s.title}, largest first`, `<p>${esc(s.text)} ${esc(s.size)}</p>${s.causes.length ? causeBars(s) : "<p>No cause to show.</p>"}`) +
    (key === FLAKES ? "" : card(`${s.title}: the issues that cost the most`, (s.top.length ? topTable(s.top) : "<p>No issue to show.</p>") +
      (file ? `<div class="actions"><button type="button" class="act primary" data-file>File an issue: ${esc(s.causes[0].name)}</button><span id="filed" class="quiet" role="status">The issue carries the runs and the reasons.</span></div>` : ""))) + `</div>`;
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
  api: (_params, q = new URLSearchParams()) => `/api/speed?window=${windowOf(q)}`,
  refresh: 60,
  render: (d, _params, q) => renderEfficiency(d, usable("day"), q?.get("tile") ?? ALL),
  mount: async (root, d) => {
    keepWindow(d.window ?? windowOf(hashQuery()));
    const draw = () => { root.innerHTML = renderEfficiency(d, usable("day"), picked()); wire(); };
    const wire = () => {
      const page = root.querySelector("#eff");
      wireScope(root);
      onTile(page, (k) => {
        setQuery({ tile: k === ALL ? "" : k });
        draw();
        root.querySelector(`.tiles button[data-tile="${k}"], .obar button[data-tile="${k}"]`)?.focus();
      });
      page?.addEventListener("click", async (e) => {
        const f = e.target.closest("button[data-file]");
        if (!f) return;
        const say = root.querySelector("#filed");
        f.disabled = true;
        try { const out = await fileIssue(d, picked()); say.textContent = `Filed${out.id ?? out.n ? ` ${REPO}-${out.id ?? out.n}` : ""}.`; }
        catch (err) { say.textContent = err.message; f.disabled = false; }
      });
    };
    wire();
    if (!trendOn(d)) return;
    await loadSpeed("day");
    if (root.querySelector("#eff")) draw();
  },
};
