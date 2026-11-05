// The parts the Issue page and the Job page share: the KPI strip, the Detail panels, and the timeline,
// a waterfall of segments whose rows each hold a lane of bars and waits on one time axis, with the row's events beneath.
// Plain JS with no DOM, so the pages and the tests both import it.
import { legendHtml, dur, esc, money, shortModel, tag, when } from "./lib.js";

/** A gap between two runs that is longer than this is a wait. */
export const GAP = 60_000;

/** A store date or a note's stamp as ms in local time, as the CLI writes them; NaN for neither. */
export const localMs = (s) => Date.parse(String(s ?? "").replace(" ", "T") + (/^\d{4}-\d\d-\d\d$/.test(String(s ?? "")) ? "T00:00" : ""));

/** The time and text of a note line `- 2026-11-01 08:06: text`; null for one with no stamp. */
export function noteEvent(line) {
  const m = /^- (\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)?): (.*)$/s.exec(String(line));
  return m ? { at: localMs(m[1]), text: m[2] } : null;
}

/**
 * The position of each time as a share of the axis. Each span between two neighbouring times takes the
 * square root of its length, so a three-minute run stays visible beside a two-week wait, and the times stay in order.
 */
export function compactScale(times) {
  const at = [...new Set(times.filter(Number.isFinite))].sort((a, b) => a - b);
  const cum = [0];
  for (let i = 1; i < at.length; i++) cum.push(cum[i - 1] + Math.sqrt(at[i] - at[i - 1]));
  const total = cum.at(-1) || 1;
  return (t) => {
    const i = at.findLastIndex((x) => x <= t);
    if (i < 0) return 0;
    if (i === at.length - 1) return cum[i] / total;
    return (cum[i] + ((t - at[i]) / (at[i + 1] - at[i])) * (cum[i + 1] - cum[i])) / total;
  };
}

/** Up to `max` axis labels, each at least 24% from the one before. */
export function axisTimes(times, x, max = 5) {
  const out = [];
  for (const t of [...new Set(times)].sort((a, b) => a - b)) {
    if (!out.length || x(t) - x(out.at(-1)) >= 0.24) out.push(t);
  }
  return out.slice(0, max);
}

const BAD = ["failed", "stuck", "dropped"];
const AUX = ["intake", "triage", "plan", "facts", "explain", "firefighter", "director", "monitor"];
/** A run's bar colour: bad for a run that failed, land, aux for a run that does not build, else build. */
export const barTone = (r) => (BAD.includes(r.condition) ? "bad" : r.kind === "land" ? "land" : AUX.includes(r.kind) ? "aux" : "build");

/** A run's start and end in ms; a live run ends now, a run with no end ends where it started. */
export function spanOf(r, now = Date.now()) {
  const start = Date.parse(r.started), end = Date.parse(r.ended ?? "");
  return { r, start, end: end >= start ? end : r.condition === "running" ? now : start };
}

/** Runs as spans in start order, without the ones with no start. */
export const spans = (runs, now = Date.now()) => runs.map((r) => spanOf(r, now)).filter((s) => s.start >= 0).sort((a, b) => a.start - b.start);

/**
 * The waits of a lane: each gap over a minute between `from`, the runs and `to`. A wait after a run that
 * awaits Chris is his; any other is the factory's. `runs` are spans in start order.
 */
export function gaps(runs, from, to) {
  const out = [];
  let cursor = from, prev = null;
  for (const s of runs) {
    if (Number.isFinite(cursor) && s.start - cursor > GAP) out.push({ start: cursor, end: s.start, chris: prev?.condition === "awaiting" });
    cursor = Number.isFinite(cursor) ? Math.max(cursor, s.end) : s.end;
    prev = s.r;
  }
  if (Number.isFinite(to) && Number.isFinite(cursor) && to - cursor > GAP) out.push({ start: cursor, end: to, chris: prev?.condition === "awaiting" });
  return out;
}

/**
 * The minutes each hold reason covers inside a wait, in the order the reasons first happened. `holds` are
 * `{ at, name, kind, text }` oldest first; the hold in force at a moment is the last record at or before it,
 * and a `started` record ends it.
 */
function holdTimes(w, holds) {
  const recs = holds.map((h) => ({ ...h, t: Date.parse(h.at) })).filter((h) => Number.isFinite(h.t));
  const out = new Map();
  let cur = null, from = w.start;
  const close = (to) => {
    if (cur && to > from) out.set(cur, (out.get(cur) ?? 0) + (to - from));
    else if (cur && !out.has(cur)) out.set(cur, 0);
  };
  const apply = (h) => (h.kind === "started" || !h.text ? null : String(h.text));
  for (const h of recs) {
    if (h.t <= w.start) { cur = apply(h); continue; }
    if (h.t >= w.end) break;
    close(h.t);
    from = h.t;
    cur = apply(h);
  }
  close(w.end);
  return [...out].filter(([, ms]) => ms > 0);
}

/** A wait's event: its length, whose it is and, from `holds`, why. */
export function waitEvent(w, holds = []) {
  const reasons = Array.isArray(holds) ? holdTimes(w, holds) : []; // `waits.map(waitEvent)` passes an index
  const why = reasons.length ? `: ${reasons.map(([text, ms]) => `${dur(ms / 1000)} because ${text}`).join("; ")}` : "";
  return { at: w.start, tag: w.chris ? "Awaiting you" : "Waiting", tone: "need", html: esc(`Waited ${dur((w.end - w.start) / 1000)}${w.chris ? " for your answer" : ""}${why}.`) };
}

/** A label: the kind, a number when the lane has more than one of that kind, the model (not on a bar) and, with `cost`, the cost. */
export function barLabel(r, nth, { cost = false, model = true } = {}) {
  const kind = r.kind === "worker" ? "build" : r.kind;
  return [nth ? `${kind} ${nth}` : kind, model ? shortModel(r.model) : "", cost && r.cost ? money(r.cost) : ""].filter(Boolean).join(" · ");
}

/** The bars of a lane from its spans: the label of each, and a tip with the condition, the time and the reason. */
export function barsOf(runs, { cost = false } = {}) {
  const count = {}, seen = {};
  for (const { r } of runs) count[r.kind] = (count[r.kind] ?? 0) + 1;
  return runs.map(({ r, start, end }) => {
    seen[r.kind] = (seen[r.kind] ?? 0) + 1;
    const label = barLabel(r, count[r.kind] > 1 ? seen[r.kind] : 0, { cost, model: false });
    return { start, end, tone: barTone(r), label, tip: `${label} · ${r.condition} · ${dur((end - start) / 1000)}${r.reason ? ` · ${r.reason}` : ""}`, ...(r.name ? { href: `#/jobs/${encodeURIComponent(r.name)}` } : {}) };
  });
}


const LEGEND = { wait: "waiting", chris: "awaiting you", aux: "intake, facts", build: "build", bad: "failed or stuck", land: "land", made: "filed", done: "closed or accepted" };
const pct = (f) => (f * 100).toFixed(3);
/** The time on the page: "11/02 08:11". */
const timeOf = (at) => (Number.isFinite(at) ? when(new Date(at)) : "");

/**
 * The Timeline panel. `segments` is `[{ title, aside?, rows }]`; a row is
 * `{ head, bars: [{ start, end, tone, label, tip, href? }], waits: [{ start, end, chris }], marks: [{ at, tone: "made" | "done", tip }], result, time, cost, events: [{ at?, tag, tone, html }] }`.
 * "" for no rows; a row with nothing timed has an empty lane.
 */
export function renderTimeline(segments) {
  const rows = segments.flatMap((s) => s.rows);
  const times = rows.flatMap((r) => [...r.bars.flatMap((b) => [b.start, b.end]), ...r.waits.flatMap((w) => [w.start, w.end]), ...(r.marks ?? []).map((m) => m.at)]).filter(Number.isFinite);
  if (!rows.length) return "";
  const x = compactScale(times);
  const used = new Set(rows.flatMap((r) => [...r.bars.map((b) => b.tone), ...r.waits.map((w) => (w.chris ? "chris" : "wait")), ...(r.marks ?? []).map((m) => m.tone)]));
  const key = Object.entries(LEGEND).filter(([k]) => used.has(k)).map(([k, v]) => [v, `t-${k}`]);
  // A tick near the end ends at its time, so it stays inside the axis.
  const ticks = axisTimes(times, x).map((t) => `<span${x(t) > 0.9 ? ' class="end"' : ""} style="left:${pct(x(t))}%">${esc(timeOf(t))}</span>`).join("");
  const at = (a, b) => `left:${pct(x(a))}%;width:${pct(Math.max(0.004, x(b) - x(a)))}%`;
  // A bar too narrow for its label (about 600px of lane, 7px a letter) shows the first letter, as the land bar's clip did.
  const short = (b) => ((x(b.end) - x(b.start)) * 600 < b.label.length * 7 + 8 ? b.label.slice(0, 1) : b.label);
  const lane = (r) => `<div class="dp-lane">` +
    r.waits.map((w) => `<span class="dp-wait${w.chris ? " t-chris" : ""}" style="${at(w.start, w.end)}" title="${esc(`${w.chris ? "Awaiting you" : "Waiting"} · ${dur((w.end - w.start) / 1000)}`)}"></span>`).join("") +
    r.bars.map((b) => { const t = b.href ? "a" : "span"; return `<${t} class="dp-bar t-${b.tone}"${b.href ? ` href="${esc(b.href)}"` : ""} style="${at(b.start, b.end)}" title="${esc(b.tip ?? b.label)}">${esc(short(b))}</${t}>`; }).join("") +
    (r.marks ?? []).map((m) => `<span class="dp-mark t-${m.tone}" style="left:${pct(x(m.at))}%" title="${esc(m.tip ?? "")}"></span>`).join("") + `</div>`;
  // An event of more than about 3 lines (and with no log opening inside it) is clamped, with a button to read the rest.
  const evt = (html) => (!html.includes("data-logs") && html.replace(/<[^>]*>/g, "").length > 180
    ? `<div class="dp-evt"><div class="dp-txt clamp">${html}</div><button class="link dp-more" type="button" aria-expanded="false">Show more</button></div>`
    : `<div class="dp-evt">${html}</div>`);
  const events = (evs) => {
    const list = [...(evs ?? [])].sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
    return list.length ? `<div class="dp-evs">${list.map((e) => `<div class="dp-ev"><span class="dp-at">${esc(timeOf(e.at))}</span><span>${tag(e.tag, e.tone)}</span>${evt(e.html)}</div>`).join("")}</div>` : "";
  };
  const row = (r) => `<div class="dp-row"><div class="dp-tl"><div class="dp-head">${r.head}</div>${lane(r)}<span class="dp-res">${r.result ?? ""}</span><span class="num">${esc(r.time ?? "–")}</span><span class="num">${esc(r.cost ?? "–")}</span></div>${events(r.events)}</div>`;
  return `<section class="dp-panel dp-timeline" aria-labelledby="h-timeline"><div class="dp-ph"><h2 id="h-timeline">Timeline</h2>${legendHtml(key)}</div>` +
    `<div class="dp-scroll"><div class="dp-tl dp-axis"><span>Long spans are compressed</span><div class="dp-ticks">${ticks}</div><span>Result</span><span class="num">Time</span><span class="num">Cost</span></div>` +
    segments.filter((s) => s.rows.length).map((s) => `<div class="dp-seg"><h3>${esc(s.title)}</h3>${s.aside ? `<span class="quiet">${esc(s.aside)}</span>` : ""}</div>${s.rows.map(row).join("")}`).join("") +
    `</div></section>`;
}

/** The KPI strip: `[{ k, v, sub, text? }]`, where `v` and `sub` are HTML; a `text` value is words, set smaller than a figure. */
export const renderKpis = (items) => `<section class="dp-panel dp-kpis" aria-label="Summary">${items.map((i) => `<div class="dp-kpi"><span class="dp-k">${esc(i.k)}</span><span class="dp-v${i.text ? " text" : ""}">${i.v}</span>${i.sub ? `<span class="dp-sub">${i.sub}</span>` : ""}</div>`).join("")}</section>`;

/** A Detail panel, open: its title, an aside (HTML) beside it, and its body. */
export const fold = (title, aside, body) => `<details class="dp-panel dp-fold" open><summary><span>${esc(title)}</span>${aside ? `<span class="dp-aside">${aside}</span>` : ""}</summary><div class="dp-body">${body}</div></details>`;

/** A panel with a heading: the Spec, the Result, the Description. `body` is HTML; `aside` is HTML. */
export const panel = (id, title, body, aside = "") => `<section class="dp-panel dp-prose" aria-labelledby="h-${esc(id)}"><div class="dp-ph"><h2 id="h-${esc(id)}">${esc(title)}</h2>${aside ? `<span class="quiet">${aside}</span>` : ""}</div>${body}</section>`;

/** "$1.11", or "–" for none. */
export const costText = (n) => (n ? money(n) : "–");
/** "08:11 to 08:39" for a span in one day, else with the dates. */
export const fromTo = (a, b) => `${when(new Date(a))} to ${when(new Date(b))}`;

if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.(".dp-more");
    if (!b) return;
    const open = b.previousElementSibling.classList.toggle("clamp") === false;
    b.setAttribute("aria-expanded", String(open));
    b.textContent = open ? "Show less" : "Show more";
  });
}
