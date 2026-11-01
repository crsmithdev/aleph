// The Efficiency page: where agent time went, in hours. `d` is /api/speed for the week.
import { esc, pageHead, repoIdLink } from "../lib.js";
import { causeRow, firstPassTile, hours, loadSpeed, lostClasses, lostTile, mergeCauses, pctText, plural, small, tile, trend, usable, weekText } from "./speed.js";

const TOP_ISSUES = 5;
const REPO = "aleph";
const ALL = "all";

let pick = ALL;
export const resetPick = () => { pick = ALL; };

/** What the cards show for a selection: a class, or all the lost classes together. */
export function selection(d, key) {
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

function tiles(d, day) {
  const fixed = (d.classes ?? []).find((c) => c.key === "fixed");
  return lostTile(d, day) + firstPassTile(d, day) +
    tile("Reruns", String(d.flaky), small("checks passed on rerun") + (day ? small(`${day.flaky} in the last 24 h`) : "")) +
    tile("Fix rounds", String(fixed?.runs ?? 0), small(`${hours(fixed?.hours ?? 0)} on ${plural(fixed?.issues ?? 0, "issue")}`)) +
    tile("Usage per issue", d.issues.week === null ? "–" : weekText(d.issues.week), small(d.issues.week === null ? "needs 6 hours of usage snapshots" : "of the weekly limit, median"));
}

function bar(d, key) {
  const cs = (d.classes ?? []).filter((c) => c.hours > 0), total = cs.reduce((a, c) => a + c.hours, 0);
  if (!(total > 0)) return `<p>No agent run of an issue ended in this period.</p>`;
  const label = (c) => `<b>${esc(c.name)}</b><span>${esc(hours(c.hours))} · ${Math.round((c.hours / total) * 100)}%</span>`;
  // Landed is the good part: only the others open a breakdown.
  const seg = (c) => (c.key === "landed"
    ? `<div class="seg-landed" style="flex:${c.hours}" title="${esc(c.text)}">${label(c)}</div>`
    : `<button type="button" class="seg-${esc(c.key)}" data-class="${esc(c.key)}" style="flex:${c.hours}" aria-pressed="${c.key === key}" title="${esc(c.text)}">${label(c)}</button>`);
  return `<div class="obar" role="group" aria-label="Agent time by outcome">${cs.map(seg).join("")}</div>`;
}

const topRow = (x) => `<div class="toprow"><span class="id">${x.href ? repoIdLink(x.goal, x.href) : esc(x.goal)}</span><span class="v">${esc(hours(x.hours))} · ${esc(plural(x.runs, "run"))}</span><span>${x.title ? `${esc(x.title)}. ` : ""}${esc(x.reason || "No reason recorded.")}</span></div>`;

/** The issue that "File an issue" files for a selection: its first cause as the title, its runs and reasons as the body. */
export function issueFor(d, key) {
  const s = selection(d, key), first = s.causes[0];
  if (!first) return null;
  const rows = s.top.map((x) => `- ${x.goal}: ${hours(x.hours)}, ${plural(x.runs, "run")}. ${x.reason || "No reason recorded."}`);
  return { repo: REPO, title: `Lost time: ${first.name}`, body: `${first.name}: ${hours(first.hours)}, ${plural(first.runs, "run")} in the last 7 days.\n\n${s.title}, the issues that cost the most:\n${rows.join("\n")}` };
}

/** Post the issue for a selection. It returns the answer of the server. */
export async function fileIssue(d, key, fetcher = fetch) {
  const res = await fetcher("/api/issues", { method: "POST", headers: { "Content-Type": "application/json", "X-Aleph-UI": "1" }, body: JSON.stringify(issueFor(d, key)) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? `Could not file the issue (${res.status}).`);
  return out;
}

/** The page body for a selection. `day` is /api/speed for the last 24 h, or null. */
export function renderEfficiency(d, day, key = pick) {
  const s = selection(d, key), total = (d.classes ?? []).reduce((a, c) => a + c.hours, 0), nc = d.notCounted;
  const on = key === ALL, max = s.causes[0]?.hours ?? 0;
  return `<div class="page sp" id="eff">${pageHead("Efficiency")}<section aria-label="Quality" class="tiles">${tiles(d, day)}</section>` +
    `<section aria-label="Agent time by outcome" class="card"><div class="cardhead"><h2>Agent time by outcome</h2><span>${esc(hours(total))} counted${nc?.runs ? ` · ${esc(plural(nc.runs, "run"))}, ${esc(hours(nc.hours))}, have no outcome yet` : ""}</span></div>${bar(d, key)}` +
    `<div><button type="button" class="btn" data-class="${ALL}" aria-pressed="${on}">All lost time, ${esc(hours(d.lost.hours))}</button></div></section>` +
    `<section class="card" aria-label="Causes"><h2>${esc(s.title)}, largest first</h2><p>${esc(s.text)} ${esc(s.size)}</p><div>${s.causes.map((x, i) => causeRow(`<b>${esc(x.name)}</b>`, x, max, i === 0)).join("") || "<p>No cause to show.</p>"}</div></section>` +
    `<section class="card" aria-label="Issues"><h2>${esc(s.title)}: the issues that cost the most</h2><div>${s.top.map(topRow).join("") || "<p>No issue to show.</p>"}</div>` +
    (s.causes[0] ? `<div class="filerow"><button type="button" class="btn primary" data-file>File an issue: ${esc(s.causes[0].name)}</button><span id="filed" role="status">The issue carries the runs and the reasons.</span></div>` : "") + `</section></div>`;
}

export const view = {
  path: "/status/efficiency",
  title: "Efficiency",
  group: "factory",
  order: 0.2,
  sub: true,
  icon: "chart-pie",
  api: "/api/speed?window=week",
  refresh: 60,
  render: (d) => renderEfficiency(d, usable("day")),
  mount: async (root, d) => {
    const draw = () => { root.innerHTML = renderEfficiency(d, usable("day")); wire(); };
    const wire = () => root.querySelector("#eff")?.addEventListener("click", async (e) => {
      const c = e.target.closest("button[data-class]");
      if (c) { pick = c.dataset.class; draw(); root.querySelector(`button[data-class="${pick}"]`)?.focus(); return; }
      const f = e.target.closest("button[data-file]");
      if (!f) return;
      const say = root.querySelector("#filed");
      f.disabled = true;
      try { const out = await fileIssue(d, pick); say.textContent = `Filed${out.id ?? out.n ? ` ${REPO}-${out.id ?? out.n}` : ""}.`; }
      catch (err) { say.textContent = err.message; f.disabled = false; }
    });
    wire();
    await loadSpeed("day");
    if (root.querySelector("#eff")) draw();
  },
};
